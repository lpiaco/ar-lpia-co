import { sign } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { COLUMNS, decodeCSV } from '../../lib/reports.mjs';

const REPOSITORY = 'lpiaco/ar-lpia-co';
const BRANCH = 'report-data';
const FILE = 'reports.csv';
const SPREADSHEET_ID = '15aUuGb1WaXvaXR39FO5Bby2YBLjC_UFZvv4ALaW-exQ';
const TAB_TITLE = 'GitHub Reports';
const TAB_MARKER_KEY = 'lpia_report_csv_source';
const TAB_MARKER_VALUE = [REPOSITORY, BRANCH, FILE].join('/');
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

async function requestJson(request, url, options, operation) {
  const response = await request(url, { ...options, redirect: 'error', cache: 'no-store' });
  if (!response.ok) {
    const accessDenied = response.status === 401 || response.status === 403;
    const hint = accessDenied && operation === 'Read spreadsheet'
      ? ' Enable the Sheets API and share the prototype spreadsheet with the service account as Editor.'
      : '';
    throw new Error(operation + ' failed (HTTP ' + response.status + ').' + hint);
  }
  return response.json();
}

async function googleAccessToken(request, credentialsJSON) {
  let assertion;
  try {
    const credentials = JSON.parse(credentialsJSON);
    if (credentials.type !== 'service_account' || !credentials.client_email || !credentials.private_key) {
      throw new Error('Invalid service account credentials');
    }

    const now = Math.floor(Date.now() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: credentials.private_key_id });
    const claims = encode({
      iss: credentials.client_email, scope: SHEETS_SCOPE, aud: GOOGLE_TOKEN_URL,
      iat: now, exp: now + 3600
    });
    const unsigned = header + '.' + claims;
    assertion = unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url');
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not a valid Google service account key.');
  }

  const token = await requestJson(request, GOOGLE_TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  }, 'Authorize Sheets access');
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('Google did not return a Sheets access token.');
  }
  return token.access_token;
}

async function readReports(request, githubToken) {
  const api = 'https://api.github.com/repos/' + REPOSITORY;
  const headers = {
    Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + githubToken,
    'User-Agent': 'LPIA-Report-Sheet-Sync', 'X-GitHub-Api-Version': '2022-11-28'
  };
  const ref = await requestJson(request, api + '/git/ref/heads/' + BRANCH, { headers }, 'Read current report-data commit');
  const commit = ref.object?.sha;
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('GitHub returned an invalid report-data commit.');
  const file = await requestJson(request, api + '/contents/' + FILE + '?ref=' + commit, { headers }, 'Read reports.csv');
  if (file.encoding !== 'base64' || typeof file.content !== 'string') {
    throw new Error('GitHub did not return reports.csv as a file.');
  }
  const reports = decodeCSV(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.content, 'base64')));
  return { commit, reports };
}

function planSheetWrite(sheets, values) {
  const existing = sheets.find(sheet => sheet.properties.title === TAB_TITLE);
  const requests = [];
  let sheetId;
  let rowCount = Math.max(2, values.length);
  let columnCount = COLUMNS.length;

  if (existing) {
    const owned = existing.developerMetadata?.some(metadata =>
      metadata.metadataKey === TAB_MARKER_KEY && metadata.metadataValue === TAB_MARKER_VALUE
    );
    if (!owned) throw new Error('An existing tab named GitHub Reports was not created by this sync. No data was changed.');

    const properties = existing.properties;
    sheetId = properties.sheetId;
    rowCount = Math.max(rowCount, properties.gridProperties.rowCount);
    columnCount = Math.max(columnCount, properties.gridProperties.columnCount);
    if (rowCount !== properties.gridProperties.rowCount || columnCount !== properties.gridProperties.columnCount) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { rowCount, columnCount } },
          fields: 'gridProperties.rowCount,gridProperties.columnCount'
        }
      });
    }
  } else {
    const usedIds = new Set(sheets.map(sheet => sheet.properties.sheetId));
    sheetId = 1693312124;
    while (usedIds.has(sheetId)) sheetId += 1;
    requests.push({
      addSheet: {
        properties: { sheetId, title: TAB_TITLE, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } }
      }
    }, {
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: TAB_MARKER_KEY, metadataValue: TAB_MARKER_VALUE,
          location: { sheetId }, visibility: 'DOCUMENT'
        }
      }
    });
  }

  // Supplying the full range clears stale rows and columns in this same batch.
  // Explicit stringValue stores branch IDs and formula-like text literally.
  requests.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
      rows: values.map(row => ({
        values: row.map(value => ({
          userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value }
        }))
      })),
      fields: 'userEnteredValue'
    }
  });
  return requests;
}

export async function syncReports({ githubToken, credentialsJSON, request = fetch }) {
  if (!credentialsJSON) throw new Error('Configure the GitHub Actions secret GOOGLE_SERVICE_ACCOUNT_JSON before syncing.');
  if (!githubToken) throw new Error('The GitHub Actions token is unavailable.');

  const { commit, reports } = await readReports(request, githubToken);
  const token = await googleAccessToken(request, credentialsJSON);
  const sheet = 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID;
  const headers = { Authorization: 'Bearer ' + token };
  const fields = 'sheets(properties(sheetId,title,gridProperties),developerMetadata(metadataKey,metadataValue))';
  const workbook = await requestJson(request, sheet + '?fields=' + encodeURIComponent(fields), { headers }, 'Read spreadsheet');
  const values = [COLUMNS, ...reports.map(report => COLUMNS.map(column => report[column]))];
  const requests = planSheetWrite(workbook.sheets, values);
  await requestJson(request, sheet + ':batchUpdate', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  }, 'Sync spreadsheet tab');

  const range = encodeURIComponent("'" + TAB_TITLE + "'");
  const readback = await requestJson(request, sheet + '/values/' + range + '?valueRenderOption=UNFORMATTED_VALUE',
    { headers }, 'Verify spreadsheet tab');
  if (!Array.isArray(readback.values) || readback.values.length !== values.length ||
      readback.values.some(row => row.length > COLUMNS.length) ||
      values.some((row, rowIndex) => row.some((value, column) => (readback.values[rowIndex]?.[column] ?? '') !== value))) {
    throw new Error('The spreadsheet readback did not match reports.csv.');
  }

  return { commit, reports: reports.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await syncReports({
      githubToken: process.env.GITHUB_REPORTS_TOKEN,
      credentialsJSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    });
    console.log('Verified ' + result.reports + ' report rows in GitHub Reports for commit ' + result.commit + '.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
