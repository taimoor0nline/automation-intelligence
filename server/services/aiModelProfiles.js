const ALLOWED_PROFILES = new Set(["fast", "balanced", "strong"]);

function normalizeProfile(value) {
  const candidate = String(value || process.env.AI_MODEL_DEFAULT || "strong").trim().toLowerCase();
  return ALLOWED_PROFILES.has(candidate) ? candidate : "strong";
}

function modelForProfile(value) {
  const profile = normalizeProfile(value);
  const fallback = process.env.QWEN_MODEL || "qwen3.5-flash";
  const models = {
    fast: process.env.AI_MODEL_FAST || "qwen3.5-flash" || fallback,
    balanced: process.env.AI_MODEL_BALANCED || "qwen3.7-plus" || process.env.AI_MODEL_FAST || fallback,
    strong: process.env.AI_MODEL_STRONG || "qwen3.8-max" || process.env.AI_MODEL_BALANCED || process.env.AI_MODEL_FAST || fallback,
  };
  return { profile, model: models[profile] };
}

function publicProfiles() {
  return [
    { id: "fast", label: "Fast", description: "Prioritizes response speed for routine generation." },
    { id: "balanced", label: "Balanced", description: "Balances generation speed and reasoning quality." },
    { id: "strong", label: "Strong", description: "Uses the flagship reasoning profile for complex generation and repair." },
  ];
}

module.exports = { normalizeProfile, modelForProfile, publicProfiles };
