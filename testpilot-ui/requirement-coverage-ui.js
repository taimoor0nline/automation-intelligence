(function(){
  if(window.__testNexusRequirementCoverageUi)return;
  window.__testNexusRequirementCoverageUi=true;

  const nativeFetch=(window.__aiTestPilotNativeFetch||window.fetch).bind(window);
  let currentSessionId=null;
  let lastRenderedKey='';
  let refreshTimer=null;
  let generationWasActive=Boolean(document.body?.classList.contains('generation-active'));
  let terminalFetchedForSession='';

  function esc(value){return String(value??'').replace(/[&<>"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}

  // Capture the generated session id without changing the progressive-generation flow.
  const previousFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    try{
      const url=typeof input==='string'?input:String(input?.url||'');
      if(url.includes('/api/generation/start')&&init?.body){
        const payload=JSON.parse(String(init.body));
        if(payload?.sessionId){
          currentSessionId=String(payload.sessionId);
          terminalFetchedForSession='';
          lastRenderedKey='';
        }
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
    const total=Number(coverage.totalRequirements||0);
    const exploratory=total===0;
    const key=JSON.stringify({score:coverage.score,covered:coverage.coveredCount,total,ready:coverage.executableTestCaseCount,failures:coverage.generationFailureCount,redundant,complete:coverage.generationComplete});
    if(key===lastRenderedKey)return;
    lastRenderedKey=key;

    const coveredHtml=covered.length?covered.map((row)=>`${esc(row.requirement)}${row.testCaseIds?.length?` <span style="color:#64748b">(${row.testCaseIds.map(esc).join(', ')})</span>`:''}`).join(' · '):'None';
    const uncoveredHtml=uncovered.length?uncovered.map((row)=>esc(row.requirement)).join(' · '):'None';
    const failureHtml=failures.length?failures.map((item)=>`${esc(item.plannedId||'Planned case')}: ${esc(item.message)}`).join('<br>'):'';
    const title=exploratory?'Exploratory scope':'Explicit requirement coverage';
    const subtitle=exploratory
      ?'The story describes an exploratory testing goal rather than measurable acceptance clauses. TestNexus reports grounded executable coverage instead of inventing a requirement percentage.'
      :'Measured from story requirements mapped to Automation Ready canonical assertions, not source-code coverage.';
    const score=exploratory?'—':`${Math.round(Number(coverage.score)||0)}%`;
    const requirementMeta=exploratory
      ?'<span>No explicit mandatory clauses</span>'
      :`<span>${coverage.coveredCount||0}/${total} mandatory requirements covered</span>`;
    const traceability=exploratory
      ?`<div><b>Mode:</b> Evidence-grounded exploratory testing. Only cases supported by rendered application evidence may become Automation Ready.</div>`
      :`<div><b>Covered:</b> ${coveredHtml}</div><div><b>Uncovered mandatory:</b> ${uncoveredHtml}</div>`;

    box.innerHTML=`
      <div class="generation-coverage-head">
        <div><strong>${title}</strong><span>${subtitle}</span></div>
        <div class="generation-coverage-score">${score}</div>
      </div>
      <div class="generation-coverage-meta">
        ${requirementMeta}
        <span>${coverage.executableTestCaseCount||0} executable test${Number(coverage.executableTestCaseCount)===1?'':'s'}</span>
        ${coverage.plannedTestCaseCount?`<span>${coverage.generatedTestCaseCount||0}/${coverage.plannedTestCaseCount} planned generated</span>`:''}
        ${coverage.maxTestCases?`<span>Maximum ${coverage.maxTestCases}</span>`:''}
        ${coverage.generationFailureCount?`<span>${coverage.generationFailureCount} generation rejected</span>`:''}
      </div>
      <div class="generation-coverage-summary">${exploratory?'Test generation is constrained by the rendered public application surface and the selected testing categories.':esc(coverage.summary||'')}</div>
      <details class="generation-coverage-details" open>
        <summary>${exploratory?'Grounding details':'Requirement traceability'}</summary>
        ${traceability}
        ${redundant.length?`<div><b>Potential redundancy:</b> ${redundant.map(esc).join(' · ')}</div>`:''}
        ${failureHtml?`<div><b>Generation failures:</b><br>${failureHtml}</div>`:''}
      </details>`;
  }

  async function refresh({force=false}={}){
    if(!currentSessionId)return;
    if(document.body?.classList.contains('generation-active'))return;
    if(!force&&terminalFetchedForSession===currentSessionId)return;
    try{
      const response=await nativeFetch(`/api/requirement-coverage/${encodeURIComponent(currentSessionId)}`,{headers:{Accept:'application/json'},cache:'no-store'});
      if(!response.ok)return;
      const data=await response.json();
      if(data?.coverage){
        render(data.coverage);
        // Once generation/readiness is terminal, no DOM mutation may trigger another
        // identical coverage request. A new generation resets this marker.
        if(data.coverage.generationComplete||data.coverage.readinessValidated||data.coverage.generationFailureCount>0) terminalFetchedForSession=currentSessionId;
      }
    }catch{}
  }

  function scheduleRefresh(delay=180){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>refresh(),delay);
  }

  // Only watch the generation lifecycle class. The previous subtree observer reacted
  // to its own rendered coverage markup and unrelated UI mutations.
  if(document.body){
    const observer=new MutationObserver(()=>{
      const active=Boolean(document.body.classList.contains('generation-active'));
      if(generationWasActive&&!active)scheduleRefresh(220);
      generationWasActive=active;
    });
    observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  }

  document.addEventListener('click',(event)=>{
    if(event.target?.id==='generateBtn'){
      terminalFetchedForSession='';
      lastRenderedKey='';
      generationWasActive=true;
    }
  },true);

  window.addEventListener('testnexus:generation-completed',()=>scheduleRefresh(100));
  window.addEventListener('testnexus:generation-failed',()=>scheduleRefresh(100));
})();
