const cheerio = require('cheerio');
const v4 = require('./pageDiscoveryV4');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function formMetadata($el) {
  const $form = $el.closest('form').first();
  const $fieldset = $el.closest('fieldset').first();
  return {
    formId: $form.length ? clean($form.attr('id'), 180) || null : null,
    formName: $form.length ? clean($form.attr('name'), 180) || null : null,
    formAction: $form.length ? clean($form.attr('action'), 500) || null : null,
    formMethod: $form.length ? clean($form.attr('method') || 'GET', 20).toUpperCase() : null,
    groupName: $fieldset.length ? clean($el.attr('name'), 180) || null : null,
    groupLabel: $fieldset.length ? clean($fieldset.find('legend').first().text(), 300) || null : null,
  };
}

function annotateCollection($, collection = []) {
  return (collection || []).map((item) => {
    if (!item?.selector) return item;
    try {
      const $el = $(item.selector).first();
      if (!$el.length) return item;
      return { ...item, ...formMetadata($el) };
    } catch {
      return item;
    }
  });
}

async function annotateFormContext(page) {
  const pageUrl = page?.finalUrl || page?.url;
  if (!pageUrl) return page;
  try {
    const response = await fetch(pageUrl, { redirect: 'follow' });
    if (!response.ok) return page;
    const html = await response.text();
    const $ = cheerio.load(html);
    return {
      ...page,
      elements: annotateCollection($, page.elements),
      messages: annotateCollection($, page.messages),
    };
  } catch {
    return page;
  }
}

async function discoverPage(url, options = {}) {
  return annotateFormContext(await v4.discoverPage(url, options));
}

async function discoverPages(urls, options = {}) {
  const pages = await v4.discoverPages(urls, options);
  return Promise.all(pages.map(annotateFormContext));
}

module.exports = {
  ...v4,
  discoverPage,
  discoverPages,
  annotateFormContext,
};
