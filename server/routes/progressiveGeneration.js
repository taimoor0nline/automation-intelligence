// Active progressive-generation entry point.
// Canonical IR is the default architecture. The previous scalable English-DSL
// generator remains available as an emergency compatibility switch during rollout.
const canonicalEnabled = !['false','0','no','off'].includes(String(process.env.AUTOMATION_CANONICAL_IR_ENABLED ?? 'true').toLowerCase());

module.exports = canonicalEnabled
  ? require('./progressiveGenerationCanonical')
  : require('./progressiveGenerationScalable');
