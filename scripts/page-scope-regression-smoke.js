const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const requestContext = require('../server/services/requestContext');
const { discoverPages } = require('../server/services/pageDiscovery');

async function withScope(pageScope, fn) {
  return new Promise((resolve, reject) => {
    const req = {
      body: { sessionId: `page-scope-${Date.now()}-${Math.random()}`, pageScope },
      params: {},
      query: {},
      headers: {},
      user: null,
    };
    requestContext.middleware(req, {}, () => {
      Promise.resolve().then(fn).then(resolve, reject);
    });
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url.startsWith('/second')) {
      res.end('<!doctype html><html><head><title>Second</title></head><body><input data-testid="second-field"><a href="/">Home</a></body></html>');
      return;
    }
    res.end('<!doctype html><html><head><title>Start</title></head><body><input data-testid="start-field"><a href="/second">Second page</a></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const startUrl = `http://127.0.0.1:${address.port}/`;

  try {
    const starting = await withScope('STARTING_PAGE_ONLY', () => discoverPages([startUrl]));
    assert.strictEqual(starting.length, 1, 'Starting-page scope must return exactly one page.');
    assert.strictEqual(starting[0].isStartingPage, true);
    assert.strictEqual(starting[0].discoveryScope, 'STARTING_PAGE_ONLY');
    assert.ok(starting[0].elements.some((item) => item.testId === 'start-field'));
    assert.ok(!starting.some((page) => String(page.finalUrl || page.url).includes('/second')));

    const all = await withScope('ALL_DISCOVERED_PAGES', () => discoverPages([startUrl]));
    assert.ok(all.length >= 2, 'All-discovered scope must follow the same-origin page hint.');
    assert.strictEqual(all[0].discoveryScope, 'ALL_DISCOVERED_PAGES');
    assert.ok(all.some((page) => String(page.finalUrl || page.url).includes('/second')));

    const ui = fs.readFileSync(path.join(__dirname, '..', 'testpilot-ui', 'page-scope.js'), 'utf8');
    assert.ok(ui.includes('STARTING_PAGE_ONLY'));
    assert.ok(ui.includes('ALL_DISCOVERED_PAGES'));
    assert.ok(ui.includes('payload.pageScope = pageScope'));

    const pageContext = fs.readFileSync(path.join(__dirname, '..', 'testpilot-ui', 'test-case-page-context.js'), 'utf8');
    assert.ok(pageContext.includes('Page URL'));
    assert.ok(pageContext.includes("operation || '').toUpperCase() === 'NAVIGATE'"));

    console.log('page-scope-regression-smoke: PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('page-scope-regression-smoke: FAIL');
  console.error(err);
  process.exitCode = 1;
});
