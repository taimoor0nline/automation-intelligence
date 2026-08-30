const { publicActorCatalog } = require('./testActorProfiles');

const MAX_WORKFLOW_REQUIREMENTS_LENGTH = 5000;

function normalizeWorkflowRequirements(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_WORKFLOW_REQUIREMENTS_LENGTH);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function actorNames(actor) {
  return [...new Set([
    String(actor?.role || '').trim(),
    String(actor?.displayName || '').trim(),
  ].filter(Boolean))].sort((a, b) => b.length - a.length);
}

function inferWorkflowActorSequence(requirements, actorCatalog = []) {
  const source = normalizeWorkflowRequirements(requirements);
  if (!source) return [];
  const actors = publicActorCatalog(actorCatalog);
  const matches = [];

  for (const actor of actors) {
    for (const name of actorNames(actor)) {
      const pattern = new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi');
      let match;
      while ((match = pattern.exec(source))) {
        matches.push({ index: match.index, actorRef: actor.actorRef });
        if (!match[0].length) pattern.lastIndex += 1;
      }
    }
  }

  matches.sort((a, b) => a.index - b.index || a.actorRef.localeCompare(b.actorRef));
  const sequence = [];
  let lastIndex = -1;
  let lastRef = null;
  for (const match of matches) {
    // A role/display-name pair can match the same text position. Keep that actor once,
    // but preserve legitimate later repetitions such as Requester -> Manager -> Requester.
    if (match.index === lastIndex && match.actorRef === lastRef) continue;
    sequence.push(match.actorRef);
    lastIndex = match.index;
    lastRef = match.actorRef;
  }
  return sequence;
}

function workflowContextForModel(requirements, actorCatalog = []) {
  const normalized = normalizeWorkflowRequirements(requirements);
  const actors = publicActorCatalog(actorCatalog);
  return {
    requirements: normalized || null,
    actorCatalog: actors,
    actorSequence: normalized ? inferWorkflowActorSequence(normalized, actors) : [],
  };
}

module.exports = {
  MAX_WORKFLOW_REQUIREMENTS_LENGTH,
  normalizeWorkflowRequirements,
  inferWorkflowActorSequence,
  workflowContextForModel,
};
