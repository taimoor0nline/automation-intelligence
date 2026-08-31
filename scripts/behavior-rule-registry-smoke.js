const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  discoveryRulesFromRegistry,
  mergeDiscoveredRules,
  linkRulesToCase,
  upsertRules,
  applyEffectiveRulesToIr,
} = require('../server/services/behaviorRuleRegistry');
const { projectRuleTriggers } = require('../server/services/behaviorRuleExecutionProjection');
const { applicationKey } = require('../server/services/behaviorRuleKnowledgeStore');

const registry={version:1,pages:[{pageRef:'page_feedback',path:'/feedback'}],elements:[
  {elementRef:'el_email',pageRef:'page_feedback',formId:'feedbackForm',tag:'input',type:'email',required:true,errorRef:'err_email'},
  {elementRef:'el_age',pageRef:'page_feedback',formId:'feedbackForm',tag:'input',type:'number',required:true,min:'18',max:'100',errorRef:'err_age'},
  {elementRef:'el_product',pageRef:'page_feedback',formId:'feedbackForm',tag:'input',type:'checkbox',name:'products',groupName:'products',errorRef:'err_products'},
]};
const discovered=discoveryRulesFromRegistry(registry);
assert(discovered.some(r=>r.elementRef==='el_email'&&r.ruleType==='EMAIL_FORMAT'));
assert(discovered.some(r=>r.elementRef==='el_age'&&r.ruleType==='MIN_VALUE'&&String(r.value)==='18'));
assert(discovered.some(r=>r.ruleType==='AT_LEAST_ONE_CHECKED'));

let state=mergeDiscoveredRules([],discovered);
const min=state.rules.find(r=>r.elementRef==='el_age'&&r.ruleType==='MIN_VALUE');
assert(min);
const overridden=upsertRules(state.rules,[{...min,value:'21',source:'USER_DEFINED',approved:true}],'USER_DEFINED');
const rediscovered=discovered.map(r=>r.ruleId===min.ruleId?{...r,value:'18'}:r);
state=mergeDiscoveredRules(overridden,rediscovered);
assert(state.conflicts.some(c=>c.ruleId===min.ruleId&&c.approvedValue==='21'&&c.discoveredValue==='18'),'approved business rule must conflict rather than be silently overwritten');

const tc={id:'TC005',title:'Verify age minimum boundary is accepted',type:'boundary',coverageRationale:'Verify minimum allowed age',canonicalIr:{version:1,plannedId:'P005',objective:'Verify age minimum boundary',actions:[{operation:'TYPE',elementRef:'el_age',value:'18'}],assertions:[{operation:'ASSERT_VALUE_EQUALS',elementRef:'el_age',value:'18'}]}};
const linked=linkRulesToCase(tc,overridden,registry);
assert(linked.ruleRefs.includes(min.ruleId));
const adjusted=applyEffectiveRulesToIr(linked.canonicalIr,linked.effectiveRules,linked);
assert.equal(adjusted.actions[0].value,'21','shared MIN_VALUE should update linked boundary input without editing the test case');
assert(adjusted.ruleApplication.ruleRefs.includes(min.ruleId));

const negative={...linked,type:'negative',title:'Reject age below minimum',canonicalIr:{...linked.canonicalIr,objective:'Reject age below minimum',actions:[{operation:'TYPE',elementRef:'el_age',value:'17'}]}};
const negAdjusted=applyEffectiveRulesToIr(negative.canonicalIr,negative.effectiveRules,negative);
assert.equal(negAdjusted.actions[0].value,'20','negative below-minimum case should follow updated shared rule');

const emailRule=discovered.find(r=>r.elementRef==='el_email'&&r.ruleType==='EMAIL_FORMAT');
const reviewedEmail={...emailRule,trigger:'BLUR',source:'USER_DEFINED',approved:true};
const projected=projectRuleTriggers({actions:[{operation:'TYPE',elementRef:'el_email',value:'bad-email'}],assertions:[]},[reviewedEmail]);
assert(projected.ir.actions.some(a=>a.operation==='BLUR'&&a.elementRef==='el_email'),'BLUR trigger must become executable canonical behavior');
assert.match(projected.timingHints,/ON BLUR/i);

assert.equal(applicationKey({targetUrl:'https://example.com/feedback'}),'target:https://example.com');
assert.equal(applicationKey({targetUrl:'https://example.com/'}),'target:https://example.com','rules should be reused across starting pages on the same application');
assert.equal(applicationKey({projectId:'project-123',targetUrl:'https://example.com'}),'project:project-123');
for(const migration of ['012_behavior_rule_registry.sql','013_application_behavior_rules.sql'])assert(fs.existsSync(path.join(__dirname,'..','server','db',migration)),`${migration} must exist for DB mode`);
console.log('[behavior-rule-registry-smoke] PASS');
