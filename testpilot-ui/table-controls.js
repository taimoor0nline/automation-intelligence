/* Workspace data tables: per-table filters, sorting and pagination. */
(function(){
'use strict';
const PAGE_SIZES=[10,25,50];
const TABLE_CONFIG={
 projectsBody:{create:'/project-create.html',createLabel:'Create project',search:'Search projects'},
 tasksBody:{create:'/task-create.html',createLabel:'Create task',search:'Search tasks'},
 storyList:{search:'Search stories'},
 teamBody:{search:'Search team members'},
 runsBody:{search:'Search test runs'},
 evidenceBody:{search:'Search evidence'},
 savedReportsBody:{search:'Search saved reports'},
 inventoryCases:{search:'Search test cases'},
 inventoryStories:{search:'Search story statistics'},
 inventoryAudit:{search:'Search audit events'}
};
function initTable(table){
 if(table.dataset.paginationReady==='true')return;
 const tbody=table.tBodies[0],card=table.closest('.tn-card');
 if(!tbody||!card)return;
 table.dataset.paginationReady='true';
 const key=tbody.id,cfg=TABLE_CONFIG[key]||{},headers=[...table.tHead?.rows[0]?.cells||[]];
 const holder=table.closest('.tn-scroll')||table.parentNode;
 const toolbar=document.createElement('div');
 toolbar.className='tn-table-filters';
 toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Filters for '+(card.querySelector('h2')?.textContent||'table'));
 const search=document.createElement('input');
 search.type='search';search.className='form-control tn-table-query';search.placeholder=cfg.search||'Filter rows…';
 search.setAttribute('aria-label',cfg.search||'Filter table rows');
 const filter=document.createElement('select');filter.className='form-select tn-column-filter';filter.setAttribute('aria-label','Filter column');
 const value=document.createElement('input');value.type='search';value.className='form-control tn-table-value';value.placeholder='Column value';
 value.setAttribute('aria-label','Filter selected column value');value.hidden=true;
 filter.add(new Option('All columns',''));
 for(let i=0;i<headers.length;i++){
  const label=headers[i].textContent.trim();
  if(label&&label.length<100&&!['Actions','Action'].includes(label))filter.add(new Option(label,String(i)));
 }
 const size=document.createElement('select');size.className='form-select tn-page-size';size.setAttribute('aria-label','Rows per page');
 for(const option of PAGE_SIZES)size.add(new Option(option+' / page',String(option)));
 const create=cfg.create?document.createElement('a'):null;
 if(create){create.href=cfg.create;create.className='btn btn-primary tn-btn tn-table-create';create.textContent='+ Create';
 create.title=cfg.createLabel||'Create';create.setAttribute('aria-label',cfg.createLabel||'Create');}
 const footer=document.createElement('div');footer.className='tn-table-footer';
 const info=document.createElement('span');info.setAttribute('aria-live','polite');
 const nav=document.createElement('div');nav.className='tn-table-pager';
 const prev=document.createElement('button'),next=document.createElement('button'),pageNo=document.createElement('span');
 for(const [button,title,symbol] of [[prev,'Previous page','‹'],[next,'Next page','›']]){
  button.type='button';button.textContent=symbol;button.title=title;button.setAttribute('aria-label',title);
 }
 nav.append(prev,pageNo,next);footer.append(info,nav);
 const textFilters=document.createElement('div');textFilters.className='tn-table-filters-main';textFilters.append(search,filter,value,size);
 if(key==='tasksBody'){
  const status=document.getElementById('taskStatusFilter'),hierarchy=document.getElementById('taskHierarchy')?.closest('label');
  if(status){status.classList.add('tn-table-status');textFilters.append(status);}
  if(hierarchy)textFilters.append(hierarchy);
  const selection=document.getElementById('taskSelectionCount');
  if(selection)textFilters.append(selection);
  const oldToolbar=document.querySelector('#view-tasks .tn-task-toolbar');
  if(oldToolbar)oldToolbar.hidden=true;
 }
 toolbar.append(textFilters);if(create)toolbar.append(create);
 holder.parentNode.insertBefore(toolbar,holder);
 holder.after(footer);
 let page=1,sorting={index:-1,direction:1};
 function sortRows(){
  if(sorting.index<0)return;
  const idx=sorting.index;
  const rows=[...tbody.rows];
  rows.sort((a,b)=>{
   const av=a.cells[idx]?.textContent.trim()||'',bv=b.cells[idx]?.textContent.trim()||'';
   const an=Number(av),bn=Number(bv);
   const result=av&&bv&&Number.isFinite(an)&&Number.isFinite(bn)?an-bn:av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'});
   return result*sorting.direction;
  });
  observer.disconnect();for(const r of rows)tbody.append(r);observer.observe(tbody,{childList:true});
 }
 function render(){
  const rows=[...tbody.rows],q=search.value.toLocaleLowerCase(),column=filter.value===''?-1:Number(filter.value);
  const colq=value.value.toLocaleLowerCase();
  const filtered=rows.filter(row=>{
   const full=row.textContent.toLocaleLowerCase();
   if(q&&!full.includes(q))return false;
   if(column>=0&&colq&&!String(row.cells[column]?.textContent||'').toLocaleLowerCase().includes(colq))return false;
   return true;
  });
  const per=Number(size.value)||10,totalPages=Math.max(1,Math.ceil(filtered.length/per));
  page=Math.max(1,Math.min(page,totalPages));
  const set=new Set(filtered.slice((page-1)*per,page*per));
  for(const row of rows)row.hidden=!set.has(row);
  info.textContent=filtered.length+' row(s) · '+(filtered.length?(page-1)*per+1:0)+'–'+Math.min(page*per,filtered.length)+' shown';
  pageNo.textContent='Page '+page+' of '+totalPages;
  prev.disabled=page<=1;next.disabled=page>=totalPages;
  if(create){
   const role=window.testnexusWorkspaceRole||{};
   const allowed=key==='projectsBody'?role.platformManager:key==='tasksBody'?role.canReview:true;
   create.hidden=!allowed;
  }
 }
 const observer=new MutationObserver(()=>{page=1;render();});
 observer.observe(tbody,{childList:true});
 for(const el of [search,filter,value,size])el.addEventListener(el===filter||el===size?'change':'input',()=>{
  if(el===filter)value.hidden=!filter.value;
  page=1;render();
 });
 prev.onclick=()=>{page--;render();};
 next.onclick=()=>{page++;render();};
 headers.forEach((header,index)=>{
  if(!header.textContent.trim()||header.querySelector('input,button'))return;
  header.classList.add('tn-sort-column');
  header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-label','Sort by '+header.textContent.trim());
  const change=()=>{if(sorting.index===index)sorting.direction*=-1;else sorting={index,direction:1};sortRows();render();};
  header.addEventListener('click',change);
  header.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();change();}});
 });
 render();
 table.tnRefresh=render;
}
function init(){document.querySelectorAll('.tn-view table').forEach(initTable);}
window.TNTableControls={init,refresh:()=>document.querySelectorAll('.tn-view table').forEach(x=>x.tnRefresh?.())};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
