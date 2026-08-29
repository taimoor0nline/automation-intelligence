(function(){
  if(window.__aiTestPilotGenerationDropdownSearch)return;window.__aiTestPilotGenerationDropdownSearch=true;
  const style=document.createElement('style');style.textContent='.generation-menu-search{position:sticky;top:-8px;z-index:2;background:#fff;padding:8px 4px 7px;margin:-2px 0 5px}.generation-menu-search input{width:100%;height:34px;border:1px solid #dfe4ee;border-radius:8px;padding:0 9px;font-size:10.8px;color:#344054;background:#fff}.generation-menu-search input:focus{outline:none;border-color:#7c91ff;box-shadow:0 0 0 3px rgba(47,91,255,.08)}.generation-menu-no-results{display:none;padding:10px;text-align:center;color:#667085;font-size:10.5px}';document.head.appendChild(style);
  function enhance(menu){
    if(!menu||menu.dataset.searchable==='1')return;menu.dataset.searchable='1';
    const box=document.createElement('div');box.className='generation-menu-search';box.innerHTML='<input type="search" placeholder="Search options…" aria-label="Search dropdown options">';
    const no=document.createElement('div');no.className='generation-menu-no-results';no.textContent='No matching options.';
    menu.insertBefore(box,menu.firstChild);menu.appendChild(no);
    const input=box.querySelector('input');
    input.addEventListener('click',e=>e.stopPropagation());
    input.addEventListener('input',()=>{
      const q=input.value.trim().toLowerCase();let shown=0;
      menu.querySelectorAll('.generation-category-option').forEach((row)=>{
        if(row.classList.contains('generation-category-all')){row.style.display=q?'none':'';return;}
        const visible=!q||row.textContent.toLowerCase().includes(q);row.style.display=visible?'':'none';if(visible)shown++;
      });
      no.style.display=shown?'none':'block';
    });
    const observer=new MutationObserver(()=>{if(!menu.contains(box))return;});observer.observe(menu,{childList:true});
  }
  function scan(){document.querySelectorAll('.generation-category-menu').forEach(enhance)}
  const observer=new MutationObserver(scan);observer.observe(document.documentElement,{childList:true,subtree:true});scan();
})();