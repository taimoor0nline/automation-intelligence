function upper(value){return String(value||'').trim().toUpperCase();}

function projectRuleTriggers(ir={},rules=[]){
  const actions=(ir.actions||[]).map(item=>({...item}));
  const hints=[];
  const applied=[];
  for(const rule of rules||[]){
    const trigger=upper(rule.trigger);const ref=String(rule.elementRef||'').trim();
    if(!ref||!trigger||trigger==='AUTO')continue;
    hints.push(`${ref} validates ON ${trigger}`);
    const inputIndexes=[];
    actions.forEach((action,index)=>{if(action.elementRef===ref&&['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','SELECT','CHECK','UNCHECK'].includes(upper(action.operation)))inputIndexes.push(index);});
    const after=inputIndexes.length?inputIndexes[inputIndexes.length-1]+1:0;
    if(trigger==='BLUR'&&!actions.some(a=>a.elementRef===ref&&upper(a.operation)==='BLUR')){actions.splice(after,0,{operation:'BLUR',elementRef:ref});applied.push(rule.ruleId);}
    if(trigger==='CHANGE'&&!actions.some(a=>a.elementRef===ref&&upper(a.operation)==='BLUR')){
      // Cypress form controls emit change when their value is committed/blurred. A
      // deterministic blur is preferable to inventing application-specific JS events.
      actions.splice(after,0,{operation:'BLUR',elementRef:ref});applied.push(rule.ruleId);
    }
    if(trigger==='INPUT')applied.push(rule.ruleId); // TYPE naturally emits input events.
    if(trigger==='SUBMIT'||trigger==='API_RESPONSE')applied.push(rule.ruleId);
  }
  return {ir:{...ir,actions,ruleApplication:{...(ir.ruleApplication||{}),triggerRuleRefs:[...new Set(applied)],triggers:hints}},timingHints:hints.join('; ')};
}

module.exports={projectRuleTriggers};
