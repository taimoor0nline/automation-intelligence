/* TestNexus rendered-discovery input contract. */

function boolValue(value) {
  if (value == null || value === '') return false;
  return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

function parsedSeeds() {
  try {
    const value = JSON.parse(String(Cypress.env('DISCOVERY_TARGET_URLS_JSON') || '[]'));
    return Array.isArray(value) ? value.filter(Boolean) : [];
  } catch {
    return [];
  }
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
