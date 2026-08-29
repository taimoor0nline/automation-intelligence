(function () {
  const CATEGORIES = ['FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY','INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'];
  const SECURITY_SUBCATEGORIES = ['AUTHENTICATION','AUTHORIZATION_RBAC','SESSION_MANAGEMENT','INPUT_VALIDATION','XSS','SQL_COMMAND_INJECTION','CSRF','SECURITY_HEADERS','COOKIES','SENSITIVE_DATA_EXPOSURE','API_SECURITY','FILE_UPLOAD','ACCESS_CONTROL','RATE_LIMITING','ERROR_INFORMATION_LEAKAGE','CORS','TLS_TRANSPORT','BUSINESS_LOGIC_ABUSE','LOGGING_AUDIT','DEPENDENCY_VULNERABILITY_SCAN','CUSTOM'];
  const SEVERITIES = ['INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL'];

  function normalize(value) { const v = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return CATEGORIES.includes(v) ? v : 'FUNCTIONAL'; }
  function normalizeSecurity(value) { const v = String(value || '').trim().toUpperCase().replace(/[\s\/-]+/g, '_'); return SECURITY_SUBCATEGORIES.includes(v) ? v : 'CUSTOM'; }
  function normalizeSeverity(value) { const v = String(value || '').trim().toUpperCase(); return SEVERITIES.includes(v) ? v : 'MEDIUM'; }
  function inferCategory(tc) {
    const explicit = String(tc?.testCategory || tc?.category || tc?.testData?.__testCategory || '').trim(); if (explicit) return normalize(explicit);
    const text = `${tc?.title || ''}\n${(tc?.preconditions || []).join(' ')}\n${(tc?.expectedResults || []).join(' ')}`.toLowerCase();
    if (/\bstress\b|peak\s+concurrency|breaking\s+point|saturation/.test(text)) return 'STRESS'; if (/\bload\s+test|concurrent\s+users?|virtual\s+users?|requests?\s+per\s+second|\brps\b|throughput/.test(text)) return 'LOAD'; if (/\bsecurity\b|authorization|access\s+control|xss|cross[- ]site|sql\s+injection|csrf|session\s+security|secure\s+cookie|security\s+header/.test(text)) return 'SECURITY'; if (/\bperformance\b|response\s+time|page\s+load|latency/.test(text)) return 'PERFORMANCE'; if (/\baccessibility\b|\ba11y\b|\bwcag\b|keyboard\s+navigation|screen\s+reader|aria/.test(text)) return 'ACCESSIBILITY'; if (/\bintegration\b|service\s+integration|system\s+integration|cross[- ]service/.test(text)) return 'INTEGRATION'; if (/\bapi\b|endpoint|request\s+body|response\s+body|http\s+status/.test(text)) return 'API'; if (/\bcompatibility\b|cross[- ]browser|browser\s+compatibility|device\s+compatibility/.test(text)) return 'COMPATIBILITY'; if (/\buser interface\b|\bui\b|layout|visual\s+state/.test(text)) return 'UI'; if (/\bsmoke\b|\bsanity\b|critical\s+path|health\s+check|basic\s+availability/.test(text)) return 'SMOKE'; if (/\bregression\b|previously\s+working|existing\s+behavior|existing\s+behaviour/.test(text)) return 'REGRESSION'; return 'FUNCTIONAL';
  }
  function inferSecurity(tc) {
    if (tc?.securitySubcategory) return normalizeSecurity(tc.securitySubcategory);
    const text = `${tc?.title || ''}\n${(tc?.expectedResults || []).join(' ')}`.toLowerCase();
    if (/authentication|login|password|mfa|credential/.test(text)) return 'AUTHENTICATION'; if (/authorization|rbac|role[- ]based|permission|privilege/.test(text)) return 'AUTHORIZATION_RBAC'; if (/session|logout|timeout/.test(text)) return 'SESSION_MANAGEMENT'; if (/xss|cross[- ]site scripting/.test(text)) return 'XSS'; if (/sql injection|command injection|injection/.test(text)) return 'SQL_COMMAND_INJECTION'; if (/csrf|request forgery/.test(text)) return 'CSRF'; if (/security header|content-security-policy|x-frame-options/.test(text)) return 'SECURITY_HEADERS'; if (/cookie|httponly|samesite/.test(text)) return 'COOKIES'; if (/sensitive data|information disclosure|secret/.test(text)) return 'SENSITIVE_DATA_EXPOSURE'; if (/api|endpoint/.test(text)) return 'API_SECURITY'; if (/file upload|attachment/.test(text)) return 'FILE_UPLOAD'; if (/access control|unauthorized/.test(text)) return 'ACCESS_CONTROL'; if (/rate limit|429|brute force/.test(text)) return 'RATE_LIMITING'; if (/cors|cross-origin/.test(text)) return 'CORS'; if (/tls|https|certificate/.test(text)) return 'TLS_TRANSPORT'; if (/logging|audit/.test(text)) return 'LOGGING_AUDIT'; if (/input validation|malformed|invalid input|boundary/.test(text)) return 'INPUT_VALIDATION'; return 'CUSTOM';
  }
  function casesArray() { try { if (Array.isArray(window.testCases)) return window.testCases; if (typeof testCases !== 'undefined' && Array.isArray(testCases)) return testCases; } catch {} return []; }
  function currentCase() { const id = document.getElementById('editId')?.value; return casesArray().find(x => String(x?.id || '') === String(id || '')) || null; }
  function ensureStyle() {
    if (document.getElementById('testCategoryStyle')) return; const style = document.createElement('style'); style.id='testCategoryStyle'; style.textContent=`.test-classification-row{grid-template-columns:repeat(3,minmax(0,1fr))!important;align-items:start}.test-classification-row>.field,.test-classification-row>.test-category-field{margin-top:13px}.test-category-field label{display:block;margin-bottom:6px;color:#4b5563;font-size:12px;font-weight:700}.test-category-field select{width:100%;border:1px solid var(--border);border-radius:9px;padding:10px 11px;background:#fff}.test-category-field small{display:block;color:var(--muted);margin-top:5px;font-size:10.5px;line-height:1.45}.security-classification-row{display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-top:10px;padding:10px;border:1px solid #fecaca;background:#fffafa;border-radius:10px}.security-classification-row.hidden{display:none}.tag.test-category{font-weight:800;background:#eef2ff;color:#3730a3}.tag.category-security{background:#fee2e2;color:#991b1b}.tag.security-subcategory{background:#fff1f2;color:#9f1239}.tag.security-severity{background:#fef2f2;color:#991b1b;font-weight:900}@media(max-width:760px){.test-classification-row,.security-classification-row{grid-template-columns:1fr!important}}`; document.head.appendChild(style);
  }
  function relabelScenarioType() { const label = document.getElementById('editType')?.closest('.field')?.querySelector('label'); if (label && label.textContent !== 'Scenario Type') label.textContent='Scenario Type'; }
  function syncSecurityVisibility() { const row=document.getElementById('securityClassificationRow'); if (row) row.classList.toggle('hidden', document.getElementById('editTestCategory')?.value !== 'SECURITY'); }
  function ensureEditorFields() {
    const modal=document.getElementById('editorModal'); if(!modal)return; relabelScenarioType();
    const type=document.getElementById('editType'), priority=document.getElementById('editPriority'), row=type?.closest('.two')||priority?.closest('.two'); if(!row)return; row.classList.add('test-classification-row');
    if(!document.getElementById('editTestCategory')){const field=document.createElement('div');field.className='test-category-field';field.innerHTML=`<label for="editTestCategory">Test Category</label><select id="editTestCategory">${CATEGORIES.map(x=>`<option value="${x}">${x.replaceAll('_',' ')}</option>`).join('')}</select><small>Testing purpose; separate from Scenario Type and Priority.</small>`;row.appendChild(field);field.querySelector('select').addEventListener('change',()=>{const tc=currentCase();if(tc)tc.testCategory=normalize(field.querySelector('select').value);syncSecurityVisibility();});}
    if(!document.getElementById('securityClassificationRow')){const security=document.createElement('div');security.id='securityClassificationRow';security.className='security-classification-row hidden';security.innerHTML=`<div class="test-category-field"><label for="editSecuritySubcategory">Security Subcategory</label><select id="editSecuritySubcategory">${SECURITY_SUBCATEGORIES.map(x=>`<option value="${x}">${x.replaceAll('_',' ')}</option>`).join('')}</select><small>Specific security control/risk area.</small></div><div class="test-category-field"><label for="editSeverity">Severity</label><select id="editSeverity">${SEVERITIES.map(x=>`<option value="${x}">${x}</option>`).join('')}</select><small>Security impact; separate from Priority.</small></div>`;row.insertAdjacentElement('afterend',security);document.getElementById('editSecuritySubcategory').addEventListener('change',()=>{const tc=currentCase();if(tc)tc.securitySubcategory=normalizeSecurity(document.getElementById('editSecuritySubcategory').value);});document.getElementById('editSeverity').addEventListener('change',()=>{const tc=currentCase();if(tc)tc.severity=normalizeSeverity(document.getElementById('editSeverity').value);});}
  }
  function syncEditor() { const tc=currentCase(); if(!tc)return; const category=inferCategory(tc); const categoryEl=document.getElementById('editTestCategory'); if(categoryEl&&categoryEl.value!==category)categoryEl.value=category; if(category==='SECURITY'){const sub=document.getElementById('editSecuritySubcategory'),sev=document.getElementById('editSeverity'),subValue=inferSecurity(tc),sevValue=normalizeSeverity(tc.severity||'MEDIUM');if(sub&&sub.value!==subValue)sub.value=subValue;if(sev&&sev.value!==sevValue)sev.value=sevValue;} syncSecurityVisibility(); }
  function persistEditor() { const tc=currentCase(); if(!tc)return; tc.testCategory=normalize(document.getElementById('editTestCategory')?.value); if(tc.testCategory==='SECURITY'){tc.securitySubcategory=normalizeSecurity(document.getElementById('editSecuritySubcategory')?.value);tc.severity=normalizeSeverity(document.getElementById('editSeverity')?.value);}else{tc.securitySubcategory=null;tc.severity=null;} setTimeout(()=>{try{if(typeof renderCases==='function')renderCases();}catch{}},0); }

  function setTextIfChanged(el, value) { if (el && el.textContent !== value) el.textContent = value; }
  function setClassIfChanged(el, value) { if (el && el.className !== value) el.className = value; }
  function decorateCards(){
    if(window.__aiTestPilotProgressiveGenerationActive)return;
    const cases=casesArray();
    document.querySelectorAll('#cases .case').forEach((card,index)=>{
      const meta=card.querySelector('.case-meta'),tc=cases[index];if(!meta||!tc)return;
      const category=inferCategory(tc);tc.testCategory=category;
      let tag=meta.querySelector('.tag.test-category');if(!tag){tag=document.createElement('span');tag.className='tag test-category';meta.appendChild(tag);}
      setClassIfChanged(tag,`tag test-category category-${category.toLowerCase()}`);setTextIfChanged(tag,category.replaceAll('_',' '));
      if(category==='SECURITY'){
        tc.securitySubcategory=normalizeSecurity(tc.securitySubcategory||inferSecurity(tc));tc.severity=normalizeSeverity(tc.severity||'MEDIUM');
        let sub=meta.querySelector('.tag.security-subcategory');if(!sub){sub=document.createElement('span');sub.className='tag security-subcategory';meta.appendChild(sub);}setTextIfChanged(sub,tc.securitySubcategory.replaceAll('_',' '));
        let sev=meta.querySelector('.tag.security-severity');if(!sev){sev=document.createElement('span');sev.className='tag security-severity';meta.appendChild(sev);}setTextIfChanged(sev,`Severity ${tc.severity}`);
      }else{meta.querySelector('.tag.security-subcategory')?.remove();meta.querySelector('.tag.security-severity')?.remove();}
    });
  }
  function decorateAutomationDetails(){const view=document.getElementById('editorAutomationView');if(!view)return;view.querySelector('[data-test-category-detail]')?.remove();const tc=currentCase();if(!tc)return;const category=inferCategory(tc),security=category==='SECURITY'?` &nbsp; <b>Security:</b> ${normalizeSecurity(tc.securitySubcategory||inferSecurity(tc)).replaceAll('_',' ')} &nbsp; <b>Severity:</b> ${normalizeSeverity(tc.severity||'MEDIUM')}`:'';const section=document.createElement('div');section.className='automation-section';section.dataset.testCategoryDetail='true';section.innerHTML=`<h4>Test Classification</h4><div style="font-size:10.5px;color:#475569"><b>Scenario Type:</b> ${String(tc.type||'functional').toUpperCase()} &nbsp; <b>Category:</b> ${category.replaceAll('_',' ')} &nbsp; <b>Priority:</b> ${String(tc.priority||'medium').toUpperCase()}${security}</div>`;const head=view.querySelector('.automation-head');if(head)head.insertAdjacentElement('afterend',section);else view.prepend(section);}

  let decorateScheduled=false;
  function scheduleDecorate(){
    if(window.__aiTestPilotProgressiveGenerationActive||decorateScheduled)return;
    decorateScheduled=true;
    setTimeout(()=>{decorateScheduled=false;decorateCards();},25);
  }
  function init(){
    ensureStyle();ensureEditorFields();relabelScenarioType();
    document.getElementById('saveEditorBtn')?.addEventListener('click',persistEditor,true);
    document.getElementById('editorViewTabs')?.addEventListener('click',event=>{const button=event.target.closest('[data-editor-view]');if(button?.dataset.editorView==='automation')setTimeout(decorateAutomationDetails,0);});
    const modal=document.getElementById('editorModal');if(modal)new MutationObserver(()=>{if(modal.classList.contains('show')){ensureEditorFields();syncEditor();setTimeout(decorateAutomationDetails,0);}}).observe(modal,{attributes:true,attributeFilter:['class']});
    const cases=document.getElementById('cases');if(cases)new MutationObserver(scheduleDecorate).observe(cases,{childList:true,subtree:true});
    decorateCards();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
