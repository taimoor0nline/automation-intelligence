(function(){
  if(window.__testNexusRequirementCoverageUi)return;
  window.__testNexusRequirementCoverageUi=true;

  const nativeFetch=(window.__aiTestPilotNativeFetch||window.fetch).bind(window);
  let currentSessionId=null;
  let lastRenderedKey='';
  let refreshTimer=null;

  function esc(value){return String(value??'').replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  // Capture the generated session id without changing the progressive-generation flow.
  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:String(input?.url||'');
      if(url.includes('/api/generation/start')&&init?.body){
        const payload=JSON.parse(String(init.body));
        if(payload?.sessionId) currentSessionId=String(payload.sessionId);
      }
    }catch{}
    return previousFetch(input,init);
  };

  function render(coverage){
    const box=document.getElementById('generationCoverageProposal');
    if(!box||!coverage)return;
    const rows=Array.isArray(coverage.requirements)?coverage.requirements:[];
    const covered=rows.filter((row)=>row.covered);
    const uncovered=rows.filter((row)=>!row.covered);
    const failures=Array.isArray(coverage.generationFailures)?coverage.generationFailures:[];
    const redundant=Array.isArray(coverage.redundantTestCases)?coverage.redundantTestCases:[];
    const key=JSON.stringify({score:coverage.score,covered:coverage.coveredCount,total:coverage.totalRequirements,ready:coverage.executableTestCaseCount,failures:coverage.generationFailureCount,redundant});
    if(key===lastRenderedKey)return;
    lastRenderedKey=key;

    const coveredHtml=covered.length?covered.map((row)=>`${esc(row.requirement)}${row.testCaseIds?.length?` <span style="color:#64748b">(${row.testCaseIds.map(esc).join(', ')})</span>`:''}`).join(' · '):'None';
    const uncoveredHtml=uncovered.length?uncovered.map((row)=>esc(row.requirement)).join(' · '):'None';
    const failureHtml=failures.length?failures.map((item)=>`${esc(item.plannedId||'Planned case')}: ${esc(item.message)}`).join('<br>'):'';
    box.innerHTML=`
      <div class="generation-coverage-head">
        <div><strong>Explicit requirement coverage</strong><span>Measured from story requirements mapped to Automation Ready canonical assertions, not source-code coverage.</span></div>
        <div class="generation-coverage-score">${Math.round(Number(coverage.score)||0)}%</div>
      </div>
      <div class="generation-coverage-meta">
        <span>${coverage.coveredCount||0}/${coverage.totalRequirements||0} mandatory requirements covered</span>
        <span>${coverage.executableTestCaseCount||0} executable test${Number(coverage.executableTestCaseCount)===1?'':'s'}</span>
        ${coverage.plannedTestCaseCount?`<span>${coverage.generatedTestCaseCount||0}/${coverage.plannedTestCaseCount} planned generated</span>`:''}
        ${coverage.maxTestCases?`<span>Maximum ${coverage.maxTestCases}</span>`:''}
        ${coverage.generationFailureCount?`<span>${coverage.generationFailureCount} generation rejected</span>`:''}
      </div>
      <div class="generation-coverage-summary">${esc(coverage.summary||'')}</div>
      <details class="generation-coverage-details" open>
        <summary>Requirement traceability</summary>
        <div><b>Covered:</b> ${coveredHtml}</div>
        <div><b>Uncovered mandatory:</b> ${uncoveredHtml}</div>
        ${redundant.length?`<div><b>Potential redundancy:</b> ${redundant.map(esc).join(' · ')}</div>`:''}
        ${failureHtml?`<div><b>Generation failures:</b><br>${failureHtml}</div>`:''}
      </details>`;
  }

  async function refresh(){
    if(!currentSessionId)return;
    const body=document.body;
    if(body?.classList.contains('generation-active'))return;
    try{
      const response=await nativeFetch(`/api/requirement-coverage/${encodeURIComponent(currentSessionId)}`,{headers:{Accept:'application/json'},cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      if(data?.coverage)render(data.coverage);
    }catch{}
  }

  function scheduleRefresh(delay=80){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(refresh,delay);
  }

  const observer=new MutationObserver(()=>{
    if(document.getElementById('generationCoverageProposal')&&!document.body?.classList.contains('generation-active'))scheduleRefresh();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});

  document.addEventListener('click',(event)=>{
    if(event.target?.id==='generateBtn'){
      lastRenderedKey='';
      setTimeout(()=>scheduleRefresh(700),700);
    }
  },true);
})();
