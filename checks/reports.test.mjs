import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHandler } from '../worker/index.mjs';
import { COUNT_FIELDS, decodeCSV, encodeCSV, makeReport, publicStats } from '../worker/reports.mjs';

const period = { branch_id: '08', reporting_year: 2026, reporting_month: 11, reporting_week: 3 };
const setu = {
  ...Object.fromEntries(COUNT_FIELDS.map(key => [key, 0])),
  ...period, reporter_name: '=Contoh, "Setu"', remarks: "Baris pertama\nBaris kedua",
  active_english_students: 66, active_english_classes: 22,
  active_computer_students: 7, active_computer_classes: 5,
  academic_coordinators: 1, academic_staff: 2,
  english_students_in: 3, computer_students_out: 4
};

function fixture(initialReports = []) {
  let csv = initialReports.length ? encodeCSV(initialReports) : null;
  let version = Number(Boolean(initialReports.length));
  let privateRepo = true;
  let collision = false;
  let putCount = 0;
  let ignoreWriteOnVerify = false;
  const commits = new Map();
  const sha = () => String(version).padStart(40, '0');
  const github = async (input, options) => {
    const path = new URL(input);
    assert.equal(path.origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (path.pathname === '/repos/lpiaco/test-reports') return Response.json({ private: privateRepo });
    if (path.pathname.endsWith('/branches/main')) return Response.json({ name: 'main' });
    assert.equal(path.pathname, '/repos/lpiaco/test-reports/contents/reports.csv');
    if (options.method === 'PUT') {
      putCount += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.branch, 'main');
      if (collision) { collision = false; return new Response(null, { status: 409 }); }
      if (csv ? sha() !== body.sha : body.sha) return new Response(null, { status: 409 });
      csv = Buffer.from(body.content, 'base64').toString();
      version += 1;
      commits.set(sha(), ignoreWriteOnVerify ? encodeCSV([]) : csv);
      return Response.json({ commit: { sha: sha() } }, { status: 201 });
    }
    const ref = path.searchParams.get('ref');
    const current = ref === 'main' ? csv : commits.get(ref);
    if (!current) return new Response(null, { status: 404 });
    return Response.json({ encoding: 'base64', content: Buffer.from(current).toString('base64'), sha: sha() });
  };
  const handler = createHandler(github);
  const env = {
    REPORT_REPOSITORY: 'lpiaco/test-reports', GITHUB_REPORT_TOKEN: 'test-token',
    REPORT_ACCESS_CODES: JSON.stringify({ '08': 'setu-test-code', '03': 'gede-test-code', all: 'head-office-code' })
  };
  function api(operation, report = setu, code = 'setu-test-code', origin = 'https://ar.lpia.co') {
    return handler(new Request('https://ar.lpia.co/api/reports', operation ? {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ operation, report, accessCode: code })
    } : {}), env);
  }
  return {
    api, handler, env, rows: () => csv ? decodeCSV(csv) : [], writes: () => putCount,
    collide: () => { collision = true; }, makePublic: () => { privateRepo = false; },
    corruptReadback: () => { ignoreWriteOnVerify = true; }
  };
}

const record = makeReport(setu, '2026-11-27T00:00:00.000Z');
assert.equal(record.total_active_students, 73);
assert.equal(record.total_active_classes, 27);
assert.equal(record.total_net_movement, -1);
assert.equal(record.report_id, '2026-11-W3-08');
assert.match(encodeCSV([record]), /"'=Contoh/);
assert.deepEqual(decodeCSV(encodeCSV([record])), [record]);
assert.equal(publicStats([record])[0].branches[0].academia, 3);
assert.equal(Object.hasOwn(publicStats([record])[0].branches[0], 'reporter_name'), false);

const mock = fixture();
assert.deepEqual(await (await mock.api()).json(), { periods: [] });
assert.equal((await mock.api('submit', setu, 'wrong-access-code')).status, 403);
assert.equal((await mock.api('submit', setu, 'setu-test-code', 'https://other.example')).status, 403);
assert.equal((await mock.api('submit', { ...setu, active_english_students: '66' })).status, 400);
assert.equal(mock.writes(), 0);
mock.collide();
const saved = await (await mock.api('submit')).json();
assert.equal(saved.status, 'saved');
assert.equal(mock.writes(), 2);
assert.equal(mock.rows()[0].total_active_students, 73);
assert.equal((await (await mock.api('submit')).json()).status, 'already_saved');
assert.equal((await mock.api('submit', { ...setu, active_english_students: 70 })).status, 409);
const dates = await Promise.all([2, 4].map(reporting_week => mock.api('submit', { ...setu, reporting_week })));
assert.ok(dates.every(response => response.ok));
assert.equal(mock.rows().length, 3);
assert.equal((await (await mock.api('status', period)).json()).report.report_id, '2026-11-W3-08');
assert.equal((await (await mock.api('academia', period)).json()).counts.academic_staff, 2);
assert.equal((await mock.api('history', { branch_id: '08' }, 'gede-test-code')).status, 403);
const gede = { ...setu, branch_id: '03', active_english_students: 65, active_computer_students: 22 };
assert.equal((await mock.api('submit', gede, 'gede-test-code')).status, 200);
assert.equal((await (await mock.api('history', { branch_id: '08' })).json()).reports.length, 3);
assert.equal((await (await mock.api('history', { branch_id: '08' }, 'head-office-code')).json()).reports.length, 4);
const stats = (await (await mock.api()).json()).periods;
assert.equal(stats.length, 3);
assert.equal(stats[1].branches.length, 2);
assert.equal(stats[1].branches.reduce((total, branch) => total + branch.english + branch.computer, 0), 160);
mock.makePublic();
assert.equal((await mock.api()).status, 503);
assert.equal((await mock.api('submit')).status, 503);
const mismatch = fixture();
mismatch.corruptReadback();
assert.equal((await mismatch.api('submit')).status, 502);
assert.equal((await (await mismatch.api('status', period)).json()).status, 'found');
console.log('PASS API mock: private storage, CSV verification, duplicate and concurrent writes, branch access, history and public statistics');

if (process.env.PLAYWRIGHT_MODULE) {
  const browserMock = fixture([
    makeReport({ ...setu, reporting_week: 2 }, '2026-11-20T00:00:00.000Z'),
    makeReport(gede, '2026-11-27T00:00:00.000Z')
  ]);
  const mime = { '/': 'text/html', '/app.js': 'application/javascript', '/styles.css': 'text/css' };
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/reports') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const origin = 'http://127.0.0.1:' + server.address().port;
        const response = await browserMock.handler(new Request(origin + req.url, {
          method: req.method, headers: req.headers, ...(body ? { body } : {})
        }), { ...browserMock.env, SITE_ORIGIN: origin });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (mime[req.url]) {
        res.writeHead(200, { 'Content-Type': mime[req.url] });
        res.end(await readFile(new URL('..' + (req.url === '/' ? '/index.html' : req.url), import.meta.url)));
      } else {
        res.writeHead(404).end();
      }
    } catch (error) {
      console.error(error);
      res.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error));
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => {
        window.fullscreenRequested = true;
        return Promise.reject(new Error('Simulated fullscreen permission denial'));
      };
    });
    const url = 'http://127.0.0.1:' + server.address().port;
    await page.goto(url);
    await page.getByRole('heading', { name: 'LPIA Academic Report' }).waitFor();
    assert.ok(await page.locator('.logo-placeholder').isVisible());
    await page.getByRole('button', { name: 'START', exact: true }).click();
    assert.equal(await page.evaluate(() => window.fullscreenRequested), true);
    await page.getByRole('button', { name: 'Current Status of LPIA Students' }).click();
    await page.getByText('Reports from 1 of 24 listed branches.').waitFor();
    await page.getByRole('heading', { name: 'Pd Gede · 87 students' }).waitFor();
    await page.locator('#stats-period').selectOption('2026-11-W2');
    await page.getByRole('heading', { name: 'Setu · 73 students' }).waitFor();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    const field = name => page.locator('[name="' + name + '"]');
    await field('branch_id').selectOption('08');
    await field('reporting_year').selectOption('2026');
    await field('reporting_month').selectOption('11');
    await field('reporting_week').selectOption('3');
    await field('reporter_name').fill(setu.reporter_name);
    await field('access_code').fill('setu-test-code');
    await page.getByRole('button', { name: 'Fill from last report' }).click();
    await page.getByText('Blank fields filled from Week 2, November 2026.').waitFor();
    assert.equal(await field('academic_staff').inputValue(), '2');
    for (const key of COUNT_FIELDS) await field(key).fill(String(setu[key]));
    await field('remarks').fill(setu.remarks);
    assert.equal(await page.locator('#english_students_per_class').textContent(), '3');
    assert.equal(await page.locator('#computer_students_per_class').textContent(), '1.4');
    await page.getByRole('button', { name: 'Submit report' }).click();
    await page.getByRole('heading', { name: 'Laporan tersimpan' }).waitFor();
    assert.ok((await page.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).startsWith('https://wa.me/?text='));
    await page.getByRole('button', { name: 'Lihat laporan yang baru saja di-update' }).click();
    await page.getByText('Academic Name: ' + setu.reporter_name).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Lihat semua laporan yang sudah terkirim' }).click();
    await page.getByText('Laporan yang baru dibuka').waitFor();
    assert.equal(await page.locator('#history-list article').count(), 2);
    await page.locator('#history-search').fill('Week 2');
    assert.equal(await page.locator('#history-list article').count(), 1);
    await page.getByRole('button', { name: 'Back to saved report' }).click();
    await page.getByRole('button', { name: 'Selesai' }).click();
    await page.getByText('Thank you for using Academic Report App.').waitFor();
    assert.equal(await field('access_code').inputValue(), '');
    assert.equal(await page.locator('#finished-screen').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    await page.reload();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.getByRole('button', { name: 'Current Status of LPIA Students' }).click();
    await page.getByText('Reports from 2 of 24 listed branches.').waitFor();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await page.getByText('Thank you for using Academic Report App.').waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('PASS browser mock: START, statistics, entry, verified receipt, WhatsApp link, history and both finish paths');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
