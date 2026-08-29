const SECURITY_SUBCATEGORIES = Object.freeze([
  'AUTHENTICATION',
  'AUTHORIZATION_RBAC',
  'SESSION_MANAGEMENT',
  'INPUT_VALIDATION',
  'XSS',
  'SQL_COMMAND_INJECTION',
  'CSRF',
  'SECURITY_HEADERS',
  'COOKIES',
  'SENSITIVE_DATA_EXPOSURE',
  'API_SECURITY',
  'FILE_UPLOAD',
  'ACCESS_CONTROL',
  'RATE_LIMITING',
  'ERROR_INFORMATION_LEAKAGE',
  'CORS',
  'TLS_TRANSPORT',
  'BUSINESS_LOGIC_ABUSE',
  'LOGGING_AUDIT',
  'DEPENDENCY_VULNERABILITY_SCAN',
  'CUSTOM',
]);

const SECURITY_SEVERITIES = Object.freeze(['INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL']);
const SECURITY_SUBCATEGORY_SET = new Set(SECURITY_SUBCATEGORIES);
const SECURITY_SEVERITY_SET = new Set(SECURITY_SEVERITIES);

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s\/-]+/g, '_');
}

function normalizeSecuritySubcategory(value, fallback = null) {
  const normalized = normalizeCode(value);
  return SECURITY_SUBCATEGORY_SET.has(normalized) ? normalized : fallback;
}

function normalizeSecuritySeverity(value, fallback = 'MEDIUM') {
  const normalized = normalizeCode(value);
  return SECURITY_SEVERITY_SET.has(normalized) ? normalized : fallback;
}

function inferSecuritySubcategory(testCase = {}) {
  const explicit = testCase.securitySubcategory || testCase.security_subcategory || testCase.testData?.__securitySubcategory;
  if (explicit) return normalizeSecuritySubcategory(explicit, 'CUSTOM');
  const text = `${testCase.title || ''}\n${(testCase.preconditions || []).join(' ')}\n${(testCase.expectedResults || []).join(' ')}`.toLowerCase();
  if (/\bauthentication\b|login|password|mfa|multi[- ]factor|credential/.test(text)) return 'AUTHENTICATION';
  if (/authorization|\brbac\b|role[- ]based|privilege|permission/.test(text)) return 'AUTHORIZATION_RBAC';
  if (/session|logout|timeout|session id|session token/.test(text)) return 'SESSION_MANAGEMENT';
  if (/cross[- ]site scripting|\bxss\b/.test(text)) return 'XSS';
  if (/sql injection|command injection|\binjection\b/.test(text)) return 'SQL_COMMAND_INJECTION';
  if (/\bcsrf\b|cross[- ]site request forgery/.test(text)) return 'CSRF';
  if (/security header|content-security-policy|strict-transport-security|x-frame-options|x-content-type-options/.test(text)) return 'SECURITY_HEADERS';
  if (/cookie|httponly|samesite|secure flag/.test(text)) return 'COOKIES';
  if (/sensitive data|secret|password exposure|pii|information disclosure/.test(text)) return 'SENSITIVE_DATA_EXPOSURE';
  if (/\bapi\b|endpoint|bearer|api key|http status/.test(text)) return 'API_SECURITY';
  if (/file upload|attachment|upload validation/.test(text)) return 'FILE_UPLOAD';
  if (/access control|unauthorized access|forbidden resource|idor/.test(text)) return 'ACCESS_CONTROL';
  if (/rate limit|too many requests|429|brute force/.test(text)) return 'RATE_LIMITING';
  if (/error leakage|stack trace|debug information|verbose error|information leakage/.test(text)) return 'ERROR_INFORMATION_LEAKAGE';
  if (/\bcors\b|cross-origin/.test(text)) return 'CORS';
  if (/\btls\b|https|transport security|certificate/.test(text)) return 'TLS_TRANSPORT';
  if (/business logic|workflow abuse|bypass/.test(text)) return 'BUSINESS_LOGIC_ABUSE';
  if (/audit log|logging|security event|audit trail/.test(text)) return 'LOGGING_AUDIT';
  if (/dependency|package vulnerability|component vulnerability|sca/.test(text)) return 'DEPENDENCY_VULNERABILITY_SCAN';
  if (/input validation|malformed|invalid input|boundary|special character/.test(text)) return 'INPUT_VALIDATION';
  return 'CUSTOM';
}

function inferSecuritySeverity(testCase = {}) {
  const explicit = testCase.severity || testCase.securitySeverity || testCase.testData?.__severity;
  if (explicit) return normalizeSecuritySeverity(explicit);
  const text = `${testCase.title || ''}\n${(testCase.expectedResults || []).join(' ')}`.toLowerCase();
  if (/critical|privilege escalation|admin access|account takeover|remote code|sql injection/.test(text)) return 'CRITICAL';
  if (/high|authorization|access control|sensitive data|xss|csrf|file upload/.test(text)) return 'HIGH';
  if (/informational|observation only|best practice/.test(text)) return 'INFORMATIONAL';
  if (/low/.test(text)) return 'LOW';
  return 'MEDIUM';
}

module.exports = {
  SECURITY_SUBCATEGORIES,
  SECURITY_SEVERITIES,
  normalizeSecuritySubcategory,
  normalizeSecuritySeverity,
  inferSecuritySubcategory,
  inferSecuritySeverity,
};
