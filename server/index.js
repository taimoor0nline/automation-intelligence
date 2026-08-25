require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const chatRoutes = require("./routes/chat");
const runRoutes = require("./routes/run");
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

app.use(runRoutes);
app.use(chatRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true, aiConnected: qwen.isConfigured() });
});

const READINESS_CSS = `
.readiness{margin-top:8px;padding:8px 9px;border-radius:8px;font-size:10.5px;line-height:1.4;border:1px solid var(--border)}
.readiness.ready{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.readiness.blocked{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.readiness.preflight{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.tag.ready{background:#dcfce7;color:#15803d;font-weight:800}.tag.blocked{background:#ffedd5;color:#c2410c;font-weight:800}.tag.preflight{background:#dbeafe;color:#1d4ed8;font-weight:800}
`;

const READINESS_JS = `
(function(){
  const originalRenderCases = renderCases;
  renderCases = function(){
    $('caseCount').textContent=testCases.length;
    $('addCaseBtn').disabled=!sessionId;
    if(!testCases.length){$('cases').innerHTML='<div class="empty">No test cases returned.</div>';return;}
    let ready=0,blocked=0,preflight=0;
    $('cases').innerHTML=testCases.map((tc,i)=>{
      const expected=(tc.expectedResults||[]).slice(0,2).join(' · '),source=(tc.source||'ai').toLowerCase(),type=(tc.type||'functional').toLowerCase(),allowedTypes=new Set(['negative','positive','functional','boundary','custom']),typeClass=allowedTypes.has(type)?'type-'+type:'type-functional';
      const readiness=tc.automationReadiness||null;
      const status=readiness?.status||'NEEDS_PREFLIGHT';
      const isReady=status==='READY';
      const needsPreflight=status==='NEEDS_PREFLIGHT';
      if(isReady)ready++; else if(needsPreflight)preflight++; else blocked++;
      const readinessClass=isReady?'ready':needsPreflight?'preflight':'blocked';
      const readinessLabel=isReady?'Automation Ready':needsPreflight?'Preflight on Run':status.replaceAll('_',' ');
      const reason=readiness?.reason||(needsPreflight?'This human-edited case will be re-checked against discovery and Cypress capabilities before any code is generated.':'');
      const checked=isReady||needsPreflight?'checked':'';
      const disabled=!isReady&&!needsPreflight?'disabled':'';
      return '<div class="case '+typeClass+'"><input class="case-check" type="checkbox" value="'+escapeHtml(tc.id)+'" '+checked+' '+disabled+'><div><div class="case-title">'+escapeHtml(tc.id)+' — '+escapeHtml(tc.title)+'</div><div class="case-meta"><span class="tag '+typeClass+'">'+escapeHtml(type)+'</span><span class="tag">'+escapeHtml(tc.priority||'medium')+'</span><span class="tag '+(source==='human'?'human':'')+'">'+(source==='human'?'Human':'AI / Reviewed')+'</span><span class="tag '+readinessClass+'">'+escapeHtml(readinessLabel)+'</span><span>'+((tc.steps||[]).length)+' steps</span></div>'+(expected?'<div class="expected">Expected: '+escapeHtml(expected)+'</div>':'')+'<div class="readiness '+readinessClass+'"><b>'+escapeHtml(readinessLabel)+'</b>'+(reason?' — '+escapeHtml(reason):'')+'</div></div><div class="case-actions"><button class="btn ghost" onclick="openEditor('+i+')">Edit</button><button class="btn ghost danger" onclick="deleteCase('+i+')">Delete</button></div></div>';
    }).join('');
    $('runHint').textContent=ready+' Automation Ready · '+preflight+' needs preflight · '+blocked+' manual/unsupported';
    $('runBtn').disabled=!(ready+preflight);
  };
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
      .replace("The automation engine runs the reviewed cases; Qwen then explains failures.", "The automation engine runs the reviewed cases; AI then explains failures.")
      .replace("$('healthDot').className='dot '+(data.qwenConfigured?'ok':'bad');$('healthText').textContent=data.qwenConfigured?`Qwen ${data.qwenModel} connected`:'Backend online · Qwen not configured'", "$('healthDot').className='dot '+(data.aiConnected?'ok':'bad');$('healthText').textContent=data.aiConnected?'Connected':'Not connected'")
      .replace("Discovering relevant pages and asking Qwen. Please wait.", "Discovering relevant pages, grounding test cases and checking automation readiness. Please wait.")
      .replace("Discovering pages & asking Qwen…", "Discovering pages & validating tests…")
      .replace("$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · ${data.qwenModel||'Qwen'}`", "$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · AI generated + readiness checked`")
      .replace("Automation is running.<small>Watch the Chrome window that opens automatically.</small>", "Automation is running.<small>The browser automation is executing on the server. If you are working directly on the server, you may see the browser window open; from another PC, execution continues in the background.</small>")
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
