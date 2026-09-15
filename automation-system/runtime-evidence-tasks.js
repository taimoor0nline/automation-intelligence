const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, 'artifacts', 'runtime-events.jsonl');
const ENTERPRISE_ADAPTER_CAPABILITIES = new Set(['MFA_OTP', 'WEBAUTHN_TEST_ADAPTER']);

function evidenceFile() {
  const configured = String(process.env.AUTOMATION_RUNTIME_EVENTS_FILE || '').trim();
  return configured ? path.resolve(configured) : DEFAULT_FILE;
}

function sanitize(value, depth = 0) {
  if (depth > 5) return null;
  if (value == null || ['string','number','boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) out[String(key).slice(0, 120)] = sanitize(item, depth + 1);
    return out;
  }
  return String(value).slice(0, 2000);
}

function appendRuntimeEvent(event = {}) {
  const file = evidenceFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    ...sanitize(event),
    at: new Date().toISOString(),
    runId: String(process.env.AUTOMATION_RUN_ID || '') || null,
  };
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8');
  return null;
}

async function enterpriseAdapter({ capability, action = 'assert', payload = {} } = {}) {
  const cap = String(capability || '').trim().toUpperCase();
  if (!ENTERPRISE_ADAPTER_CAPABILITIES.has(cap)) throw new Error(`Unsupported enterprise test-adapter capability: ${cap || '(missing)'}.`);
  const baseUrl = String(process.env.AUTOMATION_EXTERNAL_ADAPTER_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error(`${cap} requires AUTOMATION_EXTERNAL_ADAPTER_URL.`);
  const allow = new Set(String(process.env.AUTOMATION_EXTERNAL_CAPABILITIES || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean));
  if (allow.size && !allow.has(cap)) throw new Error(`${cap} is not enabled in AUTOMATION_EXTERNAL_CAPABILITIES.`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(Number(process.env.AUTOMATION_EXTERNAL_ADAPTER_TIMEOUT_MS || 15000), 60000)));
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = String(process.env.AUTOMATION_EXTERNAL_ADAPTER_TOKEN || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${baseUrl}/capabilities/${encodeURIComponent(cap.toLowerCase())}`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ capability: cap, action: String(action || 'assert'), payload: sanitize(payload) || {} }),
    });
    const body = await response.text();
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body }; }
    if (!response.ok) throw new Error(data.message || data.error || `${cap} adapter returned HTTP ${response.status}.`);
    return { ok: data.ok !== false, ...data };
  } finally {
    clearTimeout(timer);
  }
}

function createRuntimeEvidenceTasks() {
  return {
    testNexusRuntimeEvent: appendRuntimeEvent,
    testNexusEnterpriseAdapter: enterpriseAdapter,
  };
}

module.exports = {
  createRuntimeEvidenceTasks,
  appendRuntimeEvent,
  enterpriseAdapter,
  evidenceFile,
  DEFAULT_FILE,
  ENTERPRISE_ADAPTER_CAPABILITIES,
};
