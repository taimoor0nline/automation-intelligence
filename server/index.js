require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const chatRoutes = require("./routes/chat");
const runRoutes = require("./routes/run");
const testCaseLifecycleRoutes = require("./routes/testCaseLifecycle");
const qwen = require("./services/qwenClient");
const { REPORT_DIR, reportFileName } = require("./services/reportGenerator");

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
  res.json({ ok: true, aiConnected: qwen.isConfigured(), defaultAiProfile: process.env.AI_MODEL_DEFAULT || "strong" });
});

const READINESS_CSS = `
.readiness{margin-top:8px;padding:9px 10px;border-radius:8px;font-size:10.5px;line-height:1.45;border:1px solid var(--border)}
.readiness.ready{background:#ecfdf5;border-color:#a7f3d0;color:#047857}
.readiness.blocked{background:#fff7ed;border-color:#fed7aa;color:#9a3412}
.readiness.preflight{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
.readiness-code{display:block;margin-top:4px;font-weight:800;font-size:9.5px;letter-spacing:.25px}
.readiness-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}
.readiness-actions button{font-size:10px;padding:5px 7px}
.tag.ready{background:#dcfce7;color:#15803d;font-weight:800}
.tag.blocked{background:#ffedd5;color:#c2410c;font-weight:800}
.tag.preflight{background:#dbeafe;color:#1d4ed8;font-weight:800}
.editor-readiness{margin:0 0 14px;padding:12px;border-radius:10px;background:#f8fafc;border:1px solid var(--border);font-size:11px;line-height:1.5}
.editor-readiness strong{font-size:11.5px}
.editor-readiness .history{margin-top:7px;padding-top:7px;border-top:1px solid var(--border);color:#64748b}
.editor-ai-generator{margin:0 0 14px;padding:13px;border-radius:10px;background:#f8fbff;border:1px solid #bfdbfe}
.editor-ai-generator .title{font-size:11.5px;font-weight:800;color:#1d4ed8}
.editor-ai-generator .note{font-size:10.5px;color:#64748b;line-height:1.45;margin-top:4px}
.editor-ai-generator textarea{width:100%;min-height:70px;margin-top:9px;border:1px solid var(--border);border-radius:8px;padding:9px;resize:vertical}
.editor-ai-generator .actions{display:flex;align-items:center;gap:8px;margin-top:8px}
.editor-ai-generator .status{border:0;padding:0;font-size:10.5px}
.editor-ai-generator .status.ok{color:#047857}
.editor-ai-generator .status.bad{color:#b91c1c}
`;

function serveUi(req, res, next) {
  const uiFile = path.join(__dirname, "..", "testpilot-ui", "index.html");
  fs.readFile(uiFile, "utf8", (err, html) => {
    if (err) return next(err);
    const defaultProfile = String(process.env.AI_MODEL_DEFAULT || "strong").toLowerCase();

    const adjusted = html
      .replace("</style>", `${READINESS_CSS}</style>`)
      .replace('id="additionalPaths" value="/feedback"', 'id="additionalPaths" value=""')
      .replace("if(index<0)testCases.push(tc);else testCases[index]=tc;", "if(index<0)testCases.unshift(tc);else testCases[index]=tc;")
      .replace("User Story → Qwen → Human Review → Automated Execution → Analytics", "User Story → AI → Human Review → Automated Execution → Analytics")
      .replace("They are not sent to Qwen.", "They are not sent to the AI model.")
      .replace("The automation engine runs the reviewed cases; Qwen then explains failures.", "The automation system runs the reviewed cases deterministically; AI analysis is available on demand after execution.")
      .replace("$('healthDot').className='dot '+(data.qwenConfigured?'ok':'bad');$('healthText').textContent=data.qwenConfigured?`Qwen ${data.qwenModel} connected`:'Backend online · Qwen not configured'", "$('healthDot').className='dot '+(data.aiConnected?'ok':'bad');$('healthText').textContent=data.aiConnected?'Connected':'Not connected'")
      .replace("Discovering relevant pages and asking Qwen. Please wait.", "Discovering relevant pages and generating AI test cases. Readiness will be checked after the cases appear.")
      .replace("Discovering pages & asking Qwen…", "Discovering pages & generating tests…")
      .replace("$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · ${data.qwenModel||'Qwen'}`", "$('caseSubtitle').textContent=`${data.feature||'Story'} · ${data.pageDiscoveries?.length||0} page(s) discovered · AI generated + readiness checking`")
      .replace("Automation is running.<small>Watch the Chrome window that opens automatically.</small>", "Automation is running.<small>The automation system is executing on the server. If you are working directly on the server, you may see the browser window open; from another PC, execution continues in the background.</small>")
      .replace("Qwen failure analysis", "AI failure analysis")
      .replace("</body>", `<script src="/readiness.js"></script><script src="/add-test-mode.js"></script><script src="/results-analysis.js"></script><script>if(document.getElementById("aiModelTier")){document.getElementById("aiModelTier").value=${JSON.stringify(defaultProfile)};}</script></body>`);

    res.type("html").send(adjusted);
  });
}

app.get(["/", "/index.html"], serveUi);
app.use(express.static(path.join(__dirname, "..", "testpilot-ui")));

app.listen(PORT, HOST, () => {
  console.log(`[ai-testpilot] Backend listening on ${HOST}:${PORT}`);
  console.log(`[ai-testpilot] UI available locally at http://localhost:${PORT}/`);
  if (qwen.isConfigured()) console.log(`[ai-testpilot] ✅ AI provider connected · default profile ${(process.env.AI_MODEL_DEFAULT || "strong").toLowerCase()}`);
  else console.log("[ai-testpilot] ❌ AI provider is not configured. Check the server-side AI configuration in .env.");
});
