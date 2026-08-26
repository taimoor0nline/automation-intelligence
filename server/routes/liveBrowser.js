const express = require("express");
const router = express.Router();
const liveBrowser = require("../services/liveBrowserStream");

router.get("/api/live-browser/status", (_req, res) => {
  res.json(liveBrowser.snapshot());
});

router.get("/api/live-browser/events", (req, res) => {
  liveBrowser.subscribe(req, res);
});

module.exports = router;
