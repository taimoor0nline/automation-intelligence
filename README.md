# AI TestPilot — PoC

AI-driven test automation platform. A business user describes what to test in a **chat window** — the system discovers the target page, generates structured test cases with AI, requires human approval, generates a real **Cypress** suite, executes it, and explains failures in plain business language.

```
Chat message (URL + requirement)
        │
        ▼
  Page Discovery            (Cypress-style DOM inventory: labels, data-testid, roles)
        │
        ▼
  Qwen — Test Analyst       (Story + Page Discovery → 15–25 structured test cases)
        │
        ▼
  Human Approval            (via chat: "approve all" / "approve TC001,TC009" / "reject TC004")
        │
        ▼
  Qwen — Automation Engineer  (Approved cases → real Cypress JavaScript)
        │
        ▼
  Script Validation         (syntax + security deny-list + allowed-imports check)
        │
        ▼
  Cypress Execution         (headless run against the target app)
        │
        ▼
  PASS / FAIL + Evidence
        │
        ▼
  Qwen — Failure Analyst    (business-readable root-cause explanation per failure)
```

This mirrors the architecture in `AI-Driven_Playwright_Test_Automation.pdf`, adapted to **Cypress** instead of Playwright per your request, and to a **chat-first interface** instead of a dashboard.

## What's included

| Folder | Purpose |
|---|---|
| `demo-app/` | The target application under test — a "Customer Feedback Form" built to spec, with 2 intentional bugs for the demo |
| `server/` | The AI TestPilot backend — page discovery, Qwen client, chat pipeline, script validator, test runner |
| `chat-ui/` | Minimal chat interface (no dashboard) |
| `automation/` | The Cypress project. Generated specs land in `automation/cypress/e2e/generated/` |

## Quick start

```bash
npm install
cp .env
npm start
```

This starts:
- Demo Feedback Form → `http://localhost:4000/feedback`
- AI TestPilot chat → `http://localhost:5000`

Open `http://localhost:5000` and type, for example:

> Please test http://localhost:4000/feedback, do the validation checks like email, web url, and name validation upon submit.

Then reply `approve all` (or `approve TC001,TC009` for a subset).

## Running the generated Cypress suite

The chat backend writes the generated spec into `automation/` and attempts to execute it automatically. First time, install the Cypress binary:

```bash
cd automation
npm install
npx cypress install
npx cypress run --spec cypress/e2e/generated/customer-feedback.cy.js
```

> **Note:** Cypress needs to download its test-runner binary from `download.cypress.io` on first install. If you're running this behind a restrictive firewall/proxy, allowlist that domain or set `CYPRESS_INSTALL_BINARY` to an internal mirror.

### The two intentional defects

To prove the platform actually *finds* bugs, not just runs scripts, the demo form has two seeded defects:

1. **Age validation** — `17` is incorrectly accepted (spec requires 18–100).
2. **Website URL validation** — `abc` is incorrectly accepted as a valid URL.

`TC009` and `TC014` in the generated suite will **fail** against these, and the Failure Analyst step will explain both as `APPLICATION_DEFECT` in plain language.

## Real Qwen vs. mock mode

By default, the platform runs in **mock mode** — deterministic, realistic responses standing in for the three Qwen calls (Test Analyst, Automation Engineer, Failure Analyst), so the entire pipeline is demoable with zero API cost or setup.

To use real Qwen (Alibaba Cloud Model Studio), set in `.env`:

```
QWEN_API_KEY=your-key
QWEN_BASE_URL=https://your-model-studio-endpoint
QWEN_MODEL=qwen3.7-plus
```

No code changes needed — `server/services/qwenClient.js` switches automatically based on whether these are set. All three prompts (`TEST_ANALYST_V1`, `PLAYWRIGHT_GENERATOR_V1`, `FAILURE_ANALYST_V1`) are versioned in that file per the spec's audit requirement.

## Security

- Generated code is never executed blindly — `server/services/scriptValidator.js` runs syntax, deny-list (`child_process`, `eval`, `fs.readFile`, etc.), and allowed-import checks before anything reaches the Cypress runner.
- No credentials are ever sent to Qwen; test data uses placeholders only.
- The Qwen API key is never exposed to the frontend — all calls happen server-side in `server/services/qwenClient.js`.

## What's deliberately out of scope for this PoC

Per the spec: production-environment testing, CAPTCHA, payment gateways, multi-factor auth, and file-based test execution are not included in Phase 1. A domain allowlist for Page Discovery should be added before pointing this at anything beyond controlled UAT/test environments.

## Pushing to your own Git

```bash
git init
git add .
git commit -m "AI TestPilot PoC — chat-driven Cypress automation"
git remote add origin <your-repo-url>
git push -u origin main
```
