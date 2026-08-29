const v5 = require('./automationDslV5');

function selectorFor(item) {
  if (!item) return '';
  if (item.selector) return String(item.selector);
  if (item.testId) return `[data-testid="${item.testId}"]`;
  if (item.id) return `#${item.id}`;
  if (item.name) return `[name="${item.name}"]`;
  return '';
}

function pagePath(page) {
  try {
    const url = new URL(page?.finalUrl || page?.url || 'http://local/');
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return '/';
  }
}

function loginRuntimeFromDiscovery(pageDiscoveries = []) {
  const entries = [];
  for (const page of pageDiscoveries || []) {
    for (const item of page?.elements || []) entries.push({ page, item });
  }
  const byIdentity = (names) => entries.find(({ item }) => {
    const values = [item?.testId, item?.id, item?.name].map((value) => String(value || '').toLowerCase());
    return values.some((value) => names.includes(value));
  });
  const username = byIdentity(['username','user-name','login-username','email']) ||
    entries.find(({ item }) => /user.?name|email/i.test(String(item?.label || '')) && String(item?.type || '').toLowerCase() !== 'password');
  const password = byIdentity(['password','login-password']) ||
    entries.find(({ item }) => String(item?.type || '').toLowerCase() === 'password');
  const submit = byIdentity(['login-button','signin-button','sign-in-button','submit-login']) ||
    entries.find(({ item }) => /sign\s*in|log\s*in|login/i.test(String(item?.label || item?.text || '')) && ['button','submit'].includes(String(item?.type || '').toLowerCase()));
  const page = username?.page || password?.page || submit?.page || null;
  return {
    path: pagePath(page),
    usernameSelector: selectorFor(username?.item),
    passwordSelector: selectorFor(password?.item),
    submitSelector: selectorFor(submit?.item),
  };
}

function explicitNegativeLoginIntent(testCase) {
  const text = [
    testCase?.title,
    testCase?.type,
    ...(testCase?.preconditions || []),
    ...(testCase?.expectedResults || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return /invalid\s+(?:login|credential|username|password)|missing\s+(?:username|password|credential)|empty\s+(?:username|password)|blank\s+(?:username|password)|reject(?:ed|s)?\s+(?:login|credential)|login\s+(?:error|failure|fails)|authentication\s+(?:error|failure|fails)/i.test(text);
}

function selectorPaths(pageDiscoveries = []) {
  const map = new Map();
  for (const page of pageDiscoveries || []) {
    const path = pagePath(page);
    for (const item of page?.elements || []) {
      const selector = selectorFor(item);
      if (selector) map.set(selector, path);
      const errorSelector = selectorFor(item?.errorElement);
      if (errorSelector) map.set(errorSelector, path);
    }
    for (const item of page?.messages || []) {
      const selector = selectorFor(item);
      if (selector) map.set(selector, path);
    }
  }
  return map;
}

function normalizeCrossPageLogin(testCase, context = {}) {
  if (!testCase || typeof testCase !== 'object' || !context.hasCredentials) return testCase;
  if (explicitNegativeLoginIntent(testCase)) return testCase;
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  if (!steps.length) return testCase;

  const login = loginRuntimeFromDiscovery(context.pageDiscoveries || []);
  if (!login.usernameSelector || !login.passwordSelector || !login.submitSelector) return testCase;

  const paths = selectorPaths(context.pageDiscoveries || []);
  const loginTargets = new Set([login.usernameSelector, login.passwordSelector, login.submitSelector]);
  const loginIndexes = steps
    .map((step, index) => loginTargets.has(String(step?.target || '').trim()) ? index : -1)
    .filter((index) => index >= 0);
  if (loginIndexes.length < 2) return testCase;

  const lastLoginIndex = Math.max(...loginIndexes);
  const nextPageStep = steps.slice(lastLoginIndex + 1).find((step) => {
    const target = String(step?.target || '').trim();
    const path = paths.get(target);
    return target && path && path !== login.path;
  });
  if (!nextPageStep) return testCase;

  const retained = steps.filter((step) => !loginTargets.has(String(step?.target || '').trim()));
  const firstLoginIndex = Math.min(...loginIndexes);
  const beforeCount = steps.slice(0, firstLoginIndex).filter((step) => !loginTargets.has(String(step?.target || '').trim())).length;
  retained.splice(beforeCount, 0, {
    action: 'Use configured test credentials',
    target: '',
    value: null,
  });

  return {
    ...testCase,
    steps: retained,
    _runtimeLoginNormalization: {
      applied: true,
      loginPath: login.path,
      destinationPath: paths.get(String(nextPageStep?.target || '').trim()) || null,
      source: 'discovered-cross-page-login',
    },
  };
}

function compileTestCase(testCase, context = {}) {
  const normalized = normalizeCrossPageLogin(testCase, context);
  const compiled = v5.compileTestCase(normalized, context);
  if (compiled && normalized?._runtimeLoginNormalization) {
    return {
      ...compiled,
      runtimeLoginNormalization: normalized._runtimeLoginNormalization,
      plan: compiled.plan ? {
        ...compiled.plan,
        runtimeLoginNormalization: normalized._runtimeLoginNormalization,
      } : compiled.plan,
    };
  }
  return compiled;
}

module.exports = {
  ...v5,
  compileTestCase,
  normalizeCrossPageLogin,
  loginRuntimeFromDiscovery,
  explicitNegativeLoginIntent,
};
