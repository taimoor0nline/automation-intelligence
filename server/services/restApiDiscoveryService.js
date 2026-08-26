const YAML = require('yaml');

const HTTP_METHODS = new Set(['get','post','put','patch','delete','head','options','trace']);
const MAX_SPEC_BYTES = Math.max(256000, Math.min(Number(process.env.REST_OPENAPI_MAX_BYTES || 5_000_000), 20_000_000));
const FETCH_TIMEOUT_MS = Math.max(3000, Math.min(Number(process.env.REST_OPENAPI_TIMEOUT_MS || 15000), 60000));

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
    return normalizeBaseUrl(new URL(doc.servers[0].url, specificationUrl).toString());
  }
  if (doc.swagger && doc.host) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes[0] : new URL(specificationUrl).protocol.replace(':','');
    const basePath = String(doc.basePath || '').replace(/\/$/, '');
    return normalizeBaseUrl(`${scheme}://${doc.host}${basePath}`);
  }
  const spec = new URL(specificationUrl);
  return normalizeBaseUrl(`${spec.protocol}//${spec.host}`);
}

function compactSchema(schema) {
  if (!schema || typeof schema !== 'object') return {};
  const out = {};
  for (const key of ['$ref','type','format','required','enum','minimum','maximum','minLength','maxLength','pattern','nullable','description','properties','items','allOf','oneOf','anyOf']) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  return out;
}

function openApiRequest(operation) {
  const requestBody = operation.requestBody || {};
  const content = requestBody.content || {};
  const preferred = content['application/json'] || Object.values(content)[0] || {};
  return {
    schema: compactSchema(preferred.schema),
    example: preferred.example ?? preferred.examples ?? null,
    contentTypes: Object.keys(content),
  };
}

function swaggerRequest(operation) {
  const body = (operation.parameters || []).find((p) => p?.in === 'body');
  const contentTypes = Array.isArray(operation.consumes) ? operation.consumes : [];
  return { schema: compactSchema(body?.schema), example: body?.['x-example'] ?? null, contentTypes };
}

function normalizedParameters(pathItem, operation) {
  const items = [...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation?.parameters) ? operation.parameters : [])];
  return items.map((p) => ({
    name: p?.name || '',
    in: p?.in || '',
    required: Boolean(p?.required),
    description: p?.description || '',
    schema: compactSchema(p?.schema || { type: p?.type, format: p?.format, enum: p?.enum }),
    example: p?.example ?? null,
  })).filter((p) => p.name && p.in);
}

function normalizedResponses(operation) {
  const out = {};
  for (const [status, response] of Object.entries(operation?.responses || {})) {
    const content = response?.content || {};
    const preferred = content['application/json'] || Object.values(content)[0] || {};
    out[status] = {
      description: response?.description || '',
      schema: compactSchema(preferred.schema || response?.schema),
      contentTypes: Object.keys(content),
    };
  }
  return out;
}

function extractOperations(doc) {
  const operations = [];
  for (const [apiPath, pathItem] of Object.entries(doc.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      const lower = String(method).toLowerCase();
      if (!HTTP_METHODS.has(lower) || !operation || typeof operation !== 'object') continue;
      const request = doc.openapi ? openApiRequest(operation) : swaggerRequest(operation);
      operations.push({
        source: 'OPENAPI',
        operationKey: `${lower.toUpperCase()} ${apiPath}`,
        operationId: operation.operationId || null,
        method: lower.toUpperCase(),
        path: apiPath,
        summary: operation.summary || operation.operationId || `${lower.toUpperCase()} ${apiPath}`,
        description: operation.description || '',
        parameters: normalizedParameters(pathItem, operation),
        requestSchema: request.schema,
        requestExample: request.example,
        responses: normalizedResponses(operation),
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
  if (/^https?:\/\//i.test(apiPath)) apiPath = new URL(apiPath).pathname + new URL(apiPath).search;
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

module.exports = { discoverOpenApi, normalizeManualOperation, normalizeBaseUrl, normalizeHttpUrl };
