/* Independent browser verification for searchable suggestions and semantic dropdowns. */

function filterCapabilityCase(testContext) {
  const wanted = String(Cypress.env('CAPABILITY_CASE') || '').trim().toUpperCase();
  const current = String(testContext.currentTest?.title || '').trim().toUpperCase();
  if (wanted && !current.startsWith(wanted)) testContext.skip();
}

function findScrollableListNode(list) {
  const win = list.ownerDocument.defaultView;
  const isScrollable = (node) => {
    if (!node || node === list.ownerDocument.body || node === list.ownerDocument.documentElement) return false;
    const maxTop = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
    if (maxTop <= 1) return false;
    if (node === list) return true;
    const style = win.getComputedStyle(node);
    return /^(auto|scroll|overlay)$/i.test(String(style.overflowY || ''));
  };

  const candidates = [list, ...Array.from(list.querySelectorAll('*'))];
  let parent = list.parentElement;
  for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
    if (parent !== list.ownerDocument.body && parent !== list.ownerDocument.documentElement) candidates.push(parent);
  }
  return candidates.find(isScrollable) || null;
}

function settleVirtualizedWindow(win) {
  return new Cypress.Promise((resolve) => {
    let frames = 0;
    const settle = () => {
      frames += 1;
      if (frames >= 2) {
        resolve();
        return;
      }
      win.requestAnimationFrame(settle);
    };
    win.requestAnimationFrame(settle);
  });
}

function seekVirtualizedOption(expected, { click = false, attempt = 0, maxAttempts = 24 } = {}) {
  return cy.get('#virtual-list').should('be.visible').then(($list) => {
    const $match = $list.find('[role="option"]').filter((_, el) => {
      const text = String(el.textContent || '').trim();
      const value = String(el.getAttribute('data-value') || '').trim();
      return text === expected || value === expected;
    }).first();
    if ($match.length) {
      const chain = cy.wrap($match, { log: false }).should('be.visible');
      return click ? chain.click({ scrollBehavior: false }) : chain;
    }
    if (attempt >= maxAttempts) throw new Error(`Could not render ${expected} within ${maxAttempts} bounded traversal attempts.`);

    const list = $list[0];
    const scrollNode = findScrollableListNode(list);
    if (!scrollNode) throw new Error(`No grounded scrollable list container is available while looking for ${expected}.`);

    const before = Number(scrollNode.scrollTop || 0);
    const maxTop = Math.max(0, Number(scrollNode.scrollHeight || 0) - Number(scrollNode.clientHeight || 0));
    const viewport = Math.max(1, Number(scrollNode.clientHeight || 0));
    const next = Math.min(maxTop, before + Math.max(32, Math.floor(viewport * 0.6)));
    if (next <= before + 0.5) throw new Error(`Virtualized list cannot scroll further while looking for ${expected}.`);

    if (typeof scrollNode.scrollTo === 'function') {
      scrollNode.scrollTo({ top: next, left: Number(scrollNode.scrollLeft || 0), behavior: 'auto' });
    } else {
      scrollNode.scrollTop = next;
    }

    return settleVirtualizedWindow(list.ownerDocument.defaultView)
      .then(() => seekVirtualizedOption(expected, { click, attempt: attempt + 1, maxAttempts }));
  });
}

describe('TestNexus searchable suggestions capability lab', () => {
  beforeEach(function () {
    filterCapabilityCase(this);
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

describe('TestNexus virtualized and selected-tag capability lab', () => {
  beforeEach(function () {
    filterCapabilityCase(this);
    cy.visit('/searchable-advanced.html');
  });

  it('CAP054 bounded traversal renders an offscreen virtualized option', () => {
    cy.get('#virtual-list [role="option"]').should('not.contain.text', 'Item 24');
    seekVirtualizedOption('Item 24');
    cy.get('#virtual-list [role="option"][data-value="Item 24"]').should('be.visible');
    cy.get('#virtual-selected').should('have.text', 'none');
  });

  it('CAP055 bounded traversal selects an exact virtualized option', () => {
    seekVirtualizedOption('Item 42', { click: true });
    cy.get('#virtual-selected').should('have.text', 'Item 42');
    cy.get('#virtual-combo').should('have.value', 'Item 42');
  });

  it('CAP056 selected chip can be removed through its semantic remove control', () => {
    cy.get('#tag-chips [data-selected-value="Laravel"]').should('exist');
    cy.get('button[aria-controls="tag-list"][aria-label="Remove Laravel"]').click();
    cy.get('#tag-chips [data-selected-value="Laravel"]').should('not.exist');
    cy.get('#tag-opt-laravel').should('have.attr', 'aria-selected', 'false');
  });

  it('CAP057 dynamically selected chip reuses the grounded remove-label pattern', () => {
    cy.get('#tag-combo').clear().type('Vue');
    cy.get('#tag-list [role="option"]:visible').contains('Vue').click();
    cy.get('#tag-chips [data-selected-value="Vue"]').should('exist');
    cy.get('button[aria-controls="tag-list"][aria-label="Remove Vue"]').click();
    cy.get('#tag-chips [data-selected-value="Vue"]').should('not.exist');
    cy.get('#tag-opt-vue').should('have.attr', 'aria-selected', 'false');
  });

  it('CAP058 clear-all removes every selected chip and selected state', () => {
    cy.get('#tag-combo').clear().type('Vue');
    cy.get('#tag-list [role="option"]:visible').contains('Vue').click();
    cy.get('#tag-chips [data-selected-value]').should('have.length', 2);
    cy.get('#tag-clear-all').click();
    cy.get('#tag-chips [data-selected-value]').should('have.length', 0);
    cy.get('#tag-list [role="option"][aria-selected="true"]').should('have.length', 0);
    cy.get('#tag-selected').should('have.text', 'none');
  });

  it('CAP059 remove and clear controls are tied to the same semantic listbox', () => {
    cy.get('#tag-combo').should('have.attr', 'aria-controls', 'tag-list');
    cy.get('#tag-list').should('have.attr', 'role', 'listbox').and('have.attr', 'aria-multiselectable', 'true');
    cy.get('button[aria-label="Remove Laravel"]').should('have.attr', 'aria-controls', 'tag-list');
    cy.get('#tag-clear-all').should('have.attr', 'aria-controls', 'tag-list').and('have.attr', 'aria-label', 'Clear all selected tags');
  });
});
