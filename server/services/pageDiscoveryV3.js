const cheerio = require("cheerio");

const MAX_AUTO_DISCOVERY_PAGES = 6;
const MAX_DISCOVERY_SCRIPTS_PER_PAGE = 8;
const MAX_SCRIPT_BYTES = 1_000_000;
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

function controlSelector($el) {
  if ($el.attr("data-testid")) return `[data-testid="${$el.attr("data-testid")}"]`;
  if ($el.attr("id")) return `#${$el.attr("id")}`;
  if ($el.attr("name")) return `[name="${$el.attr("name")}"]`;
  return null;
}

function findErrorElement($, $el) {
  const describedBy = ($el.attr("aria-describedby") || "").split(/\s+/).filter(Boolean);
  for (const id of describedBy) {
    const $candidate = $(`#${id}`);
    if ($candidate.length) {
      return {
        id,
        testId: $candidate.attr("data-testid") || null,
        selector: controlSelector($candidate),
        text: $candidate.text().trim() || null,
        source: "aria-describedby",
      };
    }
  }
  let $candidate = $el.next();
  for (let i = 0; i < 4 && $candidate.length; i += 1) {
    const signature = [$candidate.attr("class"), $candidate.attr("id"), $candidate.attr("data-testid")].filter(Boolean).join(" ").toLowerCase();
    if (signature.includes("error") || signature.includes("validation")) {
      return {
        id: $candidate.attr("id") || null,
        testId: $candidate.attr("data-testid") || null,
        selector: controlSelector($candidate),
        text: $candidate.text().trim() || null,
        source: "dom-proximity",
      };
    }
    $candidate = $candidate.next();
  }
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

function isSameOriginResource(candidate, pageUrl) {
  try {
    const base = new URL(pageUrl);
    const url = new URL(candidate, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin) return null;
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
  const routeLiteral = /["'](\/[A-Za-z0-9][^"'\s<>]*)["']/g;
  let match;
  while ((match = routeLiteral.exec(html)) !== null) add(match[1]);
  return [...hints];
}

function normalizeNetworkUrl(raw, pageUrl) {
  const source = String(raw || "").trim();
  if (!source || source.includes("${") || source.includes("<%")) return null;
  try {
    const base = new URL(pageUrl);
    const url = new URL(source, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin) return null;
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return null;
  }
}

function extractNetworkHintsFromSource(source, pageUrl) {
  const hints = new Map();
  const add = (rawUrl, method = null, sourceType = "script") => {
    const url = normalizeNetworkUrl(rawUrl, pageUrl);
    if (!url) return;
    if (!/^\/(?:api|graphql|rest)\b/i.test(url) && !/\bapi\b/i.test(rawUrl)) return;
    const normalizedMethod = method ? String(method).toUpperCase() : null;
    const key = `${normalizedMethod || "*"} ${url}`;
    hints.set(key, { method: normalizedMethod, url, source: sourceType });
  };

  const text = String(source || "");
  let match;
  const fetchRegex = /fetch\s*\(\s*["'`]([^"'`]+)["'`]\s*(?:,\s*\{([\s\S]{0,500}?)\})?/gi;
  while ((match = fetchRegex.exec(text)) !== null) {
    const method = match[2]?.match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/i)?.[1] || null;
    add(match[1], method, "fetch");
  }
  const axiosRegex = /axios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((match = axiosRegex.exec(text)) !== null) add(match[2], match[1], "axios");
  const xhrRegex = /\.open\s*\(\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]\s*,\s*["'`]([^"'`]+)["'`]/gi;
  while ((match = xhrRegex.exec(text)) !== null) add(match[2], match[1], "xhr");
  const apiLiteral = /["'`](\/(?:api|graphql|rest)\/[A-Za-z0-9._~!$&()*+,;=:@%/?-]*)["'`]/gi;
  while ((match = apiLiteral.exec(text)) !== null) add(match[1], null, "literal");
  return [...hints.values()];
}

async function discoverScriptSources($, html, pageUrl) {
  const sources = [html];
  const urls = [];
  $("script[src]").each((_, el) => {
    const resolved = isSameOriginResource($(el).attr("src"), pageUrl);
    if (resolved && !urls.includes(resolved) && urls.length < MAX_DISCOVERY_SCRIPTS_PER_PAGE) urls.push(resolved);
  });
  for (const url of urls) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) continue;
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_SCRIPT_BYTES) continue;
      const text = await response.text();
      if (text.length <= MAX_SCRIPT_BYTES) sources.push(text);
    } catch {}
  }
  return sources;
}

function commonMetadata($el) {
  return {
    id: $el.attr("id") || null,
    testId: $el.attr("data-testid") || null,
    name: $el.attr("name") || null,
    selector: controlSelector($el),
    role: $el.attr("role") || null,
    ariaLabel: $el.attr("aria-label") || null,
    ariaDescribedBy: $el.attr("aria-describedby") || null,
    className: $el.attr("class") || null,
    hidden: $el.attr("hidden") !== undefined,
  };
}

async function discoverPage(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const elements = [];
  const seenSelectors = new Set();
  const addElement = (entry) => {
    if (!entry?.selector || seenSelectors.has(entry.selector)) return;
    seenSelectors.add(entry.selector);
    elements.push(entry);
  };

  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const tag = String(el.tagName || "").toLowerCase();
    const type = $el.attr("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");
    const id = $el.attr("id") || null;
    const entry = {
      ...commonMetadata($el),
      tag,
      type,
      label: labelFor($, id) || $el.closest("label").text().trim() || $el.attr("placeholder") || $el.attr("name") || null,
      placeholder: $el.attr("placeholder") || null,
      required: $el.attr("required") !== undefined,
      disabled: $el.attr("disabled") !== undefined,
      readonly: $el.attr("readonly") !== undefined,
      multiple: $el.attr("multiple") !== undefined,
      min: $el.attr("min") || null,
      max: $el.attr("max") || null,
      step: $el.attr("step") || null,
      minlength: $el.attr("minlength") || null,
      maxlength: $el.attr("maxlength") || null,
      pattern: $el.attr("pattern") || null,
      autocomplete: $el.attr("autocomplete") || null,
      inputmode: $el.attr("inputmode") || null,
      errorElement: findErrorElement($, $el),
    };
    if (tag === "select") {
      entry.options = $el.find("option").map((__, option) => {
        const $option = $(option);
        return { value: $option.attr("value") ?? "", label: $option.text().trim(), disabled: $option.attr("disabled") !== undefined };
      }).get();
    }
    if (type === "radio" || type === "checkbox") {
      entry.value = $el.attr("value") || null;
      entry.checked = $el.attr("checked") !== undefined;
    }
    addElement(entry);
  });

  $("button").each((_, el) => {
    const $el = $(el);
    addElement({ ...commonMetadata($el), tag: "button", type: $el.attr("type") || "submit", text: $el.text().trim(), disabled: $el.attr("disabled") !== undefined });
  });
  $("a[href]").each((_, el) => {
    const $el = $(el);
    addElement({ ...commonMetadata($el), tag: "a", type: "link", href: $el.attr("href"), text: $el.text().trim() });
  });

  // Ground assertion targets beyond form controls without indexing the entire DOM.
  $("[data-testid], [id][role], img[id], img[data-testid], table[id], table[data-testid], h1[id], h1[data-testid], h2[id], h2[data-testid], [aria-live][id], [aria-live][data-testid]").each((_, el) => {
    const $el = $(el);
    const tag = String(el.tagName || "").toLowerCase();
    const entry = {
      ...commonMetadata($el),
      tag,
      type: tag,
      text: $el.text().replace(/\s+/g, " ").trim() || null,
      alt: $el.attr("alt") || null,
      src: $el.attr("src") || null,
      href: $el.attr("href") || null,
    };
    addElement(entry);
  });

  const messages = [];
  $("[role='alert'], [role='status'], [aria-live], .error, .success, .success-panel").each((_, el) => {
    const $el = $(el);
    const item = {
      ...commonMetadata($el),
      tag: String(el.tagName || "").toLowerCase(),
      text: $el.text().replace(/\s+/g, " ").trim() || null,
    };
    if (item.id || item.testId || item.text) messages.push(item);
  });

  const scriptSources = await discoverScriptSources($, html, res.url || url);
  const networkMap = new Map();
  for (const source of scriptSources) {
    for (const hint of extractNetworkHintsFromSource(source, res.url || url)) {
      networkMap.set(`${hint.method || "*"} ${hint.url}`, hint);
    }
  }
  $("form[action]").each((_, el) => {
    const $form = $(el);
    const networkUrl = normalizeNetworkUrl($form.attr("action"), res.url || url);
    if (networkUrl && /^\/(?:api|graphql|rest)\b/i.test(networkUrl)) {
      const method = String($form.attr("method") || "GET").toUpperCase();
      networkMap.set(`${method} ${networkUrl}`, { method, url: networkUrl, source: "form-action" });
    }
  });

  const meta = $("meta[name]").map((_, el) => ({ name: $(el).attr("name"), content: $(el).attr("content") || "" })).get().slice(0, 50);
  return {
    url,
    finalUrl: res.url || url,
    pageTitle: $("title").text().trim() || $("h1").first().text().trim() || url,
    documentLanguage: $("html").attr("lang") || null,
    meta,
    elements,
    messages,
    routeHints: extractRouteHints($, html, res.url || url),
    networkHints: [...networkMap.values()],
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

module.exports = { discoverPage, discoverPages, extractNetworkHintsFromSource };
