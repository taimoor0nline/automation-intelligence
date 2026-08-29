function text(value) { return String(value ?? '').toLowerCase(); }

function discoveryCorpus(pageDiscoveries = []) {
  const parts = [];
  const elements = [];
  const messages = [];
  for (const page of pageDiscoveries || []) {
    parts.push(page?.pageTitle, page?.url, page?.finalUrl);
    for (const item of page?.elements || []) {
      elements.push(item);
      parts.push(item?.tag, item?.type, item?.id, item?.name, item?.testId, item?.selector, item?.label, item?.text, item?.placeholder, item?.ariaLabel);
      for (const option of item?.options || []) parts.push(option?.value, option?.label);
      const error = item?.errorElement;
      if (error) parts.push(error?.id, error?.testId, error?.selector, error?.text);
    }
    for (const message of page?.messages || []) {
      messages.push(message);
      parts.push(message?.id, message?.testId, message?.selector, message?.text);
    }
  }
  return { corpus: text(parts.filter(Boolean).join(' ')), elements, messages };
}

function itemText(item) {
  return text([item?.tag, item?.type, item?.id, item?.name, item?.testId, item?.selector, item?.label, item?.text, item?.placeholder, item?.ariaLabel].filter(Boolean).join(' '));
}

function hasElement(elements, predicate) {
  return (elements || []).some((item) => predicate(item, itemText(item)));
}

const CONCEPTS = [
  {
    key: 'login/authentication',
    requested: /\b(login|log\s*in|sign\s*in|signin|authenticate|authentication)\b/i,
    evidenced: ({ elements, corpus }) => /login|log\s*in|sign\s*in|signin|authentication/.test(corpus) || (
      hasElement(elements, (item, t) => text(item?.type) === 'password' || /password/.test(t)) &&
      hasElement(elements, (_item, t) => /user.?name|login.?id|sign.?in/.test(t))
    ),
  },
  {
    key: 'username',
    requested: /\b(user\s*name|username)\b/i,
    evidenced: ({ elements }) => hasElement(elements, (_item, t) => /user.?name|login.?id|user.?id/.test(t)),
  },
  {
    key: 'password',
    requested: /\bpassword\b/i,
    evidenced: ({ elements }) => hasElement(elements, (item, t) => text(item?.type) === 'password' || /password/.test(t)),
  },
  {
    key: 'feedback form',
    requested: /\bfeedback\b/i,
    evidenced: ({ elements, corpus }) => /feedback/.test(corpus) || hasElement(elements, (item, t) => text(item?.tag) === 'textarea' && /comment|message|review|feedback/.test(t)),
  },
  {
    key: 'email field',
    requested: /\bemail\b/i,
    evidenced: ({ elements }) => hasElement(elements, (item, t) => text(item?.type) === 'email' || /\bemail\b/.test(t)),
  },
  {
    key: 'age field/boundary',
    requested: /\bage\b/i,
    evidenced: ({ elements }) => hasElement(elements, (item, t) => /\bage\b|date.?of.?birth|\bdob\b/.test(t) || (text(item?.type) === 'number' && /age/.test(t))),
  },
  {
    key: 'website/URL field',
    requested: /\bwebsite\b|\burl\b/i,
    evidenced: ({ elements }) => hasElement(elements, (item, t) => text(item?.type) === 'url' || /website|\burl\b|homepage/.test(t)),
  },
  {
    key: 'success/confirmation state',
    requested: /\bconfirmation\b|\bconfirm(?:ed|ation)?\b|\bsuccess(?:ful|fully)?\b|after successful submission/i,
    evidenced: ({ messages, corpus }) => /success|confirm|thank|submitted|received|complete/.test(corpus) || (messages || []).length > 0,
  },
  {
    key: 'search',
    requested: /\bsearch\b|\bquery\b/i,
    evidenced: ({ elements, corpus }) => /search|query/.test(corpus) || hasElement(elements, (item, t) => text(item?.type) === 'search' || /search|\bq\b/.test(t)),
  },
  {
    key: 'file upload',
    requested: /\bupload\b|\battach(?:ment| file)?\b/i,
    evidenced: ({ elements }) => hasElement(elements, (item) => text(item?.type) === 'file'),
  },
  {
    key: 'phone field',
    requested: /\bphone\b|\bmobile\b|telephone/i,
    evidenced: ({ elements }) => hasElement(elements, (item, t) => text(item?.type) === 'tel' || /phone|mobile|telephone/.test(t)),
  },
];

function validateStoryDiscoveryCompatibility(story, pageDiscoveries = []) {
  const storyText = String(story || '').trim();
  const evidence = discoveryCorpus(pageDiscoveries);
  const requested = CONCEPTS.filter((concept) => concept.requested.test(storyText));
  const matched = requested.filter((concept) => concept.evidenced(evidence));
  const missing = requested.filter((concept) => !concept.evidenced(evidence));
  const ratio = requested.length ? matched.length / requested.length : 1;

  const criticalKeys = new Set(['login/authentication', 'feedback form']);
  const missingCritical = missing.filter((item) => criticalKeys.has(item.key));
  const specificFieldRequests = requested.filter((item) => ['username','password','email field','age field/boundary','website/URL field','file upload','phone field'].includes(item.key));
  const missingSpecific = missing.filter((item) => specificFieldRequests.includes(item));

  const mismatch = Boolean(
    missingCritical.length ||
    (requested.length >= 3 && ratio < 0.5) ||
    (specificFieldRequests.length >= 2 && missingSpecific.length >= Math.ceil(specificFieldRequests.length / 2))
  );

  return {
    compatible: !mismatch,
    requestedConcepts: requested.map((item) => item.key),
    evidencedConcepts: matched.map((item) => item.key),
    missingConcepts: missing.map((item) => item.key),
    evidenceRatio: requested.length ? Math.round(ratio * 100) : 100,
    pageTitles: (pageDiscoveries || []).map((page) => page?.pageTitle).filter(Boolean),
    finalUrls: (pageDiscoveries || []).map((page) => page?.finalUrl || page?.url).filter(Boolean),
  };
}

function mismatchMessage(result, targetUrl) {
  const missing = result?.missingConcepts?.length ? result.missingConcepts.join(', ') : 'required application behavior';
  let host = String(targetUrl || 'the target application');
  try { host = new URL(targetUrl).host; } catch {}
  return `Business story does not match the discovered target application (${host}). Missing discovery evidence for: ${missing}. Test generation was stopped so AI cannot repurpose unrelated controls or invent the requested feature.`;
}

module.exports = { validateStoryDiscoveryCompatibility, mismatchMessage };
