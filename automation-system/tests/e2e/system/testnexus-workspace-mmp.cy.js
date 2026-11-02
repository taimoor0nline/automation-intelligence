/// <reference types="cypress" />
import 'cypress-axe';

const P='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';
const B='44444444-4444-4444-8444-444444444444';
const U='33333333-3333-4333-8333-333333333333';
const tasks=[
 {id:A,project_id:P,parent_work_item_id:null,title:'Registration',work_type:'GENERAL',status:'PENDING',priority:'MEDIUM',session_id:'session-a',external_case_id:'TC001',assigned_to:U,assigned_to_name:'QA Tester'},
 {id:B,project_id:P,parent_work_item_id:A,title:'Email verification',work_type:'GENERAL',status:'READY_FOR_RETEST',priority:'HIGH',session_id:null,external_case_id:null,assigned_to:U,assigned_to_name:'QA Tester'}
];
function stubApp(){
 let links=[];
 cy.intercept('GET','/api/auth/me',{ok:true,user:{id:U,role:'QA',name:'QA Tester',email:'qa@example.test'}});
 cy.intercept('GET','/api/projects',{ok:true,projects:[{id:P,name:'Customer Portal',reference_no:'TN-001',created_at:'2026-11-02T00:00:00Z'}]});
 cy.intercept('GET','/api/projects/'+P+'/workspace',{ok:true,project:{id:P,name:'Customer Portal',reference_no:'TN-001',objectives:'Validate registration',scope_in:'Registration'},projectRole:'QA',stories:[],runs:[],documents:[],environments:[],members:[{user_id:U,project_role:'QA',display_name:'QA Tester',email:'qa@example.test'}]});
 cy.intercept('GET','/api/projects/'+P+'/work-items',{ok:true,workItems:tasks});
 cy.intercept('GET','/api/projects/'+P+'/evidence',{ok:true,results:[]});
 cy.intercept('GET','/api/projects/'+P+'/workflow',{ok:true,workflow:{auto_create_failed_tasks:false,auto_close_verified_retests:false},projectRole:'QA'});
 cy.intercept('GET','/api/projects/'+P+'/user-directory',{ok:true,users:[]});
 cy.intercept('GET','/api/projects/'+P+'/test-cases',{ok:true,cases:[{session_id:'session-a',external_case_id:'TC001',title:'Valid registration'}]});
 cy.intercept('GET','/api/projects/'+P+'/task-test-history*',{ok:true,results:[]});
 cy.intercept('GET','/api/work-items/*/test-links',req=>req.reply({ok:true,links}));
 cy.intercept('POST','/api/work-items/*/test-links',req=>{
  const entry={id:'55555555-5555-4555-8555-555555555555',session_id:req.body.sessionId,external_case_id:req.body.caseId};
  links.push(entry);req.reply({statusCode:201,body:{ok:true,link:entry}});
 });
 cy.intercept('DELETE','/api/work-items/*/test-links/*',req=>{
  links=links.filter(x=>!req.url.endsWith(x.id));req.reply({ok:true});
 });
 cy.intercept('GET','/api/work-items/*/details',req=>{
  const item=req.url.includes('/'+B+'/')?tasks[1]:tasks[0];
  req.reply({ok:true,task:item,projectRole:'QA',parent:item.id===B?{id:A,title:'Registration',status:'PENDING'}:null,subtasks:item.id===A?[{id:B,title:'Email verification',status:'READY_FOR_RETEST'}]:[],history:[],comments:[],attachments:[]});
 });
 cy.visit('/workspace.html',{onBeforeLoad:win=>win.sessionStorage.setItem('aiTestPilotToken','fixture-token')});
 cy.contains('Customer Portal').should('exist');
}
describe('TestNexus workspace MMP browser acceptance',()=>{
 beforeEach(()=>stubApp());
 it('renders a searchable project task hierarchy and navigates both directions',()=>{
  cy.get('[data-view="tasks"]').click();
  cy.get('#tasksBody tr').should('have.length',2);
  cy.get('#taskHierarchy').should('be.checked');
  cy.get('#taskSearch').type('Email');
  cy.get('#tasksBody tr').should('have.length',1).and('contain','Email verification');
  cy.get('#taskSearch').clear();
  cy.get('#tasksBody button[data-task="'+A+'"]').first().click();
  cy.get('#drawerTitle').should('contain','Registration');
  cy.get('#drawerSubtasks button[data-task="'+B+'"]').click();
  cy.get('#drawerTitle').should('contain','Email verification');
  cy.get('#drawerInfo button[data-task="'+A+'"]').click();
  cy.get('#drawerTitle').should('contain','Registration');
  cy.get('#closeTask').click();
  cy.get('#taskDrawer').should('have.attr','aria-hidden','true');
 });
 it('manages saved case links and preserves appearance preferences',()=>{
  cy.get('[data-view="tasks"]').click();
  cy.get('#tasksBody button[data-task="'+A+'"]').first().click();
  cy.get('#linkSession').should('have.value','session-a');
  cy.get('#linkCase').should('have.value','TC001');
  cy.get('#testLinkForm button[type="submit"]').click();
  cy.get('#drawerTestLinks').should('contain','TC001');
  cy.get('#drawerTestLinks [data-unlink-test]').click();
  cy.get('#drawerTestLinks').should('contain','No reusable test cases');
  cy.get('#closeTask').click();
  cy.get('#uiPreferences').click();
  cy.get('#themePreference').select('dark');
  cy.get('body').should('have.attr','data-theme','dark');
  cy.get('#densityPreference').select('compact');
  cy.get('body').should('have.attr','data-density','compact');
 });
 it('has no critical WCAG axe-core violations on any workspace view',()=>{
  cy.injectAxe();
  for(const view of ['overview','projects','stories','tasks','reports','team']){
   cy.get('nav [data-view="'+view+'"]').click();
   cy.checkA11y(null,{includedImpacts:['critical'],runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}},violations=>{
    if(violations.length){const summary=violations.map(v=>v.id+':'+v.nodes.map(n=>n.target.join(' ')).join(',')).join(';');throw new Error(view+' accessibility: '+summary);}
   });
  }
 });
 it('keeps workspace controls operable on a mobile viewport',()=>{
  cy.viewport(375,812);
  cy.get('nav [data-view="tasks"]').click();
  cy.get('#taskSearch').should('be.visible').type('Registration');
  cy.get('#tasksBody').should('contain','Registration');
  cy.get('#uiPreferences').click();cy.get('#themePreference').should('be.visible');
 });
});
