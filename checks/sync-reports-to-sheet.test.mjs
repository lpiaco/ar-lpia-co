import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { syncReports } from '../.github/scripts/sync-reports-to-sheet.mjs';
import { COLUMNS, COUNT_FIELDS, encodeCSV, makeReport } from '../lib/reports.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const serviceEmail = 'reports-sync@example-project.iam.gserviceaccount.com';
const credentialsJSON = JSON.stringify({
  type: 'service_account',
  client_email: serviceEmail,
  private_key_id: 'test-key',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' })
});
const githubToken = 'test-github-token';
const commit = 'a'.repeat(40);
const report = makeReport({
  ...Object.fromEntries(COUNT_FIELDS.map(key => [key, 0])),
  branch_id: '08', reporting_year: 2026, reporting_month: 11, reporting_week: 3,
  reporter_name: '=TEST()', remarks: 'Two lines\nWith commas, too',
  active_english_students: 66, active_computer_students: 7
}, '2026-11-27T00:00:00.000Z');
const sheetId = '15aUuGb1WaXvaXR39FO5Bby2YBLjC_UFZvv4ALaW-exQ';
const metadata = { metadataKey: 'lpia_report_csv_source', metadataValue: 'lpiaco/ar-lpia-co/report-data/reports.csv' };

function fixture() {
  const protectedTab = { properties: { title: 'Existing worksheet', sheetId: 1 } };
  const sheets = [protectedTab];
  let tab;
  let reports = [report];
  let writes = 0;
  let rejectReadback = false;
  let requests = [];
  let values = [];

  async function request(input, options) {
    const url = new URL(input);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    if (url.origin === 'https://api.github.com') {
      assert.equal(options.headers.Authorization, 'Bearer ' + githubToken);
      if (url.pathname.endsWith('/git/ref/heads/report-data')) return Response.json({ object: { sha: commit } });
      assert.equal(url.pathname, '/repos/lpiaco/ar-lpia-co/contents/reports.csv');
      assert.equal(url.searchParams.get('ref'), commit);
      return Response.json({ encoding: 'base64', content: Buffer.from(encodeCSV(reports)).toString('base64') });
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      const [header, claims, signature] = options.body.get('assertion').split('.');
      assert.ok(verify('RSA-SHA256', Buffer.from(header + '.' + claims), publicKey, Buffer.from(signature, 'base64url')));
      const decoded = JSON.parse(Buffer.from(claims, 'base64url').toString());
      assert.equal(decoded.iss, serviceEmail);
      assert.equal(decoded.scope, 'https://www.googleapis.com/auth/spreadsheets');
      assert.equal(decoded.aud, url.href);
      assert.equal(decoded.exp - decoded.iat, 3600);
      return Response.json({ access_token: 'fake-access-token' });
    }
    assert.equal(url.origin, 'https://sheets.googleapis.com');
    assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
    if (url.pathname === '/v4/spreadsheets/' + sheetId) return Response.json({ sheets });
    if (url.pathname.endsWith(':batchUpdate')) {
      assert.equal(url.pathname, '/v4/spreadsheets/' + sheetId + ':batchUpdate');
      writes += 1;
      requests = JSON.parse(options.body).requests;
      for (const change of requests) {
        if (change.addSheet) {
          tab = { properties: change.addSheet.properties, developerMetadata: [] };
          assert.notEqual(tab.properties.sheetId, protectedTab.properties.sheetId);
          sheets.push(tab);
        } else if (change.createDeveloperMetadata) {
          tab.developerMetadata.push(change.createDeveloperMetadata.developerMetadata);
        } else if (change.updateSheetProperties) {
          assert.equal(change.updateSheetProperties.properties.sheetId, tab.properties.sheetId);
          tab.properties.gridProperties = change.updateSheetProperties.properties.gridProperties;
        } else {
          const { range, rows, fields } = change.updateCells;
          assert.equal(fields, 'userEnteredValue');
          assert.equal(range.sheetId, tab.properties.sheetId);
          assert.equal(range.endRowIndex, tab.properties.gridProperties.rowCount);
          assert.equal(range.endColumnIndex, tab.properties.gridProperties.columnCount);
          values = rows.map(row => row.values.map(cell => {
            assert.equal(Object.hasOwn(cell.userEnteredValue, 'formulaValue'), false);
            return cell.userEnteredValue.numberValue ?? cell.userEnteredValue.stringValue;
          }));
        }
      }
      return Response.json({});
    }
    assert.equal(decodeURIComponent(url.pathname), "/v4/spreadsheets/" + sheetId + "/values/'GitHub Reports'");
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    return Response.json({ values: rejectReadback ? [] : values });
  }

  return {
    run: () => syncReports({ githubToken, credentialsJSON, request }),
    values: () => values, requests: () => requests, writes: () => writes,
    setReports: next => { reports = next; },
    addUnmanagedTab: () => sheets.push({ properties: { title: 'GitHub Reports', sheetId: 2 } }),
    corruptReadback: () => { rejectReadback = true; }
  };
}

await assert.rejects(syncReports({ githubToken, request: () => assert.fail('Network call without credentials') }),
  /GOOGLE_SERVICE_ACCOUNT_JSON/);
const blocked = fixture();
blocked.addUnmanagedTab();
await assert.rejects(blocked.run(), /was not created by this sync/);
assert.equal(blocked.writes(), 0);

const full = fixture();
assert.deepEqual(await full.run(), { commit, reports: 1 });
assert.equal(full.values()[1][COLUMNS.indexOf('branch_id')], '08');
assert.equal(full.values()[1][COLUMNS.indexOf('reporter_name')], '=TEST()');
assert.equal(full.values()[1][COLUMNS.indexOf('total_active_students')], 73);
const ownership = full.requests()[1].createDeveloperMetadata.developerMetadata;
assert.equal(ownership.metadataKey, metadata.metadataKey);
assert.equal(ownership.metadataValue, metadata.metadataValue);
full.setReports([report, { ...report, reporting_week: 4, report_id: '2026-11-W4-08' }]);
assert.equal((await full.run()).reports, 2);
assert.ok(full.requests().some(request => request.updateSheetProperties));
full.setReports([]);
assert.equal((await full.run()).reports, 0);
assert.deepEqual(full.values(), [COLUMNS]);
assert.equal(full.requests().at(-1).updateCells.range.endRowIndex, 3);

const empty = fixture();
empty.setReports([]);
assert.equal((await empty.run()).reports, 0);
assert.equal(empty.requests()[0].addSheet.properties.gridProperties.rowCount, 2);
empty.corruptReadback();
await assert.rejects(empty.run(), /readback did not match/);
console.log('PASS Sheets sync mock: commit-pinned CSV, OAuth scope, isolated tab, literal values, idempotent clearing, and verified readback');
