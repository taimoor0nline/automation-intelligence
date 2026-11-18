'use strict';
// CI-003: turn a branch, pull request or commit into the exact commit SHA that is scanned.
// CI-004: download that commit read-only into an isolated folder on the scanner host and remove it afterwards.
// The GitHub token is only sent as an HTTP header by this server; it never appears in a command, file or log.
const fs = require('fs');
const path = require('path');
const { githubHeaders, repoParts } = require('../sourceAwareService');
const runner = require('./runner');

const MAX_MB = Math.max(10, Math.min(Number(process.env.CI_MAX_REPO_MB || 500), 4000));

async function github(repository, urlPath) {
  const res = await fetch('https://api.github.com' + urlPath, { headers: githubHeaders(repository) });
  if (res.status === 404) throw Object.assign(new Error('Not found on GitHub (or the repository is private and needs a token).'), { statusCode: 404 });
  if (!res.ok) throw Object.assign(new Error('GitHub request failed (' + res.status + ').'), { statusCode: 502 });
  return res.json();
}

// Branch → its latest commit; pull request → its head commit; commit → its full SHA.
const gitlab = require('../gitlabSource');
const isGitLab = (repository) => String(repository?.provider || '').toLowerCase() === 'gitlab';

async function resolveCommit(repository, type, target) {
  if (isGitLab(repository)) return gitlab.resolveCommit(repository, type, target);
  const { owner, repo } = repoParts(repository.repo_full_name);
  const base = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  if (type === 'PULL_REQUEST') {
    const pr = await github(repository, base + '/pulls/' + encodeURIComponent(target));
    return { sha: pr.head.sha, label: 'Pull request #' + pr.number + ' · ' + pr.title };
  }
  const c = await github(repository, base + '/commits/' + encodeURIComponent(target));
  return { sha: c.sha, label: (type === 'COMMIT' ? 'Commit ' : 'Branch ' + target + ' @ ') + c.sha.slice(0, 7) };
}

// GitLab: fetch exactly one commit with git (shallow, no history) — GitLab's archive download is unreliable,
// and a merge request from a fork is only reachable through refs/merge-requests/<iid>/head.
// A token goes to git only as an environment variable (GIT_CONFIG_* auth header), never in a command line or file.
async function gitlabCheckout(repository, sha, runId, opts = {}) {
  const dir = runner.workDir(runId);
  const src = '$HOME/tnscans/' + runId + '/src';
  const url = gitlab.baseUrl(repository) + '/' + String(repository.repo_full_name) + '.git';
  const ref = opts.type === 'PULL_REQUEST' ? 'refs/merge-requests/' + String(opts.target).replace(/\D/g, '') + '/head' : sha;
  const token = gitlab.tokenFor(repository);
  const secretEnv = token ? { TN_GIT_AUTH: 'Authorization: Basic ' + Buffer.from('oauth2:' + token).toString('base64') } : null;
  const r = await runner.runScript(dir, 'checkout',
    'set -e\nrm -rf "$HOME/tnscans/' + runId + '"\nmkdir -p "' + src + '"\ncd "' + src + '"\ngit init -q .\n' +
    'if [ -n "$TN_GIT_AUTH" ]; then export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="$TN_GIT_AUTH"; fi\n' +
    'export GIT_TERMINAL_PROMPT=0\n' +
    'git fetch -q --depth 1 ' + runner.q(url) + ' ' + runner.q(ref) + '\n' +
    'git -c advice.detachedHead=false checkout -q FETCH_HEAD\n' +
    'echo "head=$(git rev-parse HEAD)"\n' +
    'rm -rf .git\n' + // only the files of this commit are scanned
    'chmod -R a-w .\n' + // read-only checkout
    'echo "files=$(find . -type f | wc -l)"', 10 * 60 * 1000, secretEnv);
  if (r.code !== 0) throw new Error('Could not get the code from GitLab: ' + (r.stderr || r.stdout).replace(/Authorization:[^\n]*/gi, '[hidden]').slice(0, 300));
  const head = (r.stdout.match(/head=([0-9a-f]{40})/) || [])[1];
  if (head && sha && head !== sha && opts.type !== 'PULL_REQUEST') throw new Error('GitLab returned a different commit than requested.');
  return { files: Number((r.stdout.match(/files=(\d+)/) || [])[1] || 0), bytes: 0, head };
}

// Download the commit and unpack it into $HOME/tnscans/<runId>/src on the scanner host (GitHub: archive; GitLab: git).
async function checkout(repository, sha, runId, opts = {}) {
  if (isGitLab(repository)) return gitlabCheckout(repository, sha, runId, opts);
  const dir = runner.workDir(runId);
  const archive = path.join(dir, 'source.tar.gz');
  let buf;
  {
    const { owner, repo } = repoParts(repository.repo_full_name);
    const res = await fetch('https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/tarball/' + encodeURIComponent(sha), { headers: githubHeaders(repository), redirect: 'follow' });
    if (!res.ok) throw Object.assign(new Error('Could not download the code from GitHub (' + res.status + ').'), { statusCode: 502 });
    buf = Buffer.from(await res.arrayBuffer());
  }
  if (buf.length > MAX_MB * 1024 * 1024) throw new Error('Repository archive is larger than ' + MAX_MB + ' MB (CI_MAX_REPO_MB).');
  fs.writeFileSync(archive, buf);
  const src = '$HOME/tnscans/' + runId + '/src';
  const r = await runner.runScript(dir, 'checkout',
    'set -e\nrm -rf "$HOME/tnscans/' + runId + '"\nmkdir -p "' + src + '"\n' +
    'tar -xzf ' + runner.q(runner.hostPath(archive)) + ' --strip-components=1 -C "' + src + '" --no-same-owner\n' +
    'chmod -R a-w "' + src + '"\n' + // read-only checkout
    'echo "files=$(find "' + src + '" -type f | wc -l)"', 10 * 60 * 1000);
  try { fs.unlinkSync(archive); } catch {}
  if (r.code !== 0) throw new Error('Could not unpack the code on the scanner host: ' + (r.stderr || r.stdout).slice(0, 300));
  return { files: Number((r.stdout.match(/files=(\d+)/) || [])[1] || 0), bytes: buf.length };
}

// Always called after a scan (completed, failed or cancelled).
async function cleanup(runId) {
  const dir = runner.workDir(runId);
  await runner.runScript(dir, 'cleanup', 'chmod -R u+w "$HOME/tnscans/' + runId + '" 2>/dev/null; rm -rf "$HOME/tnscans/' + runId + '"', 2 * 60 * 1000).catch(() => {});
  runner.removeWorkDir(runId);
}

module.exports = { resolveCommit, checkout, cleanup };
