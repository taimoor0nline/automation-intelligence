const assert = require('assert');
const generator = require('../server/services/deterministicAutomationGeneratorV7');

const base = {
  selector: '#virtual-combo',
  suggestionListSelector: '#virtual-list',
  suggestionListId: 'virtual-list',
  value: 'Item 42',
  suggestionTraversalMaxAttempts: 24,
};

const scrollSource = generator.emitAction({
  ...base,
  operation: 'SCROLL_SUGGESTIONS_TO_VALUE',
});

assert(scrollSource.includes("const scrollNode=candidates.find(isScrollable)"), scrollSource);
assert(scrollSource.includes("scrollNode.scrollTo({top:next"), scrollSource);
assert(scrollSource.includes('requestAnimationFrame'), scrollSource);
assert(scrollSource.includes('attempt>=24'), scrollSource);
assert(!scrollSource.includes('.scrollIntoView()'), 'virtualized traversal must not scroll a recycled option node into view');
assert(scrollSource.includes('text==="Item 42"') || scrollSource.includes('value==="Item 42"'), scrollSource);

const selectSource = generator.emitAction({
  ...base,
  operation: 'SELECT_SUGGESTION_BY_TRAVERSAL',
});

assert(selectSource.includes('const centered='), selectSource);
assert(selectSource.includes('option.offsetTop'), selectSource);
assert(selectSource.includes('settle().then(()=>cy.get("#virtual-list")'), selectSource);
assert(selectSource.includes("click({scrollBehavior:false})"), selectSource);
assert(selectSource.includes("and('not.have.attr','aria-disabled','true')"), selectSource);
assert(selectSource.includes('requestAnimationFrame'), selectSource);
assert(!selectSource.includes('force:true'), 'selection must preserve normal Cypress actionability');
assert(!selectSource.includes('.scrollIntoView()'), 'selection must not trigger a second auto-scroll that can recycle the matched option');

console.log('virtualized-traversal-emitter-smoke: PASS');
