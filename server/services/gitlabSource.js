'use strict';
// GitLab connector (next to the GitHub one in sourceAwareService.js): branches, merge requests, commits,
// exact commit, code download and token check. Works with gitlab.com and a company's own GitLab server.
// The token (project or personal access token, scope read_repository / read_api) is only sent as a request header.

function baseUrl(repository) {
  const raw = String(repository?.api_base_url || process.env.GITLAB_BASE_URL || 'https://gitlab.com').trim().replace(/\/+$/, '');
  return raw;
}
function tokenFor(repository) {
  if (repository?.access_token_encrypted) {
    try { return require('./credentialVault').decrypt(repository.access_token_encrypted); } catch { /* unreadable */ }
  }
  return process.env.GITLAB_SOURCE_TOKEN || '';
}
function headers(repository, token = tokenFor(repository)) {
  const h = { Accept: 'application/json' };
  if (token) h['PRIVATE-TOKEN'] = token;
  return h;
}
// GitLab identifies a project by its full path (group/subgroup/project), URL-encoded.
function projectPath(repository) {
  const p = String(repository?.repo_full_name || '').trim();
  if (!/^[^/\s]+(\/[^/\s]+)+$/.test(p)) throw new Error('GitLab repository must use group/project format.');
  return encodeURIComponent(p);
}
function api(repository, pathAndQuery) {
  return baseUrl(repository) + '/api/v4/projects/' + projectPath(repository) + pathAndQuery;
}
async function get(repository, pathAndQuery, token) {
  const res = await fetch(api(repository, pathAndQuery), { headers: headers(repository, token) });
  if (res.status === 401) throw Object.assign(new Error('GitLab did not accept the token.'), { statusCode: 400 });
  if (res.status === 404) throw Object.assign(new Error('Not found on GitLab: check that the project, branch, merge request or commit exists' + (tokenFor(repository) || token ? ' and that the token can read it.' : '. A private project also needs a GitLab token.')), { statusCode: 404 });
  if (!res.ok) throw Object.assign(new Error('GitLab request failed (' + res.status + ').'), { statusCode: 502 });
  return res.json();
}

async function listBranches(repository) {
  const names = [];
  for (let page = 1; page <= 5; page += 1) {
    const rows = await get(repository, '/repository/branches?per_page=100&page=' + page);
    names.push(...(Array.isArray(rows) ? rows.map((b) => String(b.name || '')).filter(Boolean) : []));
    if (!Array.isArray(rows) || rows.length < 100) break;
  }
  return names;
}

// Merge requests (GitLab's pull requests): open first, then merged / closed. Same shape as GitHub pull requests.
async function listPullRequests(repository) {
  const data = [];
  for (let page = 1; page <= 2; page += 1) {
    const rows = await get(repository, '/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100&page=' + page);
    if (!Array.isArray(rows)) break;
    data.push(...rows);
    if (rows.length < 100) break;
  }
  const state = (m) => (m.state === 'opened' ? 'open' : m.state === 'merged' ? 'merged' : 'closed');
  return data.map((m) => ({ id: String(m.iid), number: m.iid, title: String(m.title || ''), state: state(m), branch: m.source_branch || '', sha: m.sha || '' }))
    .sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1));
}

async function listCommits(repository, branch) {
  const rows = await get(repository, '/repository/commits?per_page=50&ref_name=' + encodeURIComponent(branch || repository.default_branch || 'main'));
  return (Array.isArray(rows) ? rows : []).map((c) => ({ id: c.id, sha: c.id, message: String(c.title || c.message || '').split('\n')[0], date: c.created_at || null }));
}

async function checkToken(repository, token) {
  await get(repository, '', token);
}

// Branch → latest commit; merge request → its head commit; commit → full SHA.
async function resolveCommit(repository, type, target) {
  if (type === 'PULL_REQUEST') {
    const mr = await get(repository, '/merge_requests/' + encodeURIComponent(target));
    const sha = mr.sha || mr.diff_refs?.head_sha;
    if (!sha) throw new Error('Merge request !' + target + ' has no commit to scan.');
    return { sha, label: 'Merge request !' + mr.iid + ' · ' + mr.title };
  }
  const c = await get(repository, '/repository/commits/' + encodeURIComponent(target));
  return { sha: c.id, label: (type === 'COMMIT' ? 'Commit ' : 'Branch ' + target + ' @ ') + c.id.slice(0, 7) };
}

// The commit as a .tar.gz archive (top folder is stripped when unpacking).
async function downloadArchive(repository, sha) {
  // The archive is a file, not JSON: ask for any content type. GitLab sometimes answers 406 (or 5xx) while it
  // prepares the archive and succeeds moments later, so retry a few times with short waits.
  const url = api(repository, '/repository/archive.tar.gz?sha=' + encodeURIComponent(sha));
  let status = 0;
  for (const wait of [0, 3000, 6000, 10000, 15000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(url, { headers: { ...headers(repository), Accept: '*/*' }, redirect: 'follow' });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    status = res.status;
    if (res.status === 401 || res.status === 403 || res.status === 404) break; // no point retrying
  }
  throw Object.assign(new Error('Could not download the code from GitLab (' + status + ').'), { statusCode: 502 });
}

function webUrl(repository) { return baseUrl(repository) + '/' + String(repository.repo_full_name || ''); }

module.exports = { listBranches, listPullRequests, listCommits, checkToken, resolveCommit, downloadArchive, webUrl, baseUrl, tokenFor };
