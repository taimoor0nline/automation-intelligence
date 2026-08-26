(function () {
  const TOKEN_KEY = 'aiTestPilotToken';
  const SENSITIVE_HEADER = /^(authorization|proxy-authorization|x-api-key|api-key)$/i;
  const $ = (id) => document.getElementById(id);

  function authHeaders(extra = {}) {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  async function api(url, init = {}) {
    const response = await fetch(url, { ...init, headers: authHeaders(init.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.reply || `Request failed (${response.status})`);
    return data;
  }

  function parseObject(id, label) {
    const raw = String($(id)?.value || '').trim();
    if (!raw) return {};
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error(`${label} must be valid JSON.`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
    return parsed;
  }

  function parseBody() {
    const raw = String($('manualBody')?.value || '').trim();
    if (!raw) return { supplied: false, value: null };
    try { return { supplied: true, value: JSON.parse(raw) }; }
    catch { throw new Error('Request body must be valid JSON.'); }
  }

  function validateHeaders(headers) {
    for (const name of Object.keys(headers)) {
      if (SENSITIVE_HEADER.test(name)) {
        throw new Error(`${name} is authentication-sensitive. Use Runtime authentication instead of saving it in the endpoint template.`);
      }
    }
  }

  function injectFields() {
    const button = $('addOperation');
    if (!button || $('manualHeaders')) return;
    const section = button.closest('.section');
    if (!section) return;

    const box = document.createElement('div');
    box.innerHTML = `
      <div class="field">
        <label>Headers (JSON)</label>
        <textarea id="manualHeaders" spellcheck="false" placeholder='{"Accept":"application/json","X-Tenant-Id":"tenant-01"}'></textarea>
        <div class="sub">Ordinary request headers only. Authorization/API-key secrets stay in Runtime authentication.</div>
      </div>
      <div class="two">
        <div class="field">
          <label>Query parameters (JSON)</label>
          <textarea id="manualQuery" spellcheck="false" placeholder='{"page":1,"pageSize":20}'></textarea>
        </div>
        <div class="field">
          <label>Path parameters (JSON)</label>
          <textarea id="manualPathParams" spellcheck="false" placeholder='{"id":"123"}'></textarea>
        </div>
      </div>
      <div class="field">
        <label>Request body (JSON)</label>
        <textarea id="manualBody" spellcheck="false" placeholder='{"name":"Example customer","email":"qa@example.com"}'></textarea>
        <div class="sub">This is the grounded baseline body. AI may vary it only when the requirement or schema supports that test scenario.</div>
      </div>`;
    section.insertBefore(box, button);

    const style = document.createElement('style');
    style.textContent = '#manualHeaders,#manualQuery,#manualPathParams,#manualBody{min-height:76px;font:10.5px Consolas,monospace}';
    document.head.appendChild(style);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = $('manualStatus');
      try {
        if (status) { status.textContent = 'Saving endpoint request template…'; status.className = 'status'; }
        const targetId = $('target')?.value || '';
        if (!targetId) throw new Error('Select or create a REST target first.');
        const method = $('manualMethod')?.value || 'GET';
        const path = String($('manualPath')?.value || '').trim();
        if (!path) throw new Error('Endpoint path is required.');
        const headers = parseObject('manualHeaders', 'Headers');
        const query = parseObject('manualQuery', 'Query parameters');
        const pathParams = parseObject('manualPathParams', 'Path parameters');
        validateHeaders(headers);
        const body = parseBody();
        const payload = {
          method,
          path,
          summary: String($('manualSummary')?.value || '').trim(),
          headers,
          query,
          pathParams,
        };
        if (body.supplied) payload.body = body.value;
        await api(`/api/rest-targets/${encodeURIComponent(targetId)}/operations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (status) { status.textContent = 'Endpoint and request template saved.'; status.className = 'status ok'; }
        ['manualPath','manualSummary','manualHeaders','manualQuery','manualPathParams','manualBody'].forEach((id) => { if ($(id)) $(id).value = ''; });
        $('target')?.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) {
        if (status) { status.textContent = err.message; status.className = 'status bad'; }
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFields);
  else injectFields();
})();
