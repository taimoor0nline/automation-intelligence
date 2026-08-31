# TestNexus Page Scope and Test Page Context

Web UI generation supports two discovery/testing scopes.

## All discovered pages

`ALL_DISCOVERED_PAGES` is the default and preserves the existing behavior.

TestNexus starts from the Target URL, includes any configured Known pages, and may follow same-origin route hints discovered from links/forms/scripts up to the platform discovery limit. The resulting discovered pages are the only pages exposed to the coverage planner, Canonical Element Registry and AI Canonical IR generator.

## Starting page only

`STARTING_PAGE_ONLY` is a hard discovery boundary.

Only the Target URL is fetched and registered. Known pages and automatically discovered same-origin route hints are not crawled. Planning and Canonical IR therefore cannot target controls that exist only on another page.

If the business story explicitly requires behavior that is not evidenced on the starting page, the normal story/discovery compatibility gate may reject the request instead of silently expanding the scope.

## UI behavior

The journey form order is:

```text
Environment
AI quality profile
Target URL
Known pages
Page scope
Application login
Test users & workflow
Business user story
...
```

When Starting page only is selected, the Known pages input is disabled but its current value is preserved in the browser so it can be restored by switching back to All discovered pages.

## Page URL on test cases

Each Web UI test card displays its page context.

TestNexus derives page URLs from explicit Canonical IR navigation operations and exact path/URL assertions. A multi-page workflow can therefore show multiple URLs. If a test contains no explicit navigation operation, the Target URL is displayed as the fallback page context.

Automation Details displays the same Page URL/Page URLs section above the Canonical Plan/Cypress projection.

## Security and determinism

Page scope is sent as structured request metadata and is also enforced in the server discovery layer using the asynchronous generation context. It is not merely a client-side filter.

The effective page scope is recorded on the active session and on page-discovery artifacts. This works with both `DATABASE_ENABLED=false` and `DATABASE_ENABLED=true`.

## Regression

Run:

```bash
npm run test:page-scope
```

The regression starts two local same-origin pages. It verifies that Starting page only returns exactly one page and All discovered pages follows the linked second page. It also checks the UI request/page-context integration.
