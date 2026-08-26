const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const DEFAULT_INFO_FILE = path.join(__dirname, "..", "..", "automation-system", "artifacts", "live-browser-cdp.json");
const subscribers = new Set();
let latestFrame = null;
let latestFrameAt = null;
let status = "idle";
let statusMessage = "Waiting for an automation browser.";
let ws = null;
let stopRequested = false;
let connectLoopPromise = null;

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function broadcast(event, payload) { const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`; for (const res of subscribers) { try { res.write(data); } catch { subscribers.delete(res); } } }
function setStatus(nextStatus, message) { status = nextStatus; statusMessage = message; broadcast("status", { status, message, latestFrameAt }); }
function pushFrame(base64) { latestFrame = base64; latestFrameAt = new Date().toISOString(); broadcast("frame", { image: `data:image/jpeg;base64,${base64}`, at: latestFrameAt }); }
function getJson(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let body = ""; res.setEncoding("utf8"); res.on("data", (chunk) => { body += chunk; }); res.on("end", () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`)); try { resolve(JSON.parse(body)); } catch (err) { reject(err); } }); }).on("error", reject); }); }
async function discoverDebuggerPort(infoFile) { if (!infoFile || !fs.existsSync(infoFile)) return null; try { const info = JSON.parse(fs.readFileSync(infoFile, "utf8")); const port = Number(info.port); return Number.isFinite(port) && port > 0 ? port : null; } catch { return null; } }
async function discoverPageTarget(port) { const targets = await getJson(`http://127.0.0.1:${port}/json`); if (!Array.isArray(targets)) return null; return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) || null; }
function attachToTarget(target) { return new Promise((resolve, reject) => { const socket = new WebSocket(target.webSocketDebuggerUrl); ws = socket; let commandId = 1; let lastFrameSentAt = 0; socket.once("open", () => { setStatus("live", `Streaming ${target.title || "automation browser"}`); socket.send(JSON.stringify({ id: commandId++, method: "Page.enable" })); socket.send(JSON.stringify({ id: commandId++, method: "Page.startScreencast", params: { format: "jpeg", quality: 65, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 } })); resolve(); }); socket.on("message", (raw) => { let message; try { message = JSON.parse(String(raw)); } catch { return; } if (message.method !== "Page.screencastFrame") return; const sessionId = message.params?.sessionId; if (sessionId != null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: commandId++, method: "Page.screencastFrameAck", params: { sessionId } })); const now = Date.now(); if (now - lastFrameSentAt < 180) return; lastFrameSentAt = now; if (message.params?.data) pushFrame(message.params.data); }); socket.once("error", reject); socket.once("close", () => { setStatus("waiting", "Automation browser disconnected. Waiting for the next browser target."); if (ws === socket) ws = null; }); }); }
async function connectionLoop(infoFile) { while (!stopRequested) { try { const port = await discoverDebuggerPort(infoFile); if (!port) { setStatus("waiting", "Waiting for Chrome DevTools endpoint..."); await delay(300); continue; } const target = await discoverPageTarget(port); if (!target) { setStatus("waiting", "Chrome started; waiting for the test page..."); await delay(300); continue; } if (!ws || ws.readyState === WebSocket.CLOSED) await attachToTarget(target); while (!stopRequested && ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) await delay(250); } catch (err) { if (!stopRequested) { setStatus("waiting", `Live stream reconnecting: ${err.message}`); await delay(500); } } } }
function start(infoFile = DEFAULT_INFO_FILE) { stopRequested = false; if (!connectLoopPromise) { setStatus("starting", "Starting live browser stream..."); connectLoopPromise = connectionLoop(infoFile).finally(() => { connectLoopPromise = null; }); } }
async function stop(message = "Automation run finished.") { stopRequested = true; if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch {} } ws = null; setStatus("finished", message); }
function subscribe(req, res) { start(); res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }); res.write(`event: status\ndata: ${JSON.stringify({ status, message: statusMessage, latestFrameAt })}\n\n`); if (latestFrame) res.write(`event: frame\ndata: ${JSON.stringify({ image: `data:image/jpeg;base64,${latestFrame}`, at: latestFrameAt })}\n\n`); subscribers.add(res); const heartbeat = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { clearInterval(heartbeat); } }, 15000); req.on("close", () => { clearInterval(heartbeat); subscribers.delete(res); }); }
function snapshot() { return { status, message: statusMessage, latestFrameAt, viewerCount: subscribers.size }; }
module.exports = { start, stop, subscribe, snapshot, DEFAULT_INFO_FILE };
