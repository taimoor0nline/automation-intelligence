const crypto = require('crypto');

const RULE_SOURCES = new Set(['DISCOVERED','USER_DEFINED','IMPORTED','RUNTIME_OBSERVED','AI_INFERRED']);
const SCOPE_TYPES = new Set(['APPLICATION','PAGE','FORM','FIELD','TEST_CASE']);
const TRIGGERS = new Set(['AUTO','INPUT','CHANGE','BLUR','SUBMIT','API_RESPONSE']);
const RULE_TYPES = new Set([
  'REQUIRED','EMAIL_FORMAT','URL_FORMAT','MIN_LENGTH','MAX_LENGTH','MIN_VALUE','MAX_VALUE','PATTERN',
  'OPTION_REQUIRED','AT_LEAST_ONE_CHECKED','MATCHES_FIELD','UNIQUE','ALLOWED_DOMAIN','FORBIDDEN_DOMAIN',
  'SERVER_VALIDATED','CUSTOM'
]);

function clean(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function now() { return new Date().toISOString(); }
function idPart(value) { return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rule'; }
function ruleIdFor({ scopeType, scopeRef, ruleType }) {
  const raw = `${scopeType}|${scopeRef}|${ruleType}`;
  return `rule_${idPart(scopeType)}_${idPart(scopeRef)}_${idPart(ruleType)}_${crypto.createHash('sha1').update(raw).digest('hex').slice(0,8)}`;
}
function normalizeSource(value, fallback = 'USER_DEFINED') {
  const source = clean(value, 40).toUpperCase();
  return RULE_SOURCES.has(source) ? source : fallback;
}
function normalizeScopeType(value, fallback = 'FIELD') {
  const scope = clean(value, 40).toUpperCase();
  return SCOPE_TYPES.has(scope) ? scope : fallback;
}
function normalizeTrigger(value, fallback = 'AUTO') {
  const trigger = clean(value, 40).toUpperCase();
  return TRIGGERS.has(trigger) ? trigger : fallback;
}
function normalizeRuleType(value) {
  const type = clean(value, 80).toUpperCase();
  return RULE_TYPES.has(type) ? type : 'CUSTOM';
}
function normalizeRule(raw = {}, defaults = {}) {
  const scopeType = normalizeScopeType(raw.scopeType || defaults.scopeType || 'FIELD');
  const scopeRef = clean(raw.scopeRef || raw.elementRef || defaults.scopeRef, 240);
  const ruleType = normalizeRuleType(raw.ruleType || raw.rule || defaults.ruleType);
  if (!scopeRef) throw new Error('Behavior rule requires scopeRef.');
  const source = normalizeSource(raw.source || defaults.source || 'USER_DEFINED');
  const ruleId = clean(raw.ruleId, 140) || ruleIdFor({ scopeType, scopeRef, ruleType });
  const version = Math.max(1, Number(raw.version || defaults.version || 1) || 1);
  return {
    ruleId,
    version,
    scopeType,
    scopeRef,
    pageRef: clean(raw.pageRef || defaults.pageRef, 180) || null,
    formRef: clean(raw.formRef || raw.formId || defaults.formRef, 180) || null,
    elementRef: clean(raw.elementRef || defaults.elementRef, 180) || (scopeType === 'FIELD' ? scopeRef : null),
    ruleType,
    value: raw.value === undefined ? null : raw.value,
    trigger: normalizeTrigger(raw.trigger || defaults.trigger || 'AUTO'),
    expectedState: clean(raw.expectedState || defaults.expectedState, 80).toUpperCase() || null,
    errorElementRef: clean(raw.errorElementRef || raw.errorRef || defaults.errorElementRef, 180) || null,
    source,
    approved: raw.approved === undefined ? !['AI_INFERRED','RUNTIME_OBSERVED'].includes(source) : Boolean(raw.approved),
    enabled: raw.enabled !== false,
    notes: clean(raw.notes || defaults.notes, 600) || null,
    updatedAt: raw.updatedAt || now(),
  };
}
function semanticKey(rule) { return `${rule.scopeType}|${rule.scopeRef}|${rule.ruleType}`; }
function sameValue(a, b) {
  return JSON.stringify([a.value, a.trigger, a.expectedState, a.errorElementRef, a.enabled]) === JSON.stringify([b.value, b.trigger, b.expectedState, b.errorElementRef, b.enabled]);
}
function discoveryRulesFromRegistry(registry = {}) {
  const rules = [];
  const groupSeen = new Set();
  for (const element of registry.elements || []) {
    if (!element?.elementRef || !['input','textarea','select'].includes(String(element.tag || '').toLowerCase())) continue;
    const base = { scopeType: 'FIELD', scopeRef: element.elementRef, elementRef: element.elementRef, pageRef: element.pageRef, formRef: element.formId || null, source: 'DISCOVERED', trigger: 'AUTO', approved: true };
    if (element.required === true) rules.push(normalizeRule({ ...base, ruleType: 'REQUIRED', value: true, expectedState: 'REQUIRED' }));
    if (String(element.type || '').toLowerCase() === 'email') rules.push(normalizeRule({ ...base, ruleType: 'EMAIL_FORMAT', value: true }));
    if (String(element.type || '').toLowerCase() === 'url') rules.push(normalizeRule({ ...base, ruleType: 'URL_FORMAT', value: true }));
    if (element.min !== null && element.min !== undefined && element.min !== '') rules.push(normalizeRule({ ...base, ruleType: 'MIN_VALUE', value: String(element.min) }));
    if (element.max !== null && element.max !== undefined && element.max !== '') rules.push(normalizeRule({ ...base, ruleType: 'MAX_VALUE', value: String(element.max) }));
    if (element.minlength !== null && element.minlength !== undefined && element.minlength !== '') rules.push(normalizeRule({ ...base, ruleType: 'MIN_LENGTH', value: String(element.minlength) }));
    if (element.maxlength !== null && element.maxlength !== undefined && element.maxlength !== '') rules.push(normalizeRule({ ...base, ruleType: 'MAX_LENGTH', value: String(element.maxlength) }));
    if (element.pattern) rules.push(normalizeRule({ ...base, ruleType: 'PATTERN', value: String(element.pattern) }));
    const type = String(element.type || '').toLowerCase();
    if (['checkbox','radio'].includes(type) && element.errorRef && (element.groupName || element.name)) {
      const groupRef = `group:${element.pageRef || ''}:${element.formId || ''}:${element.groupName || element.name}`;
      if (!groupSeen.has(groupRef)) {
        groupSeen.add(groupRef);
        rules.push(normalizeRule({ scopeType: 'FORM', scopeRef: groupRef, pageRef: element.pageRef, formRef: element.formId || null, ruleType: 'AT_LEAST_ONE_CHECKED', value: 1, trigger: 'AUTO', expectedState: 'VALID', errorElementRef: element.errorRef, source: 'DISCOVERED', approved: true }));
      }
    }
  }
  return rules;
}
function mergeDiscoveredRules(existing = [], discovered = []) {
  const result = existing.map((rule) => normalizeRule(rule));
  const conflicts = [];
  const byKey = new Map(result.map((rule, index) => [semanticKey(rule), { rule, index }]));
  for (const incoming of discovered.map((rule) => normalizeRule(rule, { source: 'DISCOVERED' }))) {
    const hit = byKey.get(semanticKey(incoming));
    if (!hit) {
      result.push(incoming);
      byKey.set(semanticKey(incoming), { rule: incoming, index: result.length - 1 });
      continue;
    }
    if (hit.rule.source === 'DISCOVERED') {
      if (!sameValue(hit.rule, incoming)) {
        const updated = { ...incoming, ruleId: hit.rule.ruleId, version: hit.rule.version + 1, updatedAt: now() };
        result[hit.index] = updated;
        byKey.set(semanticKey(updated), { rule: updated, index: hit.index });
      }
      continue;
    }
    if (!sameValue(hit.rule, incoming)) {
      conflicts.push({
        conflictId: `conflict_${crypto.createHash('sha1').update(`${semanticKey(incoming)}|${Date.now()}`).digest('hex').slice(0,10)}`,
        ruleId: hit.rule.ruleId,
        scopeType: hit.rule.scopeType,
        scopeRef: hit.rule.scopeRef,
        ruleType: hit.rule.ruleType,
        approvedSource: hit.rule.source,
        approvedValue: hit.rule.value,
        discoveredValue: incoming.value,
        approvedTrigger: hit.rule.trigger,
        discoveredTrigger: incoming.trigger,
        status: 'REVIEW_REQUIRED',
        detectedAt: now(),
      });
    }
  }
  return { rules: result, conflicts };
}
function refsUsedByCase(testCase = {}) {
  const refs = new Set();
  for (const item of [...(testCase.canonicalIr?.actions || []), ...(testCase.canonicalIr?.assertions || [])]) {
    if (item?.elementRef) refs.add(String(item.elementRef));
  }
  return refs;
}
function applicableRulesForCase(rules = [], testCase = {}, registry = {}) {
  const refs = refsUsedByCase(testCase);
  const byRef = new Map((registry.elements || []).map((element) => [element.elementRef, element]));
  const pages = new Set(); const forms = new Set();
  for (const ref of refs) {
    const element = byRef.get(ref); if (!element) continue;
    if (element.pageRef) pages.add(element.pageRef);
    if (element.formId) forms.add(element.formId);
  }
  const testId = String(testCase.id || testCase.canonicalIr?.plannedId || '');
  return rules.filter((rule) => {
    if (rule.enabled === false) return false;
    if (rule.scopeType === 'APPLICATION') return true;
    if (rule.scopeType === 'PAGE') return pages.has(rule.scopeRef) || pages.has(rule.pageRef);
    if (rule.scopeType === 'FORM') return forms.has(rule.scopeRef) || forms.has(rule.formRef) || [...refs].some((ref) => {
      const el = byRef.get(ref); return el && rule.scopeRef.startsWith('group:') && rule.scopeRef.includes(el.groupName || el.name || '__never__');
    });
    if (rule.scopeType === 'FIELD') return refs.has(rule.scopeRef) || refs.has(rule.elementRef);
    if (rule.scopeType === 'TEST_CASE') return rule.scopeRef === testId;
    return false;
  });
}
function precedence(rule) {
  const scope = { APPLICATION: 1, PAGE: 2, FORM: 3, FIELD: 4, TEST_CASE: 5 }[rule.scopeType] || 0;
  const source = { AI_INFERRED: 0, RUNTIME_OBSERVED: 1, DISCOVERED: 2, USER_DEFINED: 3, IMPORTED: 3 }[rule.source] || 0;
  return scope * 10 + source;
}
function effectiveRulesForCase(rules = [], testCase = {}, registry = {}) {
  const applicable = applicableRulesForCase(rules, testCase, registry).sort((a,b) => precedence(a) - precedence(b));
  const map = new Map();
  for (const rule of applicable) {
    const target = rule.elementRef || rule.scopeRef;
    map.set(`${target}|${rule.ruleType}`, rule);
  }
  return [...map.values()];
}
function linkRulesToCase(testCase, rules, registry) {
  const effective = effectiveRulesForCase(rules, testCase, registry);
  return {
    ...testCase,
    ruleRefs: effective.map((rule) => rule.ruleId),
    effectiveRules: effective.map((rule) => ({
      ruleId: rule.ruleId, version: rule.version, ruleType: rule.ruleType, scopeType: rule.scopeType, scopeRef: rule.scopeRef,
      elementRef: rule.elementRef, value: rule.value, trigger: rule.trigger, expectedState: rule.expectedState,
      errorElementRef: rule.errorElementRef, source: rule.source,
    })),
  };
}
function upsertRules(existing = [], incoming = [], source = 'USER_DEFINED') {
  const result = existing.map((rule) => normalizeRule(rule));
  const byId = new Map(result.map((rule, index) => [rule.ruleId, index]));
  for (const raw of incoming) {
    const next = normalizeRule(raw, { source });
    const index = byId.get(next.ruleId);
    if (index === undefined) {
      result.push(next); byId.set(next.ruleId, result.length - 1);
    } else {
      const previous = result[index];
      result[index] = { ...next, version: sameValue(previous, next) ? previous.version : previous.version + 1, updatedAt: now() };
    }
  }
  return result;
}

module.exports = {
  RULE_TYPES: [...RULE_TYPES], RULE_SOURCES: [...RULE_SOURCES], SCOPE_TYPES: [...SCOPE_TYPES], TRIGGERS: [...TRIGGERS],
  normalizeRule, discoveryRulesFromRegistry, mergeDiscoveredRules, effectiveRulesForCase, linkRulesToCase, upsertRules, semanticKey,
};
