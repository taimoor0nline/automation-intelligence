/**
 * AI TestPilot — Demo Target Application
 * "Customer Feedback Form"
 *
 * This is the application-under-test used to demonstrate the AI TestPilot
 * automation platform. It intentionally contains two defects (see below)
 * so the generated Cypress suite has something real to catch.
 */
const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.DEMO_APP_PORT || 4000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/feedback", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "feedback.html"));
});

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

app.post("/api/feedback", (req, res) => {
  const b = req.body;
  const errors = {};

  if (!b.fullName || b.fullName.trim().length < 2 || b.fullName.trim().length > 80) {
    errors.fullName = !b.fullName
      ? "Full name is required."
      : "Full name must be between 2 and 80 characters.";
  }

  if (!b.email) errors.email = "Email address is required.";
  else if (!isValidEmail(b.email)) errors.email = "Please enter a valid email address.";

  const age = Number(b.age);
  if (!b.age) errors.age = "Age is required.";
  // --- DEMO DEFECT #1 (intentional) ---
  // Spec requires 18–100. This condition uses `< 17` instead of `< 18`,
  // so an age of 17 incorrectly passes validation.
  else if (age < 17 || age > 100) {
    errors.age = "Age must be between 18 and 100.";
  }

  // Website is optional, but if present must be a valid URL.
  // --- DEMO DEFECT #2 (intentional) ---
  // Validation is accidentally skipped whenever the value doesn't contain
  // a dot, so a bare string like "abc" slips through instead of being rejected.
  if (b.website && b.website.includes(".") && !isValidUrl(b.website)) {
    errors.website = "Please enter a valid website URL.";
  }

  if (!b.category || b.category === "") errors.category = "Feedback category is required.";
  if (!b.contactMethod) errors.contactMethod = "Please select a preferred contact method.";

  const products = Array.isArray(b.products) ? b.products : b.products ? [b.products] : [];
  if (products.length === 0) errors.products = "Please select at least one product or service.";

  const rating = Number(b.rating);
  if (!b.rating) errors.rating = "Rating is required.";
  else if (rating < 1 || rating > 10) errors.rating = "Rating must be between 1 and 10.";

  if (!b.subject || b.subject.trim().length < 5 || b.subject.trim().length > 100) {
    errors.subject = "Subject must be between 5 and 100 characters.";
  }

  if (!b.feedback || b.feedback.trim().length < 10) {
    errors.feedback = "Feedback must contain at least 10 characters.";
  } else if (b.feedback.trim().length > 500) {
    errors.feedback = "Feedback cannot exceed 500 characters.";
  }

  if (!b.consent) errors.consent = "You must provide consent before submitting feedback.";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  const ref = `FB-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
    Math.floor(Math.random() * 9000) + 1000
  )}`;

  return res.json({ ok: true, message: "Thank you for your feedback.", reference: ref });
});

app.listen(PORT, () => {
  console.log(`[demo-app] Customer Feedback Form running at http://localhost:${PORT}/feedback`);
});

module.exports = app;
