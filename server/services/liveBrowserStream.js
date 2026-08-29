const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const DEFAULT_INFO_FILE = path.join(__dirname, "..", "..", "automation-system", "artifacts", "live-browser-cdp.json");
const DEFAULT_STATE_FILE = path.join(__dirname, "..", "..", "automation-system", "artifacts", "live-browser-state.json");
const subscribers = new Set();
let latestFrame = null;
let latestFrameAt = null;
let status = "idle";
let statusMessage = "Test not started.";
let runSummary = null;
let currentRunKey = null;
let ws = null;
let attachedTargetUrl = null;
let stopRequested = false;
let connectLoopPromise = null;

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) { try { res.write(data); } catch { subscribers.delete(res); } }
}
function setStatus(nextStatus, message, summary = runSummary) {
  status = nextStatus; statusMessage = message; runSummary = summary || null;
  broadcast("status", { status, message, latestFrameAt, summary: runSummary });
}
function resetFrame() {
  latestFrame = null; latestFrameAt = null;
  broadcast("reset", { at: new Date().toISOString() });
}
function pushFrame(base64) {
  if (status !== "live") return;
  latestFrame = base64; latestFrameAt = new Date().toISOString();
  broadcast("frame", { image: `data:image/jpeg;base64,${base64}`, at: latestFrameAt });
}
function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (res) => {
      let body = ""; res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    request.setTimeout(2000, () => request.destroy(new Error("CDP request timed out")));
    request.on("error", reject);
  });
}
function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}
async function discoverDebuggerPort(infoFile) {
  const info = readJsonFile(infoFile); const port = Number(info?.port);
  return Number.isFinite(port) && port > 0 ? port : null;
}
async function discoverPageTarget(port) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  if (!Array.isArray(targets)) return null;
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pages.length) return null;
  return pages.find((target) => /^https?:/i.test(String(target.url || ""))) || pages.find((target) => !/^(?:about:blank|chrome:|devtools:)/i.test(String(target.url || ""))) || pages[0];
}
function completedMessage(state) {
  const passed = Number(state?.passed || 0), failed = Number(state?.failed || 0), total = Number(state?.total || (passed + failed));
  return `Automation completed · ${passed} passed · ${failed} failed${total ? ` · ${total} total` : ""}.`;
}
function observeRunState(state) {
  if (!state || !state.status) {
    if (!currentRunKey && status !== "idle") { resetFrame(); setStatus("idle", "Test not started."); }
    return false;
  }
  const runKey = String(state.runId || state.at || "run");
  if (state.status === "preparing") {
    if (runKey !== currentRunKey) { currentRunKey = runKey; runSummary = null; resetFrame(); }
    setStatus("preparing", "Browser is preparing. Test has not started yet.");
    return false;
  }
  if (state.status === "running") {
    if (runKey !== currentRunKey) { currentRunKey = runKey; runSummary = null; resetFrame(); }
    const testName = state.testCaseId || state.testTitle || "approved test";
    setStatus("live", `Test started · ${testName}`);
    return false;
  }
  if (state.status === "finalizing") {
    const summary = { passed: Number(state.passed || 0), failed: Number(state.failed || 0), total: Number(state.total || 0) };
    setStatus("finalizing", `Tests finished · ${summary.passed} passed · ${summary.failed} failed. Finalizing browser teardown...`, summary);
    return false;
  }
  if (state.status === "finished") {
    const summary = { passed: Number(state.passed || 0), failed: Number(state.failed || 0), total: Number(state.total || 0) };
    resetFrame();
    setStatus("finished", completedMessage(summary), summary);
    return true;
  }
  return false;
}
function attachToTarget(target, stateFile) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl); ws = socket; attachedTargetUrl = target.webSocketDebuggerUrl;
    let commandId = 1, lastFrameSentAt = 0, lastFrameObservedAt = Date.now();
    const pendingCaptures = new Set(); let heartbeat = null;
    function cleanup(){ if(heartbeat) clearInterval(heartbeat); heartbeat=null; pendingCaptures.clear(); }
    function requestFallbackFrame(){
      if(socket.readyState!==WebSocket.OPEN||pendingCaptures.size>=2||status!=="live")return;
      const id=commandId++; pendingCaptures.add(id);
      try{socket.send(JSON.stringify({id,method:"Page.captureScreenshot",params:{format:"jpeg",quality:68,fromSurface:true}}));}catch{pendingCaptures.delete(id);}
    }
    socket.once("open",()=>{
      socket.send(JSON.stringify({id:commandId++,method:"Page.enable"}));
      socket.send(JSON.stringify({id:commandId++,method:"Page.startScreencast",params:{format:"jpeg",quality:68,maxWidth:1280,maxHeight:720,everyNthFrame:1}}));
      heartbeat=setInterval(()=>{const quietFor=Date.now()-lastFrameObservedAt;if(quietFor>=900)requestFallbackFrame();if(quietFor>=6000&&socket.readyState===WebSocket.OPEN&&pendingCaptures.size>=2){try{socket.close();}catch{}}},500);
      resolve();
    });
    socket.on("message",raw=>{
      let message;try{message=JSON.parse(String(raw));}catch{return;}
      if(pendingCaptures.has(message.id)){pendingCaptures.delete(message.id);if(message.result?.data){lastFrameObservedAt=Date.now();pushFrame(message.result.data);}return;}
      if(message.method!=="Page.screencastFrame")return;
      const sessionId=message.params?.sessionId;if(sessionId!=null&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:commandId++,method:"Page.screencastFrameAck",params:{sessionId}}));
      lastFrameObservedAt=Date.now();const now=Date.now();if(now-lastFrameSentAt<120)return;lastFrameSentAt=now;if(message.params?.data)pushFrame(message.params.data);
    });
    socket.once("error",err=>{cleanup();reject(err);});
    socket.once("close",()=>{cleanup();const state=readJsonFile(stateFile);observeRunState(state);if(ws===socket)ws=null;if(attachedTargetUrl===target.webSocketDebuggerUrl)attachedTargetUrl=null;});
  });
}
async function connectionLoop(infoFile,stateFile){
  while(!stopRequested){
    try{
      const state=readJsonFile(stateFile);if(observeRunState(state)){await delay(300);continue;}
      if(state?.status!=="running"){if(ws&&ws.readyState===WebSocket.OPEN){try{ws.close();}catch{}}await delay(200);continue;}
      const port=await discoverDebuggerPort(infoFile);if(!port){setStatus("preparing","Test started; waiting for browser stream endpoint...");await delay(200);continue;}
      const target=await discoverPageTarget(port);if(!target){setStatus("preparing","Test started; waiting for the test page...");await delay(200);continue;}
      if(!ws||ws.readyState===WebSocket.CLOSED)await attachToTarget(target,stateFile);
      let lastTargetCheckAt=0;
      while(!stopRequested&&ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ws.readyState)){
        const liveState=readJsonFile(stateFile);observeRunState(liveState);if(liveState?.status!=="running"){try{ws.close();}catch{}break;}
        const now=Date.now();if(now-lastTargetCheckAt>=1000&&ws?.readyState===WebSocket.OPEN){lastTargetCheckAt=now;try{const activeTarget=await discoverPageTarget(port);if(activeTarget?.webSocketDebuggerUrl&&attachedTargetUrl&&activeTarget.webSocketDebuggerUrl!==attachedTargetUrl){try{ws.close();}catch{}break;}}catch{}}
        await delay(150);
      }
    }catch(err){const state=readJsonFile(stateFile);observeRunState(state);if(!stopRequested){await delay(300);}}
  }
}
function start(infoFile=DEFAULT_INFO_FILE,stateFile=DEFAULT_STATE_FILE){
  stopRequested=false;if(!connectLoopPromise){setStatus("idle","Test not started.");connectLoopPromise=connectionLoop(infoFile,stateFile).finally(()=>{connectLoopPromise=null;});}
}
async function stop(message="Automation run finished."){
  stopRequested=true;if(ws&&ws.readyState===WebSocket.OPEN){try{ws.close();}catch{}}ws=null;attachedTargetUrl=null;resetFrame();setStatus("finished",message);
}
function subscribe(req,res){
  start();res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform",Connection:"keep-alive","X-Accel-Buffering":"no"});
  res.write(`event: status\ndata: ${JSON.stringify({status,message:statusMessage,latestFrameAt,summary:runSummary})}\n\n`);
  if(latestFrame&&status==="live")res.write(`event: frame\ndata: ${JSON.stringify({image:`data:image/jpeg;base64,${latestFrame}`,at:latestFrameAt})}\n\n`);
  subscribers.add(res);const heartbeat=setInterval(()=>{try{res.write(": keepalive\n\n");}catch{clearInterval(heartbeat);}},15000);req.on("close",()=>{clearInterval(heartbeat);subscribers.delete(res);});
}
function snapshot(){return{status,message:statusMessage,latestFrameAt,viewerCount:subscribers.size,summary:runSummary};}
module.exports={start,stop,subscribe,snapshot,DEFAULT_INFO_FILE,DEFAULT_STATE_FILE};
