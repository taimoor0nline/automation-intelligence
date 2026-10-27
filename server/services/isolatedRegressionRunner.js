'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const { generateDeterministicAutomation } = require('./deterministicAutomationGeneratorV7');
const { validateGroundedScript } = require('./scriptValidator');
const { hasActiveExecutions } = require('./singleSpecRunner');

const projectDir = path.resolve(__dirname, '..', '..', 'automation-system');
const configFile = path.join(projectDir, 'engine.config.js');
const cypressBin = path.join(projectDir, 'node_modules', 'cypress', 'bin', 'cypress');
const specRoot = path.join(projectDir, 'tests', 'e2e', 'repair-validation');
let busy = false;
const isRegressionBusy = () => busy;

function loginSelectorsFromPages(pages = []) {
  const entries = pages.flatMap((page) => (page?.elements || []).map((element) => ({ page, element })));
  const selector = (element) => element?.selector || (element?.testId ? '[data-testid="' + element.testId + '"]' : '') || (element?.id ? '#' + element.id : '') || '';
  const email = entries.find(({ element }) => /^(email|username|user-name|login-username)$/i.test(String(element.id || element.name || element.testId || ''))) ||
    entries.find(({ element }) => /email|user.?name/i.test(String(element.label || '')) && element.type !== 'password');
  const password = entries.find(({ element }) => String(element.type || '').toLowerCase() === 'password');
  const submit = entries.find(({ element }) => /sign.?in|log.?in|login/i.test(String(element.text || element.label || element.id || element.testId || '')) && (element.tag === 'button' || element.type === 'submit'));
  const loginPage = email?.page || password?.page || submit?.page || pages[0] || {};
  let loginPath = '/';
  try { const u = new URL(loginPage.finalUrl || loginPage.url); loginPath = u.pathname + u.search; } catch {}
  return {
    loginPath,
    loginSelectors: { username: selector(email?.element), password: selector(password?.element), submit: selector(submit?.element) },
  };
}
function testIdFor(test) {
  const text = Array.isArray(test?.title) ? test.title.join(' ') : String(test?.title || '');
  return text.match(/TC(?:\d{3}|-H\d{3})/i)?.[0]?.toUpperCase() || null;
}
function stopProcess(pid) {
  if (!pid) return;
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(pid, 'SIGTERM'); } catch {} }
}
function runCli(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let settled = false;
    let logTail = '';
    const capture = (buf) => { logTail = (logTail + String(buf)).slice(-2000); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopProcess(child.pid);
      resolve({ timeout: true, code: null, logTail });
    }, timeoutMs);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ error: err.message, code: null, logTail });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, logTail });
    });
  });
}
async function executeIsolatedRegression(session, cases) {
  if (busy) return { ok: false, error: 'Another repair regression run is already executing.', code: 'REGRESSION_ENGINE_BUSY' };
  if (session.state === 'RUNNING' || hasActiveExecutions()) return { ok: false, error: 'A normal browser execution is active. Regression must wait for isolated runner access.', code: 'REGRESSION_SESSION_BUSY' };
  if (!Array.isArray(cases) || !cases.length) return { ok: false, error: 'No validated cases supplied.', code: 'REGRESSION_EMPTY' };
  if (!fs.existsSync(cypressBin)) return { ok: false, error: 'The Cypress automation engine is not installed.', code: 'REGRESSION_ENGINE_MISSING' };
  busy = true;
  let temp = null;
  try {
    const generated = generateDeterministicAutomation(cases);
    const login = loginSelectorsFromPages(session.pageDiscoveries);
    const hasCredentials = Boolean(session.credentials?.username && session.credentials?.password);
    const actorCredentialRefs = Object.entries(session.actorCredentials || {})
      .filter(([, credentials]) => credentials?.username && credentials?.password).map(([key]) => key);
    const source = validateGroundedScript(generated.script, {
      approvedTestCases: cases,
      pageDiscoveries: session.pageDiscoveries || [],
      hasCredentials,
      loginSelectors: login.loginSelectors,
      actorCredentialRefs,
      frameworkOwnedSelectors: ['body'],
    });
    if (!source.valid) return { ok: false, error: 'Regression artifact failed strict source validation: ' + (source.errors || []).join('; '), code: 'REGRESSION_SOURCE_INVALID' };
    fs.mkdirSync(specRoot, { recursive: true });
    const dir = fs.mkdtempSync(path.join(specRoot, 'run-'));
    temp = dir;
    const specName = 'repair-regression-' + randomUUID().slice(0, 8) + '.cy.js';
    const specPath = path.join(dir, specName);
    const resultFile = path.join(dir, 'results.json');
    fs.writeFileSync(specPath, generated.script, { encoding: 'utf8', flag: 'wx' });
    const base = new URL(session.targetUrl);
    const env = {
      ...process.env,
      AUTOMATION_BASE_URL: base.origin,
      AUTOMATION_RESULT_FILE: resultFile,
      AUTOMATION_PROGRESS_FILE: path.join(dir, 'progress.json'),
      AUTOMATION_LIVE_STREAM: 'false',
      AUTOMATION_CDP_INFO_FILE: path.join(dir, 'cdp.json'),
      AUTOMATION_LIVE_STATE_FILE: path.join(dir, 'live-state.json'),
      AUTOMATION_CAPTURE_BROWSER_EVIDENCE: 'false',
      AUTOMATION_SCREENSHOT_EACH_TEST: 'false',
      AUTOMATION_TEST_COMPLETION_PAUSE_MS: '0',
      AUTOMATION_VIDEO: 'false',
      AUTOMATION_SCREENSHOT_ON_FAILURE: 'false',
      TEST_USERNAME: session.credentials?.username || '',
      TEST_PASSWORD: session.credentials?.password || '',
      TEST_ACTORS_JSON: JSON.stringify(session.actorCredentials || {}),
      LOGIN_PATH: login.loginPath,
      LOGIN_USERNAME_SELECTOR: login.loginSelectors.username,
      LOGIN_PASSWORD_SELECTOR: login.loginSelectors.password,
      LOGIN_SUBMIT_SELECTOR: login.loginSelectors.submit,
      DEMO_STEP_DELAY_MS: '0',
    };
    const args = [
      cypressBin, 'run', '--project', projectDir, '--config-file', configFile,
      '--spec', path.relative(projectDir, specPath).replace(/\\/g, '/'),
      '--browser', process.env.AUTOMATION_BROWSER || 'chrome', '--headless',
    ];
    const timeoutMs = Math.max(60000, Math.min(Number(process.env.REPAIR_REGRESSION_TIMEOUT_MS || 300000), 900000));
    const cli = await runCli(args, env, timeoutMs);
    if (cli.timeout) return { ok: false, code: 'REGRESSION_TIMEOUT', error: 'Cypress exceeded the regression timeout.' };
    if (!fs.existsSync(resultFile)) return { ok: false, code: 'REGRESSION_NO_RESULTS', error: 'Cypress produced no completion record: ' + (cli.error || cli.logTail) };
    const raw = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (!Array.isArray(raw.tests) || raw.total !== raw.tests.length)
      return { ok: false, code: 'REGRESSION_INCOMPLETE', error: 'Cypress returned incomplete test results.' };
    const tests = raw.tests.map((test) => ({
      testCaseId: testIdFor(test),
      title: test.title,
      pass: test.state === 'passed',
      state: test.state,
    }));
    return {
      ok: true,
      summary: { total: tests.length, passed: tests.filter((test) => test.pass).length, failed: tests.filter((test) => !test.pass).length, tests },
      scriptHash: generated.scriptHash,
    };
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: 'REGRESSION_EXECUTION_ERROR' };
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    busy = false;
  }
}
module.exports = { executeIsolatedRegression, loginSelectorsFromPages, isRegressionBusy };
