const assert = require('assert');
const { normalizeCrossPageLogin, normalizePassiveWaits } = require('../server/services/automationDslV6');
const { normalizeTestIdPhrase, resolveExpectedResults } = require('../server/services/expectationGrounding');
const { annotatePageDiscovery } = require('../server/services/webCapabilityMatrix');

const discoveries = [
  annotatePageDiscovery({
    url: 'http://localhost:4000/', finalUrl: 'http://localhost:4000/', pageTitle: 'Login',
    elements: [
      { tag:'input',type:'text',testId:'username',selector:'[data-testid="username"]',label:'Username' },
      { tag:'input',type:'password',testId:'password',selector:'[data-testid="password"]',label:'Password' },
      { tag:'button',type:'submit',testId:'login-button',selector:'[data-testid="login-button"]',text:'Sign in' },
    ], messages: [],
  }),
  annotatePageDiscovery({
    url: 'http://localhost:4000/feedback', finalUrl: 'http://localhost:4000/feedback', pageTitle: 'Feedback',
    elements: [
      { tag:'input',type:'text',testId:'full-name',selector:'[data-testid="full-name"]',label:'Full name',required:true },
      { tag:'input',type:'email',testId:'email',selector:'[data-testid="email"]',label:'Email',required:true },
      { tag:'input',type:'url',testId:'website',selector:'[data-testid="website"]',label:'Website' },
      { tag:'input',type:'number',testId:'age',selector:'[data-testid="age"]',label:'Age',required:true,errorElement:{tag:'div',type:'div',testId:'age-error',selector:'[data-testid="age-error"]',text:'Age must be between 18 and 100.'} },
      { tag:'div',type:'div',testId:'success-panel',selector:'[data-testid="success-panel"]',text:'Thank you for your feedback.' },
    ], messages: [],
  }),
];

const journey = {
  title:'Successful authenticated journey', type:'functional', preconditions:['Valid credentials exist'],
  steps:[
    {action:'fill',target:'[data-testid="username"]',value:'invented'},
    {action:'fill',target:'[data-testid="password"]',value:'invented-secret'},
    {action:'click',target:'[data-testid="login-button"]',value:null},
    {action:'wait',target:'[data-testid="full-name"]',value:null},
    {action:'fill',target:'[data-testid="full-name"]',value:'Jane Doe'},
  ], expectedResults:['Success panel [data-testid="success-panel"] displays "Thank you for your feedback."'],
};
const waits = normalizePassiveWaits(journey);
assert.equal(waits.steps[3].action, 'verify');
const login = normalizeCrossPageLogin(waits, { pageDiscoveries: discoveries, hasCredentials: true });
assert(login.steps.some(step => step.action === 'Use runtime credentials'));
assert(!login.steps.some(step => step.value === 'invented-secret'));

const explicit = 'Success panel [data-testid="success-panel"] displays "Thank you for your feedback."';
assert.equal(normalizeTestIdPhrase(explicit), explicit, 'Explicit selectors must never be wrapped a second time.');

const grounded = resolveExpectedResults([
  'User is redirected to http://localhost:4000/feedback after login',
  "Email 'jane@example.com' entered successfully",
  'Error message displays adjacent to the Age field',
], discoveries);
assert.equal(grounded.records[0].path, '/feedback');
assert.equal(grounded.records[1].selector, '[data-testid="email"]');
assert(!grounded.records[1].text.includes('[data-testid="website"]'));
assert.equal(grounded.records[2].selector, '[data-testid="age-error"]');

console.log('Readiness regression smoke test passed: runtime login, passive wait, selector normalization, value grounding and adjacent error grounding are stable.');
