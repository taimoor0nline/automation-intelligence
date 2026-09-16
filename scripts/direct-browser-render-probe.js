const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT_DIR = path.join(ROOT, 'automation-system', 'artifacts', 'discovery');
const DEFAULT_TARGET = 'http://127.0.0.1:4000/capabilities.html';

function existingFile(candidates = []) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolveChrome() {
  const explicit = String(process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN || '').trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  if (process.platform === 'win32') {
    return existingFile([
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]);
  }

  if (process.platform === 'darwin') {
    return existingFile([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ]);
  }

  return existingFile([
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]);
}

function clean(value, max = 1600) {
  return String(value || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-max);
}

function terminateProcessTree(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch {}
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('close', resolve);
    killer.once('error', resolve);
  });
}

function runChrome(chromePath, target, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnexus-direct-render-'));
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-popup-blocking',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${profileDir}`,
      `--virtual-time-budget=${Math.max(1000, Math.min(Number(process.env.DIRECT_BROWSER_VIRTUAL_TIME_MS || 8000), 20000))}`,
      '--dump-dom',
      target,
    ];

    const child = spawn(chromePath, args, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    child.stdout.on('data', (chunk) => {
      stdout.push(Buffer.from(chunk));
      stdoutBytes += chunk.length;
      if (stdoutBytes > 12 * 1024 * 1024) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr.push(Buffer.from(chunk));
      stderrBytes += chunk.length;
      if (stderrBytes > 2 * 1024 * 1024) stderr.shift();
    });

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => {
        const err = new Error(`Direct Chrome render exceeded ${Math.round(timeoutMs / 1000)} seconds.`);
        err.code = 'DIRECT_BROWSER_TIMEOUT';
        finish(err);
      });
    }, timeoutMs);
    timer.unref?.();

    child.once('error', (err) => finish(err));
    child.once('close', (code, signal) => {
      finish(null, {
        code,
        signal: signal || null,
        html: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

(async () => {
  const target = String(process.argv[2] || process.env.RENDERED_DISCOVERY_SMOKE_URL || DEFAULT_TARGET).trim();
  const parsed = new URL(target);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Target must be an http:// or https:// URL.');

  const chromePath = resolveChrome();
  if (!chromePath) {
    const err = new Error('Google Chrome/Chromium was not found. Set CHROME_PATH to the browser executable if it is installed in a non-standard location.');
    err.code = 'CHROME_NOT_FOUND';
    throw err;
  }

  console.log(`direct-browser-render-probe: target=${target}`);
  console.log(`direct-browser-render-probe: chrome=${chromePath}`);

  const result = await runChrome(chromePath, target);
  const html = String(result.html || '').trim();
  const stderrTail = clean(result.stderr);

  if (result.code !== 0) {
    const err = new Error(`Chrome exited with code ${result.code}${result.signal ? ` signal=${result.signal}` : ''}${stderrTail ? `: ${stderrTail}` : '.'}`);
    err.code = 'DIRECT_BROWSER_PROCESS_FAILED';
    throw err;
  }
  if (!/<html[\s>]/i.test(html) || html.length < 500) {
    const err = new Error(`Chrome exited successfully but did not emit a usable rendered DOM (${Buffer.byteLength(html)} bytes)${stderrTail ? `: ${stderrTail}` : '.'}`);
    err.code = 'DIRECT_BROWSER_DOM_MISSING';
    throw err;
  }

  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const output = path.join(ARTIFACT_DIR, `direct-browser-render-${Date.now()}.html`);
  fs.writeFileSync(output, html, 'utf8');

  const $ = cheerio.load(html);
  const title = $('title').first().text().replace(/\s+/g, ' ').trim();
  const elementCount = $('*').length;
  const interactiveCount = $('input,textarea,select,button,a[href],[role="button"],[role="link"],[role="combobox"],[role="checkbox"],[role="radio"]').length;

  console.log(`direct-browser-render-probe: PASS (${Buffer.byteLength(html)} rendered bytes; elements=${elementCount}; interactive=${interactiveCount}${title ? `; title=${JSON.stringify(title)}` : ''})`);
  console.log(`direct-browser-render-probe: artifact=${output}`);
})().catch((err) => {
  console.error(`direct-browser-render-probe: FAIL: ${err.code || 'ERROR'} ${err.message}`);
  process.exit(1);
});
