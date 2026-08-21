/**
 * Mock "Qwen Stage 1 – Test Analyst"
 * Deterministic stand-in for the real Qwen call, so the pipeline is fully
 * demoable without API credentials. Produces the same JSON shape the real
 * model is instructed to return (see SYSTEM_PROMPTS.TEST_ANALYST_V1).
 *
 * Keyword filtering: if the story mentions specific fields (e.g. "email",
 * "rating", "subject"), only test cases tagged with those fields are
 * returned (plus TC001/TC002 as sanity baselines). If no specific field
 * is mentioned, the full 24-case suite is returned.
 */
function mockGenerateTestCases({ story }) {
  const testData = {
    validName: "Ahmed Khan",
    validEmail: "ahmed@example.com",
    validAge: 35,
    validWebsite: "https://example.com",
    validSubject: "Great support experience",
    validFeedback: "The support team resolved my issue quickly and professionally.",
  };

  const tc = (id, title, type, priority, expectedResults, tags) => ({
    id, title, type, priority, preconditions: [], testData,
    steps: [{ action: "navigate", target: "/feedback" }],
    expectedResults,
    tags, // internal only — stripped before returning
  });

  const allTestCases = [
    tc("TC001", "Submit feedback with all valid information", "positive", "high",
      ["Feedback is successfully submitted", "Confirmation message 'Thank you for your feedback.' is displayed", "A feedback reference number is generated"], ["general", "submission"]),
    tc("TC002", "Submit completely empty form", "negative", "high",
      ["Required field errors are displayed for all mandatory fields", "Form is not submitted"], ["general", "required"]),
    tc("TC003", "Full name left blank", "negative", "high",
      ["Error 'Full name is required.' is displayed"], ["name"]),
    tc("TC004", "Full name below minimum length (1 character)", "boundary", "medium",
      ["Error 'Full name must be between 2 and 80 characters.' is displayed"], ["name"]),
    tc("TC005", "Email left blank", "negative", "high",
      ["Error 'Email address is required.' is displayed"], ["email"]),
    tc("TC006", "Invalid email format (missing domain)", "negative", "high",
      ["Error 'Please enter a valid email address.' is displayed"], ["email"]),
    tc("TC007", "Invalid email format (missing @ symbol)", "negative", "high",
      ["Error 'Please enter a valid email address.' is displayed"], ["email"]),
    tc("TC008", "Valid email format is accepted", "positive", "medium",
      ["No email validation error is displayed"], ["email"]),
    tc("TC009", "Age below minimum boundary (17)", "boundary", "high",
      ["Error 'Age must be between 18 and 100.' is displayed"], ["age"]),
    tc("TC010", "Age at minimum boundary (18)", "boundary", "high",
      ["Age is accepted, no validation error"], ["age"]),
    tc("TC011", "Age at maximum boundary (100)", "boundary", "high",
      ["Age is accepted, no validation error"], ["age"]),
    tc("TC012", "Age above maximum boundary (101)", "boundary", "high",
      ["Error 'Age must be between 18 and 100.' is displayed"], ["age"]),
    tc("TC013", "Website left blank (optional field)", "positive", "low",
      ["No validation error is displayed since website is optional"], ["website", "url"]),
    tc("TC014", "Invalid website URL format", "negative", "medium",
      ["Error 'Please enter a valid website URL.' is displayed"], ["website", "url"]),
    tc("TC015", "Valid website URL is accepted", "positive", "low",
      ["No website validation error is displayed"], ["website", "url"]),
    tc("TC016", "Feedback category not selected", "negative", "high",
      ["Error 'Feedback category is required.' is displayed"], ["category"]),
    tc("TC017", "Preferred contact method not selected", "negative", "high",
      ["Error 'Please select a preferred contact method.' is displayed"], ["contact", "phone"]),
    tc("TC018", "No product/service selected", "negative", "medium",
      ["Error 'Please select at least one product or service.' is displayed"], ["products"]),
    tc("TC019", "Satisfaction rating below minimum (0)", "boundary", "medium",
      ["Error 'Rating must be between 1 and 10.' is displayed"], ["rating", "satisfaction"]),
    tc("TC020", "Satisfaction rating above maximum (11)", "boundary", "medium",
      ["Error 'Rating must be between 1 and 10.' is displayed"], ["rating", "satisfaction"]),
    tc("TC021", "Subject below minimum length (4 characters)", "boundary", "medium",
      ["Error 'Subject must be between 5 and 100 characters.' is displayed"], ["subject"]),
    tc("TC022", "Feedback message below minimum length (9 characters)", "boundary", "medium",
      ["Error 'Feedback must contain at least 10 characters.' is displayed"], ["feedback", "message"]),
    tc("TC023", "Consent checkbox not checked", "negative", "high",
      ["Error 'You must provide consent before submitting feedback.' is displayed"], ["consent"]),
    tc("TC024", "Reset form clears all entered values", "functional", "low",
      ["All fields return to their default empty state"], ["reset", "general"]),
  ];

  // Keyword map: words the user might type -> the tags they should match.
  // Note: generic words like "boundary"/"boundaries" are deliberately
  // NOT included here — they'd match too many unrelated test cases.
  // Filtering only kicks in when a specific field name is mentioned.
  const KEYWORD_TAGS = {
    name: ["name"], full: ["name"],
    email: ["email"],
    age: ["age"],
    website: ["website", "url"], url: ["website", "url"], link: ["website", "url"],
    category: ["category"],
    contact: ["contact", "phone"], phone: ["contact", "phone"],
    product: ["products"], products: ["products"],
    rating: ["rating", "satisfaction"], satisfaction: ["rating", "satisfaction"],
    subject: ["subject"],
    feedback: ["feedback", "message"], message: ["feedback", "message"],
    consent: ["consent"],
    reset: ["reset"],
    required: ["required"],
    submission: ["submission"], submit: ["submission"],
  };

  // Strip the URL out first — it often contains words like "feedback" that
  // would otherwise falsely trigger keyword matches unrelated to intent.
  const storyWithoutUrl = (story || "").replace(/https?:\/\/[^\s]+/gi, " ");
  const storyLower = storyWithoutUrl.toLowerCase();

  const requestedTags = new Set();
  Object.entries(KEYWORD_TAGS).forEach(([word, tags]) => {
    // Word-boundary match so "name" doesn't match inside "username", etc.
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(storyLower)) tags.forEach((t) => requestedTags.add(t));
  });

  let selected;
  if (requestedTags.size > 0) {
    selected = allTestCases.filter((t) => t.tags.some((tag) => requestedTags.has(tag)));
    const baseline = allTestCases.filter((t) => ["TC001", "TC002"].includes(t.id) && !selected.includes(t));
    selected = [...baseline, ...selected];
  } else {
    selected = allTestCases; // no specific field mentioned -> full suite
  }

  const testCases = selected.map(({ tags, ...rest }) => rest);

  return {
    feature: "Customer Feedback",
    sourceStory: story,
    generatedCount: testCases.length,
    testCases,
  };
}

module.exports = { mockGenerateTestCases };