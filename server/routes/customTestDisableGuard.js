const { TEST_CATEGORIES } = require('../services/testCategories');
const { SECURITY_SUBCATEGORIES } = require('../services/securityTaxonomy');

const DISABLED_TEST_CATEGORY = 'CUSTOM';
const DISABLED_SECURITY_SUBCATEGORY = 'CUSTOM';
const DEFAULT_TEST_CATEGORIES = TEST_CATEGORIES.filter((value) => value !== DISABLED_TEST_CATEGORY);
const DEFAULT_SECURITY_SUBCATEGORIES = SECURITY_SUBCATEGORIES.filter((value) => value !== DISABLED_SECURITY_SUBCATEGORY);

function normalizedArray(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
    : null;
}

module.exports = function customTestDisableGuard(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/api/generation/start') return next();

  req.body = req.body && typeof req.body === 'object' ? req.body : {};

  const requestedCategories = normalizedArray(req.body.selectedTestCategories);
  if (requestedCategories) {
    const filtered = requestedCategories.filter((value) => value !== DISABLED_TEST_CATEGORY);
    if (requestedCategories.includes(DISABLED_TEST_CATEGORY) && filtered.length === 0) {
      return res.status(422).json({
        ok: false,
        code: 'CUSTOM_TESTS_DISABLED',
        reply: 'Custom test generation is disabled. Select one or more supported test categories.',
      });
    }
    req.body.selectedTestCategories = filtered;
  } else {
    req.body.selectedTestCategories = [...DEFAULT_TEST_CATEGORIES];
  }

  const requestedSecurity = normalizedArray(req.body.selectedSecuritySubcategories);
  if (requestedSecurity) {
    const filtered = requestedSecurity.filter((value) => value !== DISABLED_SECURITY_SUBCATEGORY);
    const securitySelected = req.body.selectedTestCategories.some((value) => String(value).toUpperCase() === 'SECURITY');
    if (securitySelected && requestedSecurity.includes(DISABLED_SECURITY_SUBCATEGORY) && filtered.length === 0) {
      return res.status(422).json({
        ok: false,
        code: 'CUSTOM_SECURITY_TESTS_DISABLED',
        reply: 'Custom security test areas are disabled. Select one or more supported security areas.',
      });
    }
    req.body.selectedSecuritySubcategories = filtered;
  } else {
    req.body.selectedSecuritySubcategories = [...DEFAULT_SECURITY_SUBCATEGORIES];
  }

  // Ignore legacy custom-scope payloads from cached clients. Existing historical
  // Custom cases remain readable, but new generation cannot create them.
  req.body.customTestCategories = [];
  req.body.customScenarioTypes = [];

  return next();
};
