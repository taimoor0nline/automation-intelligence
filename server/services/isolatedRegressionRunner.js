'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { generateDeterministicAutomation } = require('./deterministicAutomationGeneratorV7');
const { validateGroundedScript } = require('./scriptValidator');

const projectDir = path.resolve(__dirname, '..', '..', 'automation-system');
const configFile = path.join(projectDir, 'engine.config.js');
const specRoot = path.join(projectDir, 'tests', 'e2e', 'generated');
let busy = false;

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
async function executeIsolatedRegression(session, cases) {
  if (busy) return { ok: false, error: 'Another repair regression run is already executing.', code: 'REGRESSION_ENGINE_BUSY' };
  if (session.state === 'RUNNING') return { ok: false, error: 'A normal run is already executing in this session.', code: 'REGRESSION_SESSION_BUSY' };
  if (!Array.isArray(cases) || !cases.length) return { ok: false, error: 'No validated cases supplied.', code: 'REGRESSION_EMPTY' };
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
    const dir = fs.mkdtempSync(path.join(specRoot, 'repair-regression-'));
    temp = dir;
    const specName = 'repair-regression-' + randomUUID().slice(0, 8) + '.cy.js';
    const specPath = path.join(dir, specName);
    fs.writeFileSync(specPath, generated.script, { encoding: 'utf8', flag: 'wx' });
    const base = new URL(session.targetUrl);
    const cypress = require(path.join(projectDir, 'node_modules', 'cypress'));
    const run = await cypress.run({
      project: projectDir,
      configFile,
      testingType: 'e2e',
      browser: process.env.AUTOMATION_BROWSER || 'chrome',
      headed: false,
      headless: true,
      spec: path.relative(projectDir, specPath).replace(/\\/g, '/'),
      env: {
        TEST_USERNAME: session.credentials?.username || '',
        TEST_PASSWORD: session.credentials?.password || '',
        TEST_ACTORS_JSON: JSON.stringify(session.actorCredentials || {}),
        LOGIN_PATH: login.loginPath,
        LOGIN_USERNAME_SELECTOR: login.loginSelectors.username,
        LOGIN_PASSWORD_SELECTOR: login.loginSelectors.password,
        LOGIN_SUBMIT_SELECTOR: login.loginSelectors.submit,
        DEMO_STEP_DELAY_MS: '0',
      },
      config: {
        baseUrl: base.origin,
        video: false,
        screenshotOnRunFailure: false,
        trashAssetsBeforeRuns: false,
        screenshotsFolder: path.join(dir, 'screenshots'),
        downloadsFolder: path.join(dir, 'downloads'),
      },
    });
    if (!run?.runs?.length || run.status === 'failed')
      return { ok: false, error: String(run?.message || 'Cypress did not return a complete regression run.'), code: 'REGRESSION_ENGINE_FAILED' };
    const tests = run.runs.flatMap((part) => part.tests || []).map((test) => ({
      testCaseId: testIdFor(test),
      title: Array.isArray(test.title) ? test.title.join(' ') : test.title,
      pass: test.state === 'passed',
      state: test.state,
    }));
    return { ok: true, summary: { total: tests.length, passed: tests.filter((test) => test.pass).length, failed: tests.filter((test) => !test.pass).length, tests }, scriptHash: generated.scriptHash };
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: 'REGRESSION_EXECUTION_ERROR' };
  } finally {
    // Isolated spec and evidence are removed; normal-run artifacts are never cleared.
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    busy = false;
  }
}
module.exports = { executeIsolatedRegression, loginSelectorsFromPages };
