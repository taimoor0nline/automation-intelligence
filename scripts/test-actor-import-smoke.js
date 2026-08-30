const assert = require('assert');
const {
  parseImport,
  publicPreview,
  buildDirectoryState,
} = require('../server/services/testActorImportService');
const actorRuntimeStore = require('../server/services/testActorRuntimeStore');
const { resetSession } = require('../server/data/sessionStore');
const { buildSafeSessionPayload } = require('../server/services/persistenceService');

function b64(value) { return Buffer.from(value).toString('base64'); }
function assertNoSecret(value, secrets) {
  const text = JSON.stringify(value);
  for (const secret of secrets) assert(!text.includes(secret), `Secret leaked into safe payload: ${secret}`);
}

function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // CRC is not used by TestNexus parser
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, fileName, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const localBuffer = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function inlineCell(ref, value) {
  const safe = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<c r="${ref}" t="inlineStr"><is><t>${safe}</t></is></c>`;
}

function makeActorXlsx() {
  const rows = [
    ['role','displayName','username','password','description','enabled','active'],
    ['Requester','Requester','requester.qa','RequesterSecret!','Creates requests','true','true'],
    ['Manager','Manager 1','manager1.qa','ManagerSecret1!','Reviews requests','true','true'],
    ['Manager','Manager 2','manager2.qa','ManagerSecret2!','Backup manager','true','false'],
    ['Approver','Approver','approver.qa','ApproverSecret!','Approves requests','true','true'],
  ];
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => `${inlineCell(`${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`, value)}`).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return zipStored({
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Other" sheetId="1" r:id="rId1"/><sheet name="Test Actors" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + inlineCell('A1', 'Ignore') + '</row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

const csv = [
  'role,displayName,username,password,description,enabled,active',
  'Requester,Requester,requester.qa,RequesterSecret!,Creates requests,true,true',
  'Manager,Manager 1,manager1.qa,ManagerSecret1!,Reviews requests,true,true',
  'Manager,Manager 2,manager2.qa,ManagerSecret2!,Backup manager,true,false',
  'Approver,Approver,approver.qa,ApproverSecret!,Approves requests,true,true',
  'Broken,Broken,,MissingUserSecret!,Invalid row,true,false',
].join('\n');

const csvParsed = parseImport({ fileName: 'actors.csv', contentBase64: b64(csv) });
assert.strictEqual(csvParsed.summary.validRows, 4);
assert.strictEqual(csvParsed.summary.invalidRows, 1);
assert.deepStrictEqual(csvParsed.suggestedActiveRefs, ['actor_requester','actor_manager','actor_approver']);
assert.deepStrictEqual(csvParsed.rows.filter((row) => row.valid && row.role === 'Manager').map((row) => row.actorRef), ['actor_manager','actor_manager_02']);

const csvPreview = publicPreview(csvParsed);
assertNoSecret(csvPreview, ['RequesterSecret!','ManagerSecret1!','ManagerSecret2!','ApproverSecret!','MissingUserSecret!']);
assert(csvPreview.rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'password')));
assert(csvPreview.rows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'username')));

const state = buildDirectoryState(csvParsed, ['actor_requester','actor_manager_02','actor_approver']);
assert.strictEqual(state.publicDirectory.length, 4);
assert.deepStrictEqual(state.activeRefs, ['actor_requester','actor_manager_02','actor_approver']);
assert.strictEqual(state.activeCatalog[1].displayName, 'Manager 2');
assert.strictEqual(state.activeCredentials.actor_manager_02.username, 'manager2.qa');
assertNoSecret(state.publicDirectory, ['RequesterSecret!','ManagerSecret1!','ManagerSecret2!','ApproverSecret!']);

const xlsx = makeActorXlsx();
const xlsxParsed = parseImport({ fileName: 'actors.xlsx', contentBase64: xlsx.toString('base64') });
assert.strictEqual(xlsxParsed.fileType, 'XLSX');
assert.strictEqual(xlsxParsed.sheetName, 'Test Actors');
assert.strictEqual(xlsxParsed.summary.validRows, 4);
assert.strictEqual(xlsxParsed.summary.invalidRows, 0);
assert.deepStrictEqual(xlsxParsed.suggestedActiveRefs, ['actor_requester','actor_manager','actor_approver']);
assertNoSecret(publicPreview(xlsxParsed), ['RequesterSecret!','ManagerSecret1!','ManagerSecret2!','ApproverSecret!']);

const sessionId = `actor-import-smoke-${Date.now()}`;
const session = resetSession(sessionId);
session.testActorDirectory = state.publicDirectory;
session.testActorDirectoryCredentials = state.credentialMap;
session.testActorActiveRefs = state.activeRefs;
session.testActors = state.activeCatalog;
session.actorCredentials = state.activeCredentials;
actorRuntimeStore.setFromSession(sessionId, session);

const safe = buildSafeSessionPayload(session);
assert.deepStrictEqual(safe.testActorActiveRefs, state.activeRefs);
assert.strictEqual(safe.testActorDirectory.length, 4);
assertNoSecret(safe, ['RequesterSecret!','ManagerSecret1!','ManagerSecret2!','ApproverSecret!','requester.qa','manager2.qa']);

const reset = resetSession(sessionId);
assert.deepStrictEqual(reset.testActorActiveRefs, state.activeRefs, 'Generation reset must preserve imported active actor refs.');
assert.strictEqual(reset.actorCredentials.actor_manager_02.username, 'manager2.qa', 'Generation reset must restore runtime credentials from runtime-only store.');
assert.strictEqual(reset.testActorDirectory.length, 4);

const targetSessionId = `${sessionId}-generated`;
assert.strictEqual(actorRuntimeStore.copy(sessionId, targetSessionId), true);
const copied = resetSession(targetSessionId);
assert.deepStrictEqual(copied.testActorActiveRefs, state.activeRefs);
assert.strictEqual(copied.actorCredentials.actor_approver.password, 'ApproverSecret!');

console.log('test actor CSV/XLSX import smoke: PASS');
