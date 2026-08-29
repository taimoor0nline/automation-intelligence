const v8 = require('./automationDslV8');

const ADVANCED = new Set(v8.ADVANCED_ACTION_OPERATIONS || []);

function text(value) { return String(value ?? '').trim(); }
function lower(value) { return text(value).toLowerCase(); }
function normalizePath(value) {
  const source = text(value);
  if (source.startsWith('/')) return source;
  try { const url = new URL(source); return `${url.pathname}${url.search}` || '/'; } catch { return ''; }
}

function isAdvancedStep(step) {
  const action = lower(step?.action);
  const target = lower(step?.target);
  if (/upload|select\s+file|attach\s+file/.test(action)) return true;
  if (/drag|drop/.test(action)) return true;
  if (/permission/.test(action) && /(set|grant|deny|prompt|allow|block)/.test(action)) return true;
  return Boolean(v8.adapterCapabilityForText(`${action} ${target}`));
}

function baseStepMatchesAction(step, action) {
  const actionText = lower(step?.action);
  const target = text(step?.target);
  const value = text(step?.value);
  if (action.selector && target === action.selector) return true;
  switch (action.operation) {
    case 'NAVIGATE': return normalizePath(value || target) === action.path;
    case 'LOGIN_VALID': return /credential|username|password|sign\s*in|log\s*in|login/.test(`${actionText} ${lower(target)}`);
    case 'RELOAD': return /reload|refresh/.test(actionText);
    case 'GO_BACK': return /go back|navigate back|browser back/.test(actionText);
    case 'GO_FORWARD': return /go forward|navigate forward|browser forward/.test(actionText);
    case 'SET_VIEWPORT': return /viewport|resize browser/.test(actionText);
    default: return false;
  }
}

function reorderActions(testCase, actions) {
  const steps = Array.isArray(testCase?.steps) ? testCase.steps : [];
  if (!steps.length || !actions.length || !actions.some((action) => ADVANCED.has(action.operation))) return actions;

  const advancedIndexes = steps.map((step, index) => isAdvancedStep(step) ? index : -1).filter((index) => index >= 0);
  let advancedCursor = 0;
  const usedBaseSteps = new Set();
  const entries = [];

  actions.forEach((action, planOrder) => {
    if (ADVANCED.has(action.operation)) {
      const index = advancedIndexes[advancedCursor++] ?? (steps.length + planOrder / 1000);
      entries.push({ index, sub: 0.5, planOrder, action });
      return;
    }

    let matchedIndex = -1;
    for (let i = 0; i < steps.length; i += 1) {
      if (isAdvancedStep(steps[i]) || usedBaseSteps.has(i)) continue;
      if (!baseStepMatchesAction(steps[i], action)) continue;
      matchedIndex = i;
      usedBaseSteps.add(i);
      break;
    }

    if (matchedIndex < 0 && ['LOGIN_VALID', 'NAVIGATE', 'SET_VIEWPORT'].includes(action.operation)) {
      // Compiler-inserted setup belongs before the first reviewed interaction.
      entries.push({ index: -1, sub: planOrder / 1000, planOrder, action });
    } else if (matchedIndex < 0) {
      entries.push({ index: steps.length + 1, sub: planOrder / 1000, planOrder, action });
    } else {
      entries.push({ index: matchedIndex, sub: 0, planOrder, action });
    }
  });

  return entries
    .sort((a, b) => a.index - b.index || a.sub - b.sub || a.planOrder - b.planOrder)
    .map((entry) => entry.action);
}

function compileTestCase(testCase, context = {}) {
  const compiled = v8.compileTestCase(testCase, context);
  if (!compiled?.ok || !compiled.plan) return compiled;
  return {
    ...compiled,
    plan: {
      ...compiled.plan,
      actions: reorderActions(testCase, compiled.plan.actions || []),
    },
  };
}

module.exports = {
  ...v8,
  compileTestCase,
  reorderActions,
  isAdvancedStep,
};
