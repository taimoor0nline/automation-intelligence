const assert = require('assert');
const { validateStoryDiscoveryCompatibility } = require('../server/services/storyDiscoveryCompatibility');

const googleLike = [{
  url: 'https://www.google.com/',
  finalUrl: 'https://www.google.com/',
  pageTitle: 'Google',
  elements: [
    { tag: 'textarea', name: 'q', selector: '[name="q"]', label: 'Search' },
    { tag: 'input', type: 'submit', name: 'btnK', selector: '[name="btnK"]', label: 'Google Search' },
  ],
  messages: [],
}];

const feedbackStory = 'As a customer, I should be able to log in with valid credentials and submit feedback. Username and password are required. The feedback form must validate required fields, email format, age boundaries, website URL format and show a confirmation after successful submission.';
const mismatch = validateStoryDiscoveryCompatibility(feedbackStory, googleLike);
assert.strictEqual(mismatch.compatible, false, 'feedback/login story must not be mapped onto a Google-like search page');
assert.ok(mismatch.missingConcepts.includes('login/authentication'));
assert.ok(mismatch.missingConcepts.includes('feedback form'));

const searchStory = 'As a visitor, I should be able to search using the search field and submit a query.';
const compatible = validateStoryDiscoveryCompatibility(searchStory, googleLike);
assert.strictEqual(compatible.compatible, true, 'search story should remain compatible with search discovery evidence');

console.log('story-discovery-compatibility-smoke: PASS');
