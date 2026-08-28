(function () {
  const encoder = new TextEncoder();

  function escXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function categoryOf(tc) {
    return String(tc?.testCategory || tc?.category || tc?.testData?.__testCategory || 'FUNCTIONAL').toUpperCase();
  }

  function currentCases() {
    try {
      return typeof testCases !== 'undefined' && Array.isArray(testCases) ? testCases : [];
    } catch {
      return [];
    }
  }

  function columnName(index) {
    let n = index + 1;
    let out = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  }

  function cell(ref, value, style = 0) {
    const text = value == null ? '' : String(value);
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escXml(text)}</t></is></c>`;
  }

  function rowXml(rowNumber, values, style = 0) {
    return `<row r="${rowNumber}">${values.map((value, index) => cell(`${columnName(index)}${rowNumber}`, value, style)).join('')}</row>`;
  }

  function stepsText(steps) {
    return (steps || []).map((step, index) => {
      const value = step?.value == null || step?.value === '' ? '' : ` | ${step.value}`;
      return `${index + 1}. ${step?.action || ''}${step?.target ? ` | ${step.target}` : ''}${value}`;
    }).join('\n');
  }

  function listText(values) {
    return (values || []).map((value, index) => `${index + 1}. ${value}`).join('\n');
  }

  function testDataText(value) {
    if (!value || typeof value !== 'object') return '';
    const copy = { ...value };
    delete copy.__testCategory;
    if (!Object.keys(copy).length) return '';
    try { return JSON.stringify(copy, null, 2); } catch { return String(copy); }
  }

  function buildSheet(cases) {
    const headers = ['ID','Title','Test Category','Scenario Type','Priority','Source','Automation Readiness','Preconditions','Test Data','Steps','Expected Results'];
    const rows = [];
    let row = 1;

    let targetUrl = '';
    let environment = '';
    let story = '';
    try {
      targetUrl = document.getElementById('targetUrl')?.value || '';
      environment = document.getElementById('environment')?.value || '';
      story = document.getElementById('story')?.value || '';
    } catch {}

    rows.push(rowXml(row++, ['AI TestPilot — Reviewed Test Cases'], 2));
    rows.push(rowXml(row++, ['Exported At', new Date().toISOString()]));
    rows.push(rowXml(row++, ['Target URL', targetUrl]));
    rows.push(rowXml(row++, ['Environment', environment]));
    rows.push(rowXml(row++, ['Business Story', story]));
    row += 1;
    rows.push(rowXml(row++, headers, 1));

    for (const tc of cases) {
      const readiness = tc?.automationReadiness?.status || 'NOT CHECKED';
      rows.push(rowXml(row++, [
        tc?.id || '',
        tc?.title || '',
        categoryOf(tc),
        String(tc?.type || 'functional').toUpperCase(),
        String(tc?.priority || 'medium').toUpperCase(),
        tc?.source || 'ai-reviewed',
        readiness,
        listText(tc?.preconditions),
        testDataText(tc?.testData),
        stepsText(tc?.steps),
        listText(tc?.expectedResults),
      ]));
    }

    const lastRow = Math.max(1, row - 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:K${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/>
    <col min="3" max="7" width="20" customWidth="1"/><col min="8" max="11" width="48" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A7:K${lastRow}"/>
</worksheet>`;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function uint16(value) {
    const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b;
  }
  function uint32(value) {
    const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, true); return b;
  }
  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);
      const localHeader = concat([
        uint32(0x04034b50), uint16(20), uint16(0), uint16(0), uint16(stamp.time), uint16(stamp.day),
        uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name,
      ]);
      locals.push(localHeader, data);

      const central = concat([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0), uint16(stamp.time), uint16(stamp.day),
        uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(offset), name,
      ]);
      centrals.push(central);
      offset += localHeader.length + data.length;
    }

    const centralData = concat(centrals);
    const end = concat([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
      uint32(centralData.length), uint32(offset), uint16(0),
    ]);
    return concat([...locals, centralData, end]);
  }

  function workbookFiles(cases) {
    return [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test Cases" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BFF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      { name: 'xl/worksheets/sheet1.xml', data: buildSheet(cases) },
    ];
  }

  function exportExcel() {
    const cases = currentCases();
    if (!cases.length) {
      alert('Generate or add at least one test case before exporting.');
      return;
    }
    const bytes = zipStore(workbookFiles(cases));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `AI-TestPilot-Test-Cases-${date}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function ensureButton() {
    if (document.getElementById('exportTestCasesExcel')) return;
    const add = document.getElementById('addCaseBtn');
    const actions = add?.parentElement;
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'exportTestCasesExcel';
    button.type = 'button';
    button.className = 'btn ghost';
    button.textContent = 'Export Excel';
    button.title = 'Export the currently reviewed test cases as an .xlsx workbook.';
    button.onclick = exportExcel;
    actions.insertBefore(button, add);

    const refresh = () => { button.disabled = currentCases().length === 0; };
    refresh();
    const cases = document.getElementById('cases');
    if (cases) new MutationObserver(refresh).observe(cases, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureButton);
  else ensureButton();
})();
