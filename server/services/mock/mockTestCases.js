/**
 * Mock "Qwen Stage 1 – Test Analyst"
 * Deterministic stand-in for the real Qwen call, so the pipeline is fully
 * demoable without API credentials. Produces the same JSON shape the real
 * model is instructed to return (see SYSTEM_PROMPTS.TEST_ANALYST_V1).
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

  const tc = (id, title, type, priority, expectedResults) => ({
    id, title, type, priority, preconditions: [], testData, steps: [
      { action: "navigate", target: "/feedback" },
    ],
    expectedResults,
  });

  const testCases = [
    tc("TC001", "Submit feedback with all valid information", "positive", "high",
      ["Feedback is successfully submitted", "Confirmation message 'Thank you for your feedback.' is displayed", "A feedback reference number is generated"]),
    tc("TC002", "Submit completely empty form", "negative", "high",
      ["Required field errors are displayed for all mandatory fields", "Form is not submitted"]),
    tc("TC003", "Full name left blank", "negative", "high",
      ["Error 'Full name is required.' is displayed"]),
    tc("TC004", "Full name below minimum length (1 character)", "boundary", "medium",
      ["Error 'Full name must be between 2 and 80 characters.' is displayed"]),
    tc("TC005", "Email left blank", "negative", "high",
      ["Error 'Email address is required.' is displayed"]),
    tc("TC006", "Invalid email format (missing domain)", "negative", "high",
      ["Error 'Please enter a valid email address.' is displayed"]),
    tc("TC007", "Invalid email format (missing @ symbol)", "negative", "high",
      ["Error 'Please enter a valid email address.' is displayed"]),
    tc("TC008", "Valid email format is accepted", "positive", "medium",
      ["No email validation error is displayed"]),
    tc("TC009", "Age below minimum boundary (17)", "boundary", "high",
      ["Error 'Age must be between 18 and 100.' is displayed"]),
    tc("TC010", "Age at minimum boundary (18)", "boundary", "high",
      ["Age is accepted, no validation error"]),
    tc("TC011", "Age at maximum boundary (100)", "boundary", "high",
      ["Age is accepted, no validation error"]),
    tc("TC012", "Age above maximum boundary (101)", "boundary", "high",
      ["Error 'Age must be between 18 and 100.' is displayed"]),
    tc("TC013", "Website left blank (optional field)", "positive", "low",
      ["No validation error is displayed since website is optional"]),
    tc("TC014", "Invalid website URL format", "negative", "medium",
      ["Error 'Please enter a valid website URL.' is displayed"]),
    tc("TC015", "Valid website URL is accepted", "positive", "low",
      ["No website validation error is displayed"]),
    tc("TC016", "Feedback category not selected", "negative", "high",
      ["Error 'Feedback category is required.' is displayed"]),
    tc("TC017", "Preferred contact method not selected", "negative", "high",
      ["Error 'Please select a preferred contact method.' is displayed"]),
    tc("TC018", "No product/service selected", "negative", "medium",
      ["Error 'Please select at least one product or service.' is displayed"]),
    tc("TC019", "Satisfaction rating below minimum (0)", "boundary", "medium",
      ["Error 'Rating must be between 1 and 10.' is displayed"]),
    tc("TC020", "Satisfaction rating above maximum (11)", "boundary", "medium",
      ["Error 'Rating must be between 1 and 10.' is displayed"]),
    tc("TC021", "Subject below minimum length (4 characters)", "boundary", "medium",
      ["Error 'Subject must be between 5 and 100 characters.' is displayed"]),
    tc("TC022", "Feedback message below minimum length (9 characters)", "boundary", "medium",
      ["Error 'Feedback must contain at least 10 characters.' is displayed"]),
    tc("TC023", "Consent checkbox not checked", "negative", "high",
      ["Error 'You must provide consent before submitting feedback.' is displayed"]),
    tc("TC024", "Reset form clears all entered values", "functional", "low",
      ["All fields return to their default empty state"]),
  ];

  return {
    feature: "Customer Feedback",
    sourceStory: story,
    generatedCount: testCases.length,
    testCases,
  };
}

module.exports = { mockGenerateTestCases };
