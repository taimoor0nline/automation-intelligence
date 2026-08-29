# TestNexus Advanced Capability Adapter

TestNexus keeps Cypress as the primary deterministic web runner. Capabilities that require a different runtime or an external system use one server-side adapter contract instead of embedding provider credentials or arbitrary code in generated tests.

## Endpoint

Configure:

```env
AUTOMATION_EXTERNAL_ADAPTER_URL=https://adapter.example.test
AUTOMATION_EXTERNAL_ADAPTER_TOKEN=server-side-secret
AUTOMATION_EXTERNAL_CAPABILITIES=EMAIL_SMS_OTP,CROSS_ORIGIN_IFRAME,REAL_MULTI_TAB,CAPTCHA_BIOMETRIC,NATIVE_MOBILE,BROWSER_EXTENSION,OS_DIALOG
```

TestNexus calls:

```text
POST {AUTOMATION_EXTERNAL_ADAPTER_URL}/capabilities/{capability-lowercase}
Authorization: Bearer <token>     # when configured
Content-Type: application/json
```

Request:

```json
{
  "capability": "REAL_MULTI_TAB",
  "action": "assert",
  "payload": {
    "expectation": "The new tab displays the receipt"
  }
}
```

Successful response:

```json
{
  "ok": true,
  "evidence": {
    "message": "Receipt tab verified"
  }
}
```

Failure response should use a non-2xx HTTP status or `{"ok":false}` with a safe `message`/`error` field. Secrets must never be returned.

## Supported adapter capability keys

| Capability | Intended adapter |
| --- | --- |
| `EMAIL_SMS_OTP` | Controlled mailbox, SMS provider or OTP test inbox |
| `CROSS_ORIGIN_IFRAME` | Browser adapter capable of true cross-origin frame context |
| `REAL_MULTI_TAB` | Browser adapter capable of multiple page/window contexts |
| `CAPTCHA_BIOMETRIC` | Vendor-supported non-production bypass/test harness only |
| `NATIVE_MOBILE` | Appium/native-device adapter |
| `BROWSER_EXTENSION` | Extension-enabled browser adapter |
| `OS_DIALOG` | Desktop/OS automation adapter |

## Readiness behavior

A test that requires one of these capabilities is **not Automation Ready** unless `AUTOMATION_EXTERNAL_ADAPTER_URL` is set and, when `AUTOMATION_EXTERNAL_CAPABILITIES` is non-empty, the requested capability is allow-listed.

This is intentional: TestNexus must not claim deterministic support and then fail only after execution starts.

## Security challenge policy

`CAPTCHA_BIOMETRIC` does **not** mean defeating a real production CAPTCHA or biometric control. The adapter must use a vendor-supported test key, non-production bypass, simulator, mocked biometric response, or other explicitly approved test mechanism.

## Database assertions

Database assertions do not use the generic external adapter. They have a stricter built-in named-query adapter:

```env
AUTOMATION_DB_ASSERTIONS_ENABLED=true
AUTOMATION_DB_ASSERTION_URL=postgresql://...
AUTOMATION_DB_ASSERTION_QUERIES_JSON={"feedback_created":"SELECT status FROM feedback WHERE id=$1"}
```

Only named `SELECT`/`WITH` statements are accepted. Mutating SQL and arbitrary model-generated SQL are rejected.

## Direct browser capabilities

The following do not need this adapter: visual PNG baselines, LCP/CLS/INP observation, web file upload fixtures, drag/drop, WebSocket/SSE observation, permission-state simulation, clipboard observation, and PDF/DOCX/XLS/XLSX/PPTX downloaded-content extraction.
