const db = require('../db');

const MAX_TREE_FILES = Math.max(50, Math.min(Number(process.env.SOURCE_MAX_TREE_FILES || 800), 3000));
const MAX_CANDIDATES = Math.max(3, Math.min(Number(process.env.SOURCE_MAX_CANDIDATES || 8), 20));
const MAX_FILE_BYTES = Math.max(20000, Math.min(Number(process.env.SOURCE_MAX_FILE_BYTES || 180000), 500000));
const ALLOWED_EXTENSIONS = new Set(['.js','.jsx','.ts','.tsx','.cs','.java','.py','.php','.rb','.go','.vue','.svelte','.html']);

// The repository's own token (Source code card, stored encrypted) first; otherwise the server's GITHUB_SOURCE_TOKEN.
function tokenFor(repository) {
  if (repository?.access_token_encrypted) {
    try { return require('./credentialVault').decrypt(repository.access_token_encrypted); } catch { /* unreadable: fall back */ }
  }
  return process.env.GITHUB_SOURCE_TOKEN || '';
}
function githubHeaders(repository, token = tokenFor(repository)) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function repoParts(fullName) {
  const [owner, repo] = String(fullName || '').trim().split('/');
  if (!owner || !repo) throw new Error('Repository must use owner/name format.');
  return { owner, repo };
}

function ext(filePath) {
  const match = String(filePath || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] || '';
}

function tokenizeFailure({ testCase, expected, actual, analysis }) {
  const text = [
    testCase?.title,
    JSON.stringify(testCase?.steps || []),
    JSON.stringify(testCase?.testData || {}),
    ...(testCase?.expectedResults || []),
    expected,
    actual,
    analysis?.probableCause,
    analysis?.developerReviewArea,
  ].filter(Boolean).join(' ').toLowerCase();
  const stop = new Set(['the','and','for','with','from','that','this','should','must','when','then','into','because','expected','actual','application','validation','test','case','failed','error','element','visible','non','empty','data-testid','type','click','value']);
  return [...new Set((text.match(/[a-z][a-z0-9_-]{2,}/g) || []).filter((w) => !stop.has(w)))].slice(0, 36);
}

async function fetchJson(url, repository) {
  const res = await fetch(url, { headers: githubHeaders(repository) });
  if (!res.ok) throw new Error(`GitHub source request failed (${res.status}).`);
  return res.json();
}

async function getRepository(repositoryId) {
  if (!repositoryId || !db.isConfigured()) return null;
  const result = await db.query(
    `select id,project_id,provider,api_base_url,repo_full_name,default_branch,repository_url,source_enabled,access_token_encrypted
       from source_repositories where id=$1`, [repositoryId]
  );
  return result.rows[0] || null;
}

async function listTree(repository) {
  const { owner, repo } = repoParts(repository.repo_full_name);
  const branch = repository.default_branch || 'main';
  const ref = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, repository);
  const commit = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(ref.object.sha)}`, repository);
  const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`, repository);
  return (data.tree || [])
    .filter((item) => item.type === 'blob' && ALLOWED_EXTENSIONS.has(ext(item.path)))
    .slice(0, MAX_TREE_FILES);
}

async function fetchRepositoryFile(repository, filePath) {
  const { owner, repo } = repoParts(repository.repo_full_name);
  const branch = repository.default_branch || 'main';
  const encodedPath = String(filePath).split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const data = await fetchJson(url, repository);
  if (!data || data.type !== 'file' || data.encoding !== 'base64' || !data.content) throw new Error('GitHub did not return a readable source file.');
  return Buffer.from(String(data.content).replace(/\s/g, ''), 'base64').toString('utf8').slice(0, MAX_FILE_BYTES);
}

function scorePath(filePath, tokens) {
  const lower = String(filePath || '').toLowerCase();
  let score = 0;
  for (const token of tokens) if (lower.includes(token)) score += token.length >= 6 ? 4 : 2;
  if (/server|api|service|controller|validator|validation|form|feedback|auth|login/i.test(lower)) score += 1;
  if (/test|spec|dist|build|node_modules|vendor/i.test(lower)) score -= 2;
  return score;
}

function isCommonRuntimeFile(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return /(^|\/)(server|app|index|main|api|controller|service|validator|validation)\.(js|jsx|ts|tsx|cs|java|py|php|rb|go)$/i.test(lower) ||
    /(^|\/)(controllers?|services?|validators?|validation)\//i.test(lower);
}

function chooseCandidates(tree, tokens) {
  const scored = tree.map((item) => ({ ...item, pathScore: scorePath(item.path, tokens) }));
  const highSignal = [...scored].sort((a,b) => b.pathScore - a.pathScore).slice(0, Math.max(MAX_CANDIDATES * 2, 10));
  const runtimeQuota = scored.filter((item) => isCommonRuntimeFile(item.path)).slice(0, Math.max(8, MAX_CANDIDATES));
  const selected = new Map();
  for (const item of [...highSignal, ...runtimeQuota]) {
    if (!selected.has(item.path)) selected.set(item.path, item);
    if (selected.size >= Math.max(MAX_CANDIDATES * 3, 18)) break;
  }
  return [...selected.values()];
}

function scoreContent(content, tokens) {
  const lower = String(content || '').toLowerCase();
  let score = 0;
  for (const token of tokens) if (lower.includes(token)) score += token.length >= 6 ? 4 : 2;
  return score;
}

function snippets(content, tokens) {
  const lines = String(content || '').split(/\r?\n/);
  const indexes = [];
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (tokens.some((t) => lower.includes(t))) indexes.push(i);
    if (indexes.length >= 3) break;
  }
  return indexes.map((idx) => ({
    startLine: Math.max(1, idx - 1),
    endLine: Math.min(lines.length, idx + 3),
    text: lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 3)).join('\n'),
  }));
}

async function buildSourceContext({ repositoryId, testCase, expected, actual, analysis }) {
  const repository = await getRepository(repositoryId);
  if (!repository || !repository.source_enabled) return null;
  // Reading source files to explain failed tests is GitHub-only for now; GitLab repositories are used for code scans.
  if (isGitLab(repository)) return null;
  const tokens = tokenizeFailure({ testCase, expected, actual, analysis });
  const tree = await listTree(repository);
  const pathCandidates = chooseCandidates(tree, tokens);

  const inspected = [];
  for (const item of pathCandidates) {
    try {
      const content = await fetchRepositoryFile(repository, item.path);
      const contentScore = scoreContent(content, tokens);
      inspected.push({
        path: item.path,
        score: item.pathScore + contentScore,
        snippets: snippets(content, tokens),
        repositoryUrl: repository.repository_url || `https://github.com/${repository.repo_full_name}`,
      });
    } catch (err) {
      console.warn('[source-aware] unable to inspect', item.path, err.message);
    }
  }

  const files = inspected
    .sort((a,b) => b.score - a.score)
    .filter((item) => item.score > 0 && item.snippets.length > 0)
    .slice(0, MAX_CANDIDATES);

  return {
    mode: 'SOURCE_AWARE',
    repositoryId: repository.id,
    repoFullName: repository.repo_full_name,
    branch: repository.default_branch || 'main',
    searchTokens: tokens,
    candidateFiles: files,
    sourceVerified: files.length > 0,
  };
}

// Branch names of a linked repository (story form → Code branch). Private repositories need GITHUB_SOURCE_TOKEN.
const isGitLab = (repository) => String(repository?.provider || '').toLowerCase() === 'gitlab';
async function listBranches(repository) {
  if (isGitLab(repository)) return require('./gitlabSource').listBranches(repository);
  const { owner, repo } = repoParts(repository.repo_full_name);
  const names = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`, { headers: githubHeaders(repository) });
    if (res.status === 404) throw Object.assign(new Error(tokenFor(repository) ? 'Repository not found, or the token cannot read it.' : 'Repository not found. A private repository needs a GitHub token.'), { statusCode: 404 });
    if (!res.ok) throw Object.assign(new Error(`GitHub branch list failed (${res.status}).`), { statusCode: 502 });
    const data = await res.json();
    names.push(...(Array.isArray(data) ? data.map((b) => String(b.name || '')).filter(Boolean) : []));
    if (!Array.isArray(data) || data.length < 100) break;
  }
  return names;
}

// Pull requests of a linked repository (story → Scan by → Pull request): open ones first, then recently merged/closed.
async function listPullRequests(repository) {
  if (isGitLab(repository)) return require('./gitlabSource').listPullRequests(repository);
  const { owner, repo } = repoParts(repository.repo_full_name);
  // Up to 200 pull requests (2 pages of 100), most recently updated first.
  const data = [];
  for (let page = 1; page <= 2; page += 1) {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, { headers: githubHeaders(repository) });
    if (!res.ok) throw Object.assign(new Error(`GitHub pull request list failed (${res.status}).`), { statusCode: res.status === 404 ? 404 : 502 });
    const rows = await res.json();
    if (!Array.isArray(rows)) break;
    data.push(...rows);
    if (rows.length < 100) break;
  }
  const state = (p) => (p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'closed');
  return (Array.isArray(data) ? data : [])
    .map((p) => ({ id: String(p.number), number: p.number, title: String(p.title || ''), state: state(p), branch: p.head?.ref || '', sha: p.head?.sha || '' }))
    .sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1));
}

// Recent commits of a branch (story → Scan by → Commit).
async function listCommits(repository, branch) {
  if (isGitLab(repository)) return require('./gitlabSource').listCommits(repository, branch);
  const { owner, repo } = repoParts(repository.repo_full_name);
  const ref = encodeURIComponent(branch || repository.default_branch || 'main');
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?sha=${ref}&per_page=50`, { headers: githubHeaders(repository) });
  if (!res.ok) throw Object.assign(new Error(`GitHub commit list failed (${res.status}).`), { statusCode: res.status === 404 ? 404 : 502 });
  const data = await res.json();
  return (Array.isArray(data) ? data : []).map((c) => ({ id: c.sha, sha: c.sha, message: String(c.commit?.message || '').split('\n')[0], date: c.commit?.author?.date || null }));
}

// Check that a token can read the repository before it is saved.
async function checkToken(repository, token) {
  if (isGitLab(repository)) return require('./gitlabSource').checkToken(repository, token);
  const { owner, repo } = repoParts(repository.repo_full_name);
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: githubHeaders(repository, token) });
  if (res.status === 401) throw Object.assign(new Error('GitHub did not accept this token.'), { statusCode: 400 });
  if (res.status === 404 || res.status === 403) throw Object.assign(new Error('This token cannot read the repository.'), { statusCode: 400 });
  if (!res.ok) throw Object.assign(new Error(`GitHub check failed (${res.status}).`), { statusCode: 502 });
}

module.exports = { buildSourceContext, getRepository, listBranches, listPullRequests, listCommits, checkToken, githubHeaders, repoParts };
