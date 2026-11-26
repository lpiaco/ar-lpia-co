import {
  ACADEMIC_FIELDS, COLUMNS, ReporterError, branchValid, validatePeriod, reportId,
  makeReport, encodeCSV, decodeCSV, publicStats
} from './reports.mjs';

const REPORT_PATH = 'reports.csv';
const SITE_REPOSITORY = 'lpiaco/ar-lpia-co';
const SITE_DATA_BRANCH = 'report-data';
const MAX_ROWS = 4000;
const SITE_ORIGIN = 'https://ar.lpia.co';
const errors = {
  configuration: 'Report storage is not connected yet.',
  storage: 'Report storage could not be verified. Please try again.'
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin'
  } });
}

function config(env) {
  const repo = env.REPORT_REPOSITORY || SITE_REPOSITORY;
  const siteRepo = repo.toLowerCase() === SITE_REPOSITORY;
  const branch = env.REPORT_BRANCH || (siteRepo ? SITE_DATA_BRANCH : 'main');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !env.GITHUB_REPORT_TOKEN ||
      !/^[\w./-]+$/.test(branch) || (siteRepo && branch !== SITE_DATA_BRANCH)) {
    throw new ReporterError(503, errors.configuration);
  }
  return { repo, token: env.GITHUB_REPORT_TOKEN, branch, allowPublic: siteRepo };
}

async function authorize(env, suppliedCode, branch) {
  let codes;
  try {
    codes = JSON.parse(env.REPORT_ACCESS_CODES || '{}');
  } catch {
    throw new ReporterError(503, errors.configuration);
  }
  if (!codes || typeof codes !== 'object' || Array.isArray(codes)) throw new ReporterError(503, errors.configuration);
  const usable = code => typeof code === 'string' && code.length >= 12 && code.length <= 128;
  const expected = [codes[branch], codes.all].filter(usable);
  if (!Object.values(codes).some(usable)) throw new ReporterError(503, errors.configuration);
  if (!usable(suppliedCode) || !expected.length) throw new ReporterError(403, 'The access code is invalid for this branch.');
  const hmac = await crypto.subtle.importKey('raw', new TextEncoder().encode(suppliedCode),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const message = new TextEncoder().encode('LPIA branch access verification');
  const valid = await Promise.all(expected.map(async code => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return crypto.subtle.verify('HMAC', hmac, await crypto.subtle.sign('HMAC', key, message), message);
  }));
  if (!valid.some(Boolean)) throw new ReporterError(403, 'The access code is invalid for this branch.');
  return usable(codes.all) && suppliedCode === codes.all;
}

function github(config, request = fetch) {
  const root = 'https://api.github.com/repos/' + config.repo;
  const get = (path, options = {}) => request(root + path, {
    ...options, redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + config.token,
      'User-Agent': 'LPIA-Academic-Report',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers
    }
  });

  async function assertStorage() {
    const response = await get('');
    if (!response.ok) throw new ReporterError(503, errors.configuration);
    const repository = await response.json();
    if (repository.private !== true && !config.allowPublic) {
      throw new ReporterError(503, 'The selected repository is not an approved storage location.');
    }
  }

  async function read(ref = config.branch, allowMissing = true) {
    const response = await get('/contents/' + REPORT_PATH + '?ref=' + encodeURIComponent(ref));
    if (response.status === 404 && allowMissing) {
      const target = await get('/branches/' + encodeURIComponent(ref));
      if (!target.ok) throw new ReporterError(503, errors.configuration);
      return { sha: null, reports: [] };
    }
    if (!response.ok) throw new ReporterError(502, errors.storage);
    const file = await response.json();
    if (file.encoding !== 'base64' || typeof file.content !== 'string' || !file.sha) {
      throw new ReporterError(502, errors.storage);
    }
    const bytes = Uint8Array.from(atob(file.content.replace(/\s/g, '')), char => char.charCodeAt(0));
    return { sha: file.sha, reports: decodeCSV(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  }

  async function write(candidate) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { sha, reports } = await read();
      const previous = reports.find(report => report.report_id === candidate.report_id);
      if (previous) {
        const same = COLUMNS.every(key => key === 'submitted_at' || previous[key] === candidate[key]);
        if (same) return { status: 'already_saved', report: previous };
        throw new ReporterError(409, 'This branch already has a different report for the selected period. Open the saved report to review it.');
      }
      if (reports.length >= MAX_ROWS) throw new ReporterError(507, 'The reporting file reached its size limit. Contact Academic Affairs.');
      const bytes = new TextEncoder().encode(encodeCSV([...reports, candidate]));
      if (bytes.length > 950000) throw new ReporterError(507, 'The reporting file reached its size limit. Contact Academic Affairs.');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      const response = await get('/contents/' + REPORT_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch: config.branch, message: 'Save academic report ' + candidate.report_id,
          content: btoa(binary), ...(sha ? { sha } : {})
        })
      });
      if (response.status === 409 || response.status === 422) continue;
      if (!response.ok) throw new ReporterError(502, errors.storage);
      const saved = await response.json();
      if (!/^[0-9a-f]{40}$/.test(saved.commit?.sha)) throw new ReporterError(502, errors.storage);
      const confirmed = await read(saved.commit.sha, false);
      const report = confirmed.reports.find(value => value.report_id === candidate.report_id);
      if (!report || COLUMNS.some(key => report[key] !== candidate[key])) throw new ReporterError(502, errors.storage);
      return { status: 'saved', report, commit: saved.commit.sha };
    }
    throw new ReporterError(409, 'The report file changed while saving. Retry to confirm the latest result.');
  }
  return { read, write, assertStorage };
}

export function createHandler(requestGithub = fetch) {
  return async (request, env) => {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/api/reports') return json({ message: 'Not found.' }, 404);
      if (request.method === 'GET') {
        const store = github(config(env), requestGithub);
        await store.assertStorage();
        return json({ periods: publicStats((await store.read()).reports) });
      }
      if (request.method !== 'POST') return json({ message: 'Method not allowed.' }, 405);
      if (request.headers.get('Origin') !== (env.SITE_ORIGIN || SITE_ORIGIN)) return json({ message: 'Invalid origin.' }, 403);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) {
        return json({ message: 'Expected a JSON request.' }, 415);
      }
      if (Number(request.headers.get('Content-Length')) > 14000) return json({ message: 'Report is too large.' }, 413);
      const body = await request.text();
      if (body.length > 14000) return json({ message: 'Report is too large.' }, 413);
      let payload;
      try { payload = JSON.parse(body); } catch { return json({ message: 'Invalid report.' }, 400); }
      if (!payload || !['submit', 'status', 'history', 'academia'].includes(payload.operation)) {
        return json({ message: 'Unknown report operation.' }, 400);
      }
      const { operation, report, accessCode } = payload;
      const branch = report?.branch_id;
      if (!branchValid(branch)) return json({ message: 'Choose a valid branch.' }, 400);
      const settings = config(env);
      const administrator = await authorize(env, accessCode, branch);
      const store = github(settings, requestGithub);
      await store.assertStorage();
      if (operation === 'submit') return json(await store.write(makeReport(report)));
      const { reports } = await store.read();
      const branchReports = reports.filter(row => row.branch_id === branch).sort((a, b) => b.report_id.localeCompare(a.report_id));
      if (operation === 'history') {
        const summaries = reports.sort((a, b) => b.report_id.localeCompare(a.report_id)).map(row => {
          if (administrator || row.branch_id === branch) return { ...row, can_view_full: true };
          return {
            ...validatePeriod(row), report_id: row.report_id, branch_name: row.branch_name,
            total_active_students: row.total_active_students, can_view_full: false
          };
        });
        return json({ reports: summaries });
      }
      const requested = validatePeriod(report);
      const id = reportId(requested);
      const found = branchReports.find(row => operation === 'academia' ? row.report_id <= id : row.report_id === id);
      if (!found) return json({ status: 'not_found', message: 'No saved report was found for this branch and period.' });
      if (operation === 'academia') {
        const period = validatePeriod(found);
        const counts = Object.fromEntries(ACADEMIC_FIELDS.map(key => [key, found[key]]));
        return json({ status: 'academia_found', period, counts });
      }
      return json({ status: 'found', report: found });
    } catch (error) {
      if (error instanceof ReporterError) return json({ message: error.message }, error.status);
      return json({ message: errors.storage }, 502);
    }
  };
}

export default { fetch: createHandler() };
