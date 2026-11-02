'use strict';
/** Isolated static server for Cypress UI acceptance; never proxies production APIs. */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..','testpilot-ui');
const port=Number(process.env.TESTNEXUS_FIXTURE_PORT||4008);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
http.createServer((req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const target=path.resolve(ROOT,'.'+(pathname==='/'?'/workspace.html':pathname));
  if(!target.startsWith(ROOT+path.sep)||!types[path.extname(target)]){res.writeHead(404);return res.end('Not found')}
  fs.readFile(target,(err,bytes)=>{
   if(err){res.writeHead(404);return res.end('Not found')}
   res.writeHead(200,{'Content-Type':types[path.extname(target)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(bytes);
  });
 }catch{res.writeHead(400);res.end('Bad request')}
}).listen(port,'127.0.0.1',()=>console.log('TestNexus fixture UI on http://127.0.0.1:'+port));
