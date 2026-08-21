const form = document.getElementById("feedbackForm");
const feedbackEl = document.getElementById("feedback");
const counterEl = document.getElementById("feedbackCounter");
const successPanel = document.getElementById("successPanel");
const referenceText = document.getElementById("referenceText");

feedbackEl.addEventListener("input", () => {
  counterEl.textContent = `${feedbackEl.value.length} / 500`;
});

function clearErrors() {
  document.querySelectorAll(".error").forEach((el) => (el.textContent = ""));
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();
  successPanel.hidden = true;

  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.products = fd.getAll("products");
  payload.consent = form.consent.checked;
  payload.newsletter = form.newsletter.checked;

  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!data.ok) {
    Object.entries(data.errors).forEach(([field, msg]) => {
      const errEl = document.getElementById(`${field}-error`);
      if (errEl) errEl.textContent = msg;
    });
    return;
  }

  form.hidden = true;
  successPanel.hidden = false;
  referenceText.textContent = `Feedback Reference: ${data.reference}`;
});

form.addEventListener("reset", () => {
  clearErrors();
  counterEl.textContent = "0 / 500";
});
