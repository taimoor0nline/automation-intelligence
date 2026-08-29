(function(){
  if(window.__testNexusCustomGenerationScopes)return;
  window.__testNexusCustomGenerationScopes=true;
  const CATEGORY_STORAGE='testNexusCustomCategories';

  function split(value){return [...new Set(String(value||'').split(/[,|]/).map(v=>v.trim()).filter(Boolean))].slice(0,20);}
  function selectedCustom(){return Boolean(document.querySelector('#generationCategoryMenu input[data-test-category][value="CUSTOM"]:checked'));}

  function ensureStyles(){
    if(document.getElementById('testNexusCustomScopeStyles'))return;
    const style=document.createElement('style');style.id='testNexusCustomScopeStyles';
    style.textContent='.generation-custom-scope{display:none;margin-top:9px;padding:10px 11px;border:1px solid #dbe3ef;border-radius:10px;background:#f8fafc}.generation-custom-scope.show{display:block}.generation-custom-scope label{display:block;margin:0 0 6px;color:#344054;font-size:10.5px;font-weight:800}.generation-custom-scope input{width:100%;border:1px solid #dfe4ee;border-radius:8px;padding:9px 10px;font-size:11px;background:#fff}.generation-custom-scope small{display:block;margin-top:5px;color:#667085;font-size:9.5px;line-height:1.4}';
    document.head.appendChild(style);
  }

  function removeObsoleteNote(){document.querySelectorAll('.generation-category-engine-note').forEach(el=>el.remove());}

  function ensureCategoryInput(){
    const root=document.getElementById('generationCategoryPicker');if(!root)return null;
    let box=document.getElementById('generationCustomCategories');
    if(!box){
      box=document.createElement('div');box.id='generationCustomCategories';box.className='generation-custom-scope';
      box.innerHTML='<label for="generationCustomCategoriesInput">Custom testing purposes</label><input id="generationCustomCategoriesInput" type="text" autocomplete="off" placeholder="Localization, Data Migration | Failover"><small>Enter one or more organization-specific testing purposes. Separate values with a comma or |. They remain Custom classifications; execution still requires supported discovered actions and assertions.</small>';
      const note=root.querySelector('.generation-category-primary-note');
      if(note)note.insertAdjacentElement('beforebegin',box);else root.appendChild(box);
      const input=box.querySelector('input');
      try{input.value=sessionStorage.getItem(CATEGORY_STORAGE)||'';}catch{}
      input.addEventListener('input',()=>{try{sessionStorage.setItem(CATEGORY_STORAGE,input.value);}catch{}});
    }
    box.classList.toggle('show',selectedCustom());
    return box;
  }

  function sync(){removeObsoleteNote();ensureCategoryInput();}
  function bind(){
    ensureStyles();sync();
    const menu=document.getElementById('generationCategoryMenu');
    if(menu&&!menu.dataset.customScopeBound){
      menu.dataset.customScopeBound='1';
      menu.addEventListener('change',sync);
    }
  }
  function start(){
    bind();let attempts=0;const timer=setInterval(()=>{bind();if(document.getElementById('generationCategoryPicker')||++attempts>20)clearInterval(timer);},100);
  }
  window.TestNexusCustomScopes={split};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
