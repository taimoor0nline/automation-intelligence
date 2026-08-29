const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../services/authService');

async function projectRole(projectId,userId){const r=await db.query('select project_role from project_members where project_id=$1 and user_id=$2',[projectId,userId]);return String(r.rows[0]?.project_role||'').toUpperCase();}
async function canCreate(req,projectId){const global=String(req.user?.role||'').toUpperCase();if(global==='MANAGER')return true;return ['PROJECT_MANAGER','QA'].includes(await projectRole(projectId,req.user?.sub));}

router.post('/api/defects/:id/work-item', requireAuth, async (req,res)=>{
  try{
    const defect=await db.query(`select da.*,tr.project_id,tr.session_id,tr.id run_id,tr.run_number,ts.target_url,
      result.test_category,result.security_subcategory,result.severity as test_severity,result.priority as test_priority,result.scenario_type
      from defect_analyses da
      join test_runs tr on tr.id=da.run_id
      join test_sessions ts on ts.id=tr.session_id
      left join test_results result on result.run_id=tr.id and result.external_case_id=da.external_case_id
      where da.id=$1`,[req.params.id]);
    if(!defect.rowCount)return res.status(404).json({reply:'Defect not found.'});
    const d=defect.rows[0];
    if(!(await canCreate(req,d.project_id)))return res.status(403).json({reply:'Project Manager or QA role is required to create remediation work.'});
    const assignedTo=req.body?.assignedTo||d.assigned_to||null;
    if(assignedTo){const member=await db.query("select 1 from project_members pm join users u on u.id=pm.user_id where pm.project_id=$1 and pm.user_id=$2 and pm.project_role='DEVELOPER' and u.is_active=true",[d.project_id,assignedTo]);if(!member.rowCount)return res.status(400).json({reply:'Assign remediation work only to an active DEVELOPER member of this project.'});}
    const isSecurity=String(d.test_category||'').toUpperCase()==='SECURITY';
    const workType=isSecurity?'SECURITY_REMEDIATION':'DEFECT_FIX';
    const existing=await db.query("select * from work_items where defect_analysis_id=$1 and work_type=$2 and status<>'CANCELLED' order by created_at desc limit 1",[d.id,workType]);
    if(existing.rowCount)return res.status(409).json({reply:'An active remediation work item already exists for this defect.',workItem:existing.rows[0]});
    const priority=String(req.body?.priority||d.test_severity||d.severity||d.test_priority||'MEDIUM').toUpperCase();
    const normalizedPriority=['LOW','MEDIUM','HIGH','CRITICAL'].includes(priority)?priority:'MEDIUM';
    const prefix=isSecurity?'Security remediation':'Defect fix';
    const title=String(req.body?.title||`${d.external_case_id||'Test'} · ${prefix} · ${d.summary||'Application defect'}`).slice(0,500);
    const description=[isSecurity&&d.security_subcategory&&`Security area: ${String(d.security_subcategory).replaceAll('_',' ')}`,isSecurity&&(d.test_severity||d.severity)&&`Security severity: ${d.test_severity||d.severity}`,d.summary&&`Summary: ${d.summary}`,d.probable_cause&&`Probable cause: ${d.probable_cause}`,d.developer_review_area&&`Where to inspect: ${d.developer_review_area}`,d.developer_implementation_hint&&`Implementation guidance: ${d.developer_implementation_hint}`].filter(Boolean).join('\n\n').slice(0,10000);
    const item=await db.withTransaction(async client=>{
      const inserted=await client.query(`insert into work_items(project_id,session_id,run_id,defect_analysis_id,external_case_id,work_type,title,description,status,priority,assigned_to,assigned_by,created_by,due_at,metadata)
        values($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,$11,$11,$12,$13::jsonb) returning *`,[d.project_id,d.session_id,d.run_id,d.id,d.external_case_id,workType,title,description,normalizedPriority,assignedTo,req.user.sub,req.body?.dueAt||null,JSON.stringify({classification:d.classification,severity:d.test_severity||d.severity,testCategory:d.test_category||null,securitySubcategory:d.security_subcategory||null,scenarioType:d.scenario_type||null,sourceGuidanceLevel:d.source_guidance_level||'BLACK_BOX',targetUrl:d.target_url,runNumber:d.run_number})]);
      const w=inserted.rows[0];
      await client.query(`insert into work_item_history(work_item_id,event_type,new_status,performed_by,comment,metadata) values($1,'WORK_ITEM_CREATED','PENDING',$2,$3,$4::jsonb)`,[w.id,req.user.sub,isSecurity?'Created from failed security-test analysis.':'Created from failed-test defect analysis.',JSON.stringify({defectAnalysisId:d.id,externalCaseId:d.external_case_id,testCategory:d.test_category,securitySubcategory:d.security_subcategory,severity:d.test_severity||d.severity})]);
      if(assignedTo)await client.query("insert into notification_outbox(project_id,user_id,channel,event_type,subject,payload_json,status) values($1,$2,'IN_APP',$3,$4,$5::jsonb,'PENDING')",[d.project_id,assignedTo,isSecurity?'SECURITY_REMEDIATION_ASSIGNED':'WORK_ITEM_ASSIGNED',`Assigned: ${title}`,JSON.stringify({workItemId:w.id,defectAnalysisId:d.id,externalCaseId:d.external_case_id,status:'PENDING',testCategory:d.test_category,securitySubcategory:d.security_subcategory,severity:d.test_severity||d.severity})]);
      await client.query('update defect_analyses set assigned_to=coalesce($1,assigned_to) where id=$2',[assignedTo,d.id]);
      return w;
    });
    res.status(201).json({ok:true,workItem:item,workType});
  }catch(err){res.status(err.statusCode||500).json({reply:err.message});}
});

module.exports=router;
