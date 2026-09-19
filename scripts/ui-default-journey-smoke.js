const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'testpilot-ui', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

assert(
  /id="targetUrl" value="https:\/\/academy\.demoibsservices\.com"/.test(html),
  'The customer-facing Target URL must default to the Academy demo URL.'
);
assert(
  /<textarea id="story">As a user, test public pages, including the login and forgot-password pages, using negative testing only\.<\/textarea>/.test(html),
  'The default Business Story must focus on public login and forgot-password negative testing.'
);
assert(
  !server.includes('.replace("id=\\"targetUrl\\"'),
  'The served UI should not override the default Target URL with a hard-coded replacement.'
);

console.log('ui-default-journey-smoke: PASS');
