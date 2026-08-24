require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const chatRoutes = require("./routes/chat");
const runRoutes = require("./routes/run");
const qwen = require("./services/qwenClient");
const { normalizeGeneratedScript } = require("./services/automationScriptNormalizer");

// Keep Qwen as the source of the automation, but normalize the small class of
// assertions that are known to be brittle in this demo. In particular, the
// success panel contains a dynamic feedback reference, so exact whole-element
// text equality would incorrectly fail a successful submission.
const generateAutomationCode = qwen.generateAutomationCode.bind(qwen);
qwen.generateAutomationCode = async (args) => {
  const generated = await generateAutomationCode(args);
  return {
    ...generated,
    script: normalizeGeneratedScript(generated.script),
  };
};

const app = express();
const PORT = process.env.SERVER_PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// The optimized run router intercepts only approved execution requests and
// calls next() for normal story/test-case generation requests.
app.use(runRoutes);
app.use(chatRoutes);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    qwenConfigured: qwen.isConfigured(),
    qwenModel: qwen.QWEN_MODEL,
  });
});

app.use(express.static(path.join(__dirname, "..", "testpilot-ui")));

app.listen(PORT, () => {
  console.log(`[ai-testpilot] Backend running at http://localhost:${PORT}`);
  console.log(`[ai-testpilot] UI available at http://localhost:${PORT}/`);
  if (qwen.isConfigured()) {
    console.log(`[ai-testpilot] ✅ Real Qwen enabled (${qwen.QWEN_MODEL})`);
  } else {
    console.log("[ai-testpilot] ❌ Qwen is not configured. Set QWEN_API_KEY and QWEN_BASE_URL in .env.");
  }
});
