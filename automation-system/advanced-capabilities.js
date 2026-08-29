const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SCREENSHOTS = path.join(ROOT, 'artifacts', 'screenshots');
const DOWNLOADS = path.join(ROOT, 'artifacts', 'downloads');
const BASELINES = path.resolve(process.env.AUTOMATION_VISUAL_BASELINE_DIR || path.join(ROOT, 'baselines'));
const UPLOAD_FIXTURES = path.resolve(process.env.AUTOMATION_UPLOAD_FIXTURE_DIR || path.join(ROOT, 'fixtures', 'uploads'));

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function visualBaselineMode() {
  const explicit = String(process.env.AUTOMATION_VISUAL_BASELINE_MODE || '').trim().toLowerCase();
  if (['compare', 'create-missing'].includes(explicit)) return explicit;
  return boolEnv(process.env.AUTOMATION_VISUAL_UPDATE_BASELINES, false) ? 'create-missing' : 'compare';
}

function safeName(value, label = 'file') {
  const name = String(value || '').trim();
  if (!name || name.includes('..') || /[\\/]/.test(name)) throw new Error(`${label} must be a safe file name.`);
  return name;
}

function assertInside(root, candidate) {
  const resolved = path.resolve(candidate);
  const base = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(base)) throw new Error('Requested file is outside the configured automation directory.');
  return resolved;
}

function findByBaseName(root, baseName) {
  if (!fs.existsSync(root)) return null;
  const wanted = String(baseName).toLowerCase();
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (item.name.toLowerCase() === wanted) return full;
    }
  }
  return null;
}

function resolveUploadFixture(fileName) {
  const name = safeName(fileName, 'Upload fixture');
  const filePath = assertInside(UPLOAD_FIXTURES, path.join(UPLOAD_FIXTURES, name));
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Upload fixture not found: ${name}`);
  return filePath;
}

function compareVisual({ actualName, baselineName, threshold = 0.1, maxDiffRatio = 0 } = {}) {
  const actualFile = safeName(String(actualName || '').endsWith('.png') ? actualName : `${actualName}.png`, 'Actual screenshot');
  const baselineFile = safeName(String(baselineName || actualName || '').endsWith('.png') ? (baselineName || actualName) : `${baselineName || actualName}.png`, 'Visual baseline');
  const actualPath = findByBaseName(SCREENSHOTS, actualFile);
  if (!actualPath) throw new Error(`Screenshot not found for visual comparison: ${actualFile}`);
  const baselinePath = assertInside(BASELINES, path.join(BASELINES, baselineFile));
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });

  if (!fs.existsSync(baselinePath)) {
    if (visualBaselineMode() !== 'create-missing') {
      throw new Error(`Visual baseline does not exist: ${baselineFile}. Keep AUTOMATION_VISUAL_BASELINE_MODE=compare for normal runs; use create-missing only while intentionally approving the first baseline.`);
    }
    fs.copyFileSync(actualPath, baselinePath);
    return { matched: true, createdBaseline: true, diffPixels: 0, totalPixels: 0, diffRatio: 0, baseline: baselineFile };
  }

  const { PNG } = require('pngjs');
  const pixelmatch = require('pixelmatch');
  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return { matched: false, reason: 'DIMENSION_MISMATCH', actual: `${actual.width}x${actual.height}`, baselineDimensions: `${baseline.width}x${baseline.height}`, diffRatio: 1 };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(actual.data, baseline.data, diff.data, actual.width, actual.height, { threshold: Number(threshold) || 0.1 });
  const totalPixels = actual.width * actual.height;
  const diffRatio = totalPixels ? diffPixels / totalPixels : 0;
  return { matched: diffRatio <= Number(maxDiffRatio || 0), diffPixels, totalPixels, diffRatio, baseline: baselineFile };
}

async function extractDownloadedDocument({ fileName } = {}) {
  const name = safeName(fileName, 'Downloaded document');
  const filePath = assertInside(DOWNLOADS, path.join(DOWNLOADS, name));
  if (!fs.existsSync(filePath)) throw new Error(`Downloaded document not found: ${name}`);
  const ext = path.extname(name).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  if (['.txt', '.csv', '.json', '.xml', '.html', '.md'].includes(ext)) return { fileName: name, text: buffer.toString('utf8') };
  if (ext === '.pdf') {
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    return { fileName: name, text: String(parsed.text || ''), pages: Number(parsed.numpages || 0) };
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return { fileName: name, text: String(parsed.value || '') };
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `# ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
    }).join('\n\n');
    return { fileName: name, text, sheets: workbook.SheetNames };
  }
  if (ext === '.pptx') {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(buffer);
    const slides = zip.getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }))
      .map((entry) => entry.getData().toString('utf8')
        .replace(/<a:br\s*\/>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ').trim());
    return { fileName: name, text: slides.join('\n'), slides: slides.length };
  }
  throw new Error(`Document semantic extraction is not configured for ${ext || 'this file type'}.`);
}

function namedDbQueries() {
  const raw = String(process.env.AUTOMATION_DB_ASSERTION_QUERIES_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    throw new Error(`AUTOMATION_DB_ASSERTION_QUERIES_JSON is invalid JSON: ${err.message}`);
  }
}

function namedDbQueryDefinition(queryName) {
  const value = namedDbQueries()[String(queryName || '')];
  if (!value) throw new Error(`Named database assertion query is not configured: ${queryName || 'missing query name'}`);
  if (typeof value === 'string') return { sql: value, params: [] };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      sql: String(value.sql || ''),
      params: Array.isArray(value.params) ? value.params.map(String).filter(Boolean) : [],
    };
  }
  throw new Error(`Named database assertion query has an invalid definition: ${queryName}`);
}

function validateReadOnlySql(sql) {
  const text = String(sql || '').trim();
  if (!/^(select|with)\b/i.test(text)) throw new Error('Named database assertions must be read-only SELECT/WITH queries.');
  if (/;\s*\S|\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|execute|call|copy)\b/i.test(text)) {
    throw new Error('Named database assertion contains a disallowed modifying operation.');
  }
  return text;
}

async function databaseAssertion({ queryName, params = [] } = {}) {
  if (!boolEnv(process.env.AUTOMATION_DB_ASSERTIONS_ENABLED, false)) throw new Error('Database assertions are disabled. Set AUTOMATION_DB_ASSERTIONS_ENABLED=true to use named read-only checks.');
  const connectionString = String(process.env.AUTOMATION_DB_ASSERTION_URL || '').trim();
  if (!connectionString) throw new Error('AUTOMATION_DB_ASSERTION_URL is required for database assertions.');
  const definition = namedDbQueryDefinition(queryName);
  const sql = validateReadOnlySql(definition.sql);
  const suppliedParams = Array.isArray(params) ? params : [];
  if (definition.params.length !== suppliedParams.length) {
    throw new Error(`Named database assertion ${queryName} requires ${definition.params.length} parameter(s): ${definition.params.join(', ') || 'none'}.`);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: Math.max(500, Number(process.env.AUTOMATION_DB_ASSERTION_TIMEOUT_MS || 3000)) });
  try {
    const result = await pool.query(sql, suppliedParams);
    return { rowCount: result.rowCount, rows: result.rows, first: result.rows?.[0] || null };
  } finally {
    await pool.end().catch(() => {});
  }
}

const EXTERNAL_CAPABILITIES = new Set([
  'EMAIL_SMS_OTP',
  'CROSS_ORIGIN_IFRAME',
  'REAL_MULTI_TAB',
  'CAPTCHA_BIOMETRIC',
  'NATIVE_MOBILE',
  'BROWSER_EXTENSION',
  'OS_DIALOG',
]);

async function externalAdapter({ capability, action = 'assert', payload = {} } = {}) {
  const cap = String(capability || '').toUpperCase();
  if (!EXTERNAL_CAPABILITIES.has(cap)) throw new Error(`Unsupported external automation capability: ${cap || 'unknown'}`);
  const baseUrl = String(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error(`External adapter is required for ${cap}. Configure AUTOMATION_EXTERNAL_ADAPTER_URL.`);
  const configured = new Set(String(process.env.AUTOMATION_EXTERNAL_CAPABILITIES || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean));
  if (configured.size && !configured.has(cap)) throw new Error(`External adapter capability ${cap} is not enabled in AUTOMATION_EXTERNAL_CAPABILITIES.`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(process.env.AUTOMATION_EXTERNAL_ADAPTER_TIMEOUT_MS || 15000)));
  try {
    const headers = { 'Content-Type': 'application/json' };
    const tokenEnvKey = String(process.env.AUTOMATION_EXTERNAL_ADAPTER_TOKEN_ENV || '').trim();
    const token = String(process.env.AUTOMATION_EXTERNAL_ADAPTER_TOKEN || (tokenEnvKey ? process.env[tokenEnvKey] : '') || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}/capabilities/${encodeURIComponent(cap.toLowerCase())}`, {
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({ capability: cap, action: String(action || 'assert'), payload: payload && typeof payload === 'object' ? payload : {} }),
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    if (!response.ok) throw new Error(data.message || data.error || `External adapter returned HTTP ${response.status}.`);
    return { ok: data.ok !== false, ...data };
  } finally {
    clearTimeout(timeout);
  }
}

function createAdvancedTasks() {
  return {
    testNexusResolveUploadFixture(fileName) { return resolveUploadFixture(fileName); },
    testNexusCompareVisual(input) { return compareVisual(input); },
    testNexusExtractDownloadedDocument(input) { return extractDownloadedDocument(input); },
    testNexusDatabaseAssertion(input) { return databaseAssertion(input); },
    testNexusExternalAdapter(input) { return externalAdapter(input); },
  };
}

module.exports = {
  createAdvancedTasks,
  resolveUploadFixture,
  compareVisual,
  extractDownloadedDocument,
  databaseAssertion,
  externalAdapter,
  namedDbQueryDefinition,
  visualBaselineMode,
  EXTERNAL_CAPABILITIES,
};
