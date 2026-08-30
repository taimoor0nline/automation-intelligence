const zlib = require('zlib');
const { MAX_ACTORS } = require('./testActorProfiles');

const MAX_DIRECTORY_ACTORS = 500;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function clean(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeHeader(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const HEADER_ALIASES = new Map([
  ['actorref', 'actorRef'], ['actorid', 'actorRef'], ['actor', 'actorRef'],
  ['role', 'role'], ['rolename', 'role'],
  ['displayname', 'displayName'], ['name', 'displayName'], ['label', 'displayName'],
  ['username', 'username'], ['user', 'username'], ['login', 'username'], ['loginname', 'username'],
  ['password', 'password'], ['pass', 'password'], ['secret', 'password'],
  ['description', 'description'], ['notes', 'description'], ['note', 'description'],
  ['enabled', 'enabled'], ['isenabled', 'enabled'],
  ['active', 'active'], ['selected', 'active'], ['use', 'active'], ['useinscenario', 'active'],
]);

function boolValue(value, fallback = null) {
  const raw = clean(value, 20).toLowerCase();
  if (!raw) return fallback;
  if (['true','1','yes','y','on','enabled'].includes(raw)) return true;
  if (['false','0','no','n','off','disabled'].includes(raw)) return false;
  return fallback;
}

function slug(value, fallback = 'actor') {
  const normalized = clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const base = normalized || fallback;
  return base.startsWith('actor_') ? base : `actor_${base}`;
}

function maskUsername(value) {
  const username = String(value || '');
  if (!username) return '';
  const at = username.indexOf('@');
  if (at > 1) return `${username.slice(0, 2)}***${username.slice(at)}`;
  if (username.length <= 2) return '*'.repeat(username.length);
  return `${username.slice(0, 2)}***`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  row.push(field);
  if (row.some((value) => String(value).length) || rows.length === 0) rows.push(row);
  return rows;
}

function findEocd(buffer) {
  const signature = 0x06054b50;
  const start = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error('Excel file is not a valid XLSX/ZIP archive.');
}

function unzipEntries(buffer) {
  const eocd = findEocd(buffer);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Excel ZIP central directory is malformed.');
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8').replace(/\\/g, '/');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Excel ZIP local entry is malformed: ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (compression === 0) data = Buffer.from(compressed);
    else if (compression === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`Unsupported XLSX compression method ${compression} in ${name}.`);
    entries.set(name, data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? xmlDecode(match[1] ?? match[2] ?? '') : '';
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const siPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let si;
  while ((si = siPattern.exec(xml))) {
    const parts = [];
    const tPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let t;
    while ((t = tPattern.exec(si[1]))) parts.push(xmlDecode(t[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function columnIndex(cellRef) {
  const letters = String(cellRef || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let value = 0;
  for (const ch of letters) value = value * 26 + ch.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const values = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cell;
    while ((cell = cellPattern.exec(rowMatch[2]))) {
      const cellTag = `<c ${cell[1]}>`;
      const ref = attr(cellTag, 'r');
      const type = attr(cellTag, 't');
      const body = cell[2];
      let value = '';
      if (type === 'inlineStr') {
        const parts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => xmlDecode(m[1]));
        value = parts.join('');
      } else {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
        if (type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if (type === 'b') value = String(raw) === '1' ? 'true' : 'false';
        else value = xmlDecode(raw);
      }
      values[columnIndex(ref)] = value;
    }
    rows.push(values);
  }
  return rows;
}

function parseXlsx(buffer) {
  const entries = unzipEntries(buffer);
  const workbook = entries.get('xl/workbook.xml')?.toString('utf8');
  const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !rels) throw new Error('Excel workbook metadata is missing.');

  const relationships = new Map();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
    const tag = `<Relationship ${match[1]}>`;
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) relationships.set(id, target);
  }

  const sheets = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)) {
    const tag = `<sheet ${match[1]}>`;
    sheets.push({ name: attr(tag, 'name'), relId: attr(tag, 'r:id') });
  }
  if (!sheets.length) throw new Error('Excel workbook has no worksheets.');
  const selected = sheets.find((sheet) => sheet.name.trim().toLowerCase() === 'test actors') || sheets[0];
  let target = relationships.get(selected.relId);
  if (!target) throw new Error(`Excel worksheet relationship is missing for ${selected.name || 'first sheet'}.`);
  target = target.replace(/^\//, '');
  if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\.\//, '')}`;
  const sheetXml = entries.get(target)?.toString('utf8');
  if (!sheetXml) throw new Error(`Excel worksheet data is missing: ${selected.name || target}.`);
  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  return { rows: parseWorksheet(sheetXml, shared), sheetName: selected.name || 'Sheet1' };
}

function mapRows(matrix) {
  const headerIndex = matrix.findIndex((row) => (row || []).some((value) => clean(value, 100)));
  if (headerIndex < 0) throw new Error('Import file is empty.');
  const rawHeaders = matrix[headerIndex] || [];
  const headers = rawHeaders.map((value) => HEADER_ALIASES.get(normalizeHeader(value)) || null);
  const requiredHeaders = ['role','username','password'];
  const missing = requiredHeaders.filter((name) => !headers.includes(name));
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(', ')}.`);

  const records = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    if (!row.some((value) => clean(value, 500))) continue;
    const item = { __rowNumber: i + 1 };
    headers.forEach((key, index) => { if (key) item[key] = row[index] ?? ''; });
    records.push(item);
  }
  return records;
}

function validateRecords(records) {
  const rows = [];
  const usedRefs = new Set();
  const usernameRows = new Map();
  const roleCounts = new Map();

  for (const source of records.slice(0, MAX_DIRECTORY_ACTORS)) {
    const rowNumber = Number(source.__rowNumber || rows.length + 2);
    const errors = [];
    const warnings = [];
    const role = clean(source.role, 80);
    const username = String(source.username || '').trim();
    const password = String(source.password || '');
    const displayName = clean(source.displayName || role, 100) || role;
    const description = clean(source.description, 300) || null;
    const enabled = boolValue(source.enabled, true);
    const explicitActive = boolValue(source.active, null);

    if (!role) errors.push('Role is required.');
    if (!username) errors.push('Username is required.');
    if (!password) errors.push('Password is required.');
    if (source.enabled != null && clean(source.enabled) && boolValue(source.enabled, null) == null) warnings.push(`Enabled value "${clean(source.enabled)}" was treated as true.`);
    if (source.active != null && clean(source.active) && boolValue(source.active, null) == null) warnings.push(`Active value "${clean(source.active)}" was ignored.`);

    const roleKey = role.toLowerCase();
    const nextCount = (roleCounts.get(roleKey) || 0) + 1;
    roleCounts.set(roleKey, nextCount);
    const suppliedRef = clean(source.actorRef, 80);
    let actorRef = slug(suppliedRef || role || `role_${rowNumber}`, `actor_${rowNumber}`);
    if (!suppliedRef && nextCount > 1) actorRef = `${actorRef}_${String(nextCount).padStart(2, '0')}`;
    if (usedRefs.has(actorRef)) errors.push(`Duplicate actorRef: ${actorRef}.`);
    usedRefs.add(actorRef);

    const usernameKey = username.toLowerCase();
    if (usernameKey) {
      if (usernameRows.has(usernameKey)) warnings.push(`Username is also used on row ${usernameRows.get(usernameKey)}.`);
      else usernameRows.set(usernameKey, rowNumber);
    }

    rows.push({
      rowNumber, valid: errors.length === 0, errors, warnings,
      actorRef, role, displayName, description, enabled: enabled !== false,
      explicitActive, username, password, usernameMasked: maskUsername(username),
    });
  }

  if (records.length > MAX_DIRECTORY_ACTORS) {
    rows.push({
      rowNumber: MAX_DIRECTORY_ACTORS + 2,
      valid: false,
      errors: [`Import exceeds the ${MAX_DIRECTORY_ACTORS}-actor directory limit.`],
      warnings: [], actorRef: '', role: '', displayName: '', description: null,
      enabled: false, explicitActive: null, username: '', password: '', usernameMasked: '',
    });
  }

  const validEnabled = rows.filter((row) => row.valid && row.enabled);
  const explicit = validEnabled.filter((row) => row.explicitActive === true).map((row) => row.actorRef);
  const suggested = [];
  if (explicit.length) suggested.push(...explicit.slice(0, MAX_ACTORS));
  else {
    const seenRoles = new Set();
    for (const row of validEnabled) {
      const key = row.role.toLowerCase();
      if (seenRoles.has(key)) continue;
      seenRoles.add(key);
      suggested.push(row.actorRef);
      if (suggested.length >= MAX_ACTORS) break;
    }
  }

  const valid = rows.filter((row) => row.valid).length;
  const invalid = rows.length - valid;
  const warningCount = rows.reduce((sum, row) => sum + row.warnings.length, 0);
  return {
    rows,
    suggestedActiveRefs: suggested,
    summary: {
      totalRows: rows.length,
      validRows: valid,
      invalidRows: invalid,
      warnings: warningCount,
      enabledRows: rows.filter((row) => row.valid && row.enabled).length,
      suggestedActiveCount: suggested.length,
      maxActiveActors: MAX_ACTORS,
      maxDirectoryActors: MAX_DIRECTORY_ACTORS,
    },
  };
}

function parseImport({ fileName, contentBase64 }) {
  const name = clean(fileName, 255);
  if (!name) throw new Error('fileName is required.');
  if (!contentBase64 || typeof contentBase64 !== 'string') throw new Error('File content is required.');
  const buffer = Buffer.from(contentBase64, 'base64');
  if (!buffer.length) throw new Error('Uploaded actor file is empty.');
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error(`Actor import file exceeds the ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB limit.`);

  const extension = name.toLowerCase().split('.').pop();
  let matrix;
  let sheetName = null;
  if (extension === 'csv') matrix = parseCsv(buffer.toString('utf8'));
  else if (extension === 'xlsx') {
    const parsed = parseXlsx(buffer);
    matrix = parsed.rows;
    sheetName = parsed.sheetName;
  } else throw new Error('Only .csv and .xlsx actor import files are supported.');

  const validated = validateRecords(mapRows(matrix));
  return { ...validated, fileName: name, fileType: extension.toUpperCase(), sheetName };
}

function publicPreview(parsed) {
  return {
    fileName: parsed.fileName,
    fileType: parsed.fileType,
    sheetName: parsed.sheetName || null,
    summary: parsed.summary,
    suggestedActiveRefs: parsed.suggestedActiveRefs,
    rows: parsed.rows.map((row) => ({
      rowNumber: row.rowNumber,
      valid: row.valid,
      errors: row.errors,
      warnings: row.warnings,
      actorRef: row.actorRef,
      role: row.role,
      displayName: row.displayName,
      description: row.description,
      enabled: row.enabled,
      explicitActive: row.explicitActive,
      usernameMasked: row.usernameMasked,
      credentialsPresent: Boolean(row.username && row.password),
    })),
  };
}

function buildDirectoryState(parsed, requestedActiveRefs = null) {
  const validRows = parsed.rows.filter((row) => row.valid);
  const publicDirectory = validRows.map((row) => ({
    actorRef: row.actorRef,
    role: row.role,
    displayName: row.displayName,
    description: row.description,
    enabled: row.enabled,
    source: 'IMPORT',
    sourceRow: row.rowNumber,
  }));
  const credentialMap = {};
  for (const row of validRows) credentialMap[row.actorRef] = { username: row.username, password: row.password };

  const allowed = new Set(validRows.filter((row) => row.enabled).map((row) => row.actorRef));
  const requested = Array.isArray(requestedActiveRefs) && requestedActiveRefs.length
    ? requestedActiveRefs.map(String)
    : parsed.suggestedActiveRefs;
  const activeRefs = [...new Set(requested.filter((ref) => allowed.has(ref)))].slice(0, MAX_ACTORS);
  const byRef = new Map(publicDirectory.map((actor) => [actor.actorRef, actor]));
  const activeCatalog = activeRefs.map((ref) => byRef.get(ref)).filter(Boolean).map(({ enabled, source, sourceRow, ...actor }) => actor);
  const activeCredentials = Object.fromEntries(activeRefs.filter((ref) => credentialMap[ref]).map((ref) => [ref, credentialMap[ref]]));
  return { publicDirectory, credentialMap, activeRefs, activeCatalog, activeCredentials };
}

module.exports = {
  MAX_DIRECTORY_ACTORS,
  MAX_IMPORT_BYTES,
  parseCsv,
  parseXlsx,
  parseImport,
  publicPreview,
  buildDirectoryState,
};
