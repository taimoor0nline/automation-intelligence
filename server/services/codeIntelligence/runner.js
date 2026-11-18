'use strict';
// Runs scanner commands on the scanner host (CI-007).
// Windows development laptop: inside WSL (Linux), e.g. "Ubuntu". Linux server: directly with bash.
// Commands are written to a script file (never built from a command line with user text) and run with a time limit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODE = String(process.env.CI_SCANNER_RUNNER || (process.platform === 'win32' ? 'wsl' : 'local')).toLowerCase();
const DISTRO = process.env.CI_WSL_DISTRO || 'Ubuntu';
const WORK_ROOT = path.join(os.tmpdir(), 'testnexus-code-scans');

// C:\Users\x\file → /mnt/c/Users/x/file (WSL view of a Windows path). On Linux the path is used as is.
function hostPath(p) {
  if (MODE !== 'wsl') return p;
  const m = String(p).match(/^([A-Za-z]):[\\/](.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : String(p).replace(/\\/g, '/');
}

// Single-quote a value for bash.
function q(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }

function workDir(runId) {
  const dir = path.join(WORK_ROOT, String(runId).replace(/[^a-z0-9-]/gi, ''));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Run a bash script on the scanner host. Resolves {code, stdout, stderr, timedOut}.
// secretEnv: values (e.g. a git auth header) passed only as environment variables — never written into the script,
// a command line or a log. In WSL they are forwarded with WSLENV.
function runScript(dir, name, body, timeoutMs, secretEnv = null) {
  const file = path.join(dir, name + '.sh');
  fs.writeFileSync(file, '#!/usr/bin/env bash\nexport PATH="$HOME/.local/bin:$PATH"\n' + body + '\n', { encoding: 'utf8' });
  const cmd = MODE === 'wsl' ? 'wsl.exe' : 'bash';
  const args = MODE === 'wsl' ? ['-d', DISTRO, '--', 'bash', hostPath(file)] : [file];
  let env;
  if (secretEnv && Object.keys(secretEnv).length) {
    env = { ...process.env, ...secretEnv };
    if (MODE === 'wsl') env.WSLENV = [process.env.WSLENV, ...Object.keys(secretEnv).map((k) => k + '/u')].filter(Boolean).join(':');
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, ...(env ? { env } : {}) });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (d) => { if (stdout.length < 200000) stdout += d.toString('utf8').replace(/\0/g, ''); });
    child.stderr.on('data', (d) => { if (stderr.length < 20000) stderr += d.toString('utf8').replace(/\0/g, ''); });
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err.message), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

function removeWorkDir(runId) {
  try { fs.rmSync(path.join(WORK_ROOT, String(runId).replace(/[^a-z0-9-]/gi, '')), { recursive: true, force: true }); } catch {}
}

module.exports = { MODE, DISTRO, hostPath, q, workDir, runScript, removeWorkDir };
