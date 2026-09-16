function js(value) { return JSON.stringify(value); }
function cssAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function suggestionListSelector(contract = {}) {
  if (contract.suggestionListSelector) return String(contract.suggestionListSelector);
  if (contract.suggestionListId) return `[id="${cssAttr(contract.suggestionListId)}"]`;
  throw new Error('Virtualized suggestion traversal requires a grounded listbox relationship.');
}

function optionMatchBody(expected) {
  return `const text=String(el.textContent||'').trim().replace(/\\s+/g,' '); const value=String(el.getAttribute('data-value')||el.getAttribute('value')||el.getAttribute('aria-label')||'').trim(); return text===${js(String(expected))}||value===${js(String(expected))};`;
}

function emitNativeTraversal(contract, expected, { click = false } = {}) {
  const listSelector = suggestionListSelector(contract);
  const maxAttempts = Math.max(1, Math.min(Number(contract.suggestionTraversalMaxAttempts || 24), 50));
  const found = click
    ? `return cy.wrap($match,{log:false}).should('be.visible').and('not.have.attr','aria-disabled','true').click({scrollBehavior:false});`
    : `return cy.wrap($match,{log:false}).should('be.visible');`;

  return `cy.then(()=>{ const seek=(attempt=0)=>cy.get(${js(listSelector)}).should('be.visible').then(($list)=>{ const $matches=$list.find('[role="option"]').filter((_,el)=>{ ${optionMatchBody(expected)} }); if($matches.length){ const $match=$matches.first(); ${found} } if(attempt>=${maxAttempts}) throw new Error(${js(`Suggestion ${String(expected)} was not rendered within the bounded traversal limit.`)}); const list=$list[0]; const win=list.ownerDocument.defaultView; const isScrollable=(node)=>{ if(!node||node===list.ownerDocument.body||node===list.ownerDocument.documentElement) return false; const max=Math.max(0,Number(node.scrollHeight||0)-Number(node.clientHeight||0)); if(max<=1) return false; if(node===list) return true; const style=win.getComputedStyle(node); return /^(auto|scroll|overlay)$/i.test(String(style.overflowY||'')); }; const candidates=[list,...Array.from(list.querySelectorAll('*'))]; let parent=list.parentElement; for(let depth=0;parent&&depth<3;depth+=1,parent=parent.parentElement){ if(parent!==list.ownerDocument.body&&parent!==list.ownerDocument.documentElement) candidates.push(parent); } const scrollNode=candidates.find(isScrollable); if(!scrollNode) throw new Error(${js(`Suggestion ${String(expected)} was not found and no grounded scrollable list container is available.`)}); const before=Number(scrollNode.scrollTop||0); const maxTop=Math.max(0,Number(scrollNode.scrollHeight||0)-Number(scrollNode.clientHeight||0)); const viewport=Math.max(1,Number(scrollNode.clientHeight||0)); const step=Math.max(32,Math.floor(viewport*0.6)); const next=Math.min(maxTop,before+step); if(next<=before+0.5) throw new Error(${js(`Suggestion ${String(expected)} was not found and the list cannot scroll further.`)}); if(typeof scrollNode.scrollTo==='function') scrollNode.scrollTo({top:next,left:Number(scrollNode.scrollLeft||0),behavior:'auto'}); else scrollNode.scrollTop=next; return new Cypress.Promise((resolve)=>{ let frames=0; const settle=()=>{ frames+=1; if(frames>=2){ resolve(); return; } win.requestAnimationFrame(settle); }; win.requestAnimationFrame(settle); }).then(()=>seek(attempt+1)); }); return seek(0); })`;
}

function emitTraversalAction(action) {
  const operation = String(action?.operation || '').trim().toUpperCase();
  if (!['SCROLL_SUGGESTIONS_TO_VALUE', 'SELECT_SUGGESTION_BY_TRAVERSAL'].includes(operation)) return null;
  const value = String(action?.value || '').trim();
  if (!action?.selector || !value) throw new Error(`${operation} requires a grounded control and evidenced suggestion value.`);
  const traversal = emitNativeTraversal(action, value, { click: operation === 'SELECT_SUGGESTION_BY_TRAVERSAL' });
  return `    cy.get(${js(action.selector)}).then(($el)=>{ if(String($el.attr('aria-expanded')||'').toLowerCase()!=='true') cy.wrap($el).click(); }).then(()=>${traversal});`;
}

module.exports = {
  emitNativeTraversal,
  emitTraversalAction,
  suggestionListSelector,
};
