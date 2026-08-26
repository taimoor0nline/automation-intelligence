const YAML = require('yaml');

const HTTP_METHODS = new Set(['get','post','put','patch','delete','head','options','trace']);
const MAX_SPEC_BYTES = Math.max(256000, Math.min(Number(process.env.REST_OPENAPI_MAX_BYTES || 5_000_000), 20_000_000));
const FETCH_TIMEOUT_MS = Math.max(3000, Math.min(Number(process.env.REST_OPENAPI_TIMEOUT_MS || 15000), 60000));
const MAX_SCHEMA_DEPTH = 4;

function normalizeHttpUrl(value, label = 'URL') {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error(`${label} must be a valid absolute URL.`); }
  if (!['http:','https:'].includes(url.protocol)) throw new Error(`${label} must use http or https.`);
  return url.toString();
}

function normalizeBaseUrl(value) {
  const url = new URL(normalizeHttpUrl(value, 'Base URL'));
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

function parseDocument(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('OpenAPI/Swagger document is empty.');
  try { return JSON.parse(raw); }
  catch {}
  try {
    const parsed = YAML.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error('The specification is not valid JSON or YAML.');
  }
}

function resolveBaseUrl(doc, specificationUrl) {
  if (Array.isArray(doc.servers) && doc.servers[0]?.url) {
    const serverUrl = String(doc.servers[0].url);
    if (!serverUrl.includes('{')) return normalizeBaseUrl(new URL(serverUrl, specificationUrl).toString());
  }
  if (doc.swagger && doc.host) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes[0] : new URL(specificationUrl).protocol.replace(':','');
    const basePath = String(doc.basePath || '').replace(/\/$/, '');
    return normalizeBaseUrl(`${scheme}://${doc.host}${basePath}`);
  }
  const spec = new URL(specificationUrl);
  return normalizeBaseUrl(`${spec.protocol}//${spec.host}`);
}

function resolvePointer(doc, ref) {
  if (!String(ref || '').startsWith('#/')) return null;
  let current = doc;
  for (const raw of String(ref).slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!current || typeof current !== 'object' || !(key in current)) return null;
    current = current[key];
  }
  return current && typeof current === 'object' ? current : null;
}

function resolveNode(doc, node) {
  if (!node || typeof node !== 'object') return node || {};
  if (!node.$ref) return node;
  return resolvePointer(doc, node.$ref) || node;
}

function compactSchema(schema, doc, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || depth > MAX_SCHEMA_DEPTH) return {};
  const originalRef = schema.$ref ? String(schema.$ref) : null;
  if (originalRef && seen.has(originalRef)) return { $ref: originalRef };
  const nextSeen = new Set(seen);
  if (originalRef) nextSeen.add(originalRef);
  const resolved = originalRef ? (resolvePointer(doc, originalRef) || schema) : schema;
  const out = {};
  if (originalRef) out.$ref = originalRef;
  for (const key of ['type','format','required','enum','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','minItems','maxItems','pattern','nullable','description','default','example']) {
    if (resolved[key] !== undefined) out[key] = resolved[key];
  }
  if (resolved.properties && typeof resolved.properties === 'object' && depth < MAX_SCHEMA_DEPTH) {
    out.properties = {};
    for (const [name, property] of Object.entries(resolved.properties).slice(0, 100)) {
      out.properties[name] = compactSchema(property, doc, depth + 1, nextSeen);
    }
  }
  if (resolved.items && depth < MAX_SCHEMA_DEPTH) out.items = compactSchema(resolved.items, doc, depth + 1, nextSeen);
  for (const key of ['allOf','oneOf','anyOf']) {
    if (Array.isArray(resolved[key]) && depth < MAX_SCHEMA_DEPTH) out[key] = resolved[key].slice(0, 20).map((item) => compactSchema(item, doc, depth + 1, nextSeen));
  }
  return out;
}

function openApiRequest(operation, doc) {
  const requestBody = resolveNode(doc, operation.requestBody || {});
  const content = requestBody.content || {};
  const preferred = content['application/json'] || Object.values(content)[0] || {};
  return {
    schema: compactSchema(preferred.schema, doc),
    example: preferred.example ?? preferred.examples ?? null,
    contentTypes: Object.keys(content),
  };
}

function swaggerRequest(operation, doc) {
  const params = (operation.parameters || []).map((p) => resolveNode(doc, p));
  const body = params.find((p) => p?.in === 'body');
  const contentTypes = Array.isArray(operation.consumes) ? operation.consumes : [];
  return { schema: compactSchema(body?.schema, doc), example: body?.['x-example'] ?? null, contentTypes };
}

function normalizedParameters(pathItem, operation, doc) {
  const items = [...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation?.parameters) ? operation.parameters : [])];
  return items.map((raw) => {
    const p = resolveNode(doc, raw);
    return {
      name: p?.name || '',
      in: p?.in || '',
      required: Boolean(p?.required),
      description: p?.description || '',
      schema: compactSchema(p?.schema || { type: p?.type, format: p?.format, enum: p?.enum, minimum: p?.minimum, maximum: p?.maximum, pattern: p?.pattern }, doc),
      example: p?.example ?? null,
    };
  }).filter((p) => p.name && p.in);
}

function normalizedResponses(operation, doc) {
  const out = {};
  for (const [status, rawResponse] of Object.entries(operation?.responses || {})) {
    const response = resolveNode(doc, rawResponse);
    const content = response?.content || {};
    const preferred = content['application/json'] || Object.values(content)[0] || {};
    out[status] = {
      description: response?.description || '',
      schema: compactSchema(preferred.schema || response?.schema, doc),
      contentTypes: Object.keys(content),
      headers: response?.headers && typeof response.headers === 'object' ? Object.keys(response.headers).slice(0, 50) : [],
    };
  }
  return out;
}

function extractOperations(doc) {
  const operations = [];
  for (const [apiPath, rawPathItem] of Object.entries(doc.paths || {})) {
    const pathItem = resolveNode(doc, rawPathItem);
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const lower = String(method).toLowerCase();
      if (!HTTP_METHODS.has(lower) || !operation || typeof operation !== 'object') continue;
      const request = doc.openapi ? openApiRequest(operation, doc) : swaggerRequest(operation, doc);
      operations.push({
        source: 'OPENAPI',
        operationKey: `${lower.toUpperCase()} ${apiPath}`,
        operationId: operation.operationId || null,
        method: lower.toUpperCase(),
        path: apiPath,
        summary: operation.summary || operation.operationId || `${lower.toUpperCase()} ${apiPath}`,
        description: operation.description || '',
        parameters: normalizedParameters(pathItem, operation, doc),
        requestSchema: request.schema,
        requestExample: request.example,
        responses: normalizedResponses(operation, doc),
        contentTypes: request.contentTypes,
      });
    }
  }
  return operations;
}

async function discoverOpenApi(specificationUrl) {
  const url = normalizeHttpUrl(specificationUrl, 'Swagger/OpenAPI URL');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json, application/yaml, text/yaml, */*' }, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`Specification request failed with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > MAX_SPEC_BYTES) throw new Error(`Specification exceeds the ${Math.round(MAX_SPEC_BYTES / 1_000_000)} MB import limit.`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES) throw new Error(`Specification exceeds the ${Math.round(MAX_SPEC_BYTES / 1_000_000)} MB import limit.`);
    const document = parseDocument(text);
    if (!document.openapi && !document.swagger) throw new Error('The document is not recognized as OpenAPI or Swagger.');
    const operations = extractOperations(document);
    if (!operations.length) throw new Error('No REST operations were found in the specification.');
    return {
      specificationUrl: response.url || url,
      title: document.info?.title || 'Imported REST API',
      version: document.info?.version || null,
      format: document.openapi ? `OpenAPI ${document.openapi}` : `Swagger ${document.swagger}`,
      baseUrl: resolveBaseUrl(document, response.url || url),
      operations,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Specification request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)} seconds.`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeManualOperation(input = {}) {
  const method = String(input.method || 'GET').toUpperCase();
  if (!HTTP_METHODS.has(method.toLowerCase())) throw new Error('Unsupported HTTP method.');
  let apiPath = String(input.path || '').trim();
  if (!apiPath) throw new Error('Endpoint path is required.');
  if (/^https?:\/\//i.test(apiPath)) {
    const absolute = new URL(apiPath);
    apiPath = absolute.pathname + absolute.search;
  }
  if (!apiPath.startsWith('/')) apiPath = `/${apiPath}`;
  const responses = input.responses && typeof input.responses === 'object' && !Array.isArray(input.responses) ? input.responses : {};
  return {
    source: 'MANUAL',
    operationKey: `${method} ${apiPath}`,
    operationId: String(input.operationId || '').trim() || null,
    method,
    path: apiPath,
    summary: String(input.summary || '').trim() || `${method} ${apiPath}`,
    description: String(input.description || '').trim(),
    parameters: Array.isArray(input.parameters) ? input.parameters.slice(0, 50) : [],
    requestSchema: input.requestSchema && typeof input.requestSchema === 'object' ? input.requestSchema : {},
    requestExample: input.requestExample ?? null,
    responses,
    contentTypes: Array.isArray(input.contentTypes) ? input.contentTypes.slice(0, 10) : ['application/json'],
  };
}

module.exports = { discoverOpenApi, normalizeManualOperation, normalizeBaseUrl, normalizeHttpUrl, extractOperations };
