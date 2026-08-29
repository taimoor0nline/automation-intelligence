(function(){
  if(window.__aiTestPilotExecutionErrorClassification)return;window.__aiTestPilotExecutionErrorClassification=true;
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}
  function caseById(id){try{return (typeof testCases!=='undefined'&&Array.isArray(testCases)?testCases:[]).find(tc=>String(tc?.id||'').toUpperCase()===String(id||'').toUpperCase())||null}catch{return null}}
  function classify(text){
    const t=String(text||'');
    if(/accessibility|axe|a11y|violation/i.test(t))return{code:'ACCESSIBILITY_VIOLATION',label:'Accessibility violation',cls:'accessibility'};
    if(/support file|webpack|cypress|automation engine|browser.*(?:crash|closed|failed)|runtime login|invalid automation command|failed before test execution|could not verify that this server is running/i.test(t))return{code:'AUTOMATION_RUNTIME_FAILURE',label:'Automation runtime failure',cls:'automation'};
    if(/(?:response|request|status code|http status|header|json path|api)/i.test(t))return{code:'API_RESPONSE_MISMATCH',label:'API response mismatch',cls:'api'};
    if(/expected.*(?:visible|hidden|exist|contain|equal|include|empty|checked|enabled|disabled)|assertionerror|timed out retrying/i.test(t))return{code:'APPLICATION_BEHAVIOR_MISMATCH',label:'Application behavior mismatch',cls:'application'};
    if(/element|selector|detached|not found/i.test(t))return{code:'UI_ELEMENT_MISMATCH',label:'UI element mismatch',cls:'ui'};
    return{code:'REVIEW_REQUIRED',label:'Review required',cls:'review'};
  }
  function style(){if(document.getElementById('executionClassificationStyles'))return;const s=document.createElement('style');s.id='executionClassificationStyles';s.textContent=`
    .execution-classification{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:6px;font-size:9.5px}
    .execution-classification .meta{padding:3px 6px;border-radius:999px;background:#f1f5f9;color:#475569;font-weight:800;text-transform:uppercase}
    .execution-classification .failure-category{padding:3px 6px;border-radius:999px;font-weight:850}
    .failure-category.application{background:#fee2e2;color:#b91c1c}.failure-category.automation{background:#fef3c7;color:#92400e}.failure-category.api{background:#e0f2fe;color:#075985}.failure-category.accessibility{background:#f3e8ff;color:#7e22ce}.failure-category.ui{background:#ffedd5;color:#9a3412}.failure-category.review{background:#e5e7eb;color:#475569}
  `;document.head.appendChild(s);}
  function decorate(){
    style();const results=document.getElementById('results');if(!results)return false;
    for(const row of results.querySelectorAll('.result')){
      if(row.querySelector('.execution-classification'))continue;
      const badge=row.querySelector('.badge');if(!badge||!/^FAIL$/i.test(badge.textContent||''))continue;
      const text=row.textContent||'';const id=text.match(/TC(?:\d{3}|-H\d{3})/i)?.[0]||'';const tc=caseById(id);const failure=classify(text);
      const meta=document.createElement('div');meta.className='execution-classification';meta.dataset.failureCategory=failure.code;
      meta.innerHTML=`${tc?.testCategory?`<span class="meta">${esc(tc.testCategory)}</span>`:''}${tc?.type?`<span class="meta">${esc(tc.type)}</span>`:''}<span class="failure-category ${failure.cls}" title="${esc(failure.code)}">${esc(failure.label)}</span>`;
      const title=row.querySelector('.result-title')||row.firstElementChild;title?.appendChild(meta);
    }
    return true;
  }
  function install(){if(!decorate())return false;const results=document.getElementById('results');if(results&&!results.dataset.executionClassificationObserved){results.dataset.executionClassificationObserved='1';new MutationObserver(()=>requestAnimationFrame(decorate)).observe(results,{childList:true,subtree:true});}return true;}
  if(!install()){const obs=new MutationObserver(()=>{if(install())obs.disconnect();});obs.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>obs.disconnect(),5000);}
})();