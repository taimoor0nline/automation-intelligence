(function () {
  if (window.__aiTestPilotReviewFiltersInstalled) return;
  window.__aiTestPilotReviewFiltersInstalled = true;

  const state = { search:'', type:'ALL', category:'ALL', priority:'ALL', securitySubcategory:'ALL', severity:'ALL', readiness:'ALL' };
  const CATEGORY_OPTIONS = ['FUNCTIONAL','SMOKE','REGRESSION','SECURITY','PERFORMANCE','ACCESSIBILITY','INTEGRATION','API','UI','COMPATIBILITY','LOAD','STRESS','CUSTOM'];
  const TYPE_OPTIONS = ['positive','negative','boundary','custom'];
  const PRIORITY_OPTIONS = ['low','medium','high'];
  const SECURITY_OPTIONS = ['AUTHENTICATION','AUTHORIZATION_RBAC','SESSION_MANAGEMENT','INPUT_VALIDATION','XSS','SQL_COMMAND_INJECTION','CSRF','SECURITY_HEADERS','COOKIES','SENSITIVE_DATA_EXPOSURE','API_SECURITY','FILE_UPLOAD','ACCESS_CONTROL','RATE_LIMITING','ERROR_INFORMATION_LEAKAGE','CORS','TLS_TRANSPORT','BUSINESS_LOGIC_ABUSE','LOGGING_AUDIT','DEPENDENCY_VULNERABILITY_SCAN','CUSTOM'];
  const SEVERITY_OPTIONS = ['INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL'];
  const READINESS_OPTIONS = ['READY','NEEDS_PREFLIGHT','INSUFFICIENT_EVIDENCE','MANUAL_ONLY','INVALID'];

  const label = (value) => String(value || '').replaceAll('_',' ').replace(/\b\w/g, (m)=>m.toUpperCase());
  function optionHtml(values, allLabel) { return `<option value="ALL">${allLabel}</option>${values.map(v=>`<option value="${v}">${label(v)}</option>`).join('')}`; }

  function installStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .review-filter-shell{position:sticky;top:0;z-index:4;background:#fff;border-top:1px solid #eef1f6;border-bottom:1px solid #e5e9f1;padding:10px 18px;box-shadow:0 4px 10px rgba(15,23,42,.035)}
      .review-filter-row{display:grid;grid-template-columns:minmax(190px,1.6fr) repeat(3,minmax(120px,.8fr)) auto;gap:7px;align-items:center}
      .review-filter-secondary{margin-top:7px;grid-template-columns:minmax(160px,1fr) auto}
      .review-filter-secondary.security-active{grid-template-columns:repeat(3,minmax(140px,1fr)) auto}
      .review-security-only[hidden]{display:none!important}
      .review-filter-input,.review-filter-select{width:100%;height:36px;border:1px solid #dfe4ee;border-radius:8px;background:#fff;padding:0 10px;color:#344054;font-size:10.8px}
      .review-filter-input:focus,.review-filter-select:focus{outline:none;border-color:#7c91ff;box-shadow:0 0 0 3px rgba(47,91,255,.08)}
      .review-filter-clear{width:36px;height:36px;display:grid;place-items:center;padding:0;border-radius:8px;font-size:15px;line-height:1}
      .review-filter-summary{font-size:10.5px;color:#667085;white-space:nowrap;text-align:right}
      .review-filter-empty{padding:34px 16px;text-align:center;color:#667085;font-size:11.5px}
      #cases.cases{max-height:680px;overflow-y:auto;scrollbar-gutter:stable}
      @media(max-width:1000px){.review-filter-row,.review-filter-secondary,.review-filter-secondary.security-active{grid-template-columns:1fr 1fr}.review-filter-summary{text-align:left}.review-filter-clear{width:36px}}
    `;
    document.head.appendChild(style);
  }

  function syncSecurityVisibility() {
    const securitySelected = state.category === 'SECURITY';
    const row = document.getElementById('reviewSecondaryFilterRow');
    row?.classList.toggle('security-active', securitySelected);

    for (const id of ['reviewSecuritySubcategory','reviewSeverity']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.hidden = !securitySelected;
      el.disabled = !securitySelected;
      if (!securitySelected) el.value = 'ALL';
    }

    if (!securitySelected) {
      state.securitySubcategory = 'ALL';
      state.severity = 'ALL';
    }
  }

  function installToolbar() {
    const cases = document.getElementById('cases');
    if (!cases || document.getElementById('reviewFilterShell')) return;
    const shell = document.createElement('div');
    shell.id='reviewFilterShell'; shell.className='review-filter-shell';
    shell.innerHTML = `
      <div class="review-filter-row">
        <input id="reviewSearch" class="review-filter-input" type="search" placeholder="Search test ID, title, expected result…" aria-label="Search review test cases">
        <select id="reviewType" class="review-filter-select" aria-label="Filter by scenario type">${optionHtml(TYPE_OPTIONS,'All scenario types')}</select>
        <select id="reviewCategory" class="review-filter-select" aria-label="Filter by test category">${optionHtml(CATEGORY_OPTIONS,'All categories')}</select>
        <select id="reviewPriority" class="review-filter-select" aria-label="Filter by priority">${optionHtml(PRIORITY_OPTIONS,'All priorities')}</select>
        <button id="reviewClearFilters" class="btn ghost review-filter-clear" type="button" title="Clear filters" aria-label="Clear filters">↺</button>
      </div>
      <div id="reviewSecondaryFilterRow" class="review-filter-row review-filter-secondary">
        <select id="reviewSecuritySubcategory" class="review-filter-select review-security-only" aria-label="Filter by security subcategory" hidden disabled>${optionHtml(SECURITY_OPTIONS,'All security areas')}</select>
        <select id="reviewSeverity" class="review-filter-select review-security-only" aria-label="Filter by security severity" hidden disabled>${optionHtml(SEVERITY_OPTIONS,'All severities')}</select>
        <select id="reviewReadiness" class="review-filter-select" aria-label="Filter by readiness">${optionHtml(READINESS_OPTIONS,'All readiness states')}</select>
        <span id="reviewFilterSummary" class="review-filter-summary">0 shown</span>
      </div>`;
    cases.insertAdjacentElement('beforebegin', shell);

    const bind = (id,key,event='change') => document.getElementById(id)?.addEventListener(event,(e)=>{
      state[key]=e.target.value;
      if (key === 'category') syncSecurityVisibility();
      scheduleApply(0);
    });
    bind('reviewSearch','search','input'); bind('reviewType','type'); bind('reviewCategory','category'); bind('reviewPriority','priority'); bind('reviewSecuritySubcategory','securitySubcategory'); bind('reviewSeverity','severity'); bind('reviewReadiness','readiness');
    document.getElementById('reviewClearFilters')?.addEventListener('click',()=>{
      Object.assign(state,{search:'',type:'ALL',category:'ALL',priority:'ALL',securitySubcategory:'ALL',severity:'ALL',readiness:'ALL'});
      document.getElementById('reviewSearch').value='';
      ['reviewType','reviewCategory','reviewPriority','reviewSecuritySubcategory','reviewSeverity','reviewReadiness'].forEach((id)=>{const el=document.getElementById(id);if(el)el.value='ALL';});
      syncSecurityVisibility();
      scheduleApply(0);
    });
    syncSecurityVisibility();
  }

  function matches(tc) {
    const readiness = tc?.automationReadiness?.status || 'NEEDS_PREFLIGHT';
    const haystack = [tc?.id,tc?.title,tc?.type,tc?.testCategory,tc?.priority,tc?.securitySubcategory,tc?.severity,...(tc?.preconditions||[]),...(tc?.expectedResults||[])].join(' ').toLowerCase();
    const q = state.search.trim().toLowerCase();
    return (!q || haystack.includes(q)) &&
      (state.type==='ALL' || String(tc?.type||'').toLowerCase()===state.type.toLowerCase()) &&
      (state.category==='ALL' || String(tc?.testCategory||'FUNCTIONAL').toUpperCase()===state.category) &&
      (state.priority==='ALL' || String(tc?.priority||'medium').toLowerCase()===state.priority.toLowerCase()) &&
      (state.securitySubcategory==='ALL' || String(tc?.securitySubcategory||'').toUpperCase()===state.securitySubcategory) &&
      (state.severity==='ALL' || String(tc?.severity||'').toUpperCase()===state.severity) &&
      (state.readiness==='ALL' || String(readiness).toUpperCase()===state.readiness);
  }

  function applyFilters() {
    if (window.__aiTestPilotSuspendReviewFilters) return;
    const cards = [...document.querySelectorAll('#cases .case')];
    let shown = 0;
    cards.forEach((card,index)=>{
      const tc = Array.isArray(window.testCases) ? window.testCases[index] : (typeof testCases !== 'undefined' ? testCases[index] : null);
      const visible = tc ? matches(tc) : true;
      card.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    const total = Array.isArray(window.testCases) ? window.testCases.length : (typeof testCases !== 'undefined' && Array.isArray(testCases) ? testCases.length : cards.length);
    const summary = document.getElementById('reviewFilterSummary');
    if (summary) summary.textContent = `${shown} of ${total} shown`;

    const casesEl = document.getElementById('cases');
    let empty = document.getElementById('reviewFilterEmpty');
    if (!shown && total > 0) {
      if (!empty) { empty=document.createElement('div'); empty.id='reviewFilterEmpty'; empty.className='review-filter-empty'; empty.textContent='No test cases match the current filters.'; casesEl?.appendChild(empty); }
      empty.style.display='block';
    } else if (empty) empty.style.display='none';
  }

  let applyTimer = 0;
  function scheduleApply(delay=80) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = 0;
      if (!window.__aiTestPilotSuspendReviewFilters) requestAnimationFrame(applyFilters);
    }, delay);
  }

  function observeCases() {
    const cases = document.getElementById('cases');
    if (!cases) return;
    new MutationObserver(()=>scheduleApply(120)).observe(cases,{childList:true,subtree:false});
  }

  function start(){installStyles();installToolbar();observeCases();scheduleApply(0);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();