'use strict';
const path=require('path');
const fs=require('fs');
const {randomUUID}=require('crypto');
const db=require('../db');
const ROOT=path.resolve(__dirname,'..','..','automation-system','artifacts');
const DEST=path.join(ROOT,'run-evidence');
const LIMIT={screenshot:12*1024*1024,video:300*1024*1024};
function safeSource(name){
 if(!name)return null;
 const p=path.resolve(String(name));
 return p.startsWith(ROOT+path.sep)?p:null;
}
async function retainExecutionEvidence({projectId,runId,sessionArtifacts}){
 if(!db.isConfigured()||!projectId||!runId||!sessionArtifacts)return {retained:0,skipped:0};
 let retained=0,skipped=0;
 for(const [kind,field,ext,mime] of [
 ['screenshot','screenshotsByTestCase','.png','image/png'],
 ['video','videosByTestCase','.mp4','video/mp4']
 ]){
  const mapped=sessionArtifacts[field]||{};
  for(const [caseId,filename] of Object.entries(mapped)){
   const source=safeSource(filename);
   if(!source||!caseId){skipped++;continue;}
   try{
    const st=await fs.promises.stat(source);
    if(!st.isFile()||st.size<1||st.size>LIMIT[kind]){skipped++;continue;}
    const folder=path.join(DEST,String(runId));await fs.promises.mkdir(folder,{recursive:true});
    const relative=path.join('run-evidence',String(runId),randomUUID()+ext);
    const target=path.join(ROOT,relative);
    await fs.promises.copyFile(source,target,fs.constants.COPYFILE_EXCL);
    try{
     await db.withTransaction(async client=>{
      await client.query("insert into test_run_evidence(run_id,external_case_id,kind,relative_path,bytes,mime_type) values($1,$2,$3,$4,$5,$6) on conflict(run_id,external_case_id,kind) do update set relative_path=excluded.relative_path,bytes=excluded.bytes,mime_type=excluded.mime_type",[runId,caseId,kind,relative,st.size,mime]);
      const url='/api/projects/'+encodeURIComponent(projectId)+'/run-evidence/'+encodeURIComponent(runId)+'/'+encodeURIComponent(caseId)+'/'+kind;
      await client.query("update test_results set evidence_json=coalesce(evidence_json,'{}'::jsonb) || jsonb_build_object($1::text,$2::text) where run_id=$3 and external_case_id=$4",[kind==='video'?'videoUrl':'screenshotUrl',url,runId,caseId]);
     });
     retained++;
    }catch(e){await fs.promises.unlink(target).catch(()=>{});throw e;}
   }catch(e){skipped++;console.warn('[evidence-retention] capture not retained',kind,caseId,e.message);}
  }
 }
 return {retained,skipped};
}
module.exports={retainExecutionEvidence,ROOT};