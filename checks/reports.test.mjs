import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHandler } from '../lib/report-store.mjs';
import { COUNT_FIELDS, decodeCSV, encodeCSV, makeReport, monthlyReportStats, publicStats } from '../lib/reports.mjs';

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
assert.deepEqual(decodeCSV(encodeCSV([{ ...record, branch_name: 'Setu' }])), [record]);
assert.equal(publicStats([record])[0].branches[0].academia, 3);
assert.equal(Object.hasOwn(publicStats([record])[0].branches[0], 'reporter_name'), false);
const [month] = monthlyReportStats([record, makeReport({
  ...setu, reporting_week: 2, active_english_students: 60, english_students_in: 2
}, '2026-11-20T00:00:00.000Z')]);
assert.equal(month.branches[0].english, 66);
assert.equal(month.branches[0].latestWeek, 3);
assert.equal(month.branches[0].inCount, 5);
assert.equal(month.branches[0].weeksReported, 2);

const mock = fixture();
assert.deepEqual(await (await mock.api()).json(), { periods: [] });
assert.equal((await mock.api('status', period, 'wrong-access-code')).status, 403);
assert.equal((await mock.api('submit', setu, 'setu-test-code', 'https://other.example')).status, 403);
assert.equal((await mock.api('submit', { ...setu, active_english_students: '66' })).status, 400);
assert.equal((await mock.api('submit', { ...setu, reporting_year: 2037 })).status, 400);
assert.equal(mock.writes(), 0);
const direct = fixture();
delete direct.env.REPORT_ACCESS_CODES;
const submittedWithoutCode = await direct.api('submit', setu, '');
assert.equal(submittedWithoutCode.status, 200);
assert.equal((await submittedWithoutCode.json()).report.report_id, '2026-11-W3-08');
assert.equal(direct.rows().length, 1);
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
const branchHistory = (await (await mock.api('history', { branch_id: '08' })).json()).reports;
assert.equal(branchHistory.length, 4);
const otherBranch = branchHistory.find(row => row.branch_id === '03');
assert.equal(otherBranch.can_view_full, false);
assert.equal(Object.hasOwn(otherBranch, 'reporter_name'), false);
assert.equal(Object.hasOwn(otherBranch, 'remarks'), false);
const centralHistory = (await (await mock.api('history', { branch_id: '08' }, 'head-office-code')).json()).reports;
assert.ok(centralHistory.every(row => row.can_view_full));
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
  const mime = {
    '/': 'text/html', '/app.js': 'application/javascript', '/styles.css': 'text/css',
    '/lib/reports.mjs': 'application/javascript', '/assets/lpia-logo.png': 'image/png',
    '/data/active-students.json': 'application/json'
  };
  let endpointAvailable = false;
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname === '/api/reports') {
        if (!endpointAvailable) {
          res.writeHead(404, { 'Content-Type': 'text/html' }).end('Page not found.');
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        const origin = 'http://127.0.0.1:' + server.address().port;
        const response = await browserMock.handler(new Request(origin + req.url, {
          method: req.method, headers: req.headers, ...(body ? { body } : {})
        }), { ...browserMock.env, SITE_ORIGIN: origin });
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } else if (mime[pathname]) {
        res.writeHead(200, { 'Content-Type': mime[pathname] });
        res.end(await readFile(new URL('..' + (pathname === '/' ? '/index.html' : pathname), import.meta.url)));
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
    let showWeeklyReports = false;
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error));
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => {
        window.fullscreenRequested = true;
        return Promise.reject(new Error('Simulated fullscreen permission denial'));
      };
      window.open = url => { window.openedWindow = url; };
      window.print = () => { window.printCount = (window.printCount ?? 0) + 1; };
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async text => {
          if (window.rejectClipboard) throw new Error('Clipboard permission denied');
          window.copiedReport = text;
        } }
      });
    });
    const privateTestSha = 'a'.repeat(40);
    await page.route('https://api.github.com/repos/lpiaco/ar-lpia-co/git/ref/heads/report-data?*', route =>
      route.fulfill({
        json: { object: { sha: privateTestSha } }, headers: { 'Access-Control-Allow-Origin': '*' }
      }));
    await page.route('https://raw.githubusercontent.com/lpiaco/ar-lpia-co/' + privateTestSha + '/reports.csv?*', route =>
      route.fulfill({
        contentType: 'text/csv', headers: { 'Access-Control-Allow-Origin': '*' },
        body: encodeCSV(showWeeklyReports ? browserMock.rows() : [])
      }));
    const url = 'http://127.0.0.1:' + server.address().port;
    await page.goto(url);
    await page.getByRole('heading', { name: 'LPIA Academic Report' }).waitFor();
    const splashTiming = await page.locator('#start-screen').evaluate(screen => Object.fromEntries(
      screen.getAnimations({ subtree: true }).map(animation => [animation.animationName, animation.effect.getTiming()])
    ));
    assert.equal(splashTiming['splash-spin'].delay, splashTiming['splash-drop'].duration);
    const spinEnd = splashTiming['splash-spin'].delay + splashTiming['splash-spin'].duration;
    assert.ok(Math.abs(splashTiming['splash-reveal'].delay - spinEnd) < 1);
    const start = page.getByRole('button', { name: 'START', exact: true });
    await start.waitFor();
    await page.waitForFunction(() => document.getElementById('brand-logo').naturalWidth > 0);
    assert.ok(await page.locator('#brand-logo').isVisible());
    const splashLogo = await page.locator('#brand-logo').boundingBox();
    assert.equal(splashLogo.width, 168);
    await start.click();
    assert.equal(await page.evaluate(() => window.fullscreenRequested), true);
    const yearProgress = page.locator('#menu-year-progress');
    await yearProgress.getByRole('heading', { name: 'Enrollment trend · 2026' }).waitFor();
    assert.equal(await yearProgress.getByRole('button').count(), 11);
    await yearProgress.getByText('November · 1,599 students').waitFor();
    for (const viewport of [{ width: 360, height: 780 }, { width: 1366, height: 768 }]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.locator('#masthead .brand-heading img').isVisible());
      const menu = await page.locator('.menu-content').boundingBox();
      assert.ok(menu.x >= 0 && menu.x+menu.width <= viewport.width);
      const flag = await page.locator('#language-toggle').boundingBox();
      assert.ok(flag.x >= viewport.width/2 && flag.x+flag.width <= viewport.width);
      assert.ok(await page.locator('.month-bar i').first().evaluate(bar => bar.getBoundingClientRect().height > 0));
    }
    await page.setViewportSize({ width: 360, height: 780 });
    await yearProgress.getByRole('button', { name: 'January 2026 · 1,485 students' }).click();
    await page.getByRole('heading', { name: 'January 2026 · Monthly figures' }).waitFor();
    await page.locator('#stats-summary').getByText('1,485', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
    await page.getByRole('button', { name: 'Enrollment details' }).click();
    await page.getByRole('heading', { name: 'November 2026 · Monthly figures' }).waitFor();
    assert.equal(await page.locator('#stats-period').inputValue(), 'monthly-2026-11');
    await page.getByText('Figures for 23 of 24 listed branches.').waitFor();
    await page.locator('#stats-summary').getByText('1,599', { exact: true }).waitFor();
    await page.locator('#stats-summary').getByText('1,305', { exact: true }).waitFor();
    await page.locator('#stats-summary').getByText('294', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Jatiwarna · 21 students' }).waitFor();
    await page.getByRole('heading', { name: 'Tanah Baru · 74 students' }).waitFor();
    const historicalDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const historicalCsv = await readFile(await (await historicalDownload).path(), 'utf8');
    assert.match(historicalCsv, /"Total of recorded branches","1398","296","1694"/);
    assert.match(historicalCsv, /"Total in LPIA Active Students","1305","294","1599"/);
    await page.getByRole('heading', { name: 'Solo · 0 students' }).waitFor();
    assert.equal(await page.getByText('Total active classes', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: /Jatisampurna/ }).count(), 0);
    await page.locator('#stats-period').selectOption('monthly-2023-01');
    await page.getByRole('heading', { name: 'January 2023 · Monthly figures' }).waitFor();
    await page.getByRole('button', { name: 'Back to menu' }).click();
    showWeeklyReports = true;
    await page.getByRole('button', { name: 'Enrollment details' }).click();
    await page.getByText('Reports from 1 of 24 listed branches.').waitFor();
    await page.getByRole('heading', { name: 'Pondok Gede · 87 students' }).waitFor();
    await page.locator('#stats-period').selectOption('2026-11-W2');
    await page.getByRole('heading', { name: 'Setu Bekasi · 73 students' }).waitFor();
    await page.locator('#stats-period').selectOption('monthly-reports-2026-11');
    await page.getByRole('heading', { name: 'November 2026 · Monthly reports' }).waitFor();
    await page.locator('#stats-summary').getByText('160', { exact: true }).waitFor();
    const statsDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const exportedStats = await statsDownload;
    assert.equal(exportedStats.suggestedFilename(), 'LPIA-monthly-reports-2026-11.csv');
    assert.match(await readFile(await exportedStats.path(), 'utf8'), /"Total","131","29","160"/);
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    assert.equal(await page.evaluate(() => window.printCount), 1);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#stats-controls').isVisible(), false);
    assert.equal(await page.locator('#app-content').evaluate(el => getComputedStyle(el).overflow), 'visible');
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('button', { name: 'New weekly report', exact: true }).click();
    const field = name => page.locator('[name="' + name + '"]');
    assert.ok(await page.locator('#masthead .brand-heading img').isVisible());
    assert.equal(await page.locator('#masthead .brand-heading').evaluate(el => getComputedStyle(el).fontWeight), '800');
    assert.equal(await page.locator('legend').first().evaluate(el => getComputedStyle(el).fontWeight), '800');
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight), 780);
    const picker = page.locator('#field-picker');
    const openPicker = async (name, expectedHeight) => {
      await page.getByRole('button', { name }).click();
      await picker.waitFor();
      const box = await picker.boundingBox();
      assert.ok(Math.abs(box.height - expectedHeight) < 1);
      assert.ok(Math.abs(box.y + box.height / 2 - 390) < 1);
    };
    await openPicker(/^Branch,/, 390);
    assert.ok(await picker.locator('#picker-options').evaluate(el => el.scrollHeight > el.clientHeight));
    await picker.getByRole('button', { name: 'Setu Bekasi', exact: true }).click();
    await openPicker(/^Reporting year,/, 585);
    assert.equal(await picker.locator('#picker-options button').count(), 11);
    assert.equal(await picker.locator('#picker-options button').last().textContent(), '2036');
    await picker.getByRole('button', { name: '2026', exact: true }).click();
    await openPicker(/^Reporting month,/, 585);
    await picker.getByRole('button', { name: 'November', exact: true }).click();
    await openPicker(/^Reporting week,/, 390);
    assert.equal(await picker.locator('#picker-options button').count(), 5);
    assert.ok(await picker.getByRole('button', { name: 'Close' }).isVisible());
    await picker.getByRole('button', { name: 'Week 3', exact: true }).click();
    await field('reporter_name').fill(setu.reporter_name);
    await page.getByText('Filled from Week 2, November 2026.').waitFor({ state: 'attached' });
    assert.equal(await field('academic_staff').inputValue(), '2');
    assert.equal(await field('computer_students_out').getAttribute('type'), 'number');
    assert.equal(await field('computer_students_out').getAttribute('autocomplete'), 'off');
    assert.equal(await page.locator('#report-form input[type="password"]').count(), 0);
    const fillReportSections = async () => {
      for (const key of COUNT_FIELDS) {
        if (!await field(key).isVisible()) await page.locator('#step-next').click();
        await field(key).fill(String(setu[key]));
      }
      await page.locator('#step-next').click();
      await field('remarks').fill(setu.remarks);
    };
    await fillReportSections();
    assert.equal(await page.locator('#english_students_per_class').textContent(), '3');
    assert.equal(await page.locator('#computer_students_per_class').textContent(), '1.4');
    const review = page.locator('#review-dialog');
    const submit = page.locator('#submit');
    const reviewAndSubmit = async () => {
      await submit.click();
      await review.locator('#review-submit').click();
    };
    const check = page.locator('#check');
    await submit.scrollIntoViewIfNeeded();
    assert.ok(Math.abs((await submit.boundingBox()).y - (await check.boundingBox()).y) < 1);
    // Switching language preserves all inputs, and editing within review does not write a report.
    await page.locator('#language-toggle').click();
    await page.locator('[data-language=id]').click();
    assert.equal(await page.locator('html').getAttribute('lang'),'id');
    assert.equal(await field('remarks').inputValue(),setu.remarks);
    await submit.click();
    await review.getByRole('button',{name:'Edit · Siswa dan kelas',exact:true}).first().click();
    await field('active_english_students').fill('67');
    assert.equal(await page.locator('#total_active_students').textContent(),'74');
    await field('active_english_students').fill(String(setu.active_english_students));
    await page.locator('#language-toggle').click();
    await page.locator('[data-language=en]').click();
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.equal(browserMock.rows().length,2);
    await reviewAndSubmit();
    const fallbackMessage = 'Your report is ready to send.';
    await page.getByText(fallbackMessage).waitFor();
    assert.equal(await field('reporter_name').inputValue(), setu.reporter_name);
    assert.equal(await page.evaluate(() => window.openedWindow), undefined);
    assert.equal(await page.getByText(/Direct submission is unavailable/).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Copy report' }).count(), 0);
    const fallback = page.getByRole('link', { name: 'Continue submission' });
    const issueURL = new URL(await fallback.getAttribute('href'));
    assert.equal(issueURL.searchParams.get('title'), 'LPIA Academic Report');
    assert.deepEqual(JSON.parse(issueURL.searchParams.get('body')), setu);

    await page.evaluate(() => { window.rejectClipboard = true; });
    const longRemarks = '😀'.repeat(500);
    await field('remarks').fill(longRemarks);
    await reviewAndSubmit();
    await fallback.waitFor();
    assert.equal(new URL(await fallback.getAttribute('href')).searchParams.has('body'), false);
    await fallback.evaluate(link => link.addEventListener('click', event => event.preventDefault(), { once: true }));
    await fallback.click();
    await page.getByText('Copy the selected report text.').waitFor();
    assert.equal(JSON.parse(await page.getByLabel('Report to copy').inputValue()).remarks, longRemarks);
    await field('remarks').fill(setu.remarks);
    await reviewAndSubmit();
    await page.getByText(fallbackMessage).waitFor();
    assert.equal(await page.locator('#report-form input[type="password"]').count(), 0);
    await fallback.evaluate(link => {
      link.href = 'https://github.com/lpiaco/ar-lpia-co/issues/new';
      link.addEventListener('click', event => {
        event.preventDefault();
        window.clickedIssueUrl = event.currentTarget.href;
      }, { once: true });
    });
    await fallback.click();
    await page.getByText('The report is filled in. Click Create to send it.').waitFor();
    const clickedURL = new URL(await page.evaluate(() => window.clickedIssueUrl));
    const prefilledReport = JSON.parse(clickedURL.searchParams.get('body'));
    assert.deepEqual(prefilledReport, setu);
    assert.equal(Object.hasOwn(prefilledReport, 'accessCode'), false);
    assert.equal(await page.evaluate(() => window.copiedReport), undefined);
    assert.equal(await page.getByLabel('Report to copy').isVisible(), false);
    assert.equal((await browserMock.api('submit', prefilledReport)).status, 200);
    await page.getByRole('heading', { name: 'Report saved' }).waitFor();
    assert.ok((await page.getByRole('link', { name: /WhatsApp/ }).getAttribute('href')).startsWith('https://wa.me/?text='));
    await page.getByRole('button', { name: 'View saved report' }).click();
    await page.getByText("Coordinator's/Staff's Name: " + setu.reporter_name).waitFor();
    const detailDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    assert.equal((await detailDownload).suggestedFilename(), '2026-11-W3-08.csv');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'View report history' }).click();
    await page.getByText('Report just opened').waitFor();
    assert.equal(await page.locator('#history-list article').count(), 3);
    assert.equal(await page.locator('#history-list button').count(), 3);
    await page.locator('#history-search').fill('Week 2');
    assert.equal(await page.locator('#history-list article').count(), 1);
    await page.getByRole('button', { name: 'Back to saved report' }).click();
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByText('Thank you for using Academic Report App.').waitFor();
    assert.equal(await page.locator('#report-form input[type="password"]').count(), 0);
    assert.equal(await page.locator('#masthead').isVisible(), false);
    assert.equal(await page.locator('#finished-screen').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
    await page.reload();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.getByText('Monthly students · November 2026').waitFor();
    await page.getByText('New reports received', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Enrollment details' }).click();
    await page.getByText('Reports from 2 of 24 listed branches.').waitFor();
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByText('Thank you for using Academic Report App.').waitFor();

    endpointAvailable = true;
    delete browserMock.env.REPORT_ACCESS_CODES;
    await page.reload();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.getByRole('button', { name: 'New weekly report' }).click();
    for (const name of ['branch_id', 'reporting_year', 'reporting_month', 'reporting_week']) {
      await field(name).evaluate((control, value) => {
        control.value = value;
        control.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(setu[name]));
    }
    await field('reporter_name').fill(setu.reporter_name);
    await fillReportSections();
    await reviewAndSubmit();
    await page.getByRole('heading', { name: 'Report saved' }).waitFor();
    assert.match(await page.locator('#saved-receipt').textContent(), /2026-11-W3-08/);
    assert.equal(await page.locator('#report-form input[type="password"]').count(), 0);
    assert.equal(browserMock.rows().length, 3);

    showWeeklyReports = false;
    let mirrorAvailable = false;
    let mirrorRequests = 0;
    const historicalSnapshot = await readFile(new URL('../data/active-students.json', import.meta.url), 'utf8');
    await page.route(url + '/data/active-students.json*', route => route.fulfill({ status: 503 }));
    await page.route('https://raw.githubusercontent.com/lpiaco/ar-lpia-co/main/data/active-students.json?*', route => {
      mirrorRequests += 1;
      return route.fulfill(mirrorAvailable
        ? { contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: historicalSnapshot }
        : { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
    await page.reload();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    const openStatus = page.getByRole('button', { name: 'Enrollment details' });
    await openStatus.click();
    await page.getByText('Student statistics could not be loaded.', { exact: true }).waitFor();
    mirrorAvailable = true;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('heading', { name: 'November 2026 · Monthly figures' }).waitFor();
    await page.locator('#stats-summary').getByText('1,599', { exact: true }).waitFor();
    const requestsAfterRecovery = mirrorRequests;
    assert.ok(requestsAfterRecovery >= 2);
    await page.getByRole('button', { name: 'Back to menu', exact: true }).click();
    await yearProgress.getByText('November · 1,599 students').waitFor();
    assert.equal(mirrorRequests, requestsAfterRecovery);
    assert.deepEqual(pageErrors, []);
    console.log('PASS browser mock: statistics recovery, START, entry, verified receipt, WhatsApp link, history and both finish paths');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
