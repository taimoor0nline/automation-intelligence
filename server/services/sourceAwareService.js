const db = require('../db');

const MAX_TREE_FILES = Math.max(50, Math.min(Number(process.env.SOURCE_MAX_TREE_FILES || 800), 3000));
const MAX_CANDIDATES = Math.max(3, Math.min(Number(process.env.SOURCE_MAX_CANDIDATES || 8), 20));
const MAX_FILE_BYTES = Math.max(20000, Math.min(Number(process.env.SOURCE_MAX_FILE_BYTES || 180000), 500000));
const ALLOWED_EXTENSIONS = new Set(['.js','.jsx','.ts','.tsx','.cs','.java','.py','.php','.rb','.go','.vue','.svelte','.html']);

function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_SOURCE_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_SOURCE_TOKEN}`;
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
  const text = [testCase?.title, ...(testCase?.expectedResults || []), expected, actual, analysis?.probableCause, analysis?.developerReviewArea]
    .filter(Boolean).join(' ').toLowerCase();
  const stop = new Set(['the','and','for','with','from','that','this','should','must','when','then','into','because','expected','actual','application','validation','test','case','failed','error','element','visible','non','empty']);
  return [...new Set((text.match(/[a-z][a-z0-9_-]{2,}/g) || []).filter((w) => !stop.has(w)))].slice(0, 30);
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) throw new Error(`GitHub source request failed (${res.status}).`);
  return res.json();
}

async function getRepository(repositoryId) {
  if (!repositoryId || !db.isConfigured()) return null;
  const result = await db.query(
    `select id,project_id,repo_full_name,default_branch,repository_url,source_enabled
       from source_repositories where id=$1`, [repositoryId]
  );
  return result.rows[0] || null;
}

async function listTree(repository) {
  const { owner, repo } = repoParts(repository.repo_full_name);
  const branch = repository.default_branch || 'main';
  const ref = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
  const commit = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${encodeURIComponent(ref.object.sha)}`);
  const data = await fetchJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`);
  return (data.tree || [])
    .filter((item) => item.type === 'blob' && ALLOWED_EXTENSIONS.has(ext(item.path)))
    .slice(0, MAX_TREE_FILES);
}

async function fetchRepositoryFile(repository, filePath) {
  const { owner, repo } = repoParts(repository.repo_full_name);
  const branch = repository.default_branch || 'main';
  const encodedPath = String(filePath).split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const data = await fetchJson(url);
  if (!data || data.type !== 'file' || data.encoding !== 'base64' || !data.content) throw new Error('GitHub did not return a readable source file.');
  return Buffer.from(String(data.content).replace(/\s/g, ''), 'base64').toString('utf8').slice(0, MAX_FILE_BYTES);
}

function scorePath(filePath, tokens) {
  const lower = String(filePath || '').toLowerCase();
  let score = 0;
  for (const token of tokens) if (lower.includes(token)) score += token.length >= 6 ? 4 : 2;
  if (/server|api|service|controller|validator|validation|form|feedback|auth|login/i.test(lower)) score += 1;
  if (/test|spec|dist|build|node_modules|vendor/i.test(lower)) score -= 1;
  return score;
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
  const tokens = tokenizeFailure({ testCase, expected, actual, analysis });
  const tree = await listTree(repository);
  const pathCandidates = tree
    .map((item) => ({ ...item, pathScore: scorePath(item.path, tokens) }))
    .sort((a, b) => b.pathScore - a.pathScore)
    .slice(0, Math.max(MAX_CANDIDATES * 2, 10));

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

  const files = inspected.sort((a, b) => b.score - a.score).filter((x) => x.score > 0).slice(0, MAX_CANDIDATES);
  return {
    mode: 'SOURCE_AWARE',
    repositoryId: repository.id,
    repoFullName: repository.repo_full_name,
    branch: repository.default_branch || 'main',
    searchTokens: tokens,
    candidateFiles: files,
    sourceVerified: files.some((file) => file.snippets.length > 0),
  };
}

module.exports = { buildSourceContext, getRepository };
