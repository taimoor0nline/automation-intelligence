// Active progressive-generation entry point.
//
// Keep the coverage planner and batch generator coupled without making the AI
// rediscover which planned behavior each case is meant to implement. The
// pageDiscoveries array is a unique object for a generation run, so a WeakMap
// gives us run-local plan queues without cross-session/global key collisions.
const generator = require('../services/progressiveTestGenerator');

const planQueuesByDiscovery = new WeakMap();

function scopeKey(value = {}) {
  return [
    String(value.category || '').toUpperCase(),
    String(value.scenarioType || '').toLowerCase(),
  ].join('|');
}

function plannedStory(story, rationales = []) {
  const items = rationales.map((value) => String(value || '').trim()).filter(Boolean);
  if (!items.length) return story;
  return `${story}\n\nTESTNEXUS STRICT PLANNED COVERAGE CONTRACT:\nThe coverage planner has already allocated the following distinct test unit(s). Generate exactly one test case for each numbered unit, in this exact order. Each generated title, steps, data and expected results must implement its corresponding unit. Do not substitute another validation, field, boundary or feature merely because it has the same category/scenario type.\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
}

if (!generator.__testNexusPlannedUnitPatch) {
  const originalPlan = generator.proposeGenerationPlan;
  const originalBatch = generator.generateBatch;

  generator.proposeGenerationPlan = async function planAwarePropose(args = {}) {
    const result = await originalPlan(args);
    const queues = new Map();
    for (const unit of result?.units || []) {
      const key = scopeKey(unit);
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push(String(unit?.rationale || '').trim());
    }
    if (args.pageDiscoveries && typeof args.pageDiscoveries === 'object') {
      planQueuesByDiscovery.set(args.pageDiscoveries, queues);
    }
    return result;
  };

  generator.generateBatch = async function planAwareGenerate(args = {}) {
    const queues = args.pageDiscoveries && typeof args.pageDiscoveries === 'object'
      ? planQueuesByDiscovery.get(args.pageDiscoveries)
      : null;
    const queue = queues?.get(scopeKey(args));
    const count = Math.max(1, Number(args.count) || 1);
    const rationales = queue?.splice(0, count) || [];
    return originalBatch({
      ...args,
      story: plannedStory(args.story, rationales),
    });
  };

  Object.defineProperty(generator, '__testNexusPlannedUnitPatch', {
    value: true,
    enumerable: false,
    configurable: false,
  });
}

module.exports = require('./progressiveGenerationScalable');
