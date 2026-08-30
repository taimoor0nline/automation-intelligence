const assert = require('assert');
const { classifyTestCase, READY } = require('../server/services/testCaseFeasibility');

const discoveries = [
  {
    url: 'http://localhost:4000/',
    finalUrl: 'http://localhost:4000/',
    elements: [
      { tag:'input', type:'text', testId:'username', id:'username', name:'username', selector:'[data-testid="username"]', errorElement:{ tag:'div', testId:'username-error', selector:'[data-testid="username-error"]', text:'Username is required.' } },
      { tag:'input', type:'password', testId:'password', id:'password', name:'password', selector:'[data-testid="password"]' },
      { tag:'button', type:'submit', testId:'login-button', id:'loginBtn', selector:'[data-testid="login-button"]', text:'Sign in' },
    ],
    messages: [],
  },
  {
    url: 'http://localhost:4000/feedback',
    finalUrl: 'http://localhost:4000/feedback',
    elements: [
      { tag:'input', type:'text', testId:'full-name', id:'fullName', name:'fullName', selector:'[data-testid="full-name"]' },
      { tag:'input', type:'number', testId:'age', id:'age', name:'age', selector:'[data-testid="age"]' },
      { tag:'select', type:'select-one', testId:'feedback-category', id:'category', name:'category', selector:'[data-testid="feedback-category"]', options:[{value:'product',text:'Product'}] },
      { tag:'div', type:'div', testId:'success-panel', id:'successPanel', selector:'[data-testid="success-panel"]', text:'Thank you for your feedback.' },
    ],
    messages: [],
  },
];

function readiness(testCase) {
  return classifyTestCase(testCase, { pageDiscoveries: discoveries, hasCredentials: false });
}

const emptyFill = readiness({
  id:'TC001', title:'Empty username', type:'negative', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/',value:null},
    {action:'fill',target:'[data-testid="username"]',value:''},
    {action:'click',target:'[data-testid="login-button"]',value:null},
  ],
  expectedResults:['Element [data-testid="username-error"] is visible'],
});
assert.equal(emptyFill.status, READY, emptyFill.reason);
assert(emptyFill.automationPlan.actions.some((item) => item.operation === 'CLEAR' && item.selector === '[data-testid="username"]'));

const valueEquals = readiness({
  id:'TC002', title:'Retain rejected age value', type:'boundary', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/feedback',value:null},
    {action:'fill',target:'[data-testid="age"]',value:'17'},
  ],
  expectedResults:['Value of [data-testid="age"] equals "17"'],
});
assert.equal(valueEquals.status, READY, valueEquals.reason);
assert(valueEquals.automationPlan.assertions.some((item) => item.operation === 'ASSERT_VALUE_EQUALS' && item.value === '17'));

const verifyPath = readiness({
  id:'TC003', title:'Verify feedback route', type:'positive', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/feedback',value:null},
    {action:'verify',target:'Path',value:'/feedback'},
  ],
  expectedResults:['Path equals "/feedback"'],
});
assert.equal(verifyPath.status, READY, verifyPath.reason);
assert(verifyPath.automationPlan.assertions.some((item) => item.operation === 'ASSERT_PATH_EQUALS' && item.path === '/feedback'));
assert(!verifyPath.automationPlan.actions.some((item) => String(item.operation).toUpperCase() === 'VERIFY'));

const selectorAlias = readiness({
  id:'TC004', title:'Canonical selector alias', type:'positive', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/feedback',value:null},
    {action:'fill',target:'#full-name',value:'Jane Doe'},
    {action:'select',target:'#category',value:'Product'},
  ],
  expectedResults:['Value of #full-name equals "Jane Doe"','Selected value of #category equals "product"'],
});
assert.equal(selectorAlias.status, READY, selectorAlias.reason);
assert(selectorAlias.automationPlan.actions.some((item) => item.selector === '[data-testid="full-name"]'));
assert(selectorAlias.automationPlan.actions.some((item) => item.operation === 'SELECT' && item.value === 'product'));

const validSuccessText = readiness({
  id:'TC005', title:'Use real success text', type:'positive', preconditions:[],
  steps:[{action:'navigate',target:'http://localhost:4000/feedback',value:null}],
  expectedResults:[
    'Element [data-testid="success-panel"] is visible',
    'Text in [data-testid="success-panel"] contains "Thank you for your feedback."',
  ],
});
assert.equal(validSuccessText.status, READY, validSuccessText.reason);

const badIdentityText = readiness({
  id:'TC006', title:'Reject selector identity as text', type:'positive', preconditions:[],
  steps:[{action:'navigate',target:'http://localhost:4000/feedback',value:null}],
  expectedResults:['Text in [data-testid="success-panel"] contains "success-panel"'],
});
assert.notEqual(badIdentityText.status, READY);
assert.equal(badIdentityText.reasonCode, 'ASSERTION_TEXT_IDENTITY_CONFLICT');

console.log('Readiness normalization smoke passed: empty fill, value grammar, verify promotion, selector canonicalization and text-identity grounding are stable.');
