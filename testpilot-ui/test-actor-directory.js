(function () {
  if (window.__testNexusActorDirectoryUi) return;
  window.__testNexusActorDirectoryUi = true;

  const MAX_ACTIVE = 12;
  let pendingFile = null;
  let pendingPreview = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }

  function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = sessionStorage.getItem('aiTestPilotToken') || '';
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  function ensureDirectorySessionId() {
    if (!window.__testNexusActorDirectorySessionId) {
      window.__testNexusActorDirectorySessionId = `actor-dir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    return window.__testNexusActorDirectorySessionId;
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  async function filePayload(file) {
    if (!file) throw new Error('Choose a CSV or XLSX file.');
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('Only .csv and .xlsx files are supported.');
    if (file.size > 700 * 1024) throw new Error('Actor import files are limited to 700 KB in the browser upload path. This comfortably supports the 500-actor directory limit.');
    return { fileName: file.name, contentBase64: toBase64(await file.arrayBuffer()) };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.reply || `Request failed (${response.status}).`);
      error.body = body;
      throw error;
    }
    return body;
  }

  function downloadTemplate() {
    const csv = [
      'actorRef,role,displayName,username,password,description,enabled,active',
      ',Requester,Requester,requester.qa,ChangeMe123!,Creates requests,true,true',
      ',Manager,Manager,manager.qa,ChangeMe123!,Reviews requests,true,true',
      ',Approver,Approver,approver.qa,ChangeMe123!,Approves requests,true,true',
      ',Manager,Backup Manager,manager.backup.qa,ChangeMe123!,Backup manager account,true,false',
    ].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'testnexus-test-actors-template.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function selectedPreviewRefs(container) {
    return [...container.querySelectorAll('input[data-import-actor-ref]:checked')]
      .map((input) => input.dataset.importActorRef)
      .filter(Boolean);
  }

  function enforceActiveLimit(container, changed) {
    const selected = selectedPreviewRefs(container);
    if (selected.length <= MAX_ACTIVE) return;
    if (changed) changed.checked = false;
    const status = container.querySelector('[data-import-selection-status]');
    if (status) status.textContent = `Choose at most ${MAX_ACTIVE} active actors for one scenario.`;
  }

  function renderPreview(container, preview) {
    pendingPreview = preview;
    const selected = new Set(preview.suggestedActiveRefs || []);
    const summary = preview.summary || {};
    const rows = preview.rows || [];
    container.innerHTML = `
      <div class="actor-import-summary">
        <strong>${esc(preview.fileName)}</strong>
        <span>${summary.validRows || 0} valid</span>
        <span>${summary.invalidRows || 0} invalid</span>
        <span>${summary.warnings || 0} warning${Number(summary.warnings || 0) === 1 ? '' : 's'}</span>
        ${preview.sheetName ? `<span>Sheet: ${esc(preview.sheetName)}</span>` : ''}
      </div>
      <div class="actor-import-note">Select the accounts that AI may use in this scenario. The full valid directory is imported; only the selected actors (maximum ${MAX_ACTIVE}) are exposed to Canonical IR. Passwords are never returned in this preview.</div>
      <div class="actor-import-table-wrap"><table class="actor-import-table">
        <thead><tr><th>Use</th><th>Row</th><th>Role / actor</th><th>Username</th><th>Status</th></tr></thead>
        <tbody>${rows.map((row) => {
          const canUse = row.valid && row.enabled;
          const checked = canUse && selected.has(row.actorRef);
          const issues = [...(row.errors || []), ...(row.warnings || [])];
          return `<tr class="${row.valid ? '' : 'invalid'}">
            <td><input type="checkbox" data-import-actor-ref="${esc(row.actorRef)}" ${checked ? 'checked' : ''} ${canUse ? '' : 'disabled'}></td>
            <td>${esc(row.rowNumber)}</td>
            <td><b>${esc(row.displayName || row.role)}</b><small>${esc(row.role)} · ${esc(row.actorRef)}</small></td>
            <td>${esc(row.usernameMasked || '')}</td>
            <td>${row.valid ? (issues.length ? `<span class="warn">${esc(issues.join(' · '))}</span>` : '<span class="ok">Valid</span>') : `<span class="bad">${esc(issues.join(' · '))}</span>`}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      <div class="actor-import-footer">
        <label class="actor-import-valid-only"><input type="checkbox" data-import-valid-only ${summary.invalidRows ? 'checked' : ''}> Import valid rows only</label>
        <span data-import-selection-status>${selected.size} actor${selected.size === 1 ? '' : 's'} selected for this scenario.</span>
        <button type="button" class="btn secondary" data-import-apply>Import directory</button>
      </div>`;

    container.querySelectorAll('input[data-import-actor-ref]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        enforceActiveLimit(container, checkbox);
        const count = selectedPreviewRefs(container).length;
        const status = container.querySelector('[data-import-selection-status]');
        if (status) status.textContent = `${count} actor${count === 1 ? '' : 's'} selected for this scenario.`;
      });
    });
  }

  function renderDirectory(container, data) {
    const directory = data.directory || [];
    const activeRefs = new Set(data.activeActorRefs || []);
    const roles = new Map();
    for (const actor of directory) roles.set(actor.role, (roles.get(actor.role) || 0) + 1);
    container.innerHTML = `
      <div class="actor-directory-head">
        <div><strong>Actor Directory</strong><small>${directory.length} account${directory.length === 1 ? '' : 's'} · ${roles.size} role${roles.size === 1 ? '' : 's'}</small></div>
        <button type="button" class="btn ghost" data-directory-save>Save active selection</button>
      </div>
      <div class="actor-directory-list">${directory.map((actor) => `
        <label class="actor-directory-item ${actor.enabled ? '' : 'disabled'}">
          <input type="checkbox" data-directory-ref="${esc(actor.actorRef)}" ${activeRefs.has(actor.actorRef) ? 'checked' : ''} ${actor.enabled ? '' : 'disabled'}>
          <span><b>${esc(actor.displayName || actor.role)}</b><small>${esc(actor.role)} · ${esc(actor.actorRef)}</small></span>
          <em class="${actor.credentialsConfigured ? 'ok' : 'warn'}">${actor.credentialsConfigured ? 'Credentials ready' : 'Credentials required'}</em>
        </label>`).join('')}</div>
      <div class="actor-directory-foot"><span data-directory-status>${activeRefs.size} active actor${activeRefs.size === 1 ? '' : 's'}.</span></div>`;

    container.querySelectorAll('input[data-directory-ref]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const checked = [...container.querySelectorAll('input[data-directory-ref]:checked')];
        if (checked.length > MAX_ACTIVE) checkbox.checked = false;
        const count = [...container.querySelectorAll('input[data-directory-ref]:checked')].length;
        const status = container.querySelector('[data-directory-status]');
        if (status) status.textContent = count > MAX_ACTIVE ? `Maximum ${MAX_ACTIVE} active actors.` : `${count} active actor${count === 1 ? '' : 's'}.`;
      });
    });

    container.querySelector('[data-directory-save]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const refs = [...container.querySelectorAll('input[data-directory-ref]:checked')].map((input) => input.dataset.directoryRef).filter(Boolean);
      const status = container.querySelector('[data-directory-status]');
      if (!refs.length) { if (status) status.textContent = 'Select at least one active actor.'; return; }
      button.disabled = true;
      try {
        const sessionId = ensureDirectorySessionId();
        const result = await api(`/api/sessions/${encodeURIComponent(sessionId)}/test-actor-directory/activate`, {
          method: 'POST', body: JSON.stringify({ actorRefs: refs }),
        });
        renderDirectory(container, result);
        window.__testNexusImportedActorDirectoryActive = true;
      } catch (err) {
        if (status) status.textContent = err.message;
      } finally { button.disabled = false; }
    });
  }

  function installFetchBridge() {
    if (window.__testNexusActorDirectoryFetchBridge) return;
    window.__testNexusActorDirectoryFetchBridge = true;
    const previousFetch = window.fetch.bind(window);
    window.fetch = async function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url !== '/api/generation/start' || !init?.body || typeof init.body !== 'string') {
        return previousFetch(input, init);
      }

      let payload;
      try { payload = JSON.parse(init.body); }
      catch { return previousFetch(input, init); }

      const directorySessionId = window.__testNexusActorDirectorySessionId || '';
      if (directorySessionId) {
        payload.actorDirectorySessionId = directorySessionId;
        // Imported directory state is server-owned. Do not replace it with blank
        // manual rows when generation starts.
        delete payload.testActors;
      } else if (typeof window.getTestNexusTestActors === 'function') {
        // Deliberately allow this validation error to reach the caller instead of
        // issuing a second generation request.
        const actors = window.getTestNexusTestActors();
        if (actors.length) payload.testActors = actors;
      }

      const response = await previousFetch(input, { ...init, body: JSON.stringify(payload) });
      if (response.ok && directorySessionId && payload.sessionId) {
        window.__testNexusActorDirectorySessionId = payload.sessionId;
      }
      return response;
    };
  }

  function install(panel) {
    if (panel.dataset.actorDirectoryInstalled === '1') return;
    panel.dataset.actorDirectoryInstalled = '1';
    const body = panel.querySelector('.test-actors-body');
    if (!body) return;

    const style = document.createElement('style');
    style.textContent = `
      .actor-directory-tools{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.actor-import-preview,.actor-directory-view{margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px}
      .actor-import-summary{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:10px}.actor-import-summary strong{font-size:10.5px}.actor-import-summary span{background:#eef2ff;border-radius:999px;padding:3px 6px}
      .actor-import-note{font-size:10px;color:#64748b;line-height:1.45;margin:7px 0}.actor-import-table-wrap{max-height:250px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff}
      .actor-import-table{width:100%;border-collapse:collapse;font-size:9.5px}.actor-import-table th,.actor-import-table td{padding:6px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}.actor-import-table small{display:block;color:#64748b;margin-top:2px}.actor-import-table tr.invalid{background:#fff7ed}
      .actor-import-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:10px}.actor-import-footer [data-import-selection-status]{margin-left:auto;color:#64748b}.actor-import-valid-only{display:flex;gap:4px;align-items:center}
      .actor-directory-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.actor-directory-head strong{display:block;font-size:11px}.actor-directory-head small{display:block;color:#64748b;font-size:9.5px;margin-top:2px}
      .actor-directory-list{margin-top:7px;max-height:260px;overflow:auto}.actor-directory-item{display:grid;grid-template-columns:auto 1fr auto;gap:7px;align-items:center;border-top:1px solid #eef2f7;padding:7px 2px;font-size:10px}.actor-directory-item small{display:block;color:#64748b;margin-top:2px}.actor-directory-item em{font-style:normal;font-size:9px}.actor-directory-item.disabled{opacity:.55}.actor-directory-foot{font-size:9.5px;color:#64748b;padding-top:6px}.ok{color:#047857}.warn{color:#a16207}.bad{color:#b91c1c}
    `;
    document.head.appendChild(style);

    const tools = document.createElement('div');
    tools.className = 'actor-directory-tools';
    tools.innerHTML = `
      <button type="button" class="btn ghost" data-actor-upload>Import CSV / Excel</button>
      <button type="button" class="btn ghost" data-actor-template>Download template</button>
      <input type="file" accept=".csv,.xlsx" data-actor-file hidden>
      <span data-actor-import-status style="font-size:10px;color:#64748b;align-self:center"></span>`;
    body.insertBefore(tools, body.firstChild);
    const previewContainer = document.createElement('div');
    previewContainer.className = 'actor-import-preview';
    previewContainer.hidden = true;
    tools.insertAdjacentElement('afterend', previewContainer);
    const directoryContainer = document.createElement('div');
    directoryContainer.className = 'actor-directory-view';
    directoryContainer.hidden = true;
    previewContainer.insertAdjacentElement('afterend', directoryContainer);

    const input = tools.querySelector('[data-actor-file]');
    const status = tools.querySelector('[data-actor-import-status]');
    tools.querySelector('[data-actor-upload]').addEventListener('click', () => input.click());
    tools.querySelector('[data-actor-template]').addEventListener('click', downloadTemplate);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      status.textContent = 'Validating actor file…';
      previewContainer.hidden = true;
      try {
        pendingFile = await filePayload(file);
        const sessionId = ensureDirectorySessionId();
        const result = await api(`/api/sessions/${encodeURIComponent(sessionId)}/test-actor-directory/import/preview`, {
          method: 'POST', body: JSON.stringify(pendingFile),
        });
        renderPreview(previewContainer, result.preview);
        previewContainer.hidden = false;
        status.textContent = `${result.preview.summary.validRows} valid actor row(s) found.`;
      } catch (err) {
        pendingFile = null;
        pendingPreview = null;
        status.textContent = err.message;
      } finally { input.value = ''; }
    });

    previewContainer.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-import-apply]');
      if (!button || !pendingFile || !pendingPreview) return;
      const activeActorRefs = selectedPreviewRefs(previewContainer);
      if (!activeActorRefs.length) { status.textContent = 'Select at least one active actor before importing.'; return; }
      button.disabled = true;
      status.textContent = 'Importing actor directory…';
      try {
        const sessionId = ensureDirectorySessionId();
        const result = await api(`/api/sessions/${encodeURIComponent(sessionId)}/test-actor-directory/import/apply`, {
          method: 'POST',
          body: JSON.stringify({
            ...pendingFile,
            activeActorRefs,
            importValidOnly: Boolean(previewContainer.querySelector('[data-import-valid-only]')?.checked),
          }),
        });
        window.__testNexusImportedActorDirectoryActive = true;
        if (typeof window.setTestNexusTestActors === 'function') window.setTestNexusTestActors([]);
        renderDirectory(directoryContainer, result);
        directoryContainer.hidden = false;
        previewContainer.hidden = true;
        status.textContent = `${result.imported} actor account(s) imported · ${result.activeActorRefs.length} active.`;
      } catch (err) {
        if (err.body?.preview) renderPreview(previewContainer, err.body.preview);
        status.textContent = err.message;
      } finally { button.disabled = false; }
    });
  }

  installFetchBridge();

  function waitForPanel(attempt = 0) {
    const panel = document.getElementById('testActorPanel');
    if (panel) return install(panel);
    if (attempt < 80) setTimeout(() => waitForPanel(attempt + 1), 100);
  }
  waitForPanel();
})();
