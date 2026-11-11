/* Workspace data tables: per-table filters, sorting and pagination. */
(function(){
'use strict';
const PAGE_SIZES=[5,10,25,50],DEFAULT_PAGE_SIZE=5;
const TABLE_CONFIG={
 projectsBody:{create:'/project-create.html',createLabel:'Create project',search:'Search projects'},
 // No Create button: failed tests become tasks and the system assigns them.
 tasksBody:{search:'Search tasks'},
 workItemsBody:{create:'/task-create.html',createLabel:'Create task',search:'Search work items'},
 legacyTeamBody:{search:'Search team members'},
 storyList:{createButton:'storyCreate',createLabel:'Create story',search:'Search stories'},
 ctRows:{createButton:'ctCreate',createLabel:'Create team',search:'Search teams'},
 teamBody:{search:'Search members'},
 projectTeams:{search:'Search teams'},
 projectTeamMembers:{search:'Search team members'},
 runsBody:{search:'Search test runs'},
 runResultsBody:{search:'Search test cases'},
 caseHistoryBody:{search:'Search attempts'},
 inventoryCases:{search:'Search test cases'},
 inventoryStories:{search:'Search story statistics'},
 inventoryAudit:{search:'Search audit events'},
 repairMemoryList:{search:'Search recommendations'},
 usersBody:{search:'Search users'},
 ctMembersBody:{search:'Search members'},
 ctProjectsBody:{search:'Search projects'}
};
function initTable(table){
 if(table.dataset.paginationReady==='true')return;
 const tbody=table.tBodies[0],card=table.closest('.tn-card')||table.closest('.panel');
 if(!tbody||!card)return;
 table.dataset.paginationReady='true';
 const key=tbody.id,cfg=TABLE_CONFIG[key]||{},headers=[...table.tHead?.rows[0]?.cells||[]];
 for(const old of card.querySelectorAll('.tn-table-filters[data-table-key="'+key+'"],.tn-table-footer[data-table-key="'+key+'"]'))old.remove();
 const holder=table.closest('.tn-scroll')||table.parentNode;
 const toolbar=document.createElement('div');
 toolbar.className='tn-table-filters';toolbar.dataset.tableKey=key;
 toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Filters for '+(card.querySelector('h2')?.textContent||'table'));
 const search=document.createElement('input');
 search.type='search';search.className='form-control tn-table-query';search.placeholder=cfg.search||'Filter rows…';
 search.setAttribute('aria-label',cfg.search||'Filter table rows');
 const filter=document.createElement('select');filter.className='form-select tn-column-filter';filter.setAttribute('aria-label','Filter column');
 for(let i=0;i<headers.length;i++){
  const label=headers[i].textContent.trim();
  if(label&&label.length<100&&!['Actions','Action'].includes(label))filter.add(new Option(label,String(i)));
 }
 // No "All columns": the first column is selected by default. A table with no named columns searches the whole row.
 filter.selectedIndex=0;filter.hidden=!filter.options.length;
 const size=document.createElement('select');size.className='form-select tn-page-size';size.setAttribute('aria-label','Rows per page');
 for(const option of PAGE_SIZES)size.add(new Option(option+' / page',String(option),false,option===(cfg.pageSize||DEFAULT_PAGE_SIZE)));
 const create=cfg.create?document.createElement('a'):cfg.createButton?document.createElement('button'):null;
 if(create&&cfg.createButton){create.type='button';create.id=cfg.createButton;}
 if(create){if(cfg.create)create.href=cfg.create;create.className='btn btn-primary tn-btn tn-table-create';create.textContent='+ Create';
 create.title=cfg.createLabel||'Create';create.setAttribute('aria-label',cfg.createLabel||'Create');}
 const footer=document.createElement('div');footer.className='tn-table-footer';footer.dataset.tableKey=key;
 const info=document.createElement('span');info.setAttribute('aria-live','polite');
 const nav=document.createElement('div');nav.className='tn-table-pager';
 const prev=document.createElement('button'),next=document.createElement('button'),pageNo=document.createElement('span');
 for(const [button,title,symbol] of [[prev,'Previous page','‹'],[next,'Next page','›']]){
  button.type='button';button.textContent=symbol;button.title=title;button.setAttribute('aria-label',title);
 }
 // Rows-per-page belongs with the pagination in the footer, not with the search filters.
 nav.append(size,prev,pageNo,next);footer.append(info,nav);
 // Search box with a magnifier icon (same on every table).
 const searchWrap=document.createElement('label');searchWrap.className='tn-search';
 searchWrap.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
 searchWrap.append(search);
 // Column dropdown and search input as one box: [ Column ▾ | 🔍 Search… ] (same size on every table).
 const searchBar=document.createElement('div');searchBar.className='tn-searchbar';searchBar.append(filter,searchWrap);
 const textFilters=document.createElement('div');textFilters.className='tn-table-filters-main';textFilters.append(searchBar);
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
   // A cell's data-sort (e.g. an ISO date or a number) sorts correctly when the shown text is formatted.
   const key=cell=>(cell?.dataset.sort??cell?.textContent??'').trim();
   const av=key(a.cells[idx]),bv=key(b.cells[idx]);
   const an=Number(av),bn=Number(bv);
   const result=av&&bv&&Number.isFinite(an)&&Number.isFinite(bn)?an-bn:av.localeCompare(bv,undefined,{numeric:true,sensitivity:'base'});
   return result*sorting.direction;
  });
  observer.disconnect();for(const r of rows)tbody.append(r);observer.observe(tbody,{childList:true});
 }
 function render(){
  // The "No items" message row is not data: always shown when the table is empty, never counted.
  const emptyRows=[...tbody.rows].filter(r=>r.querySelector('td.tn-empty'));
  const rows=[...tbody.rows].filter(r=>!emptyRows.includes(r)),q=search.value.toLocaleLowerCase(),column=filter.value===''?-1:Number(filter.value);
  const filtered=rows.filter(row=>{
   // Search looks only in the column chosen in the dropdown.
   const text=column>=0?String(row.cells[column]?.textContent||''):row.textContent;
   if(q&&!text.toLocaleLowerCase().includes(q))return false;
   return true;
  });
  const per=Number(size.value)||10,totalPages=Math.max(1,Math.ceil(filtered.length/per));
  page=Math.max(1,Math.min(page,totalPages));
  const set=new Set(filtered.slice((page-1)*per,page*per));
  for(const row of rows)row.hidden=!set.has(row);
  for(const row of emptyRows)row.hidden=rows.length>0;
  info.textContent=filtered.length+' row(s) · '+(filtered.length?(page-1)*per+1:0)+'–'+Math.min(page*per,filtered.length)+' shown';
  pageNo.textContent='Page '+page+' of '+totalPages;
  prev.disabled=page<=1;next.disabled=page>=totalPages;
  if(create){
   const role=window.testnexusWorkspaceRole||{};
   const allowed=key==='projectsBody'?role.platformManager:key==='tasksBody'?role.canReview:key==='workItemsBody'?window.legacyWorkCanCreate:true;
   create.hidden=!allowed;
  }
 }
 const observer=new MutationObserver(()=>{page=1;render();});
 observer.observe(tbody,{childList:true});
 for(const el of [search,filter,size])el.addEventListener(el===filter||el===size?'change':'input',()=>{
  page=1;render();
 });
 prev.onclick=()=>{page--;render();};
 next.onclick=()=>{page++;render();};
 headers.forEach((header,index)=>{
  if(!header.textContent.trim()||header.querySelector('input,button')||['Actions','Action'].includes(header.textContent.trim()))return;
  header.classList.add('tn-sort-column');
  header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-label','Sort by '+header.textContent.trim());
  const change=()=>{if(sorting.index===index)sorting.direction*=-1;else sorting={index,direction:1};sortRows();render();
   // Mark the sorted column so only it shows an arrow (↑ / ↓).
   headers.forEach(h=>h.removeAttribute('aria-sort'));header.setAttribute('aria-sort',sorting.direction===1?'ascending':'descending');};
  header.addEventListener('click',change);
  header.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();change();}});
 });
 render();
 table.tnRefresh=render;
}
function init(){document.querySelectorAll('.tn-view table,#team table,#work table,.tn-popup-table table').forEach(initTable);}
window.TNTableControls={init,refresh:()=>document.querySelectorAll('.tn-view table').forEach(x=>x.tnRefresh?.())};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
for(const id of ['team','work']){const el=document.getElementById(id);if(el)new MutationObserver(init).observe(el,{childList:true});}
})();
