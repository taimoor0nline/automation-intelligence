const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const RUN_MARKER_PREFIX = '--ai-testpilot-run-id=';

function safeRunId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function markerForRun(runId) {
  const safe = safeRunId(runId);
  return safe ? `${RUN_MARKER_PREFIX}${safe}` : RUN_MARKER_PREFIX;
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

async function cleanupAutomationBrowsers({ runId = '', reason = 'cleanup', log = true } = {}) {
  const pids = [...new Set(await ownedBrowserPids(runId))];
  if (!pids.length) return { found: 0, killed: 0, pids: [] };

  if (log) {
    console.warn(`[browser-cleanup] Found ${pids.length} AI TestPilot Chromium process${pids.length === 1 ? '' : 'es'} during ${reason}; terminating owned browser process tree(s).`);
  }
  for (const pid of pids) await terminatePidTree(pid);

  await new Promise((resolve) => setTimeout(resolve, 250));
  const remaining = await ownedBrowserPids(runId);
  const killed = Math.max(0, pids.length - remaining.length);
  if (log) console.log(`[browser-cleanup] ${reason}: ${remaining.length ? `${remaining.length} owned Chromium process(es) still detected` : 'owned Chromium cleanup complete'}.`);
  return { found: pids.length, killed, pids, remaining };
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
    const hardExit = setTimeout(() => process.exit(1), 5000);
    hardExit.unref?.();
    cleanupAutomationBrowsers({ reason: `server ${signal}`, log: true })
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
