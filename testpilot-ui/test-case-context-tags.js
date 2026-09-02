(function(){
  if(window.__testNexusCaseContextTags)return;
  window.__testNexusCaseContextTags=true;

  function casesArray(){try{return Array.isArray(testCases)?testCases:[]}catch{return[]}}
  function currentEnvironment(){return document.getElementById('environment')?.value||'Test'}
  function pretty(v){return String(v||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase())}
  function pageFor(tc){
    const fromIr=(tc?.canonicalIr?.actions||[]).find(a=>String(a?.operation||'').toUpperCase()==='NAVIGATE')?.path;
    if(fromIr)return fromIr;
    const fromStep=(tc?.steps||[]).find(s=>/navigate/i.test(String(s?.action||'')))?.value;
    return fromStep||'/';
  }
  function ensureStyle(){
    if(document.getElementById('testCaseContextTagCss'))return;
    const s=document.createElement('style');s.id='testCaseContextTagCss';s.textContent=`
      #cases .case-meta .tag.context-environment{background:#ecfdf3;color:#067647;font-weight:800}
      #cases .case-meta .tag.context-page{background:#f8fafc;color:#475569;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #cases .case-meta .tag.context-scenario{background:#fff7ed;color:#9a3412;font-weight:800}
    `;document.head.appendChild(s);
  }
  function upsert(meta,cls,text,title){let el=meta.querySelector(`.tag.${cls}`);if(!el){el=document.createElement('span');el.className=`tag ${cls}`;meta.appendChild(el)}el.textContent=text;if(title)el.title=title}
  function decorate(){
    if(window.__aiTestPilotProgressiveGenerationActive)return;
    const cases=casesArray(),env=currentEnvironment();
    document.querySelectorAll('#cases .case').forEach((card,i)=>{
      const tc=cases[i],meta=card.querySelector('.case-meta');if(!tc||!meta)return;
      const scenario=tc.type||tc.scenarioType||'functional';
      const category=tc.testCategory||tc.category||'FUNCTIONAL';
      const page=pageFor(tc);
      // test-category-ui owns the category badge when available; create a fallback
      // only when that enhancer has not decorated the card yet.
      if(!meta.querySelector('.tag.test-category'))upsert(meta,'test-category',pretty(category));
      upsert(meta,'context-scenario',`Scenario: ${pretty(scenario)}`);
      upsert(meta,'context-environment',`Env: ${env}`);
      upsert(meta,'context-page',`Page: ${page}`,page);
    });
  }
  ensureStyle();
  const root=document.getElementById('cases');
  if(root)new MutationObserver(()=>setTimeout(decorate,0)).observe(root,{childList:true,subtree:true});
  document.getElementById('environment')?.addEventListener('change',decorate);
  [0,100,300,700,1400].forEach(d=>setTimeout(decorate,d));
  window.TestNexusRefreshCaseContext=decorate;
})();