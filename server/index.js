require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const chatRoutes = require("./routes/chat");
const qwen = require("./services/qwenClient");

const app = express();
const PORT = process.env.SERVER_PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
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
