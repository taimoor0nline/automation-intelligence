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
    document.getElementById('openHtmlReportBtn').addEventListener('click',()=>{if(!window.sessionId&&!globalThis.sessionId)return;const id=window.sessionId||globalThis.sessionId;window.open(`/api/reports/${encodeURIComponent(id)}`,'_blank','noopener');});
    document.getElementById('exportExecutionExcelBtn').addEventListener('click',exportExcel);
    return box;
  }
  function testCaseFor(id){try{return (window.testCases||testCases||[]).find(x=>String(x.id).toUpperCase()===String(id).toUpperCase())||{};}catch{return {};}}
  function renderedRows(){
    const rows=[];
    for(const el of document.querySelectorAll('#results .result')){
      const text=String(el.textContent||'').replace(/\s+/g,' ').trim();
      const id=text.match(/TC(?:\d{3}|-H\d{3})/i)?.[0]||'';
      const outcome=/\bPASS\b/i.test(text)?'PASS':/\bFAIL\b/i.test(text)?'FAIL':'';
      rows.push({id,title:text,outcome,error:outcome==='FAIL'?text:''});
    }
    return rows;
  }
  function summaryFromDom(){
    const items=renderedRows();if(!items.length)return null;
    const passed=items.filter(x=>x.outcome==='PASS').length,failed=items.filter(x=>x.outcome==='FAIL').length;
    return {total:items.length,passed,failed,tests:items.map(x=>({testCaseId:x.id,title:x.title,pass:x.outcome==='PASS',fail:x.outcome==='FAIL',state:x.outcome.toLowerCase(),durationMs:null,err:x.error?{message:x.error}:null}))};
  }
  function analysisText(){return String(document.getElementById('analysis')?.innerText||'').replace(/\s+/g,' ').trim();}
  function exportExcel(){
    const summary=lastSummary||summaryFromDom();if(!summary)return;
    const globalAnalysis=analysisText();
    const rows=[['Test Case','Title','Scenario Type','Category','Priority','Outcome','Duration (ms)','Error','AI Classification','AI Analysis']];
    for(const test of summary.tests||[]){
      const id=test.testCaseId||String(test.title||'').match(/TC(?:\d{3}|-H\d{3})/i)?.[0]||'';const tc=testCaseFor(id);const analysis=(lastAnalyses||[]).find(a=>String(a.testCase||'').toUpperCase()===String(id).toUpperCase())||{};
      rows.push([id,test.title||tc.title||'',String(tc.type||'').toUpperCase(),String(tc.testCategory||tc.category||'FUNCTIONAL').toUpperCase(),String(tc.priority||'').toUpperCase(),test.pass?'PASS':test.fail?'FAIL':String(test.state||'').toUpperCase(),test.durationMs??'',test.err?.message||'',analysis.classification||'',analysis.summary||globalAnalysis||'']);
    }
    const html='<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><tr><th colspan="10">TestNexus AI Execution & Analysis Report</th></tr><tr><td>Exported At</td><td colspan="9">'+esc(new Date().toISOString())+'</td></tr><tr><td>Total</td><td>'+Number(summary.total||0)+'</td><td>Passed</td><td>'+Number(summary.passed||0)+'</td><td>Failed</td><td>'+Number(summary.failed||0)+'</td><td colspan="4"></td></tr>'+rows.map((r,i)=>'<tr>'+r.map(v=>(i===0?'<th>':'<td>')+esc(v)+(i===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</table></body></html>';
    const blob=new Blob([html],{type:'application/vnd.ms-excel'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TestNexus-AI-Execution-${new Date().toISOString().slice(0,10)}.xls`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function capture(summary,analyses){if(summary)lastSummary=summary;if(Array.isArray(analyses))lastAnalyses=analyses;refresh();}
  function refresh(){const box=ensure();if(!box)return;const hasResults=Boolean(lastSummary||document.querySelector('#results .result'));box.style.display=hasResults?'grid':'none';}
  function wrap(){const original=window.renderResults;if(typeof original!=='function'||original.__reportActionsWrapped)return;function wrapped(summary,analyses){const out=original.apply(this,arguments);capture(summary,analyses);return out;}wrapped.__reportActionsWrapped=true;window.renderResults=wrapped;try{renderResults=wrapped}catch{}}
  function start(){
    ensure();wrap();
    window.addEventListener('testnexus:analysis-progress',(event)=>{const detail=event.detail||{};capture(detail.summary,detail.analyses);});
    let scheduled=false;const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;wrap();refresh();});};
    const results=document.getElementById('results'),analysis=document.getElementById('analysis');
    const observer=new MutationObserver(schedule);if(results)observer.observe(results,{childList:true,subtree:true});if(analysis)observer.observe(analysis,{childList:true,subtree:true});
    let attempts=0;const timer=setInterval(()=>{wrap();refresh();if(++attempts>20)clearInterval(timer);},250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();