function compactError(error) {
  if (!error) return null;
  return {
    id: error.id || null,
    testId: error.testId || null,
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
    label: item?.label || item?.text || null,
    required: Boolean(item?.required),
    min: item?.min ?? null,
    max: item?.max ?? null,
    minlength: item?.minlength ?? null,
    maxlength: item?.maxlength ?? null,
    value: item?.value ?? null,
    errorElement: compactError(item?.errorElement),
  };

  if (Array.isArray(item?.options) && item.options.length) {
    out.options = item.options.slice(0, 30).map((option) => ({
      value: option?.value ?? "",
      label: option?.label || null,
    }));
  }

  return out;
}

function compactMessage(message) {
  return {
    id: message?.id || null,
    testId: message?.testId || null,
    text: message?.text || null,
    hidden: Boolean(message?.hidden),
  };
}

function compactDiscoveriesForModel(pageDiscoveries = []) {
  return (pageDiscoveries || []).map((page) => ({
    url: page?.url || null,
    finalUrl: page?.finalUrl || page?.url || null,
    pageTitle: page?.pageTitle || null,
    elements: (page?.elements || []).map(compactElement),
    messages: (page?.messages || []).map(compactMessage),
    routeHints: Array.isArray(page?.routeHints) ? page.routeHints.slice(0, 20) : [],
  }));
}

module.exports = { compactDiscoveriesForModel };
