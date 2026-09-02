const v2 = require('./canonicalTestIrV2b');
const { publicActorCatalog } = require('./testActorProfiles');

const LOGIN_AS_ACTOR_OPERATION = 'LOGIN_AS_ACTOR';

function actorCatalogMap(catalog = []) {
  return new Map(publicActorCatalog(catalog).map((actor) => [actor.actorRef, actor]));
}

function configuredActorRefs(context = {}) {
  const source = context.actorCredentialRefs;
  if (source instanceof Set) return source;
  if (Array.isArray(source)) return new Set(source.map(String));
  return new Set();
}

function actorValidationErrors(ir, context = {}) {
  const catalog = actorCatalogMap(context.actorCatalog || []);
  const configured = configuredActorRefs(context);
  const errors = [];
  for (const action of ir?.actions || []) {
    if (String(action?.operation || '').trim().toUpperCase() !== LOGIN_AS_ACTOR_OPERATION) continue;
    const actorRef = String(action.actorRef || '').trim();
    if (!actorRef) {
      errors.push(`${LOGIN_AS_ACTOR_OPERATION} requires actorRef.`);
      continue;
    }
    if (!catalog.has(actorRef)) {
      errors.push(`${LOGIN_AS_ACTOR_OPERATION} references an unknown configured actor: ${actorRef}.`);
      continue;
    }
    if (!configured.has(actorRef)) errors.push(`${LOGIN_AS_ACTOR_OPERATION} requires runtime credentials for ${actorRef}.`);
  }
  return errors;
}

function preprocessActorIr(ir) {
  if (!ir || typeof ir !== 'object') return ir;
  return {
    ...ir,
    actions: (Array.isArray(ir.actions) ? ir.actions : []).map((action) => {
      if (String(action?.operation || '').trim().toUpperCase() !== LOGIN_AS_ACTOR_OPERATION) return action;
      return { operation: 'LOGIN_VALID' };
    }),
  };
}

function validateCanonicalIr(ir, context = {}) {
  const actorErrors = actorValidationErrors(ir, context);
  if (actorErrors.length) {
    return {
      ok: false,
      reasonCode: actorErrors.some((item) => /credentials/i.test(item)) ? 'MISSING_ACTOR_CREDENTIALS' : 'CANONICAL_IR_INVALID',
      reason: actorErrors[0],
      errors: actorErrors,
    };
  }

  const originalActions = Array.isArray(ir?.actions) ? ir.actions : [];
  const processed = preprocessActorIr(ir);
  const validated = v2.validateCanonicalIr(processed, context);
  if (!validated.ok) return validated;

  const catalog = actorCatalogMap(context.actorCatalog || []);
  const actions = validated.plan.actions.map((action, index) => {
    const original = originalActions[index];
    if (String(original?.operation || '').trim().toUpperCase() !== LOGIN_AS_ACTOR_OPERATION) return action;
    const actorRef = String(original.actorRef || '').trim();
    const actor = catalog.get(actorRef);
    return {
      operation: LOGIN_AS_ACTOR_OPERATION,
      actorRef,
      role: actor?.role || null,
      displayName: actor?.displayName || actor?.role || actorRef,
    };
  });

  const steps = validated.display.steps.map((step, index) => {
    const original = originalActions[index];
    if (String(original?.operation || '').trim().toUpperCase() !== LOGIN_AS_ACTOR_OPERATION) return step;
    const actorRef = String(original.actorRef || '').trim();
    const actor = catalog.get(actorRef);
    return {
      action: `Login as configured ${actor?.role || actorRef}`,
      target: 'runtime actor session',
      value: null,
    };
  });

  return {
    ...validated,
    canonicalIr: { ...ir, version: v2.IR_VERSION },
    plan: { ...validated.plan, actions, actorRefs: [...new Set(actions.filter((action) => action.operation === LOGIN_AS_ACTOR_OPERATION).map((action) => action.actorRef))] },
    display: { ...validated.display, steps },
  };
}

function canonicalActionCatalog() {
  return [
    ...v2.canonicalActionCatalog(),
    {
      operation: LOGIN_AS_ACTOR_OPERATION,
      usesElementRef: false,
      fields: ['actorRef'],
      description: 'Switch to a configured runtime test actor/role using isolated browser authentication state. actorRef must come from actorCatalog.',
    },
  ];
}

module.exports = {
  ...v2,
  validateCanonicalIr,
  canonicalActionCatalog,
  LOGIN_AS_ACTOR_OPERATION,
  actorValidationErrors,
};
