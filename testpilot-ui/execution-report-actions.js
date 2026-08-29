(function(){
  if(window.__aiTestPilotExecutionReportActions)return;window.__aiTestPilotExecutionReportActions=true;
  let lastSummary=null,lastAnalyses=[];
  function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function ensure(){
    let box=document.getElementById('executionReportActions');if(box)return box;
    const analysis=document.getElementById('analysis'),results=document.getElementById('results');if(!analysis&&!results)return null;
    box=document.createElement('div');box.id='executionReportActions';box.style.cssText='display:none;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px';
    box.innerHTML='<button id="openHtmlReportBtn" class="btn secondary" type="button">HTML Report</button><button id="exportExecutionExcelBtn" class="btn ghost" type="button">Export Excel</button>';
    (analysis||results).insertAdjacentElement('afterend',box);
    document.getElementById('openHtmlReportBtn').addEventListener('click',()=>{if(!window.sessionId)return;window.open(`/api/reports/${encodeURIComponent(window.sessionId)}`,'_blank','noopener');});
    document.getElementById('exportExecutionExcelBtn').addEventListener('click',exportExcel);
    return box;
  }
  function testCaseFor(id){try{return (window.testCases||testCases||[]).find(x=>String(x.id).toUpperCase()===String(id).toUpperCase())||{};}catch{return {};}}
  function exportExcel(){
    if(!lastSummary)return;
    const rows=[['Test Case','Title','Scenario Type','Category','Priority','Outcome','Duration (ms)','Error','AI Classification','AI Summary']];
    for(const test of lastSummary.tests||[]){
      const id=test.testCaseId||String(test.title||'').match(/TC(?:\d{3}|-H\d{3})/i)?.[0]||'';const tc=testCaseFor(id);const analysis=(lastAnalyses||[]).find(a=>String(a.testCase||'').toUpperCase()===String(id).toUpperCase())||{};
      rows.push([id,test.title||tc.title||'',String(tc.type||'').toUpperCase(),String(tc.testCategory||tc.category||'FUNCTIONAL').toUpperCase(),String(tc.priority||'').toUpperCase(),test.pass?'PASS':test.fail?'FAIL':String(test.state||'').toUpperCase(),test.durationMs??'',test.err?.message||'',analysis.classification||'',analysis.summary||'']);
    }
    const html='<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><tr><th colspan="10">AI TestPilot Execution Report</th></tr><tr><td>Exported At</td><td colspan="9">'+esc(new Date().toISOString())+'</td></tr><tr><td>Total</td><td>'+Number(lastSummary.total||0)+'</td><td>Passed</td><td>'+Number(lastSummary.passed||0)+'</td><td>Failed</td><td>'+Number(lastSummary.failed||0)+'</td><td colspan="4"></td></tr>'+rows.map((r,i)=>'<tr>'+r.map(v=>(i===0?'<th>':'<td>')+esc(v)+(i===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</table></body></html>';
    const blob=new Blob([html],{type:'application/vnd.ms-excel'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`AI-TestPilot-Execution-${new Date().toISOString().slice(0,10)}.xls`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function capture(summary,analyses){if(summary)lastSummary=summary;if(Array.isArray(analyses))lastAnalyses=analyses;const box=ensure();if(box&&lastSummary)box.style.display='grid';}
  function wrap(){const original=window.renderResults;if(typeof original!=='function'||original.__reportActionsWrapped)return;function wrapped(summary,analyses){const out=original.apply(this,arguments);capture(summary,analyses);return out;}wrapped.__reportActionsWrapped=true;window.renderResults=wrapped;try{renderResults=wrapped}catch{}}
  function start(){ensure();wrap();let attempts=0;const timer=setInterval(()=>{wrap();ensure();if(++attempts>20)clearInterval(timer);},250);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();