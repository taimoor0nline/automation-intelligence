/* Independent browser verification for searchable suggestions and semantic dropdowns. */

describe('TestNexus searchable suggestions capability lab', () => {
  beforeEach(function () {
    const wanted = String(Cypress.env('CAPABILITY_CASE') || '').trim().toUpperCase();
    const current = String(this.currentTest?.title || '').trim().toUpperCase();
    if (wanted && !current.startsWith(wanted)) this.skip();
    cy.visit('/capabilities.html');
  });

  it('CAP044 search input filters visible suggestions', () => {
    cy.get('#search-suggest-input').clear().type('Doc');
    cy.get('#search-suggest-list').should('be.visible');
    cy.get('#search-suggest-list [role="option"]:visible').should('have.length', 2);
    cy.get('#search-suggest-list [role="option"]:visible').then(($options) => {
      const labels = Array.from($options).map((el) => el.textContent.trim());
      expect(labels).to.deep.eq(['Documents', 'Document Intelligence']);
    });
  });

  it('CAP045 search suggestion can be selected deterministically', () => {
    cy.get('#search-suggest-input').clear().type('Document Intelligence');
    cy.get('#search-suggest-list [role="option"]:visible').contains('Document Intelligence').click();
    cy.get('#search-suggest-input').should('have.value', 'Document Intelligence');
    cy.get('#search-suggest-selected').should('have.text', 'Document Intelligence');
    cy.get('#search-suggest-input').should('have.attr', 'aria-expanded', 'false');
  });

  it('CAP046 search suggestions expose a deterministic no-results state', () => {
    cy.get('#search-suggest-input').clear().type('No Such Result');
    cy.get('#search-suggest-input').should('have.attr', 'aria-expanded', 'false');
    cy.get('#search-suggest-list').should('not.be.visible');
    cy.get('#search-suggest-list [role="option"]:visible').should('have.length', 0);
  });

  it('CAP047 searchable single-select filters and selects an evidenced option', () => {
    cy.get('#country-combo').clear().type('Oma');
    cy.get('#country-list').should('be.visible');
    cy.get('#country-list [role="option"]:visible').should('have.length', 1).and('contain.text', 'Oman');
    cy.get('#country-list [role="option"]:visible').click();
    cy.get('#country-combo').should('have.value', 'Oman');
    cy.get('#country-selected').should('have.text', 'Oman');
  });

  it('CAP048 searchable multi-select retains multiple selected options', () => {
    cy.get('#skills-combo').clear().type('Laravel');
    cy.get('#skills-list [role="option"]:visible').contains('Laravel').click();
    cy.get('#skills-combo').clear().type('Vue');
    cy.get('#skills-list [role="option"]:visible').contains('Vue').click();
    cy.get('#skills-list [role="option"][data-value="Laravel"]').should('have.attr', 'aria-selected', 'true');
    cy.get('#skills-list [role="option"][data-value="Vue"]').should('have.attr', 'aria-selected', 'true');
    cy.get('#skills-chips [data-selected-value]').then(($chips) => {
      expect(Array.from($chips).map((el) => el.getAttribute('data-selected-value'))).to.deep.eq(['Laravel', 'Vue']);
    });
    cy.get('#skills-selected').should('have.text', 'Laravel,Vue');
  });

  it('CAP049 searchable multi-select is explicitly ARIA multiselectable', () => {
    cy.get('#skills-combo').should('have.attr', 'role', 'combobox').and('have.attr', 'aria-controls', 'skills-list');
    cy.get('#skills-list').should('have.attr', 'role', 'listbox').and('have.attr', 'aria-multiselectable', 'true');
  });

  it('CAP050 async search suggestions expose loading then grounded results', () => {
    cy.get('#async-search').clear().type('Sara');
    cy.get('#async-loading').should('be.visible');
    cy.get('#async-search-list').should('be.visible');
    cy.get('#async-loading').should('not.be.visible');
    cy.get('#async-search-list [role="option"]:visible').should('have.length', 1).and('contain.text', 'Sara Khan').click();
    cy.get('#async-selected').should('have.text', 'Sara Khan');
    cy.get('#async-search').should('have.value', 'Sara Khan');
  });

  it('CAP051 keyboard Enter selects the first filtered suggestion', () => {
    cy.get('#search-suggest-input').clear().type('Users').type('{enter}');
    cy.get('#search-suggest-selected').should('have.text', 'Users');
    cy.get('#search-suggest-input').should('have.value', 'Users');
  });

  it('CAP052 Escape collapses an expanded searchable dropdown', () => {
    cy.get('#country-combo').click().should('have.attr', 'aria-expanded', 'true').type('{esc}');
    cy.get('#country-combo').should('have.attr', 'aria-expanded', 'false');
    cy.get('#country-list').should('not.be.visible');
  });

  it('CAP053 suggestion controls expose stable semantic relationships', () => {
    cy.get('#search-suggest-input').should('have.attr', 'role', 'combobox').and('have.attr', 'aria-autocomplete', 'list').and('have.attr', 'aria-controls', 'search-suggest-list');
    cy.get('#search-suggest-list').should('have.attr', 'role', 'listbox');
    cy.get('#search-suggest-list [role="option"]').should('have.length', 4);
  });
});
