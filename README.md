# AI TestPilot — Real AI Automation Demo

AI TestPilot is a focused demonstration of **story-driven test automation**:

```text
Business user story
      ↓
Page discovery (real controls/selectors from the target pages)
      ↓
Qwen Test Analyst
      ↓
Structured test cases / use cases
      ↓
Human review and approval
      ↓
Qwen Automation Engineer
      ↓
Security + syntax validation
      ↓
Visible browser automation
      ↓
PASS / FAIL
      ↓
Qwen failure analysis
      ↓
HTML analytics report
```

There is **no database** in this demo. Test cases, results and the HTML report live only in the Node.js process for the current run. Restarting the backend clears them.

## Demo application

The target demo app runs at `http://localhost:4000` and contains two pages:

- `/` — login page
- `/feedback` — customer feedback form

Demo credentials:

```text
Username: admin
Password: admin123
```

The feedback API intentionally keeps two application defects so the automation has genuine failures to detect:

- age `17` is incorrectly accepted although the UI/specification says 18–100;
- a website such as `abc` is incorrectly accepted although the field requires a valid URL.

For the current five-case demonstration, once the real login and feedback controls are discovered, the demo calibrates the reviewed set to a predictable shape:

1. valid login + valid feedback submission — expected PASS;
2. invalid login credentials — expected PASS;
3. missing required email on the feedback form — expected PASS;
4. age `17` against the discovered minimum of `18` — expected FAIL because of the demo application defect;
5. malformed website value `abc` — expected FAIL because of the demo application defect.

The two failing checks are legitimate expected-behaviour tests. They fail because the demo target violates its own discovered constraints, not because the assertions are deliberately made incorrect. This calibration is only for the PoC/demo and should not be carried into the production test-generation policy.

## AI TestPilot UI

The testing UI runs at:

```text
http://localhost:5000
```

The user provides:

1. target URL;
2. optional **Known pages** hints, such as `/feedback`;
3. environment;
4. test username/password;
5. a business user story.

### Known pages are optional

The current discovery service always starts from the Target URL. In addition to explicitly supplied Known pages, it now performs a small bounded same-origin discovery pass over real page route hints such as links, form actions and simple root-relative routes found in the page source.

For this demo, the login page contains a real `/feedback` redirect hint. Therefore `/feedback` can still be discovered even when the **Known pages (optional)** box is blank.

This remains deliberately limited static discovery. It is not intended to replace the future browser-driven discovery agent for real React/Next/Vue/SPA applications.

Credentials are kept in the in-memory session and injected into the browser automation runtime at execution time. Their values are **not included in the Qwen prompt**. Generated automation reads `TEST_USERNAME` and `TEST_PASSWORD` from the secure runtime environment.

## Review and edit test cases

Qwen proposes the initial test set, but the tester can still control the final execution set before automation code is generated. A tester can:

- include or exclude generated cases;
- edit a generated case;
- delete a case;
- add a human-authored case;
- start a new case from Functional, Validation, Boundary, Negative or Blank templates.

The add/edit dialog explains the purpose of Functional, Positive, Negative, Boundary and Custom test types and provides starter preconditions, steps and expected results. Automation code is generated only from the final reviewed set.

## Real Qwen only

This branch deliberately removes the old hard-coded mock generators. Configure Alibaba Cloud Model Studio in your local `.env`:

```env
QWEN_API_KEY=your-new-key
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-flash
```

Never commit `.env`. It is already ignored by Git.

## Install

From the repository root:

```bash
npm install
```

Install the dedicated browser automation runtime:

```bash
cd automation-system
npm install
npm run engine:verify
cd ..
```

## Run

```bash
npm start
```

This starts:

```text
Demo target app: http://localhost:4000
AI TestPilot:    http://localhost:5000
```

## Suggested story

```text
As a customer, I should be able to log in with valid credentials and submit feedback.
Username and password are required. The feedback form must validate required fields,
email format, age boundaries, website URL format and show a confirmation after
successful submission.
```

Use these page settings in the UI:

```text
Target URL:             http://localhost:4000/
Known pages (optional): /feedback   # may also be left blank in this demo
Username:               admin
Password:               admin123
```

Click **Generate AI Test Cases**, review or modify the generated cases, then click **Run Approved Tests**. A real Chrome window opens automatically. The positive and validation cases now visibly continue onto the feedback form rather than stopping after login.

Each approved case is executed independently so every failed case can have its own video and failure screenshot.

## Important implementation details

### Page discovery

`server/services/pageDiscovery.js` inventories actual inputs, buttons, links, `data-testid` values, ids, names, constraints, dropdown options and nearby validation elements. It also performs a bounded same-origin pass over observed route hints so the current demo can find `/feedback` from the starting login page even without a manual Known pages entry.

### AI generation

`server/services/qwenClient.js` contains three prompts:

- Test Analyst — story + discovered pages → structured test cases;
- Automation Engineer — approved test case + discovered pages → executable JavaScript automation;
- Failure Analyst — runtime error + expected behaviour → business-readable classification.

For the current demo target only, a calibration layer pins the five reviewed cases to the predictable 3-pass / 2-defect-detection shape described above after the relevant real controls have been discovered.

### Generated-code safety

`server/services/scriptValidator.js` checks syntax, structure and denied patterns before execution. Generated specs cannot use `child_process`, `fs`, `eval`, `Function`, raw `process.env`, network modules or numeric fixed waits.

### Visible execution

`server/services/testRunner.js` launches the current browser automation engine using Chrome and headed mode by default. Configure locally if needed:

```env
AUTOMATION_BROWSER=chrome
AUTOMATION_HEADED=true
AUTOMATION_STEP_DELAY_MS=350
AUTOMATION_VIDEO=true
AUTOMATION_SCREENSHOT_ON_FAILURE=true
```

### Duration

The runner records duration per independent case. It first uses attempt-level timing when provided by the runtime and then falls back through other available test/spec timing fields. This keeps the Duration value populated when the engine exposes timing at a different level.

### Evidence

Each approved test case runs as an independent spec. Failed cases therefore receive dedicated evidence when available:

```text
TC004 FAIL
├── Video
└── Screenshot

TC005 FAIL
├── Video
└── Screenshot
```

### Analytics

`server/services/reportGenerator.js` builds a standalone HTML analytics page after the run. It includes totals, pass/fail rate, test-level duration, per-failure evidence links and Qwen failure analysis. The HTML is stored only in the current in-memory session and served from `/api/reports/:sessionId`.

## Production direction: Playwright

The intended production architecture is to use **Playwright for both browser discovery and test execution**. In that model, the user should normally provide only the starting URL, credentials and business story. A bounded Playwright discovery agent can navigate the real application, observe authenticated routes and controls, build the relevant journey, and remove the need for manually supplied Known pages in most cases.

Known pages can remain as an optional advanced hint or override for special routes that automated discovery cannot reach reliably.

## Project layout

```text
automation-intelligence/
├── automation-system/          Browser automation runtime, generated specs and evidence
├── testpilot-ui/               AI TestPilot browser UI
├── demo-app/                   Login + feedback target application
└── server/
    ├── data/sessionStore.js    In-memory run state
    ├── routes/chat.js          Story → AI → automation orchestration
    └── services/
        ├── pageDiscovery.js
        ├── qwenClient.js
        ├── reportGenerator.js
        ├── scriptValidator.js
        └── testRunner.js
```

## Security note

This is a controlled demo, not a production remote-browser service. Before allowing arbitrary external targets, add a target-domain allowlist, authentication/authorization for AI TestPilot itself, network isolation, secret management and stronger sandboxing for generated automation.
