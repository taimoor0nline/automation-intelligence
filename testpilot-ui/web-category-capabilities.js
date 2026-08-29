(function(){
  if(window.__aiTestPilotWebCategoryCapabilities)return;window.__aiTestPilotWebCategoryCapabilities=true;
  const unavailable={
    API:'Use REST API testing for direct API execution.',
    COMPATIBILITY:'Current Web UI execution uses one configured browser per run; cross-browser compatibility certification is not part of this execution path.',
    LOAD:'Concurrent load generation is not part of the Web UI execution engine.',
    STRESS:'Stress/saturation execution is not part of the Web UI execution engine.'
  };
  function style(){if(document.getElementById('webCategoryCapabilityStyles'))return;const s=document.createElement('style');s.id='webCategoryCapabilityStyles';s.textContent=`
    .generation-category-option.engine-unavailable{opacity:.46;cursor:not-allowed;background:#f8fafc;color:#94a3b8;text-decoration:line-through}
    .generation-category-option.engine-unavailable:hover{background:#f8fafc}
    .generation-category-option.engine-unavailable input{cursor:not-allowed}
    .engine-unavailable-note{margin-left:auto;text-decoration:none!important;font-size:8.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.03em}
    .generation-category-engine-note{background:#f8fafc!important;color:#667085!important;border:1px solid #eef1f6}
  `;document.head.appendChild(s);}
  function apply(){
    style();
    const menu=document.getElementById('generationCategoryMenu');if(!menu)return false;
    for(const input of menu.querySelectorAll('input[data-test-category]')){
      const code=String(input.value||'').toUpperCase(),reason=unavailable[code];
      const row=input.closest('.generation-category-option');
      if(reason){input.checked=false;input.disabled=true;input.title=reason;if(row){row.classList.add('engine-unavailable');row.title=reason;if(!row.querySelector('.engine-unavailable-note')){const n=document.createElement('span');n.className='engine-unavailable-note';n.textContent='Unavailable';row.appendChild(n);}}}
      else if(row){row.title=code==='UI'?'Browser-visible UI behavior: visibility, text, form controls, navigation, layout/viewport and supported UI-state assertions.':'';}
    }
    const note=menu.querySelector('.generation-category-engine-note');
    if(note)note.textContent='Grey categories are not executable in the Web UI engine. UI remains available for browser-visible behavior and supported layout/state assertions.';
    window.__aiTestPilotSyncGenerationMasters?.();
    return true;
  }
  if(!apply()){
    const obs=new MutationObserver(()=>{if(apply())obs.disconnect();});obs.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>obs.disconnect(),5000);
  }
})();