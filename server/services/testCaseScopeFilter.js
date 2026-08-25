const MAX_GENERATED_CASES = 5;

function evidenceText(story, pageDiscoveries) {
  return `${String(story || "")}\n${JSON.stringify(pageDiscoveries || [])}`.toLowerCase();
}

function caseText(testCase) {
  return JSON.stringify(testCase || {}).toLowerCase();
}

function unsupportedSpecializedScenario(testCase, evidence) {
  const text = caseText(testCase);
  const rules = [
    {
      casePattern: /special characters?|symbols? in (?:user|pass)|punctuation in (?:user|pass)/i,
      evidencePattern: /special characters?|pattern|regex|regexp|character set|allowed characters?|symbols?/i,
    },
    {
      casePattern: /sql injection|script injection|xss|cross[- ]site scripting/i,
      evidencePattern: /sql injection|xss|cross[- ]site scripting|security testing|injection/i,
    },
    {
      casePattern: /leading whitespace|trailing whitespace|spaces? around|trim(?:ming)?/i,
      evidencePattern: /whitespace|trim|leading spaces?|trailing spaces?/i,
    },
    {
      casePattern: /case[- ]sensitive|case sensitivity|uppercase|lowercase/i,
      evidencePattern: /case[- ]sensitive|case sensitivity|uppercase|lowercase/i,
    },
    {
      casePattern: /maximum length|minimum length|too long|length boundary/i,
      evidencePattern: /maxlength|minlength|maximum length|minimum length|length boundary/i,
    },
    {
      casePattern: /account lock|locked account|rate limit|too many attempts/i,
      evidencePattern: /account lock|locked account|rate limit|too many attempts/i,
    },
  ];

  return rules.some(({ casePattern, evidencePattern }) => casePattern.test(text) && !evidencePattern.test(evidence));
}

function canonicalSignature(testCase) {
  const targets = (testCase?.steps || []).map((step) => String(step?.target || "").trim().toLowerCase()).filter(Boolean).join("|");
  const actions = (testCase?.steps || []).map((step) => String(step?.action || "").trim().toLowerCase().replace(/\b(valid|invalid|configured|test)\b/g, "").replace(/\s+/g, " ")).join("|");
  const expected = (testCase?.expectedResults || []).map((item) => String(item || "").trim().toLowerCase()).join("|");
  return `${actions}::${targets}::${expected}`;
}

function pruneGeneratedTestCases(testCases, { story = "", pageDiscoveries = [], maxCases = MAX_GENERATED_CASES } = {}) {
  const evidence = evidenceText(story, pageDiscoveries);
  const seen = new Set();
  const retained = [];

  for (const testCase of Array.isArray(testCases) ? testCases : []) {
    if (!testCase || unsupportedSpecializedScenario(testCase, evidence)) continue;
    const signature = canonicalSignature(testCase);
    if (signature && seen.has(signature)) continue;
    if (signature) seen.add(signature);
    retained.push(testCase);
    if (retained.length >= Math.max(1, Math.min(Number(maxCases) || MAX_GENERATED_CASES, MAX_GENERATED_CASES))) break;
  }

  // Never turn a valid AI response into an empty suite solely because of conservative pruning.
  const safe = retained.length ? retained : (Array.isArray(testCases) ? testCases.slice(0, 1) : []);
  return safe.map((testCase, index) => ({ ...testCase, id: `TC${String(index + 1).padStart(3, "0")}` }));
}

module.exports = { MAX_GENERATED_CASES, pruneGeneratedTestCases };
