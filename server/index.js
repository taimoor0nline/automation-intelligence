require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const chatRoutes = require("./routes/chat");

const app = express();
const PORT = process.env.SERVER_PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(chatRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

// Serve the chat UI
app.use(express.static(path.join(__dirname, "..", "chat-ui")));

app.listen(PORT, () => {
  console.log(`[ai-testpilot] Backend running at http://localhost:${PORT}`);
  console.log(`[ai-testpilot] Chat UI available at http://localhost:${PORT}/`);
  const qwen = require("./services/qwenClient");
  if (qwen.isUsingRealQwen()) {
    console.log(`[ai-testpilot] ✅ Using REAL Qwen API (model: ${qwen.QWEN_MODEL})`);
  } else {
    console.log(`[ai-testpilot] ⚠️  Using MOCK Qwen (QWEN_API_KEY or QWEN_BASE_URL not set in .env)`);
  }
  require("./db/database").initDb();
});
