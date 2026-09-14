function compactError(error) {
  if (!error) return null;
  return {
    id: error.id || null,
    testId: error.testId || null,
    selector: error.selector || null,
    text: error.text || null,
  };
}

function compactElement(item) {
  const out = {
    tag: item?.tag || null,
    type: item?.type || null,
    id: item?.id || null,
    name: item?.name || null,
    testId: item?.testId || null,
    selector: item?.selector || null,
    selectorStrategy: item?.selectorStrategy || null,
    selectorStability: item?.selectorStability || null,
    label: item?.label || item?.text || null,
    ariaLabel: item?.ariaLabel || null,
    placeholder: item?.placeholder || null,
    required: Boolean(item?.required),
    disabled: Boolean(item?.disabled),
    readonly: Boolean(item?.readonly),
    min: item?.min ?? null,
    max: item?.max ?? null,
    minlength: item?.minlength ?? null,
    maxlength: item?.maxlength ?? null,
    pattern: item?.pattern ?? null,
    value: item?.value ?? null,
    capabilities: Array.isArray(item?.capabilities) ? item.capabilities.slice(0, 40) : [],
    errorElement: compactError(item?.errorElement),
  };

  if (Array.isArray(item?.options) && item.options.length) {
    out.options = item.options.slice(0, 30).map((option) => ({
      value: option?.value ?? "",
      label: option?.label || option?.text || null,
    }));
  }

  return out;
}

function compactMessage(message) {
  return {
    id: message?.id || null,
    testId: message?.testId || null,
    selector: message?.selector || null,
    text: message?.text || null,
    hidden: Boolean(message?.hidden),
    capabilities: Array.isArray(message?.capabilities) ? message.capabilities.slice(0, 20) : [],
  };
}

function compactNetworkHint(hint) {
  return {
    method: hint?.method || null,
    url: hint?.url || null,
    source: hint?.source || null,
  };
}

function compactDiscoveriesForModel(pageDiscoveries = []) {
  return (pageDiscoveries || []).map((page) => ({
    url: page?.url || null,
    finalUrl: page?.finalUrl || page?.url || null,
    pageTitle: page?.pageTitle || page?.title || null,
    documentLanguage: page?.documentLanguage || null,
    discoveryEngine: page?.discoveryEngine || null,
    capabilitySummary: page?.capabilitySummary || null,
    elements: (page?.elements || []).map(compactElement),
    messages: (page?.messages || []).map(compactMessage),
    routeHints: Array.isArray(page?.routeHints) ? page.routeHints.slice(0, 20) : [],
    networkHints: Array.isArray(page?.networkHints) ? page.networkHints.slice(0, 20).map(compactNetworkHint) : [],
    meta: Array.isArray(page?.meta) ? page.meta.slice(0, 20).map((item) => ({ name: item?.name || null, content: item?.content || '' })) : [],
  }));
}

module.exports = { compactDiscoveriesForModel };
