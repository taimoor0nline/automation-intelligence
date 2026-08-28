const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RUN_MARKER_PREFIX = '--ai-testpilot-run-id=';
const DEFAULT_CLEANUP_ATTEMPTS = 5;
const DEFAULT_VERIFY_DELAY_MS = 450;

function safeRunId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function markerForRun(runId) {
  const safe = safeRunId(runId);
  return safe ? `${RUN_MARKER_PREFIX}${safe}` : RUN_MARKER_PREFIX;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function windowsAutomationPids(marker) {
  const escaped = String(marker).replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    `$marker='${escaped}'`,
    "$names=@('chrome.exe','chromium.exe','msedge.exe')",
    "$items=Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name -and $_.CommandLine -and $_.CommandLine.Contains($marker) }",
    "$items | ForEach-Object { $_.ProcessId }",
  ].join('; ');
  try {
    const { stdout = '' } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout)
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

async function posixAutomationPids(marker) {
  try {
    const { stdout = '' } = await execFileAsync('pgrep', ['-f', marker], { timeout: 5000, maxBuffer: 1024 * 1024 });
    return String(stdout)
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
  } catch {
    return [];
  }
}

async function ownedBrowserPids(runId = '') {
  const marker = markerForRun(runId);
  return process.platform === 'win32'
    ? windowsAutomationPids(marker)
    : posixAutomationPids(marker);
}

async function terminatePidTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10000,
      });
    } catch {}
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

async function cleanupAutomationBrowsers({
  runId = '',
  reason = 'cleanup',
  log = true,
  attempts = DEFAULT_CLEANUP_ATTEMPTS,
  verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
} = {}) {
  const maxAttempts = Math.max(1, Math.min(Number(attempts) || DEFAULT_CLEANUP_ATTEMPTS, 10));
  const waitMs = Math.max(100, Math.min(Number(verifyDelayMs) || DEFAULT_VERIFY_DELAY_MS, 2000));
  const firstPids = [...new Set(await ownedBrowserPids(runId))];

  if (!firstPids.length) {
    if (log && runId) console.log(`[browser-cleanup] ${reason}: verified no owned Chromium processes remain.`);
    return { found: 0, killed: 0, pids: [], remaining: [], verifiedGone: true, attempts: 0 };
  }

  if (log) {
    console.warn(`[browser-cleanup] Found ${firstPids.length} AI TestPilot Chromium process${firstPids.length === 1 ? '' : 'es'} during ${reason}; terminating owned browser process tree(s).`);
  }

  let remaining = firstPids;
  let attempt = 0;
  while (remaining.length && attempt < maxAttempts) {
    attempt += 1;
    const targets = [...new Set(remaining)];
    if (log) console.log(`[browser-cleanup] ${reason}: cleanup attempt ${attempt}/${maxAttempts} for ${targets.length} owned Chromium process(es).`);
    for (const pid of targets) await terminatePidTree(pid);
    await delay(waitMs);
    remaining = [...new Set(await ownedBrowserPids(runId))];
  }

  const killed = Math.max(0, firstPids.length - remaining.length);
  const verifiedGone = remaining.length === 0;
  if (log) {
    if (verifiedGone) {
      console.log(`[browser-cleanup] ${reason}: verified all AI TestPilot Chromium processes are closed.`);
    } else {
      console.warn(`[browser-cleanup] ${reason}: ${remaining.length} owned Chromium process(es) still detected after ${attempt} cleanup attempt(s): ${remaining.join(', ')}. Test results remain valid and will still be returned.`);
    }
  }

  // Cleanup is a lifecycle concern, not a test-result concern. Never throw here:
  // a Windows process that is slow to terminate must not erase already-captured PASS/FAIL results.
  return {
    found: firstPids.length,
    killed,
    pids: firstPids,
    remaining,
    verifiedGone,
    attempts: attempt,
    warning: verifiedGone ? null : 'AUTOMATION_BROWSER_CLEANUP_INCOMPLETE',
  };
}

function installBrowserCleanupLifecycle() {
  if (global.__aiTestPilotBrowserCleanupLifecycleInstalled) return;
  global.__aiTestPilotBrowserCleanupLifecycleInstalled = true;

  setImmediate(() => {
    cleanupAutomationBrowsers({ reason: 'server startup stale cleanup', log: true }).catch(() => {});
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[browser-cleanup] ${signal} received; cleaning AI TestPilot browser processes before exit.`);
    const hardExit = setTimeout(() => process.exit(1), 8000);
    hardExit.unref?.();
    cleanupAutomationBrowsers({ reason: `server ${signal}`, log: true, attempts: 6, verifyDelayMs: 500 })
      .catch(() => {})
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

installBrowserCleanupLifecycle();

module.exports = {
  RUN_MARKER_PREFIX,
  safeRunId,
  markerForRun,
  ownedBrowserPids,
  cleanupAutomationBrowsers,
  installBrowserCleanupLifecycle,
};
