'use strict';
// CI-006 adapter registry + CI-009 normalization. Each adapter runs one scanner on the checked-out source
// ($HOME/tnscans/<runId>/src) and returns findings in one format:
//   {category, scanner, ruleId, title, severity, cwe, cve, filePath, line, packageName, installedVersion, fixedVersion, message, key}
// "key" is the stable part used for the fingerprint (no line numbers, so a moved line is not a new finding).
const fs = require('fs');
const path = require('path');
const runner = require('./runner');

const TIMEOUT_MS = Math.max(60, Number(process.env.CI_SCAN_TIMEOUT_SECONDS || 900)) * 1000;
const RULES_DIR = process.env.CI_OPENGREP_RULES || '$HOME/tn-rules';
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const clean = (v, max = 2000) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const rel = (p) => String(p || '').replace(/^\.\//, '').replace(/^\/+/, '');

// Source file extension → OpenGrep rule folder (only folders for languages found in the repository are used).
const RULE_FOLDERS = { php: 'php', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java', kt: 'kotlin', cs: 'csharp', go: 'go', rb: 'ruby', rs: 'rust', swift: 'swift', scala: 'scala', c: 'c', h: 'c' };

async function version(dir, cmd) {
  const r = await runner.runScript(dir, 'version-' + cmd.split(' ')[0], cmd + ' 2>/dev/null | head -1', 60000);
  return clean(r.stdout, 60).replace(/^Version:\s*/i, '') || null;
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function failure(r, name) { return r.timedOut ? name + ' took longer than the scan time limit.' : name + ' failed: ' + clean(r.stderr || r.stdout, 300); }

// CI-005 (basic): which languages are in the repository, by file extension (dependency folders skipped).
async function detectLanguages(runId, dir) {
  const r = await runner.runScript(dir, 'detect', 'cd "$HOME/tnscans/' + runId + '/src" && find . -type f -not -path "*/node_modules/*" -not -path "*/vendor/*" -not -path "*/.git/*" | sed -n "s/.*\\.\\([A-Za-z0-9]*\\)$/\\1/p" | tr "A-Z" "a-z" | sort | uniq -c | sort -rn | head -40', 120000);
  const counts = {};
  for (const line of r.stdout.split('\n')) { const m = line.trim().match(/^(\d+)\s+(\S+)$/); if (m) counts[m[2]] = Number(m[1]); }
  return counts;
}

const ADAPTERS = {
  // SAST — OpenGrep with the rule folders of the languages found.
  SAST: {
    scanner: 'OpenGrep',
    async run(runId, dir, ctx) {
      const folders = [...new Set(Object.keys(ctx.languages).map((e) => RULE_FOLDERS[e]).filter(Boolean))];
      if (!folders.length) return { skipped: 'No supported source language found for SAST rules.' };
      const out = path.join(dir, 'opengrep.json');
      const cfg = folders.map((f) => '--config "' + RULES_DIR + '/' + f + '"').join(' ');
      const r = await runner.runScript(dir, 'opengrep', 'cd "$HOME/tnscans/' + runId + '/src" && opengrep scan --quiet --json --output ' + runner.q(runner.hostPath(out)) + ' ' + cfg + ' --exclude node_modules --exclude vendor .', TIMEOUT_MS);
      const d = readJson(out);
      if (!d) throw new Error(failure(r, 'OpenGrep'));
      const sev = { ERROR: 'HIGH', WARNING: 'MEDIUM', INFO: 'LOW' };
      return { findings: (d.results || []).map((x) => {
        const meta = x.extra?.metadata || {};
        const cwe = Array.isArray(meta.cwe) ? meta.cwe[0] : meta.cwe;
        const rule = String(x.check_id || '').split('.').pop();
        return { category: 'SAST', scanner: 'OpenGrep', ruleId: rule, title: clean(rule.replace(/[-_]/g, ' '), 200), severity: sev[x.extra?.severity] || 'MEDIUM',
          cwe: cwe ? clean(cwe, 120) : null, filePath: rel(x.path), line: x.start?.line || null, message: clean(x.extra?.message, 1000),
          key: [rule, rel(x.path), clean(x.extra?.lines, 300)].join('|') };
      }), note: 'Rules: ' + folders.join(', ') };
    },
  },
  // Secrets — Gitleaks; values are always redacted, the raw secret is never stored or shown.
  SECRETS: {
    scanner: 'Gitleaks',
    async run(runId, dir) {
      const out = path.join(dir, 'gitleaks.json');
      const r = await runner.runScript(dir, 'gitleaks', 'cd "$HOME/tnscans/' + runId + '/src" && gitleaks dir . --redact --no-banner --log-level error --report-format json --report-path ' + runner.q(runner.hostPath(out)), TIMEOUT_MS);
      const d = readJson(out);
      if (!Array.isArray(d)) throw new Error(failure(r, 'Gitleaks'));
      return { findings: d.map((x) => ({ category: 'SECRETS', scanner: 'Gitleaks', ruleId: clean(x.RuleID, 120), title: 'Possible secret: ' + clean(x.Description || x.RuleID, 160),
        severity: 'HIGH', filePath: rel(x.File), line: x.StartLine || null, message: 'A ' + clean(x.RuleID, 80) + ' value is written in this file (value hidden).',
        key: [x.RuleID, rel(x.File), x.StartLine].join('|') })) };
    },
  },
  // SCA + configuration — Trivy: vulnerable packages, and Dockerfile / Kubernetes / IaC misconfigurations.
  SCA: {
    scanner: 'Trivy',
    async run(runId, dir) {
      const out = path.join(dir, 'trivy.json');
      const r = await runner.runScript(dir, 'trivy', 'cd "$HOME/tnscans/' + runId + '/src" && trivy fs . --scanners vuln,misconfig --quiet --format json --output ' + runner.q(runner.hostPath(out)), TIMEOUT_MS);
      const d = readJson(out);
      if (!d) throw new Error(failure(r, 'Trivy'));
      const findings = [];
      for (const res of d.Results || []) {
        for (const v of res.Vulnerabilities || []) {
          findings.push({ category: 'SCA', scanner: 'Trivy', ruleId: v.VulnerabilityID, title: clean(v.Title || v.VulnerabilityID, 200), severity: SEVERITIES.includes(v.Severity) ? v.Severity : 'INFO',
            cve: v.VulnerabilityID, cwe: Array.isArray(v.CweIDs) ? v.CweIDs[0] : null, filePath: rel(res.Target), packageName: v.PkgName, installedVersion: v.InstalledVersion,
            fixedVersion: v.FixedVersion || null, message: clean(v.Description, 1000), key: [v.VulnerabilityID, v.PkgName, v.InstalledVersion, rel(res.Target)].join('|') });
        }
        for (const m of res.Misconfigurations || []) {
          const type = String(res.Type || m.Type || '').toLowerCase();
          findings.push({ category: type.includes('docker') ? 'CONTAINER' : 'IAC', scanner: 'Trivy', ruleId: m.ID || m.AVDID, title: clean(m.Title, 200),
            severity: SEVERITIES.includes(m.Severity) ? m.Severity : 'LOW', filePath: rel(res.Target), line: m.CauseMetadata?.StartLine || null,
            message: clean([m.Message, m.Resolution].filter(Boolean).join(' Fix: '), 1000), key: [m.ID || m.AVDID, rel(res.Target)].join('|') });
        }
      }
      return { findings };
    },
  },
};

// ---- Code snippets for AI on demand: ~16 lines around each finding, read before the scanned code is deleted ----
// Secrets never leave the scanner host in clear: a Secrets finding's own line is replaced, and anything that looks
// like a password / key / token value is masked in every snippet.
const SNIPPET_BEFORE = 8, SNIPPET_AFTER = 8, SNIPPET_MAX = 800;
function maskSecrets(line) {
  return String(line)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g, '[private key hidden]')
    .replace(/((?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth)[\w-]*["']?\s*(?:=>|[:=])\s*)(["']?)[^"'\s,;)]{4,}\2/gi, '$1$2****$2')
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, '****');
}
async function captureSnippets(runId, dir, findings) {
  const wanted = new Map();
  for (const f of findings) {
    if (!f.filePath || !f.line || f.category === 'SCA') continue;
    const key = f.filePath + '\u0000' + f.line;
    if (!wanted.has(key) && wanted.size < SNIPPET_MAX) wanted.set(key, { path: f.filePath, line: Number(f.line) });
  }
  if (!wanted.size) return 0;
  const list = path.join(dir, 'snippets.list'), out = path.join(dir, 'snippets.txt');
  fs.writeFileSync(list, [...wanted.values()].map((w) => w.line + '\t' + w.path).join('\n') + '\n', 'utf8');
  await runner.runScript(dir, 'snippets',
    'cd "$HOME/tnscans/' + runId + '/src" || exit 1\n' +
    'while IFS=$\'\\t\' read -r ln p; do\n' +
    '  [ -z "$ln" ] && continue\n' +
    '  s=$(( ln > ' + SNIPPET_BEFORE + ' ? ln - ' + SNIPPET_BEFORE + ' : 1 )); e=$(( ln + ' + SNIPPET_AFTER + ' ))\n' +
    '  printf "@@@\\t%s\\t%s\\t%s\\n" "$ln" "$s" "$p"\n' +
    '  case "$p" in /*|*..*) continue;; esac\n' + // only files inside the checked-out code
    '  [ -f "$p" ] && sed -n "${s},${e}p" -- "$p" | cut -c1-220\n' +
    'done < ' + runner.q(runner.hostPath(list)) + ' > ' + runner.q(runner.hostPath(out)), 5 * 60 * 1000);
  let text = '';
  try { text = fs.readFileSync(out, 'utf8'); } catch { return 0; }
  const blocks = new Map();
  let cur = null;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@@\t')) { const [, ln, s, p] = raw.split('\t'); cur = { key: p + '\u0000' + ln, line: Number(ln), start: Number(s), lines: [] }; blocks.set(cur.key, cur); continue; }
    if (cur) cur.lines.push(raw);
  }
  let n = 0;
  for (const f of findings) {
    const b = blocks.get(f.filePath + '\u0000' + f.line);
    if (!b || !b.lines.length) continue;
    const lines = b.lines.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER + 1).map((l, i) =>
      f.category === 'SECRETS' && b.start + i === b.line ? '[secret value hidden by TestNexus]' : maskSecrets(l));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    f.snippet = lines.join('\n').slice(0, 4000);
    f.snippetStart = b.start;
    n++;
  }
  return n;
}

// Story checks → adapters. AI code review and Code quality have no scanner yet (sir has not chosen one).
const CHECK_TO_ADAPTER = { CODE_SAST: 'SAST', CODE_SECRETS: 'SECRETS', CODE_SCA: 'SCA' };
const NOT_AVAILABLE = { CODE_AI_REVIEW: 'AI code review', CODE_QUALITY: 'Code quality' };
const VERSION_CMD = { SAST: 'opengrep --version', SECRETS: 'gitleaks version', SCA: 'trivy --version' };

module.exports = { ADAPTERS, CHECK_TO_ADAPTER, NOT_AVAILABLE, VERSION_CMD, detectLanguages, version, captureSnippets, maskSecrets };
