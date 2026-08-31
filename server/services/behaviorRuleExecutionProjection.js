function upper(value){return String(value||'').trim().toUpperCase();}
function inputAction(action){return ['TYPE','TYPE_RUNTIME_CREDENTIAL','CLEAR','SELECT','CHECK','UNCHECK'].includes(upper(action?.operation));}

function projectRuleTriggers(ir={},rules=[]){
  const actions=(ir.actions||[]).map(item=>({...item}));
  const hints=[];
  const applied=[];
  for(const rule of rules||[]){
    const trigger=upper(rule.trigger);if(!trigger||trigger==='AUTO')continue;
    const explicitRef=String(rule.elementRef||'').trim();
    const targetRefs=explicitRef?[explicitRef]:[...new Set(actions.filter(inputAction).map(a=>String(a.elementRef||'').trim()).filter(Boolean))];
    if(!targetRefs.length)continue;
    hints.push(`${explicitRef||rule.scopeType||'applicable controls'} validates ON ${trigger}`);
    for(const ref of targetRefs){
      const inputIndexes=[];actions.forEach((action,index)=>{if(action.elementRef===ref&&inputAction(action))inputIndexes.push(index);});
      if(!inputIndexes.length)continue;
      const after=inputIndexes[inputIndexes.length-1]+1;
      if(['BLUR','CHANGE'].includes(trigger)&&!actions.some(a=>a.elementRef===ref&&upper(a.operation)==='BLUR'))actions.splice(after,0,{operation:'BLUR',elementRef:ref});
    }
    applied.push(rule.ruleId);
  }
  return {ir:{...ir,actions,ruleApplication:{...(ir.ruleApplication||{}),triggerRuleRefs:[...new Set(applied)],triggers:hints}},timingHints:hints.join('; ')};
}

module.exports={projectRuleTriggers};
