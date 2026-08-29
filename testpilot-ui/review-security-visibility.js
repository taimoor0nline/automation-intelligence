(function(){
  if(window.__aiTestPilotReviewSecurityVisibility)return;window.__aiTestPilotReviewSecurityVisibility=true;
  function cases(){try{return typeof testCases!=='undefined'&&Array.isArray(testCases)?testCases:[]}catch{return[]}}
  function refresh(){
    const category=document.getElementById('reviewCategory');
    const security=document.getElementById('reviewSecuritySubcategory');
    const severity=document.getElementById('reviewSeverity');
    if(!category||!security||!severity)return false;
    const selected=String(category.value||'ALL').toUpperCase();
    const hasSecurity=cases().some(tc=>String(tc?.testCategory||'').toUpperCase()==='SECURITY');
    const visible=selected==='SECURITY'||(selected==='ALL'&&hasSecurity);
    security.style.display=visible?'':'none';
    severity.style.display=visible?'':'none';
    if(!visible){security.value='ALL';severity.value='ALL';security.dispatchEvent(new Event('change',{bubbles:true}));severity.dispatchEvent(new Event('change',{bubbles:true}));}
    return true;
  }
  function install(){
    if(!refresh())return false;
    const category=document.getElementById('reviewCategory');
    if(category.dataset.securityVisibilityBound!=='1'){category.dataset.securityVisibilityBound='1';category.addEventListener('change',refresh);}
    const casesEl=document.getElementById('cases');
    if(casesEl&&!casesEl.dataset.securityVisibilityObserved){casesEl.dataset.securityVisibilityObserved='1';new MutationObserver(()=>setTimeout(refresh,0)).observe(casesEl,{childList:true,subtree:false});}
    return true;
  }
  if(!install()){const obs=new MutationObserver(()=>{if(install())obs.disconnect();});obs.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>obs.disconnect(),5000);}
})();