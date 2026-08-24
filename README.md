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
Qwen Cypress Engineer
      ↓
Security + syntax validation
      ↓
Cypress 15 in visible Chrome
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

The feedback API intentionally keeps two demo defects so the automation has genuine failures to detect:

- age `17` is incorrectly accepted although the UI/specification says 18–100;
- a website such as `abc` is incorrectly accepted by the server validation.

## AI TestPilot UI

The testing UI runs at:

```text
http://localhost:5000
```

The user provides:

1. target URL;
2. optional additional page paths, such as `/feedback`;
3. environment;
4. test username/password;
5. a business user story.

Credentials are kept in the in-memory session and injected into Cypress at execution time. Their values are **not included in the Qwen prompt**. Generated Cypress is instructed to read `TEST_USERNAME` and `TEST_PASSWORD` using Cypress `cy.env()`.

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

Install Cypress in its dedicated automation project:

```bash
cd automation
npm install
npx cypress verify
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
Target URL:            http://localhost:4000/
Additional page paths: /feedback
Username:              admin
Password:              admin123
```

Click **Generate AI Test Cases**, review the Qwen-generated cases, then click **Run Approved Tests**. Cypress launches a real Chrome window automatically. When execution finishes, the UI shows pass/fail results and exposes **Open HTML Analytics Report**.

## Important implementation details

### Page discovery

`server/services/pageDiscovery.js` fetches the selected pages and inventories actual inputs, buttons, links, `data-testid` values, ids, names, constraints, dropdown options and nearby validation elements. Qwen receives this inventory so it does not need to guess selectors from the story alone.

### AI generation

`server/services/qwenClient.js` contains three prompts:

- Test Analyst — story + discovered pages → structured test cases;
- Cypress Engineer — approved test cases + discovered pages → Cypress JavaScript;
- Failure Analyst — Cypress error + expected behaviour → business-readable classification.

### Generated-code safety

`server/services/scriptValidator.js` checks syntax, structure and denied patterns before execution. Generated specs cannot use `child_process`, `fs`, `eval`, `Function`, raw `process.env`, network modules or numeric fixed waits.

### Visible execution

`server/services/testRunner.js` launches Cypress through the Node API using Chrome and headed mode by default. Configure locally if needed:

```env
CYPRESS_BROWSER=chrome
CYPRESS_HEADED=true
```

### Analytics

`server/services/reportGenerator.js` builds a standalone HTML analytics page after the run. It includes totals, pass/fail rate, test-level results and Qwen failure analysis. The HTML is stored only in the current in-memory session and served from `/api/reports/:sessionId`.

## Project layout

```text
automation-intelligence/
├── automation/                 Cypress project and generated specs
├── chat-ui/                    AI TestPilot browser UI
├── demo-app/                   Login + feedback target application
└── server/
    ├── data/sessionStore.js    In-memory run state
    ├── routes/chat.js          Story → AI → Cypress orchestration
    └── services/
        ├── pageDiscovery.js
        ├── qwenClient.js
        ├── reportGenerator.js
        ├── scriptValidator.js
        └── testRunner.js
```

## Security note

This is a controlled demo, not a production remote-browser service. Before allowing arbitrary external targets, add a target-domain allowlist, authentication/authorization for AI TestPilot itself, network isolation, secret management and stronger sandboxing for generated automation.
