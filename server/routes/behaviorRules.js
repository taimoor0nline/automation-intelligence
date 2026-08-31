const express = require('express');
const router = express.Router();
const { getSession } = require('../data/sessionStore');
const { assessTestCases, readinessSummary } = require('../services/testCaseFeasibility');
const persistence = require('../services/persistenceService');
const {
  RULE_TYPES, RULE_SOURCES, SCOPE_TYPES, TRIGGERS,
  upsertRules, linkRulesToCase,
} = require('../services/behaviorRuleRegistry');

const AUTH_REQUIRED = String(process.env.AUTH_REQUIRED || 'false').toLowerCase() === 'true';
function qaManagerOnly(req,res,next){
  if(!AUTH_REQUIRED) return next();
  const role=String(req.user?.role||'').toUpperCase();
  if(!req.user) return res.status(401).json({reply:'Authentication is required.'});
  if(!['QA','MANAGER'].includes(role)) return res.status(403).json({reply:'QA or MANAGER role is required.'});
  next();
}
function safeRules(session){ return Array.isArray(session.behaviorRules) ? session.behaviorRules : []; }
function relinkAndAssess(session){
  const registry=session.canonicalElementRegistry || {elements:[],pages:[]};
  session.testCases=(session.testCases||[]).map((tc)=>linkRulesToCase(tc,safeRules(session),registry));
  session.testCases=assessTestCases(session.testCases,{
    pageDiscoveries:session.pageDiscoveries||[],
    hasCredentials:Boolean(session.credentials?.username&&session.credentials?.password),
    actorCatalog:session.testActors||[],
    actorCredentialRefs:Object.entries(session.actorCredentials||{}).filter(([,c])=>c?.username&&c?.password).map(([ref])=>ref),
    story:session.story||'',
  });
  session.automationReadiness=readinessSummary(session.testCases);
  session.readinessValidated=true;
}
async function persist(sessionId,session,req){
  if(!persistence.enabled()) return;
  await persistence.persistSession(sessionId,session,{projectId:session.projectId,repositoryId:session.repositoryId,userId:req.user?.sub||session.createdBy||null});
  await persistence.persistBehaviorRules?.(sessionId,session.behaviorRules||[],session.behaviorRuleConflicts||[]);
  await persistence.persistTestCases(sessionId,session.testCases||[]);
}

router.get('/api/test-rules/catalog', qaManagerOnly, (_req,res)=>res.json({ok:true,ruleTypes:RULE_TYPES,sources:RULE_SOURCES,scopeTypes:SCOPE_TYPES,triggers:TRIGGERS}));
router.get('/api/test-rules/:sessionId', qaManagerOnly, (req,res)=>{
  const session=getSession(req.params.sessionId||'default');
  res.json({ok:true,databaseMode:persistence.enabled()?'POSTGRESQL_AND_SESSION':'SESSION_ONLY',rules:safeRules(session),conflicts:session.behaviorRuleConflicts||[],testCases:(session.testCases||[]).map(tc=>({id:tc.id,title:tc.title,ruleRefs:tc.ruleRefs||[],effectiveRules:tc.effectiveRules||[]}))});
});
router.post('/api/test-rules/:sessionId', qaManagerOnly, async (req,res)=>{
  const sessionId=req.params.sessionId||'default'; const session=getSession(sessionId);
  const incoming=Array.isArray(req.body?.rules)?req.body.rules:req.body?.rule?[req.body.rule]:[];
  if(!incoming.length) return res.status(422).json({ok:false,reply:'Provide at least one behavior rule.'});
  try{
    session.behaviorRules=upsertRules(safeRules(session),incoming,'USER_DEFINED');
    relinkAndAssess(session); await persist(sessionId,session,req);
    res.json({ok:true,databaseMode:persistence.enabled()?'POSTGRESQL_AND_SESSION':'SESSION_ONLY',rules:session.behaviorRules,conflicts:session.behaviorRuleConflicts||[],automationReadiness:session.automationReadiness,testCases:session.testCases});
  }catch(err){res.status(422).json({ok:false,reply:err.message});}
});
router.post('/api/test-rules/:sessionId/import', qaManagerOnly, async (req,res)=>{
  const sessionId=req.params.sessionId||'default'; const session=getSession(sessionId);
  const incoming=Array.isArray(req.body?.rules)?req.body.rules:[];
  if(!incoming.length) return res.status(422).json({ok:false,reply:'Imported rule list is empty.'});
  try{
    session.behaviorRules=upsertRules(safeRules(session),incoming.map(r=>({...r,source:'IMPORTED'})),'IMPORTED');
    relinkAndAssess(session); await persist(sessionId,session,req);
    res.json({ok:true,imported:incoming.length,databaseMode:persistence.enabled()?'POSTGRESQL_AND_SESSION':'SESSION_ONLY',rules:session.behaviorRules,conflicts:session.behaviorRuleConflicts||[],automationReadiness:session.automationReadiness});
  }catch(err){res.status(422).json({ok:false,reply:err.message});}
});
router.post('/api/test-rules/:sessionId/conflicts/:conflictId/resolve', qaManagerOnly, async (req,res)=>{
  const sessionId=req.params.sessionId||'default'; const session=getSession(sessionId);
  const conflicts=session.behaviorRuleConflicts||[]; const conflict=conflicts.find(c=>c.conflictId===req.params.conflictId);
  if(!conflict) return res.status(404).json({ok:false,reply:'Rule conflict not found.'});
  const resolution=String(req.body?.resolution||'KEEP_APPROVED').toUpperCase();
  if(!['KEEP_APPROVED','ACCEPT_DISCOVERED'].includes(resolution)) return res.status(422).json({ok:false,reply:'resolution must be KEEP_APPROVED or ACCEPT_DISCOVERED.'});
  if(resolution==='ACCEPT_DISCOVERED'){
    const existing=safeRules(session).find(r=>r.ruleId===conflict.ruleId);
    if(existing){session.behaviorRules=upsertRules(safeRules(session),[{...existing,value:conflict.discoveredValue,trigger:conflict.discoveredTrigger,source:'USER_DEFINED',approved:true}],'USER_DEFINED');}
  }
  session.behaviorRuleConflicts=conflicts.map(c=>c.conflictId===conflict.conflictId?{...c,status:'RESOLVED',resolution,resolvedAt:new Date().toISOString()}:c);
  relinkAndAssess(session); await persist(sessionId,session,req);
  res.json({ok:true,resolution,rules:session.behaviorRules,conflicts:session.behaviorRuleConflicts,automationReadiness:session.automationReadiness});
});

module.exports=router;
