(function () {
  const encoder = new TextEncoder();
  const ICONS = {
    export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4v10h10V7H7Zm1 1h3v3H8V8Zm4 0h4v3h-4V8Zm-4 4h3v4H8v-4Zm4 0h4v4h-4v-4Z"/></svg>',
    add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm1 5h-2v4H7v2h4v4h2v-4h4v-2h-4V7Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15.7 3.3 5 5-11.9 11.9-5.8 1.3 1.3-5.8L15.7 3.3Zm0 2.8L6.1 16.7l-.5 2.1 2.1-.5L18.9 8.2l-3.2-2.1Z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2Zm-3 6h12l-1 12H7L6 9Zm3 2 .5 8h2L11 11H9Zm4 0-.5 8h2l.5-8h-2Z"/></svg>',
    repair: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 5.6a7 7 0 0 1-9.3 6.6L5.4 19.5a2.1 2.1 0 0 1-3-3l7.3-7.3A7 7 0 0 1 18.4 0l-4 4 .6 3 3 .6 4-4v2ZM4 17.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z"/></svg>',
    assertion: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3a6.5 6.5 0 1 0 3.9 11.7L19.7 21l1.4-1.4-6.3-6.3A6.5 6.5 0 0 0 9.5 3Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm2.8 2.3-3.7 3.8-1.9-1.9-1.4 1.4 3.3 3.3 5.1-5.2-1.4-1.4Z"/></svg>'
  };

  function injectStyles() {
    if (document.getElementById('reviewIconStyles')) return;
    const style = document.createElement('style');
    style.id = 'reviewIconStyles';
    style.textContent = `
      .icon-action{width:36px;height:36px;padding:0!important;display:inline-grid!important;place-items:center;border-radius:10px!important;line-height:1!important}
      .icon-action svg{width:17px;height:17px;fill:currentColor;pointer-events:none}
      .case-actions .icon-action{width:32px;height:32px}
      .readiness-actions .icon-action{width:31px;height:31px}
      .icon-action.repair{color:#7c3aed;background:#f5f3ff;border-color:#ddd6fe}
      .icon-action.danger{color:#b91c1c}
      .editor-assertion-advisor{margin:8px 0 0;padding:10px 11px;border:1px solid #dbeafe;background:#f8fbff;border-radius:9px;display:none}
      .editor-assertion-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .editor-assertion-title{font-size:11px;font-weight:800;color:#1d4ed8}
      .editor-assertion-note{font-size:10.5px;color:#64748b;margin-top:4px;line-height:1.45}
      .editor-assertion-result{font-size:10.5px;color:#334155;line-height:1.45;margin-top:8px;white-space:pre-wrap}
      .editor-assertion-advisor .icon-action{width:34px;height:34px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe}
    `;
    document.head.appendChild(style);
  }

  function escXml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  function escHtml(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function categoryOf(tc) { return String(tc?.testCategory || tc?.category || tc?.testData?.__testCategory || 'FUNCTIONAL').toUpperCase(); }
  function currentCases() { try { return typeof testCases !== 'undefined' && Array.isArray(testCases) ? testCases : []; } catch { return []; } }
  function columnName(index) { let n=index+1,out=''; while(n>0){const rem=(n-1)%26;out=String.fromCharCode(65+rem)+out;n=Math.floor((n-1)/26);} return out; }
  function cell(ref,value,style=0){return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escXml(value==null?'':String(value))}</t></is></c>`;}
  function rowXml(rowNumber,values,style=0){return `<row r="${rowNumber}">${values.map((v,i)=>cell(`${columnName(i)}${rowNumber}`,v,style)).join('')}</row>`;}
  function stepsText(steps){return (steps||[]).map((s,i)=>`${i+1}. ${s?.action||''}${s?.target?` | ${s.target}`:''}${s?.value==null||s?.value===''?'':` | ${s.value}`}`).join('\n');}
  function listText(values){return (values||[]).map((v,i)=>`${i+1}. ${v}`).join('\n');}
  function testDataText(value){if(!value||typeof value!=='object')return '';const copy={...value};delete copy.__testCategory;try{return Object.keys(copy).length?JSON.stringify(copy,null,2):'';}catch{return String(copy);}}

  function buildSheet(cases){
    const headers=['ID','Title','Test Category','Scenario Type','Priority','Source','Automation Readiness','Preconditions','Test Data','Steps','Expected Results'];
    const rows=[];let row=1;
    const targetUrl=document.getElementById('targetUrl')?.value||'';
    const environment=document.getElementById('environment')?.value||'';
    const story=document.getElementById('story')?.value||'';
    rows.push(rowXml(row++,['AI TestPilot — Reviewed Test Cases'],2));
    rows.push(rowXml(row++,['Exported At',new Date().toISOString()]));
    rows.push(rowXml(row++,['Target URL',targetUrl]));rows.push(rowXml(row++,['Environment',environment]));rows.push(rowXml(row++,['Business Story',story]));row++;
    rows.push(rowXml(row++,headers,1));
    for(const tc of cases) rows.push(rowXml(row++,[tc?.id||'',tc?.title||'',categoryOf(tc),String(tc?.type||'functional').toUpperCase(),String(tc?.priority||'medium').toUpperCase(),tc?.source||'ai-reviewed',tc?.automationReadiness?.status||'NOT CHECKED',listText(tc?.preconditions),testDataText(tc?.testData),stepsText(tc?.steps),listText(tc?.expectedResults)]));
    const last=Math.max(1,row-1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:K${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/><col min="3" max="7" width="20" customWidth="1"/><col min="8" max="11" width="48" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A7:K${last}"/></worksheet>`;
  }

  const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
  function u16(v){const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,v,true);return b;} function u32(v){const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,v>>>0,true);return b;}
  function concat(parts){const len=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}
  function stamp(){const d=new Date(),y=Math.max(1980,d.getFullYear());return{time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2),day:((y-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate()};}
  function zipStore(files){const locals=[],centrals=[];let offset=0;const s=stamp();for(const f of files){const name=encoder.encode(f.name),data=typeof f.data==='string'?encoder.encode(f.data):f.data,crc=crc32(data);const local=concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(s.time),u16(s.day),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);locals.push(local,data);centrals.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(s.time),u16(s.day),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=local.length+data.length;}const central=concat(centrals),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(offset),u16(0)]);return concat([...locals,central,end]);}
  function workbookFiles(cases){return[
    {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test Cases" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:'xl/styles.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BFF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
    {name:'xl/worksheets/sheet1.xml',data:buildSheet(cases)}
  ];}
  function exportExcel(){const cases=currentCases();if(!cases.length){alert('Generate or add at least one test case before exporting.');return;}const blob=new Blob([zipStore(workbookFiles(cases))],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`AI-TestPilot-Test-Cases-${new Date().toISOString().slice(0,10)}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}

  function makeIconButton(button, icon, label, extraClass='') {
    if (!button) return;
    button.classList.add('icon-action');
    if (extraClass) button.classList.add(extraClass);
    button.title = label;
    button.setAttribute('aria-label', label);
    if (button.dataset.iconAction === icon) return;
    button.dataset.iconAction = icon;
    button.innerHTML = ICONS[icon] || '';
  }

  function decorateTopActions() {
    const add=document.getElementById('addCaseBtn');
    if(add) makeIconButton(add,'add','Add Test Case');
    let exp=document.getElementById('exportTestCasesExcel');
    if(!exp&&add?.parentElement){exp=document.createElement('button');exp.id='exportTestCasesExcel';exp.type='button';exp.className='btn ghost';exp.onclick=exportExcel;add.parentElement.insertBefore(exp,add);}
    if(exp){makeIconButton(exp,'export','Export Excel');exp.disabled=currentCases().length===0;}
  }

  function decorateCaseActions() {
    document.querySelectorAll('.case-actions button').forEach((button)=>{
      const onclick=button.getAttribute('onclick')||'';
      if(onclick.includes('openEditor')) makeIconButton(button,'edit','Edit test case');
      else if(onclick.includes('deleteCase')) makeIconButton(button,'delete','Delete test case','danger');
    });
    document.querySelectorAll('.readiness-actions button').forEach((button)=>{
      const onclick=button.getAttribute('onclick')||'';
      if(onclick.includes('repairCaseWithAI')) makeIconButton(button,'repair','Repair test case with AI','repair');
      if(onclick.includes('suggestAssertionWithAI')) button.remove();
    });
  }

  let editorIndex=-1;
  function currentEditorCase(){const cases=currentCases();return editorIndex>=0?cases[editorIndex]||null:null;}
  function ensureAssertionAdvisor(){
    if(document.getElementById('editorAssertionAdvisor')) return;
    const expected=document.getElementById('editExpected')?.closest('.field');
    if(!expected) return;
    const box=document.createElement('div');box.id='editorAssertionAdvisor';box.className='editor-assertion-advisor';box.innerHTML=`<div class="editor-assertion-head"><div><div class="editor-assertion-title">AI assertion advisor</div><div class="editor-assertion-note">Available only when deterministic readiness reports an unsupported or uncompiled expectation.</div></div><button id="editorAssertionBtn" type="button" class="btn ghost icon-action" title="Suggest assertion with AI" aria-label="Suggest assertion with AI">${ICONS.assertion}</button></div><div id="editorAssertionResult" class="editor-assertion-result"></div>`;expected.appendChild(box);
    const btn=document.getElementById('editorAssertionBtn');if(btn)btn.dataset.iconAction='assertion';
    btn?.addEventListener('click',requestAssertionSuggestion);
  }
  function refreshAssertionAdvisor(){ensureAssertionAdvisor();const box=document.getElementById('editorAssertionAdvisor'),tc=currentEditorCase(),can=Boolean(tc?.automationReadiness?.canSuggestAssertion);if(!box)return;box.style.display=can?'block':'none';const result=document.getElementById('editorAssertionResult');if(result&&!can)result.textContent='';}
  async function requestAssertionSuggestion(){
    const tc=currentEditorCase();if(!tc?.automationReadiness?.canSuggestAssertion)return;
    const btn=document.getElementById('editorAssertionBtn'),out=document.getElementById('editorAssertionResult');if(btn)btn.disabled=true;if(out)out.textContent='Checking assertion options…';
    try{const username=document.getElementById('username')?.value||'',password=document.getElementById('password')?.value||'';const r=await fetch('/api/test-cases/assertion-suggestion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,testCase:tc,credentials:{username,password}})});const data=await r.json();if(!r.ok)throw new Error(data.reply||'AI could not suggest an assertion.');const s=data.suggestion||{};if(out)out.innerHTML=`<b>${escHtml(s.kind||'REVIEW')}${s.operation?` · ${escHtml(s.operation)}`:''}</b><br>${escHtml(s.rationale||'')}${s.cypressStrategy?`<br><b>Cypress:</b> ${escHtml(s.cypressStrategy)}`:''}`;}catch(err){if(out)out.textContent=err.message;}finally{if(btn)btn.disabled=false;}
  }

  function wrapEditor(){const previous=window.openEditor;if(typeof previous!=='function'||previous.__iconWrapped)return;const wrapped=function(index){editorIndex=Number(index);previous(index);setTimeout(refreshAssertionAdvisor,0);};wrapped.__iconWrapped=true;window.openEditor=wrapped;try{openEditor=wrapped;}catch{}}
  function refreshAll(){decorateTopActions();decorateCaseActions();wrapEditor();refreshAssertionAdvisor();}
  let refreshScheduled=false;
  function scheduleRefresh(){if(refreshScheduled)return;refreshScheduled=true;queueMicrotask(()=>{refreshScheduled=false;refreshAll();});}
  injectStyles();
  const start=()=>{refreshAll();new MutationObserver(scheduleRefresh).observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
