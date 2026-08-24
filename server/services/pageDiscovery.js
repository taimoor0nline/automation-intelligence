const cheerio = require("cheerio");

const MAX_AUTO_DISCOVERY_PAGES = 6;
const SKIP_PATH_PREFIXES = ["/api/"];
const SKIP_EXTENSIONS = /\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip|json|xml)(?:$|[?#])/i;

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

function isUsefulPageUrl(candidate, pageUrl) {
  try {
    const base = new URL(pageUrl);
    const url = new URL(candidate, base);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.origin !== base.origin) return null;
    if (SKIP_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
    if (SKIP_EXTENSIONS.test(url.pathname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractRouteHints($, html, pageUrl) {
  const hints = new Set();

  const add = (raw) => {
    const resolved = isUsefulPageUrl(raw, pageUrl);
    if (resolved) hints.add(resolved);
  };

  $("a[href]").each((_, el) => add($(el).attr("href")));
  $("form[action]").each((_, el) => add($(el).attr("action")));

  // The current demo uses a JavaScript redirect after login. Collect root-relative
  // route literals from the real page source so Known pages can remain optional.
  // This is deliberately bounded and same-origin; production discovery will use a browser.
  const routeLiteral = /["'](\/[A-Za-z0-9][^"'\s<>]*)["']/g;
  let match;
  while ((match = routeLiteral.exec(html)) !== null) add(match[1]);

  return [...hints];
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
    routeHints: extractRouteHints($, html, res.url || url),
  };
}

async function discoverPages(urls) {
  const seeds = [...new Set((urls || []).filter(Boolean))];
  if (!seeds.length) return [];

  const firstOrigin = new URL(seeds[0]).origin;
  const queue = [...seeds];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];

  while (queue.length && pages.length < MAX_AUTO_DISCOVERY_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const page = await discoverPage(url);
    pages.push(page);

    for (const hint of page.routeHints || []) {
      try {
        if (new URL(hint).origin !== firstOrigin) continue;
      } catch {
        continue;
      }
      if (!visited.has(hint) && !queued.has(hint) && queue.length + pages.length < MAX_AUTO_DISCOVERY_PAGES) {
        queue.push(hint);
        queued.add(hint);
      }
    }
  }

  return pages;
}

module.exports = { discoverPage, discoverPages };
