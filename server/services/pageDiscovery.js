const cheerio = require("cheerio");

function labelFor($, id) {
  if (!id) return null;
  let text = null;
  $("label").each((_, label) => {
    if (text) return;
    const $label = $(label);
    if ($label.attr("for") === id) text = $label.text().trim();
  });
  return text;
}

function findErrorElement($, $el) {
  const describedBy = ($el.attr("aria-describedby") || "").split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const $candidate = $(`#${id}`);
    if ($candidate.length) {
      return {
        id,
        testId: $candidate.attr("data-testid") || null,
        text: $candidate.text().trim() || null,
        source: "aria-describedby",
      };
    }
  }

  let $candidate = $el.next();
  for (let i = 0; i < 4 && $candidate.length; i += 1) {
    const signature = [
      $candidate.attr("class"),
      $candidate.attr("id"),
      $candidate.attr("data-testid"),
    ].filter(Boolean).join(" ").toLowerCase();
    if (signature.includes("error") || signature.includes("validation")) {
      return {
        id: $candidate.attr("id") || null,
        testId: $candidate.attr("data-testid") || null,
        text: $candidate.text().trim() || null,
        source: "dom-proximity",
      };
    }
    $candidate = $candidate.next();
  }
  return null;
}

function controlSelector($el) {
  if ($el.attr("data-testid")) return `[data-testid="${$el.attr("data-testid")}"]`;
  if ($el.attr("id")) return `#${$el.attr("id")}`;
  if ($el.attr("name")) return `[name="${$el.attr("name")}"]`;
  return null;
}

async function discoverPage(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const elements = [];

  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const tag = String(el.tagName || "").toLowerCase();
    const type = $el.attr("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");
    const id = $el.attr("id") || null;
    const entry = {
      tag,
      type,
      id,
      name: $el.attr("name") || null,
      testId: $el.attr("data-testid") || null,
      selector: controlSelector($el),
      label: labelFor($, id) || $el.closest("label").text().trim() || $el.attr("placeholder") || $el.attr("name") || null,
      placeholder: $el.attr("placeholder") || null,
      required: $el.attr("required") !== undefined,
      min: $el.attr("min") || null,
      max: $el.attr("max") || null,
      minlength: $el.attr("minlength") || null,
      maxlength: $el.attr("maxlength") || null,
      errorElement: findErrorElement($, $el),
    };

    if (tag === "select") {
      entry.options = $el.find("option").map((__, option) => {
        const $option = $(option);
        return { value: $option.attr("value") ?? "", label: $option.text().trim() };
      }).get();
    }

    if (type === "radio" || type === "checkbox") {
      entry.value = $el.attr("value") || null;
      entry.checked = $el.attr("checked") !== undefined;
    }

    elements.push(entry);
  });

  $("button").each((_, el) => {
    const $el = $(el);
    elements.push({
      tag: "button",
      type: $el.attr("type") || "submit",
      id: $el.attr("id") || null,
      testId: $el.attr("data-testid") || null,
      selector: controlSelector($el),
      text: $el.text().trim(),
    });
  });

  $("a[href]").each((_, el) => {
    const $el = $(el);
    elements.push({
      tag: "a",
      href: $el.attr("href"),
      id: $el.attr("id") || null,
      testId: $el.attr("data-testid") || null,
      selector: controlSelector($el),
      text: $el.text().trim(),
    });
  });

  // Assertion targets are discovered separately so the model can see
  // validation/success elements even when their runtime text is initially empty.
  const messages = [];
  $("[role='alert'], .error, .success, .success-panel").each((_, el) => {
    const $el = $(el);
    const item = {
      tag: String(el.tagName || "").toLowerCase(),
      id: $el.attr("id") || null,
      testId: $el.attr("data-testid") || null,
      text: $el.text().replace(/\s+/g, " ").trim() || null,
      hidden: $el.attr("hidden") !== undefined,
    };
    if (item.id || item.testId || item.text) messages.push(item);
  });

  return {
    url,
    finalUrl: res.url || url,
    pageTitle: $("title").text().trim() || $("h1").first().text().trim() || url,
    elements,
    messages,
  };
}

async function discoverPages(urls) {
  const unique = [...new Set((urls || []).filter(Boolean))];
  const pages = [];
  for (const url of unique) pages.push(await discoverPage(url));
  return pages;
}

module.exports = { discoverPage, discoverPages };
