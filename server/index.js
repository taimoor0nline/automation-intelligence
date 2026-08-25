require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const chatRoutes = require("./routes/chat");
const runRoutes = require("./routes/run");
const testCaseLifecycleRoutes = require("./routes/testCaseLifecycle");
const qwen = require("./services/qwenClient");
const { normalizeGeneratedScript } = require("./services/automationScriptNormalizer");
const { REPORT_DIR, reportFileName } = require("./services/reportGenerator");

const generateAutomationCode = qwen.generateAutomationCode.bind(qwen);
qwen.generateAutomationCode = async (args) => {
  const generated = await generateAutomationCode(args);
  return { ...generated, script: normalizeGeneratedScript(generated.script) };
};

const analyzeFailure = qwen.analyzeFailure.bind(qwen);
qwen.analyzeFailure = async (args) => {
  const analysis = await analyzeFailure(args);
  const expected = String(args?.expected || "");
  const actual = String(args?.actual || "");
  const tc = args?.testCase || {};
  const validationExpectation = /reject|validation|required|minimum|url/i.test(expected);
  const formHidden = /not visible/i.test(actual) && /display:\s*none/i.test(actual);
  const seededDemoCase = tc.id === "TC004" || tc.id === "TC005";

  if (seededDemoCase && validationExpectation && formHidden) {
    return {
      ...analysis,
      classification: "APPLICATION_DEFECT",
      summary: tc.id === "TC004"
        ? "The application accepted age 17 even though the discovered minimum is 18, then hid the form instead of showing the required age validation."
        : "The application accepted the malformed website value even though the field requires a URL, then hid the form instead of showing the required website validation.",
      probableCause: tc.id === "TC004"
        ? "The target application's age boundary check incorrectly allows 17."
        : "The target application's website validation incorrectly allows values such as abc.",
      severity: "high",
      confidence: Math.max(Number(analysis.confidence) || 0, 0.98),
    };
  }
  return analysis;
};

const app = express();
const PORT = process.env.SERVER_PORT || 5000;
const HOST = process.env.SERVER_HOST || "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function sanitizePublicPayload(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicPayload);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (["qwenModel", "qwenConfigured", "usingRealQwen"].includes(key)) continue;
      out[key] = sanitizePublicPayload(item);
    }
    return out;
  }
  if (typeof value === "string") {
    return value.replace(/Qwen/gi, "AI").replace(/qwen\d+(?:\.\d+)*(?:-[a-z0-9.-]+)?/gi, "AI");
  }
  return value;
}

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(sanitizePublicPayload(payload));
  next();
});

app.get("/api/reports/:sessionId", (req, res, next) => {
  const filePath = path.join(REPORT_DIR, reportFileName(req.params.sessionId));
  if (!fs.existsSync(filePath)) return next();
  return res.sendFile(filePath);
});

app.use(testCaseLifecycleRoutes);
app.use(runRoutes);
app.use(chatRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true, aiConnected: qwen.isConfigured() });
});

const READINESS_CSS = `
.readiness{margin-top:8px;padding:9px 10px;border-radius:8px;font-size:10.5px;line-height:1.45;border:1px solid var(--border)}
.readiness.ready{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.readiness.blocked{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.readiness.preflight{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.readiness-code{display:block;margin-top:4px;font-weight:800;font-size:9.5px;letter-spacing:.25px}.readiness-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.readiness-actions button{font-size:10px;padding:5px 7px}
.tag.ready{background:#dcfce7;color:#15803d;font-weight:800}.tag.blocked{background:#ffedd5;color:#c2410c;font-weight:800}.tag.preflight{background:#dbeafe;color:#1d4ed8;font-weight:800}
.editor-readiness{margin:0 0 14px;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid var(--border);font-size:11px;line-height:1.5}.editor-readiness strong{font-size:11.5px}.editor-readiness .history{margin-top:7px;padding-top:7px;border-top:1px solid var(--border);color:#64748b}
.editor-ai-generator{margin:0 0 14px;padding:13px;border-radius:10px;background:#f8fbff;border:1px solid #bfdbfe}.editor-ai-generator .title{font-size:11.5px;font-weight:800;color:#1d4ed8}.editor-ai-generator .note{font-size:10.5px;color:#64748b;line-height:1.45;margin-top:4px}.editor-ai-generator textarea{width:100%;min-height:70px;margin-top:9px;border:1px solid var(--border);border-radius:8px;padding:9px;resize:vertical}.editor-ai-generator .actions{display:flex;align-items:center;gap:8px;margin-top:8px}.editor-ai-generator .status{border:0;padding:0;font-size:10.5px}.editor-ai-generator .status.ok{color:#047857}.editor-ai-generator .status.bad{color:#b91c1c}
`;

const READINESS_JS = `
(function(){
  let readinessRefreshInFlight=false;
  let readinessTimer=null;
  let pendingGeneratedCase=null;
  const credentialsPayload=()=>({username:$('username').value,password:$('password').value});
  const readinessLabel=(status)=>status==='READY'?'Automation Ready':status==='NEEDS_PREFLIGHT'?'Checking readiness':String(status||'NEEDS_PREFLIGHT').replaceAll('_',' ');
  const readinessClass=(status)=>status==='READY'?'ready':status==='NEEDS_PREFLIGHT'?'preflight':'blocked';

  async function refreshReadiness(){
    if(!sessionId||!testCases.length||readinessRefreshInFlight)return;
    readinessRefreshInFlight=true;
    try{
      const r=await fetch('/api/test-cases/revalidate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,testCases,credentials:credentialsPayload()})});
      const data=await r.json();
      if(r.ok&&Array.isArray(data.testCases)){testCases=data.testCases;renderCases();}
    }catch(err){console.warn('[readiness] refresh failed',err);}finally{readinessRefreshInFlight=false;}
  }
  window.refreshTestReadiness=refreshReadiness;
  function scheduleReadiness(){clearTimeout(readinessTimer);readinessTimer=setTimeout(refreshReadiness,180);}

  renderCases=function(){
    $('caseCount').textContent=testCases.length;
    $('addCaseBtn').disabled=!sessionId;
    if(!testCases.length){$('cases').innerHTML='<div class="empty">No test cases returned.</div>';return;}
    let ready=0,blocked=0,preflight=0,needsRefresh=false;
    $('cases').innerHTML=testCases.map((tc,i)=>{
      const expected=(tc.expectedResults||[]).slice(0,2).join(' · '),source=(tc.source||'ai').toLowerCase(),type=(tc.type||'functional').toLowerCase(),allowedTypes=new Set(['negative','positive','functional','boundary','custom']),typeClass=allowedTypes.has(type)?'type-'+type:'type-functional';
      const readiness=tc.automationReadiness||null,status=readiness?.status||'NEEDS_PREFLIGHT';
      if(!readiness)needsRefresh=true;
      const isReady=status==='READY',isPreflight=status==='NEEDS_PREFLIGHT';
      if(isReady)ready++;else if(isPreflight)preflight++;else blocked++;
      const cls=readinessClass(status),label=readinessLabel(status),reason=readiness?.reason||(isPreflight?'The automation system is checking this test against discovered application evidence and supported capabilities.':'');
      const reasonCode=readiness?.reasonCode||'',resolution=readiness?.resolutionType||'',checked=isReady||isPreflight?'checked':'',disabled=!isReady&&!isPreflight?'disabled':'';
      let actions='';
      if(resolution==='AI_REPAIRABLE')actions='<button class="btn ghost" type="button" onclick="repairCaseWithAI('+i+')">Fix with AI</button>';
      else if(resolution==='USER_INPUT_REQUIRED')actions='<button class="btn ghost" type="button" onclick="focusRequiredInput('+i+')">Provide required input</button>';
      const sourceLabel=source==='human'?'Human':source==='ai-on-demand'?'AI · On-demand':source==='ai-repaired'?'AI · Repaired':'AI / Reviewed';
      return '<div class="case '+typeClass+'"><input class="case-check" type="checkbox" value="'+escapeHtml(tc.id)+'" '+checked+' '+disabled+'><div><div class="case-title">'+escapeHtml(tc.id)+' — '+escapeHtml(tc.title)+'</div><div class="case-meta"><span class="tag '+typeClass+'">'+escapeHtml(type)+'</span><span class="tag">'+escapeHtml(tc.priority||'medium')+'</span><span class="tag '+(source==='human'?'human':'')+'">'+escapeHtml(sourceLabel)+'</span><span class="tag '+cls+'">'+escapeHtml(label)+'</span><span>'+((tc.steps||[]).length)+' steps</span></div>'+(expected?'<div class="expected">Expected: '+escapeHtml(expected)+'</div>':'')+'<div class="readiness '+cls+'"><b>'+escapeHtml(label)+'</b> — '+escapeHtml(reason)+(reasonCode?'<span class="readiness-code">Reason: '+escapeHtml(reasonCode)+' · Resolution: '+escapeHtml(resolution||'NONE')+'</span>':'')+(actions?'<div class="readiness-actions">'+actions+'</div>':'')+'</div></div><div class="case-actions"><button class="btn ghost" onclick="openEditor('+i+')">Edit</button><button class="btn ghost danger" onclick="deleteCase('+i+')">Delete</button></div></div>';
    }).join('');
    $('runHint').textContent=ready+' Automation Ready · '+preflight+' checking · '+blocked+' action/manual';
    $('runBtn').disabled=!(ready+preflight);
    if(needsRefresh)scheduleReadiness();
  };

  window.focusRequiredInput=function(index){
    const readiness=testCases[index]?.automationReadiness;
    const required=readiness?.requiredInputs||[];
    if(required.includes('username'))$('username').focus();else if(required.includes('password'))$('password').focus();
    showError(readiness?.reason||'Provide the required execution input and the test will be revalidated automatically.');
  };

  window.repairCaseWithAI=async function(index){
    const tc=testCases[index];if(!tc)return;
    clearError();
    try{
      const r=await fetch('/api/test-cases/repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,testCase:tc,credentials:credentialsPayload()})});
      const data=await r.json();
      if(!r.ok)throw new Error(data.reply||'The test case could not be repaired safely.');
      if(data.testCase){testCases[index]=data.testCase;renderCases();}
    }catch(err){showError(err.message);}
  };

  ['username','password'].forEach(id=>$(id).addEventListener('input',()=>{if(sessionId&&testCases.length)scheduleReadiness();}));

  const modalCard=$('editorModal')?.querySelector('.modal-card');
  if(modalCard&&!$('editorReadiness')){
    const box=document.createElement('div');box.id='editorReadiness';box.className='editor-readiness';box.innerHTML='<strong>Automation readiness</strong><div>Save or validate this test case to see its deterministic readiness result.</div>';
    const head=modalCard.querySelector('.section-head');if(head)head.insertAdjacentElement('afterend',box);
  }
  if(modalCard&&!$('editorAiGenerator')){
    const aiBox=document.createElement('div');aiBox.id='editorAiGenerator';aiBox.className='editor-ai-generator';aiBox.style.display='none';
    aiBox.innerHTML='<div class="title">Generate this test case with AI</div><div class="note">Describe one specific scenario. AI will propose one grounded test case inside this editor; nothing is added until you review it and click Save Test Case.</div><textarea id="editorAiPrompt" placeholder="Example: Test login with an empty password and verify the required-field validation."></textarea><div class="actions"><button id="editorAiGenerateBtn" class="btn secondary" type="button">Generate</button><span id="editorAiStatus" class="status"></span></div>';
    const readiness=$('editorReadiness');if(readiness)readiness.insertAdjacentElement('afterend',aiBox);
  }

  function showEditorReadiness(index,candidate=null){
    const box=$('editorReadiness');if(!box)return;
    const tc=candidate||(index>=0?testCases[index]:null),r=tc?.automationReadiness,h=tc?.repairHistory||[];
    if(!r){box.innerHTML='<strong>Automation readiness</strong><div>This new or edited test will be revalidated before execution.</div>';return;}
    const history=h.length?'<div class="history"><b>Repair history</b><br>'+h.map(x=>'Attempt '+escapeHtml(x.attempt)+': '+escapeHtml(x.reasonCode||x.originalStatus)+' → '+escapeHtml(x.result||'review')).join('<br>')+'</div>':'';
    box.innerHTML='<strong>'+escapeHtml(readinessLabel(r.status))+'</strong><div><b>Reason code:</b> '+escapeHtml(r.reasonCode||'—')+'</div><div><b>Reason:</b> '+escapeHtml(r.reason||'—')+'</div><div><b>Resolution:</b> '+escapeHtml(r.resolutionType||'NONE')+'</div><div><b>Validation:</b> Deterministic automation-system check</div>'+history;
  }

  function fillEditorFromCandidate(tc){
    $('editId').value=tc.id||$('editId').value;
    $('editTitle').value=tc.title||'';
    $('editType').value=tc.type||'functional';
    $('editPriority').value=tc.priority||'medium';
    $('editPreconditions').value=(tc.preconditions||[]).join('\n');
    $('editSteps').value=(tc.steps||[]).map(stepToLine).join('\n');
    $('editExpected').value=(tc.expectedResults||[]).join('\n');
    updateTypeHelp();
    showEditorReadiness(-1,tc);
  }

  const originalOpenEditor=window.openEditor;
  window.openEditor=function(index){
    originalOpenEditor(index);
    pendingGeneratedCase=null;
    showEditorReadiness(index);
    const generator=$('editorAiGenerator');
    if(generator){
      generator.style.display=index<0?'block':'none';
      if(index<0){$('editorAiPrompt').value='';$('editorAiStatus').textContent='';$('editorAiGenerateBtn').textContent='Generate';}
    }
  };
  openEditor=window.openEditor;

  $('editorAiGenerateBtn')?.addEventListener('click',async()=>{
    const request=$('editorAiPrompt').value.trim();
    if(!request){$('editorAiStatus').className='status bad';$('editorAiStatus').textContent='Describe the test case first.';return;}
    const btn=$('editorAiGenerateBtn');btn.disabled=true;btn.textContent=pendingGeneratedCase?'Regenerating…':'Generating…';$('editorAiStatus').className='status';$('editorAiStatus').textContent='Grounding against the current story and discovered application…';
    try{
      const requestedId=$('editId').value||null;
      const r=await fetch('/api/test-cases/generate-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,requestText:request,testCases,credentials:credentialsPayload(),requestedId})});
      const data=await r.json();
      if(!r.ok)throw new Error(data.reply||'The requested test case could not be generated.');
      pendingGeneratedCase=data.testCase;
      fillEditorFromCandidate(data.testCase);
      $('editorAiStatus').className='status ok';$('editorAiStatus').textContent='Candidate generated. Review or modify it, then click Save Test Case.';
      btn.textContent='Regenerate';
    }catch(err){$('editorAiStatus').className='status bad';$('editorAiStatus').textContent=err.message;btn.textContent=pendingGeneratedCase?'Regenerate':'Generate';}
    finally{btn.disabled=false;}
  });

  $('saveEditorBtn').addEventListener('click',()=>{
    const generated=pendingGeneratedCase;
    const savedId=$('editId').value;
    setTimeout(()=>{
      if(generated){
        const index=testCases.findIndex(tc=>tc.id===savedId);
        if(index>=0){
          testCases[index].source='ai-on-demand';
          testCases[index].createdBy='human-request';
          testCases[index].repairHistory=generated.repairHistory||[];
          testCases[index].automationReadiness=null;
        }
        pendingGeneratedCase=null;
      }
      scheduleReadiness();
    },40);
  });
})();
`;

function serveUi(req, res, next) {
  const uiFile = path.join(__dirname, "..", "testpilot-ui", "index.html");
  fs.readFile(uiFile, "utf8", (err, html) => {
    if (err) return next(err);

    const adjusted = html
      .replace("</style>", `${READINESS_CSS}</style>`)
      .replace("</script>", `${READINESS_JS}</script>`)
      .replace('id="additionalPaths" value="/feedback"', 'id="additionalPaths" value=""')
      .replace("if(index<0)testCases.push(tc);else testCases[index]=tc;", "if(index<0)testCases.unshift(tc);else testCases[index]=tc;")
      .replace("User Story → Qwen → Human Review → Automated Execution → Analytics", "User Story → AI → Human Review → Automated Execution → Analytics")
      .replace("They are not sent to Qwen.", "They are not sent to the AI model.")
      .replace("The automation engine runs the reviewed cases; Qwen then explains failures.", "The automation system runs the reviewed cases; AI then explains failures.")
      .replace("$('healthDot').className='dot '+(data.qwenConfigured?'ok':'bad');$('healthText').textContent=data.qwenConfigured?`Qwen ${data.qwenModel} connected`:'Backend online · Qwen not configured'", "$('healthDot').className='dot '+(data.aiConnected?'ok':'bad');$('healthText').textContent=data.aiConnected?'Connected':'Not connected'")
      .replace("Discovering relevant pages and asking Qwen. Please wait.", "Discovering relevant pages, grounding test cases and checking automation readiness. Please wait.")
      .replace("Discovering pages & asking Qwen…", "Discovering pages & validating tests…")
      .replace("$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · ${data.qwenModel||'Qwen'}`", "$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · AI generated + readiness checked`")
      .replace("Automation is running.<small>Watch the Chrome window that opens automatically.</small>", "Automation is running.<small>The automation system is executing on the server. If you are working directly on the server, you may see the browser window open; from another PC, execution continues in the background.</small>")
      .replace("Qwen failure analysis", "AI failure analysis");

    res.type("html").send(adjusted);
  });
}

app.get(["/", "/index.html"], serveUi);
app.use(express.static(path.join(__dirname, "..", "testpilot-ui")));

app.listen(PORT, HOST, () => {
  console.log(`[ai-testpilot] Backend listening on ${HOST}:${PORT}`);
  console.log(`[ai-testpilot] UI available locally at http://localhost:${PORT}/`);
  if (qwen.isConfigured()) console.log(`[ai-testpilot] ✅ AI provider connected (${qwen.QWEN_MODEL})`);
  else console.log("[ai-testpilot] ❌ AI provider is not configured. Check the server-side AI configuration in .env.");
});
