(function () {
  const encoder = new TextEncoder();

  function text(node) {
    return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function escXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escXml(value == null ? '' : String(value))}</t></is></c>`;
  }

  function rowXml(rowNumber, values, style = 0) {
    return `<row r="${rowNumber}">${values.map((value, index) => cell(`${columnName(index)}${rowNumber}`, value, style)).join('')}</row>`;
  }

  function labeledDetail(container, label) {
    const needle = String(label || '').toLowerCase();
    for (const node of container?.querySelectorAll('.analysis-detail') || []) {
      const bold = text(node.querySelector('b')).replace(/:$/, '').toLowerCase();
      if (bold !== needle) continue;
      const clone = node.cloneNode(true);
      clone.querySelector('b')?.remove();
      return text(clone);
    }
    return '';
  }

  function listAfterLabel(container, label) {
    const needle = String(label || '').toLowerCase();
    for (const node of container?.querySelectorAll('.analysis-detail') || []) {
      const bold = text(node.querySelector('b')).replace(/:$/, '').toLowerCase();
      if (bold !== needle) continue;
      return [...node.querySelectorAll('li')].map((li, i) => `${i + 1}. ${text(li)}`).join('\n');
    }
    return '';
  }

  function sourceFiles(container) {
    return [...(container?.querySelectorAll('.source-file') || [])].map((node) => {
      const code = text(node.querySelector('code'));
      const reason = text(node.querySelector('span'));
      const full = text(node);
      return reason ? `${code} — ${reason}` : full;
    }).join('\n');
  }

  function evidence(container) {
    return [...(container?.querySelectorAll('.evidence-link') || [])]
      .map((link) => `${text(link)}: ${link.href}`)
      .join('\n');
  }

  function reportMetadata() {
    const meta = text(document.querySelector('.hero .meta'));
    const cards = [...document.querySelectorAll('.cards .card')];
    const metric = (label) => {
      const card = cards.find((c) => text(c.querySelector('.label')).toLowerCase() === label.toLowerCase());
      return text(card?.querySelector('.metric'));
    };
    const targetCard = [...document.querySelectorAll('.card')].find((c) => text(c.querySelector('.label')).toLowerCase() === 'target');
    const storyHeading = [...document.querySelectorAll('.section-title')].find((h) => text(h).toLowerCase() === 'business story');
    const storyCard = storyHeading?.nextElementSibling;
    return {
      meta,
      tests: metric('Tests'),
      passed: metric('Passed'),
      failed: metric('Failed'),
      defects: metric('Defects detected'),
      passRate: metric('Execution pass rate'),
      target: text(targetCard?.querySelector('strong')),
      environment: text(targetCard?.querySelector('.muted')),
      story: text(storyCard),
    };
  }

  function reportRows() {
    return [...document.querySelectorAll('table tbody tr')].map((tr) => {
      const cells = [...tr.children];
      const analysis = cells[5];
      const developer = analysis?.querySelector('.developer-box');
      const resolution = analysis?.querySelector('.resolution-box');
      return [
        text(cells[0]),
        text(cells[1]),
        text(cells[2]?.querySelector('.status')) || text(cells[2]),
        text(cells[3]),
        text(analysis?.querySelector('.classification')),
        text(analysis?.querySelector('.analysis-summary')),
        labeledDetail(analysis, 'Expected'),
        labeledDetail(analysis, 'Observed'),
        labeledDetail(analysis, 'Probable cause'),
        text(resolution?.querySelector('.resolution-comment')),
        labeledDetail(resolution, 'Recommended fix'),
        labeledDetail(resolution, 'Suggested owner'),
        text(developer?.querySelector('.source-level')) || text(analysis?.querySelector('.source-level')),
        sourceFiles(developer || analysis),
        labeledDetail(developer, 'Where to inspect'),
        labeledDetail(developer, 'Implementation hint'),
        text(developer?.querySelector('pre')),
        listAfterLabel(resolution, 'Verify after correction'),
        listAfterLabel(developer, 'Regression checks'),
        evidence(cells[4]),
      ];
    });
  }

  function buildSheet() {
    const meta = reportMetadata();
    const rows = [];
    let row = 1;
    rows.push(rowXml(row++, ['AI TestPilot — Execution & AI Analysis'], 2));
    rows.push(rowXml(row++, ['Exported At', new Date().toISOString()]));
    rows.push(rowXml(row++, ['Run / Generated', meta.meta]));
    rows.push(rowXml(row++, ['Target', meta.target]));
    rows.push(rowXml(row++, ['Environment / Browser', meta.environment]));
    rows.push(rowXml(row++, ['Business Story', meta.story]));
    rows.push(rowXml(row++, ['Tests', meta.tests, 'Passed', meta.passed, 'Failed', meta.failed, 'Defects', meta.defects, 'Pass Rate', meta.passRate]));
    row += 1;

    const headerRow = row;
    const headers = [
      'Case','Test','Outcome','Duration','Failure Classification','AI Analysis Summary',
      'Expected','Observed','Probable Cause','AI Resolution Guidance','Recommended Fix','Suggested Owner',
      'Source Guidance Level','Source Candidate Files','Developer Review Area','Implementation Hint',
      'Illustrative / Proposed Fix','Verification Steps','Regression Checks','Evidence Links'
    ];
    rows.push(rowXml(row++, headers, 1));
    reportRows().forEach((values) => rows.push(rowXml(row++, values)));

    const lastRow = Math.max(headerRow, row - 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:T${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/>
    <col min="3" max="5" width="20" customWidth="1"/><col min="6" max="20" width="45" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A${headerRow}:T${lastRow}"/>
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
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  function uint16(value) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value, true); return b; }
  function uint32(value) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0, true); return b; }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    parts.forEach((part) => { out.set(part, offset); offset += part.length; });
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
      centrals.push(concat([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0), uint16(0), uint16(stamp.time), uint16(stamp.day),
        uint32(crc), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(offset), name,
      ]));
      offset += localHeader.length + data.length;
    }
    const centralData = concat(centrals);
    return concat([...locals, centralData, concat([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
      uint32(centralData.length), uint32(offset), uint16(0),
    ])]);
  }

  function workbookFiles() {
    return [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Execution Analysis" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5BFF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
      { name: 'xl/worksheets/sheet1.xml', data: buildSheet() },
    ];
  }

  function exportReport() {
    const bytes = zipStore(workbookFiles());
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const runText = text(document.querySelector('.hero .meta')).match(/Run:\s*([^\s]+)/i)?.[1] || 'run';
    const safeRun = runText.replace(/[^a-zA-Z0-9_-]/g, '_');
    const link = document.createElement('a');
    link.href = url;
    link.download = `AI-TestPilot-Analysis-${safeRun}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function install() {
    const button = document.getElementById('exportAnalysisExcel');
    if (button) button.addEventListener('click', exportReport);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();