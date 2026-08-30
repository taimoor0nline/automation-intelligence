const assert = require('assert');
const { classifyTestCase, READY } = require('../server/services/testCaseFeasibility');

const discoveries = [
  {
    url:'http://localhost:4000/', finalUrl:'http://localhost:4000/',
    elements:[
      { tag:'input', type:'text', testId:'username', selector:'[data-testid="username"]' },
      { tag:'input', type:'password', testId:'password', selector:'[data-testid="password"]' },
      { tag:'button', type:'submit', testId:'login-button', selector:'[data-testid="login-button"]', text:'Sign in' },
    ], messages:[],
  },
  {
    url:'http://localhost:4000/feedback', finalUrl:'http://localhost:4000/feedback',
    elements:[
      { tag:'input', type:'number', testId:'age', selector:'[data-testid="age"]' },
      { tag:'div', type:'div', testId:'age-error', selector:'[data-testid="age-error"]', text:'Age must be between 18 and 100.' },
      { tag:'div', type:'div', testId:'success-panel', selector:'[data-testid="success-panel"]', text:'Thank you for your feedback.' },
      { tag:'div', type:'div', testId:'feedback-reference', selector:'[data-testid="feedback-reference"]' },
    ], messages:[],
  },
];

function readiness(tc) {
  return classifyTestCase(tc, { pageDiscoveries: discoveries, hasCredentials: false });
}

const successText = readiness({
  id:'TC001', title:'Success text is business text', type:'positive', preconditions:[],
  steps:[{action:'navigate',target:'http://localhost:4000/feedback',value:null}],
  expectedResults:[
    'Element [data-testid="success-panel"] is visible',
    'Text in [data-testid="success-panel"] contains "Thank you for your feedback."',
  ],
});
assert.equal(successText.status, READY, successText.reason);

const identityText = readiness({
  id:'TC002', title:'Selector identity is not display text', type:'positive', preconditions:[],
  steps:[{action:'navigate',target:'http://localhost:4000/feedback',value:null}],
  expectedResults:['Text in [data-testid="success-panel"] contains "success-panel"'],
});
assert.notEqual(identityText.status, READY);
assert.equal(identityText.reasonCode, 'ASSERTION_TEXT_IDENTITY_CONFLICT');

const punctuation = readiness({
  id:'TC003', title:'Trailing punctuation value grammar', type:'negative', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/feedback',value:null},
    {action:'fill',target:'[data-testid="age"]',value:'17'},
  ],
  expectedResults:[
    'Element [data-testid="age-error"] is visible.',
    'Value of [data-testid="age"] equals "17".',
  ],
});
assert.equal(punctuation.status, READY, punctuation.reason);
assert(punctuation.automationPlan.assertions.some((item) => item.operation === 'ASSERT_VALUE_EQUALS' && item.value === '17'));

const verifyUrl = readiness({
  id:'TC004', title:'Verify URL includes feedback', type:'positive', preconditions:[],
  steps:[
    {action:'navigate',target:'http://localhost:4000/',value:null},
    {action:'verify',target:'URL',value:'includes "/feedback"'},
  ],
  expectedResults:['Element [data-testid="username"] exists'],
});
assert.equal(verifyUrl.status, READY, verifyUrl.reason);
assert(verifyUrl.automationPlan.assertions.some((item) => item.operation === 'ASSERT_URL_INCLUDES' && item.value === '/feedback'));

console.log('Readiness V13 regression smoke passed: selector quotes, sentence punctuation and verify URL syntax are normalized safely.');
