# TestNexus HTML/browser capability matrix

This document is the engineering truth for the generic Web testing engine. AI is not allowed to infer a capability from a tag name alone. Rendered discovery creates a canonical element registry, and the exact `capabilities[]` on each `elementRef` is authoritative.

Status terminology:

- **READY** — modeled through discovery/registry, deterministic contract, compiler and executable browser emitter. A capability-lab case exists where practical.
- **OBSERVE** — deterministic observation/assertion is supported, but there is no specialized mutation/action.
- **PARTIAL** — useful generic behavior exists, but important application patterns need more work.
- **ADAPTER** — intentionally requires an explicit configured integration rather than guessing/bypassing browser or security boundaries.
- **NOT YET** — no generic deterministic contract today.

> The HTML capability workflow runs the deterministic contracts and browser labs on the active capability branch and on `main`. Do not promote a capability while this gate is red.

## Native input and form controls

| Surface | Status | Current deterministic capability |
|---|---|---|
| `<input>` missing type | READY | Browser/default text semantics; TYPE, CLEAR, value/state assertions |
| text | READY | TYPE, CLEAR, focus/blur/key, value/validity/metadata assertions |
| password | READY | TYPE/CLEAR; runtime credential helper available |
| email | READY | TYPE/CLEAR + HTML validity |
| search | READY | TYPE/CLEAR; semantic suggestions supported when a datalist/listbox relationship is rendered |
| tel | READY | TYPE/CLEAR |
| url | READY | TYPE/CLEAR + validity |
| number | READY | TYPE/CLEAR; finite numeric syntax + min/max metadata |
| date | READY | TYPE/CLEAR; real `YYYY-MM-DD` calendar-date validation |
| datetime-local | READY | TYPE/CLEAR; deterministic local date/time syntax |
| month | READY | TYPE/CLEAR; `YYYY-MM` validation |
| week | READY | TYPE/CLEAR; `YYYY-Www` validation |
| time | READY | TYPE/CLEAR; 24-hour time validation |
| range | READY | `SET_RANGE_VALUE` via native value setter + `input`/`change`; min/max/step enforced |
| color | READY | `SET_COLOR_VALUE` via native value setter + `input`/`change`; exact `#RRGGBB` validation |
| checkbox | READY | CHECK + UNCHECK + state assertions |
| radio | READY | CHECK; radio is deliberately not advertised as UNCHECK |
| hidden | READY/OBSERVE | Exists/value/attribute observation; interaction capabilities are stripped |
| file | READY | approved fixture `SELECT_FILE`; `accept` contract enforced |
| file multiple | READY | `SELECT_FILES`; `multiple=true`, fixture inventory and accept enforced |
| image-only upload | READY | image fixture and `accept=image/*` contract enforced |
| button/submit/reset/image input | READY | click/submit behavior when rendered semantics prove it; form reset works as browser action |
| textarea | READY | TYPE/CLEAR/value/validity |
| contenteditable | READY | TYPE/CLEAR + text/HTML assertions; deliberately **not** a form VALUE capability |
| native single `<select>` | READY | SELECT only discovered enabled option values |
| native `<select multiple>` | READY | `SELECT_MULTIPLE` + exact `ASSERT_SELECTED_VALUES_EQUALS` |
| disabled `<option>` | READY | selection is blocked by deterministic contract |
| disabled `<optgroup>` inheritance | READY | rendered discovery records effective inherited disabled state |
| native datalist input | READY/PARTIAL | datalist values are grounded and searchable; browser-owned suggestion popup is intentionally not treated as a custom listbox click surface |

## Searchable dropdowns, autocomplete and suggestions

| Surface | Status | Current deterministic capability |
|---|---|---|
| search box with semantic suggestions | READY | `SEARCH_SUGGESTIONS`, clear query, exact grounded option assertions/selection when a rendered listbox is related |
| searchable single-select dropdown | READY | open/close, search, select one exact grounded suggestion, expanded/collapsed assertions |
| searchable multi-select dropdown | READY | search/select multiple exact grounded options when `aria-multiselectable=true` is rendered |
| async/server-backed suggestions | READY with explicit data | search can wait for delayed rendered options; a not-yet-rendered option must come from the user story/approved test data, never AI invention |
| no-results state | READY | exact no-suggestion assertion against the associated listbox |
| keyboard Enter selection | READY | browser-lab coverage for selecting the first filtered suggestion |
| Escape/collapse | READY | semantic collapsed state is verified |
| ARIA combobox/listbox/option relationships | READY | `aria-controls`, `aria-owns`, `aria-autocomplete`, `aria-activedescendant`, `aria-multiselectable`, `aria-selected` captured |
| selected-option state | READY | `aria-selected=true` assertion on associated listbox options |
| exact selected multi-option vector | READY | `ASSERT_SELECTED_SUGGESTIONS_EQUALS` |
| chips/tags rendered after multi-select | OBSERVE/READY via normal elements | chips are discoverable/assertable; dedicated remove-chip/clear-all actions are a remaining refinement |
| virtualized listbox | PARTIAL | search-driven selection works when the requested option is rendered after the query; generic bounded scroll-through virtualization remains backlog |
| framework-specific widgets | READY when semantic | no library-specific selector contract; React/Vue/Angular/Select2/MUI/Ant-style widgets work when rendered semantics expose a deterministic editable control + listbox/options relation |

### Anti-invention rules for suggestions

For suggestion/dropdown generation, AI may use an option/value only when it is supported by at least one of these sources:

1. a suggestion rendered during discovery;
2. explicit user-authored story/requirement text;
3. approved test data;
4. a deterministic substring/prefix used only to search for a grounded final option.

AI-provided labels, CSS classes, likely country/customer names, or invented search results are never treated as evidence. If a dynamic option is unknown until runtime and was not explicitly supplied by the user, the case remains blocked/repairable.

## Content, semantics and element state

| Surface | Status | Current deterministic capability |
|---|---|---|
| h1-h6 | READY | text/HTML/visibility/attribute/layout assertions + heading semantic tag |
| p | READY | text/HTML/visibility/attribute/layout assertions |
| div/span/section/article/main/nav/header/footer/aside | READY/OBSERVE | meaningful rendered content is discoverable; interaction only when click/focus/role evidence exists |
| links | READY | click, href/attributes and discovered same-origin navigation grounding |
| label/fieldset/legend | OBSERVE | text/attribute/form-group evidence |
| list/li/dl/dt/dd | READY/OBSERVE | content and collection assertions |
| table/thead/tbody/tfoot/tr/th/td | READY/OBSERVE | content, attributes, collection/count/layout assertions |
| details/summary | READY | generic click + open attribute/visibility assertions |
| dialog | READY/PARTIAL | rendered dialog/button click and open/visibility assertions; no dedicated DIALOG_OPEN operation is required today |
| progress/meter/output | OBSERVE | value/property/text/attribute assertions; no specialized mutation API |
| image | READY | loaded/natural-size + non-empty alt + ordinary attribute/layout assertions |
| picture | OBSERVE | generic content/attributes; actual img child carries image-loaded semantics |
| canvas | OBSERVE | existence/layout/attributes and visual-regression screenshot; no semantic pixel/drawing API |
| audio/video | PARTIAL | readyState/duration metadata is discovered; specialized play/pause/currentTime actions/assertions are not yet modeled |
| object/embed | OBSERVE | generic existence/attribute/layout only |
| iframe same-origin content | PARTIAL | iframe element is discoverable; recursive inner-document capability mapping is not yet generic |

## Interaction capabilities

| Capability | Status | Notes |
|---|---|---|
| click/double-click/right-click | READY | only when rendered semantics/capability permits |
| hover | READY | deterministic hover surface |
| focus/blur | READY | focusable rendered elements only |
| scroll into view | READY | discovered element only |
| keyboard Enter/Escape/arrows/Home/End/Backspace/Delete | READY/PARTIAL | deterministic special-key support; Tab/modifier/native-key coverage remains a refinement |
| native HTML5 element drag/drop | READY | draggable source + evidenced drop target + DataTransfer |
| file drag/drop | READY/PARTIAL | real file drag/drop on evidenced file-drop targets; modern delegated drop zones without explicit evidence may be conservatively rejected |
| pointer/mouse sortable drag | PARTIAL | HTML5 DnD is not equivalent to pointer-driven sortable-library interaction |
| touch/swipe/pinch/long-press | NOT YET | needs separate pointer/touch action model |
| open Shadow DOM | READY | execution and discovery cover open roots while avoiding brittle structural shadow selectors |
| closed Shadow DOM | NOT YET | cannot be generically inspected without application-specific instrumentation |

## Assertions and browser state

The deterministic assertion catalog covers element existence/visibility/layout, text/HTML, form values and state, checked state, native selected values, semantic suggestion/listbox state, required/readonly/validity, attributes/properties/classes/CSS/ARIA, collection counts, URL/path/query/hash/origin/host/protocol, title/document language/meta, cookies, localStorage/sessionStorage, network request/response observations, accessibility violations, downloads, console/runtime errors, window-open observations, page timing/resource limits, viewport, visual regression, Web Vitals, database named-query assertions, WebSocket/SSE messages, clipboard writes, downloaded-document content extraction and deterministic browser permission state.

## Advanced configured capabilities

| Capability | Status |
|---|---|
| LCP / CLS / INP | READY when the requested threshold is explicitly grounded/configured |
| visual regression | READY when a baseline exists or approved create-missing mode is enabled |
| database assertions | READY when read-only named queries are configured |
| downloaded PDF/DOCX/XLS/XLSX/PPTX/text extraction | READY via configured runtime tasks |
| WebSocket/SSE observation | READY |
| clipboard write observation | READY |
| browser permission-state simulation | READY |
| email/SMS/OTP | ADAPTER |
| cross-origin iframe / SSO | ADAPTER |
| real multi-tab workflow | ADAPTER |
| CAPTCHA / biometric test flow | ADAPTER; non-production/vendor-supported test integration only |
| native mobile | ADAPTER |
| browser extension | ADAPTER |
| OS-native dialog | ADAPTER |

## Remaining capability backlog

The meaningful generic gaps are now: chip/tag remove and clear-all as dedicated semantic actions; bounded scrolling for virtualized listboxes without search; richer evidence for framework/delegated file-drop zones; Tab/modifier/native-key coverage; pointer/touch drag and gestures; recursive same-origin iframe discovery; specialized media actions/assertions; dedicated popover/dialog semantics where they add value; checkbox `indeterminate`; first-class JavaScript alert/confirm/prompt handling; and any closed-shadow/cross-origin/native-device case that inherently needs instrumentation or an adapter.

## Local verification

Start the capability target in terminal A:

```bash
npm run start:demo-app
```

Open `http://localhost:4000/capabilities.html` if you want to inspect the target controls manually.

In terminal B, verify deterministic contracts first:

```bash
npm run test:html-native-controls
npm run test:html-capability-contract
npm run test:searchable-suggestions
npm run test:capabilities
```

Then run browser labs:

```bash
npm run test:html-capability-lab
npm run test:searchable-suggestions-lab
```

The native lab contains `CAP001`–`CAP043`. The searchable-suggestion lab contains `CAP044`–`CAP053` covering search suggestions, searchable single select, searchable multi-select, async suggestions, no-results, Enter selection, Escape collapse and semantic ARIA relationships.

A failure name identifies the exact capability that needs investigation. Do not weaken a validator merely to make a lab test pass; fix the deterministic contract or mark the capability PARTIAL/NOT YET.
