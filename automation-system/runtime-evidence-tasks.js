const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, 'artifacts', 'runtime-events.jsonl');

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

function createRuntimeEvidenceTasks() {
  return { testNexusRuntimeEvent: appendRuntimeEvent };
}

module.exports = { createRuntimeEvidenceTasks, appendRuntimeEvent, evidenceFile, DEFAULT_FILE };
