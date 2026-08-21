/**
 * Page Discovery Service
 * -----------------------
 * Visits the target URL and builds a compact inventory of form controls
 * (label, name, type, testId, required) so Qwen never has to guess
 * selectors from the business story alone.
 *
 * Uses cheerio for lightweight HTML parsing (no headless browser needed
 * for static/server-rendered forms like the demo app).
 */
const cheerio = require("cheerio");

async function discoverPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const elements = [];

  const labelFor = (id) => $(`label[for="${id}"]`).first().text().trim() || null;
  const legendFor = ($fieldset) => $fieldset.find("legend").first().text().trim() || null;

  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const tag = el.tagName.toLowerCase();
    const type = $el.attr("type") || (tag === "select" ? "select" : tag === "textarea" ? "textarea" : "text");
    if (type === "radio" || type === "checkbox") return; // grouped separately below
    const id = $el.attr("id");
    elements.push({
      tag,
      type,
      label: (id && labelFor(id)) || $el.attr("placeholder") || $el.attr("name"),
      name: $el.attr("name"),
      testId: $el.attr("data-testid") || null,
      required: $el.attr("required") !== undefined || $el.attr("min") !== undefined,
    });
  });

  // Radio / checkbox groups (grouped by `name`, inside a <fieldset>)
  const groups = {};
  $("fieldset").each((_, fs) => {
    const $fs = $(fs);
    const legend = legendFor($fs);
    $fs.find('input[type="radio"], input[type="checkbox"]').each((__, inp) => {
      const $inp = $(inp);
      const name = $inp.attr("name");
      if (!name) return;
      groups[name] = groups[name] || { name, type: $inp.attr("type"), label: legend, options: [] };
      const optLabel = $inp.closest("label").text().trim();
      groups[name].options.push({ value: $inp.attr("value"), label: optLabel, testId: $inp.attr("data-testid") || null });
    });
  });
  Object.values(groups).forEach((g) => elements.push({ tag: "input-group", ...g }));

  // Standalone consent/newsletter-style checkboxes (not in a fieldset group)
  $('input[type="checkbox"]').each((_, el) => {
    const $el = $(el);
    if (groups[$el.attr("name")]) return;
    const id = $el.attr("id");
    elements.push({
      tag: "input",
      type: "checkbox",
      label: (id && labelFor(id)) || $el.closest("label").text().trim(),
      name: $el.attr("name"),
      testId: $el.attr("data-testid") || null,
      required: $el.attr("required") !== undefined,
    });
  });

  $("button").each((_, el) => {
    const $el = $(el);
    elements.push({
      tag: "button",
      role: "button",
      text: $el.text().trim(),
      testId: $el.attr("data-testid") || null,
      submitType: $el.attr("type") || "submit",
    });
  });

  return {
    pageTitle: $("title").text().trim() || $("h1").first().text().trim(),
    url,
    elements,
  };
}

module.exports = { discoverPage };
