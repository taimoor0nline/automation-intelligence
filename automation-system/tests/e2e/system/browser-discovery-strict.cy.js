/* TestNexus rendered-discovery input contract. */

function boolValue(value) {
  if (value == null || value === '') return false;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function parsedSeeds() {
  const raw = Cypress.env('DISCOVERY_TARGET_URLS_JSON');
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (raw && typeof raw === 'object') return [];
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string' && value) return [value];
  } catch {
    if (/^https?:\/\//i.test(text)) return [text];
  }
  return [];
}

describe('TestNexus rendered discovery input contract', () => {
  it('receives the target URL and snapshot output path when discovery is explicitly enabled', () => {
    if (!boolValue(Cypress.env('DISCOVERY_ENABLED'))) return;

    const seeds = parsedSeeds();
    const outputFile = String(Cypress.env('DISCOVERY_OUTPUT_FILE') || '').trim();
    const pageScope = String(Cypress.env('DISCOVERY_PAGE_SCOPE') || '').trim();

    if (!seeds.length || !outputFile) {
      throw new Error(
        `[DISCOVERY_INPUT_INVALID] Rendered discovery was enabled but Cypress did not receive its required inputs. ` +
        `targetCount=${seeds.length}; outputFile=${outputFile ? 'present' : 'missing'}; pageScope=${pageScope || 'missing'}.`
      );
    }

    expect(seeds[0]).to.match(/^https?:\/\//i);
    expect(outputFile).to.match(/artifacts[\\/]discovery[\\/].+\.json$/i);
  });
});

require('./browser-discovery.cy.js');
