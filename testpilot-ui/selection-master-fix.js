(function(){
  if(window.__aiTestPilotSelectionMasterFix)return;window.__aiTestPilotSelectionMasterFix=true;
  const configs=[
    {root:'#generationTypeMenu',item:'input[data-scenario-type]',all:'#generationTypeSelectAll',button:'#generationTypeButton',count:'#generationTypeCount',storage:'aiTestPilotGenerationScenarioTypes',allText:'All scenario types',noun:'type'},
    {root:'#generationCategoryMenu',item:'input[data-test-category]',all:'#generationCategorySelectAll',button:'#generationCategoryButton',count:'#generationCategoryCount',storage:'aiTestPilotGenerationCategories',allText:'All available categories',noun:'category'},
    {root:'#securitySubcategoryMenu',item:'input[data-security-subcategory]',all:'#securitySubcategorySelectAll',button:'#securitySubcategoryButton',storage:'aiTestPilotSecuritySubcategories',allText:'All security areas',noun:'security area'},
    {root:'#securitySeverityMenu',item:'input[data-security-severity]',all:'#securitySeveritySelectAll',button:'#securitySeverityButton',storage:'aiTestPilotSecuritySeverities',allText:'All severities',noun:'severity'}
  ];
  function enabledItems(root,c){return [...root.querySelectorAll(c.item)].filter(x=>!x.disabled);}
  function sync(c){
    const root=document.querySelector(c.root),all=document.querySelector(c.all),button=document.querySelector(c.button),count=c.count?document.querySelector(c.count):null;if(!root||!all)return;
    const items=enabledItems(root,c),selected=items.filter(x=>x.checked).map(x=>x.value),isAll=items.length>0&&selected.length===items.length;
    all.checked=isAll;all.indeterminate=selected.length>0&&!isAll;
    if(button){const text=isAll?c.allText:`${selected.length} ${c.noun}${selected.length===1?'':'s'} selected`;button.innerHTML=`<span>${text}</span><span class="generation-chevron">⌄</span>`;button.title=selected.join(', ');}
    if(count)count.textContent=isAll?'All':String(selected.length);
    try{sessionStorage.setItem(c.storage,JSON.stringify(selected));}catch{}
  }
  function install(){
    for(const c of configs){
      const root=document.querySelector(c.root),all=document.querySelector(c.all);if(!root||!all||all.dataset.masterFixed==='1')continue;all.dataset.masterFixed='1';
      all.addEventListener('change',e=>{e.stopImmediatePropagation();root.querySelectorAll(c.item).forEach(x=>{x.checked=x.disabled?false:all.checked;});sync(c);},true);
      root.addEventListener('change',e=>{if(e.target.matches(c.item))setTimeout(()=>sync(c),0);});
      sync(c);
    }
  }
  window.__aiTestPilotSyncGenerationMasters=function(){for(const c of configs)sync(c);};
  document.addEventListener('click',e=>{
    if(!e.target.closest('#generateBtn'))return;
    const categories=[...document.querySelectorAll('#generationCategoryMenu input[data-test-category]:checked:not(:disabled)')];
    const types=[...document.querySelectorAll('#generationTypeMenu input[data-scenario-type]:checked:not(:disabled)')];
    if(categories.length&&types.length)return;
    e.preventDefault();e.stopImmediatePropagation();
    const message=!categories.length?'Select at least one available Test Category before generating test cases.':'Select at least one Scenario Type before generating test cases.';
    if(typeof showError==='function')showError(message);else alert(message);
  },true);
  const observer=new MutationObserver(()=>install());observer.observe(document.documentElement,{childList:true,subtree:true});install();setTimeout(()=>observer.disconnect(),5000);
})();