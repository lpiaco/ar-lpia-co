import {
  BRANCHES, FIRST_REPORT_YEAR, LAST_REPORT_YEAR, decodeCSV, displayBranchName,
  encodeCSV, makeReport, monthlyReportStats, publicStats, reportId
} from './lib/reports.mjs?v=report-views';

// Public options. Leave blank to use the WhatsApp contact picker.
const ACADEMIC_OFFICE_WHATSAPP = '';
const REPORTS_API = '/api/reports';
const GITHUB_ISSUE_URL = 'https://github.com/lpiaco/ar-lpia-co/issues/new?title=LPIA%20Academic%20Report';
const MAX_GITHUB_ISSUE_URL_LENGTH = 4000;
const REPORT_CSV_ROOT = 'https://raw.githubusercontent.com/lpiaco/ar-lpia-co/';
const REPORT_DATA_REF = 'https://api.github.com/repos/lpiaco/ar-lpia-co/git/ref/heads/report-data';
const MONTHLY_STATS_FILES = [
  './data/active-students.json?v=source-totals',
  './data/active-students.json',
  REPORT_CSV_ROOT + 'main/data/active-students.json?v=source-totals'
].map(path => new URL(path, import.meta.url));

const COUNT_LIMIT = 1000000;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];
const FIELD_GROUPS = {
  'recruits-fields': {
    new_recruits_english: 'English',
    new_recruits_computer: 'Computer'
  },
  'academia-fields': {
    academic_coordinators: 'Academic Coordinators',
    academic_staff: 'Academic Staff',
    permanent_english_instructors: 'Permanent English Instructors',
    permanent_computer_instructors: 'Permanent Computer Instructors',
    freelance_english_instructors: 'Freelance English Instructors',
    freelance_computer_instructors: 'Freelance Computer Instructors'
  },
  'test-fields': {
    english_placement: 'English Placement',
    english_promotion: 'English Promotion',
    computer_counseling: 'Computer Counseling',
    computer_promotion: 'Computer Promotion'
  },
  'active-fields': {
    active_english_students: 'Active English Students',
    active_english_classes: 'Active English Classes',
    active_computer_students: 'Active Computer Students',
    active_computer_classes: 'Active Computer Classes'
  },
  'movement-fields': {
    english_students_in: 'English Students IN',
    english_students_out: 'English Students OUT',
    computer_students_in: 'Computer Students IN',
    computer_students_out: 'Computer Students OUT'
  }
};
const TOTAL_GROUPS = {
  'active-totals': {
    total_active_students: 'Total Active Students',
    total_active_classes: 'Total Active Classes'
  },
  'class-averages': {
    english_students_per_class: 'English Students per Class',
    computer_students_per_class: 'Computer Students per Class'
  },
  'movement-totals': {
    english_net_movement: 'English Net Movement',
    computer_net_movement: 'Computer Net Movement',
    total_students_in: 'Total Students IN',
    total_students_out: 'Total Students OUT',
    total_net_movement: 'Total Net Movement'
  }
};
const PERIOD_FIELDS = ['branch_id', 'reporting_year', 'reporting_month', 'reporting_week'];
const form = document.querySelector('#report-form');
const field = name => form.elements.namedItem(name);
const countNames = Object.values(FIELD_GROUPS).flatMap(Object.keys);
const academicNames = Object.keys(FIELD_GROUPS['academia-fields']);
const carriedAcademicFields = new Set();
const feedback = document.querySelector('#feedback');
const academicFeedback = document.querySelector('#academic-feedback');
const submitButton = document.querySelector('#submit');
const checkButton = document.querySelector('#check');
let formatCount = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
let busy = false;
let activeScreen = 'start';
let savedReport;
let currentDetailReport;
let academicSource;
let academicRequest = 0;
const pickerTriggers = new Map();
let pickerTrigger;
let historyReports = [];
let statsPeriods = [];
let monthlyStatsRequest;
let fallbackReport;
let checkingFallback;

class DirectSubmissionUnavailable extends Error {}

function populate() {
  BRANCHES.map((name, index) => ({ name, id: String(index + 1).padStart(2, '0') }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .forEach(({ name, id }) => field('branch_id').add(new Option(name, id)));
  for (let year = FIRST_REPORT_YEAR; year <= LAST_REPORT_YEAR; year += 1) {
    field('reporting_year').add(new Option(String(year), String(year)));
  }
  MONTHS.forEach((name, index) => field('reporting_month').add(new Option(name, String(index + 1))));

  const today = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric'
  }).formatToParts();
  const currentYear = Number(today.find(part => part.type === 'year').value);
  field('reporting_year').value = String(Math.max(FIRST_REPORT_YEAR, Math.min(LAST_REPORT_YEAR, currentYear)));
  field('reporting_month').value = today.find(part => part.type === 'month').value;

  Object.entries(FIELD_GROUPS).forEach(([group, fields]) => {
    const container = document.getElementById(group);
    Object.entries(fields).forEach(([name, title]) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      label.textContent = title;
      input.type = 'number';
      input.name = name;
      input.inputMode = 'numeric';
      input.min = '0';
      input.max = String(COUNT_LIMIT);
      input.step = '1';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.required = true;
      label.append(input);
      container.append(label);
    });
  });
  Object.entries(TOTAL_GROUPS).forEach(([group, totals]) => {
    const container = document.getElementById(group);
    Object.entries(totals).forEach(([name, title]) => {
      const item = document.createElement('div');
      const label = document.createElement('dt');
      const value = document.createElement('dd');
      label.textContent = title;
      value.id = name;
      item.append(label, value);
      container.append(item);
    });
  });

}

function parseCount(raw) {
  if (!/^[0-9]{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= COUNT_LIMIT ? value : null;
}

function updateTotals() {
  const values = Object.fromEntries(countNames.map(name => [name, parseCount(field(name).value)]));
  const sum = (...numbers) => numbers.includes(null) ? null : numbers.reduce((total, number) => total + number, 0);
  const difference = (left, right) => left === null || right === null ? null : left - right;
  const average = (students, classes) => students !== null && classes > 0 ? students / classes : null;
  const totalIn = sum(values.english_students_in, values.computer_students_in);
  const totalOut = sum(values.english_students_out, values.computer_students_out);
  const totals = {
    total_active_students: sum(values.active_english_students, values.active_computer_students),
    total_active_classes: sum(values.active_english_classes, values.active_computer_classes),
    english_students_per_class: average(values.active_english_students, values.active_english_classes),
    computer_students_per_class: average(values.active_computer_students, values.active_computer_classes),
    english_net_movement: difference(values.english_students_in, values.english_students_out),
    computer_net_movement: difference(values.computer_students_in, values.computer_students_out),
    total_students_in: totalIn,
    total_students_out: totalOut,
    total_net_movement: difference(totalIn, totalOut)
  };
  Object.entries(totals).forEach(([name, value]) => {
    document.getElementById(name).textContent = value === null ? '—' : formatCount.format(value);
  });

  const unusual = [];
  if (values.active_english_students > 0 && values.active_english_classes === 0) unusual.push('English');
  if (values.active_computer_students > 0 && values.active_computer_classes === 0) unusual.push('Computer');
  const warning = document.querySelector('#active-warning');
  warning.hidden = !unusual.length;
  const programs = unusual.map(tr).join(' ' + tr('and') + ' ');
  const warningText = unusual.length
    ? `${tr('Review')} ${programs}. ${tr('Active students were entered with 0 active classes.')}` : '';
  if (warning.textContent !== warningText) warning.textContent = warningText;
}

function selectedPeriod() {
  return {
    branch_id: field('branch_id').value,
    reporting_year: Number(field('reporting_year').value),
    reporting_month: Number(field('reporting_month').value),
    reporting_week: Number(field('reporting_week').value)
  };
}

function periodText(period) {
  return `${tr('Week')} ${period.reporting_week}, ${monthLabel(period.reporting_month)} ${period.reporting_year}`;
}

function updateSelection() {
  const period = selectedPeriod();
  document.querySelector('#selection').textContent = Object.values(period).every(Boolean)
    ? `${BRANCHES[Number(period.branch_id) - 1]} · ${periodText(period)}`
    : tr('Choose a branch and reporting period.');
}

function collectReport(operation, output) {
  const report = selectedPeriod();
  const errors = [];
  const mark = (name, message) => {
    const control = field(name);
    control.setCustomValidity(tr(message));
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      const visibleControl = pickerTriggers.get(name) ?? control;
      visibleControl.setAttribute('aria-invalid', 'true');
      errors.push(visibleControl);
    } else {
      control.removeAttribute('aria-invalid');
      pickerTriggers.get(name)?.removeAttribute('aria-invalid');
    }
  };
  const periodChecks = {
    branch_id: /^(0[1-9]|1[0-9]|2[0-4])$/.test(report.branch_id),
    reporting_year: Number.isInteger(report.reporting_year) && report.reporting_year >= FIRST_REPORT_YEAR &&
      report.reporting_year <= LAST_REPORT_YEAR,
    reporting_month: Number.isInteger(report.reporting_month) && report.reporting_month >= 1 && report.reporting_month <= 12,
    reporting_week: Number.isInteger(report.reporting_week) && report.reporting_week >= 1 && report.reporting_week <= 5
  };
  PERIOD_FIELDS.forEach(name => mark(name, periodChecks[name] ? '' : 'Select a value.'));
  if (operation === 'submit') {
    report.reporter_name = field('reporter_name').value.trim();
    report.remarks = field('remarks').value.replace(/\r\n?/g, '\n');
    mark('reporter_name', report.reporter_name && report.reporter_name.length <= 100 ? '' : "Enter the coordinator's or staff member's name.");
    mark('remarks', report.remarks.length <= 1000 ? '' : 'Keep remarks to 1,000 characters or fewer.');
    countNames.forEach(name => {
      const value = parseCount(field(name).value);
      mark(name, value === null ? 'Enter a whole number from 0 to 1,000,000.' : '');
      report[name] = value;
    });
  }
  if (errors.length) {
    showFeedback(output, 'error', 'Check the highlighted fields.');
    const section = errors[0].closest('fieldset');
    if (section?.hidden) setEntryStep(entrySections.indexOf(section));
    errors[0].focus();
    if (!errors[0].classList.contains('picker-trigger')) errors[0].reportValidity();
    return null;
  }
  return report;
}

function showFeedback(output, kind, ...lines) {
  output.dataset.kind = kind;
  output.replaceChildren(...lines.map(text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = tr(text);
    return paragraph;
  }));
}

function setBusy(value) {
  busy = value;
  submitButton.disabled = value;
  checkButton.disabled = value;
  byId('step-next').disabled = value || entryStep === entrySections.length - 1;
  byId('step-back').disabled = value || entryStep === 0;
  document.querySelectorAll('.workspace-nav button').forEach(link => { link.disabled = value; });
  document.querySelector('#entry-back').disabled = value;
  form.querySelectorAll('fieldset').forEach(section => { section.disabled = value; });
}

async function autoFillAcademicNumbers() {
  const request = ++academicRequest;
  carriedAcademicFields.forEach(name => { field(name).value = ''; });
  carriedAcademicFields.clear();
  academicFeedback.replaceChildren();

  const period = selectedPeriod();
  if (!period.branch_id) return;
  if (!academicSource) {
    academicSource = loadPublicReports().catch(error => {
      academicSource = undefined;
      throw error;
    });
  }

  try {
    const reports = await academicSource;
    if (request !== academicRequest) return;
    const limit = period.reporting_week ? reportId(period) : null;
    const latest = reports.filter(row => row.branch_id === period.branch_id && (!limit || row.report_id <= limit))
      .sort((left, right) => right.report_id.localeCompare(left.report_id))[0];
    if (!latest) return;
    for (const name of academicNames) {
      const control = field(name);
      if (control.value !== '') continue;
      control.value = String(latest[name]);
      control.setCustomValidity('');
      control.removeAttribute('aria-invalid');
      carriedAcademicFields.add(name);
    }
    if (carriedAcademicFields.size) {
      showFeedback(academicFeedback, 'info', tr('Filled from') + ' ' + periodText(latest) + '.');
    }
  } catch {
    if (request === academicRequest) {
      showFeedback(academicFeedback, 'info', 'Previous counts could not be loaded. You can enter them here.');
    }
  }
}

const byId = id => document.getElementById(id);
const headings = {
  menu: 'menu-title', status: 'status-title', entry: 'entry-title',
  saved: 'saved-title', history: 'history-title', detail: 'detail-title', finished: 'finished-title'
};

function showScreen(name) {
  activeScreen = name;
  document.body.dataset.screen = name;
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === name) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  document.querySelectorAll('.screen').forEach(section => { section.hidden = section.id !== name + '-screen'; });
  const standalone = name === 'start' || name === 'menu' || name === 'finished';
  document.body.classList.toggle('app-running', name !== 'start' && name !== 'finished');
  byId('app-content').hidden = standalone;
  byId('masthead').hidden = name === 'start' || name === 'finished';
  byId('app-content').scrollTop = 0;
  window.scrollTo(0, 0);
  byId(headings[name])?.focus({ preventScroll: true });
  if (name === 'menu') {
    showMenuYearProgress();
    showMenuTotals();
  }
  if (name === 'entry') {
    academicSource = undefined;
    autoFillAcademicNumbers();
  }
}

function beginFullscreen() {
  const element = document.documentElement;
  try {
    const request = element.requestFullscreen || element.webkitRequestFullscreen || element.webkitRequestFullScreen;
    if (request) Promise.resolve(request.call(element)).catch(() => {});
  } catch {
    // The app stays usable when fullscreen is restricted by the browser.
  }
  showScreen('menu');
}

async function loadPublicReports() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const options = { cache: 'no-store', signal: controller.signal };
    let ref = 'report-data';
    try {
      const response = await fetch(REPORT_DATA_REF + '?read=' + Date.now(), options);
      if (response.ok) {
        const head = await response.json();
        if (/^[0-9a-f]{40}$/.test(head.object?.sha ?? '')) ref = head.object.sha;
      }
    } catch {
      // The public branch URL is still usable if the reference API is unavailable.
    }
    const response = await fetch(REPORT_CSV_ROOT + ref + '/reports.csv?read=' + Date.now(), options);
    if (!response.ok) throw new Error('The report CSV could not be loaded.');
    return decodeCSV(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

function showReceipt(report) {
  savedReport = report;
  clearSubmissionFallback();
  clearSubmissionAccess();
  byId('saved-receipt').textContent = report.branch_name + ' · ' + periodText(report) + ' · ' + report.report_id;
  const text = [
    tr('LPIA Academic Report'), report.branch_name + ' · ' + periodText(report),
    'Report ID ' + report.report_id,
    'Active students: ' + report.total_active_students + ' (English ' + report.active_english_students +
      ', Computer ' + report.active_computer_students + ')',
    'Active classes: ' + report.total_active_classes,
    'Student movement: ' + report.total_students_in + ' IN / ' + report.total_students_out + ' OUT'
  ].join('\n');
  byId('share-whatsapp').href = 'https://wa.me/' + ACADEMIC_OFFICE_WHATSAPP + '?text=' + encodeURIComponent(text);
  showScreen('saved');
}

function clearSubmissionFallback() {
  fallbackReport = undefined;
  byId('submission-fallback').hidden = true;
  byId('fallback-github').href = GITHUB_ISSUE_URL;
  byId('fallback-copy-manually').hidden = true;
  byId('fallback-body').value = '';
  byId('fallback-status').textContent = '';
}

function issueUrlWithReport(body) {
  const prefilled = GITHUB_ISSUE_URL + '&body=' + encodeURIComponent(body);
  return prefilled.length <= MAX_GITHUB_ISSUE_URL_LENGTH ? prefilled : GITHUB_ISSUE_URL;
}

function showSubmissionFallback(report) {
  fallbackReport = report;
  const body = JSON.stringify(report);
  const issueUrl = issueUrlWithReport(body);
  byId('fallback-body').value = body;
  byId('fallback-github').href = issueUrl;
  byId('fallback-instructions').textContent = tr(issueUrl === GITHUB_ISSUE_URL
    ? 'Continue submission, paste the report into Body, and click Create.'
    : 'Continue submission. The report is already in Body. Click Create to send it.');
  byId('submission-fallback').hidden = false;
}

async function continueToGitHub(event) {
  const report = fallbackReport;
  if (!report) {
    event.preventDefault();
    return;
  }
  const body = byId('fallback-body');
  const link = event.currentTarget;
  link.href = issueUrlWithReport(body.value);
  const prefilled = link.href !== GITHUB_ISSUE_URL;
  checkFallbackReceipt();
  if (prefilled) byId('fallback-status').textContent = tr('The report is filled in. Click Create to send it.');
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable.');
    await navigator.clipboard.writeText(body.value);
    if (!prefilled && fallbackReport === report) {
      byId('fallback-status').textContent = tr('Report copied. Paste it into Body to finish sending.');
    }
  } catch {
    if (prefilled || fallbackReport !== report) return;
    byId('fallback-copy-manually').hidden = false;
    body.focus();
    body.select();
    byId('fallback-status').textContent = tr('Copy the selected report text.');
  }
}

function matchesSubmission(expected, saved) {
  return saved?.report_id === reportId(expected) &&
    Object.keys(expected).every(key => expected[key] === saved[key]);
}

async function checkFallbackReceipt() {
  const expected = fallbackReport;
  if (!expected || checkingFallback === expected) return;
  checkingFallback = expected;
  const status = byId('fallback-status');
  status.textContent = tr('Waiting for confirmation that the report was saved…');
  try {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      if (fallbackReport !== expected || activeScreen !== 'entry') return;
      let saved;
      try {
        saved = (await loadPublicReports()).find(row => row.report_id === reportId(expected));
      } catch {
        // GitHub may still be publishing the report.
      }
      if (fallbackReport !== expected || activeScreen !== 'entry') return;
      if (matchesSubmission(expected, saved)) {
        academicSource = undefined;
        showReceipt(saved);
        return;
      }
      if (saved) {
        status.textContent = tr('A different report already exists for this branch and period. Open Check Report to review it.');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 4000));
    }
    if (fallbackReport === expected && activeScreen === 'entry') {
      status.textContent = tr('This report is still waiting for confirmation. Use Check Report to check again.');
    }
  } finally {
    if (checkingFallback === expected) checkingFallback = undefined;
  }
}

function showSubmissionAccess() {
  const access = byId('submission-access');
  if (!byId('submission-code')) access.append(byId('submission-access-field').content.cloneNode(true));
  byId('submission-code').value = '';
  access.hidden = false;
}

function clearSubmissionAccess() {
  const access = byId('submission-access');
  access.hidden = true;
  access.replaceChildren();
}

async function submitDirectly(report) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(REPORTS_API, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'submit', report, accessCode: byId('submission-code')?.value ?? ''
      })
    });
    if ([404, 405, 503].includes(response.status) ||
        !response.headers.get('Content-Type')?.includes('application/json')) {
      throw new DirectSubmissionUnavailable();
    }

    const result = await response.json();
    if (response.status === 403 && result.message === 'The access code is invalid for this branch.') {
      showSubmissionAccess();
      throw new Error('Enter your branch’s access code, then review and submit the report.');
    }
    if (!response.ok) throw new Error(result.message || 'The report could not be saved.');
    if (!['saved', 'already_saved'].includes(result.status) || !matchesSubmission(report, result.report)) {
      throw new Error('The saved report could not be verified. Use Check Report before trying again.');
    }
    academicSource = undefined;
    showReceipt(result.report);
  } finally {
    clearTimeout(timeout);
  }
}

async function sendReport(operation) {
  if (busy || activeScreen !== 'entry') return;
  const report = collectReport(operation, feedback);
  if (!report) return;
  if (operation === 'submit') clearSubmissionFallback();
  setBusy(true);
  showFeedback(feedback, 'progress', operation === 'submit' ? 'Saving and verifying your report…' : 'Checking saved reports…');
  try {
    if (operation === 'submit') {
      await submitDirectly(report);
    } else {
      const saved = (await loadPublicReports()).find(row => row.report_id === reportId(report));
      if (saved) showReceipt(saved);
      else showFeedback(feedback, 'info', 'No saved report was found for this branch and period.');
    }
  } catch (error) {
    if (error instanceof DirectSubmissionUnavailable) {
      clearSubmissionAccess();
      showFeedback(feedback, 'info', 'Your report is ready to send.');
      showSubmissionFallback(report);
    } else {
      showFeedback(feedback, 'error', error.name === 'AbortError'
        ? 'The request timed out. Use Check Report before trying again.'
        : error.message);
    }
  } finally {
    setBusy(false);
    if (activeScreen === 'entry') {
      const code = byId('submission-code');
      if (operation === 'submit' && code && !code.value) code.focus();
      else feedback.focus({ preventScroll: true });
    }
  }
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = tr(text);
  if (className) element.className = className;
  return element;
}

function metricList(entries) {
  const list = document.createElement('dl');
  list.className = 'totals stats-grid';
  entries.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.append(textElement('dt', label), textElement('dd',
      value === null ? '—' : typeof value === 'number' ? formatCount.format(value) : value));
    list.append(item);
  });
  return list;
}

function totalStudents({ source_totals, branches }) {
  if (source_totals) return source_totals.english + source_totals.computer;
  return branches.reduce((total, row) => total + (row.english ?? 0) + (row.computer ?? 0), 0);
}

async function showMenuYearProgress() {
  try {
    const figures = await loadMonthlyStats();
    if (activeScreen !== 'menu' || !figures.length) return;
    const year = Math.max(...figures.map(period => period.reporting_year));
    const months = figures.filter(period => period.reporting_year === year)
      .sort((left, right) => left.reporting_month - right.reporting_month);
    const latest = months.at(-1);
    renderOverviewPanel(latest);
    const maximum = Math.max(1,...months.map(totalStudents));
    byId('menu-year-title').textContent = tr('Enrollment trend') + ' · ' + year;
    byId('menu-year-latest').textContent = monthLabel(latest.reporting_month) + ' · ' + formatCount.format(totalStudents(latest)) + ' ' + tr('students');
    byId('menu-year-months').replaceChildren(...months.map(period => {
      const month = monthLabel(period.reporting_month);
      const students = totalStudents(period);
      const total = formatCount.format(students);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.setAttribute('aria-label', month + ' ' + year + ' · ' + total + ' ' + tr('students'));
      const bar = textElement('span', '', 'month-bar');
      bar.setAttribute('aria-hidden','true');
      const fill = document.createElement('i');
      fill.style.height = (students / maximum * 100) + '%';
      bar.append(fill);
      button.append(bar, textElement('span', month.slice(0, 3)), textElement('strong', total));
      button.addEventListener('click', () => openStats(period.key));
      return button;
    }));
    byId('menu-year-progress').hidden = false;
  } catch {
    // The reporting menu remains usable if the historical snapshot is unavailable.
  }
}

async function showMenuTotals() {
  const container = byId('menu-report-totals');
  try {
    const reports = await loadPublicReports();
    if (activeScreen !== 'menu') return;
    if (!reports.length) {
      container.hidden = true;
      container.replaceChildren();
      return;
    }
    const [weekly] = publicStats(reports);
    const [monthly] = monthlyReportStats(reports);
    container.replaceChildren(
      textElement('p', 'New reports received', 'hint'),
      metricList([
        [tr('Weekly students') + ' · ' + periodText(weekly), totalStudents(weekly)],
        [tr('Monthly students') + ' · ' + monthLabel(monthly.reporting_month) + ' ' + monthly.reporting_year, totalStudents(monthly)]
      ])
    );
    container.hidden = false;
  } catch {
    // The main menu remains usable when the reports cannot be loaded.
  }
}

async function openStats(periodKey) {
  showScreen('status');
  const output = byId('stats-feedback');
  byId('stats-summary').replaceChildren();
  byId('stats-controls').hidden = true;
  showFeedback(output, 'progress', 'Loading student statistics…');
  try {
    const [live, historical] = await Promise.allSettled([
      loadPublicReports().then(reports => [...publicStats(reports), ...monthlyReportStats(reports)]),
      loadMonthlyStats()
    ]);
    if (activeScreen !== 'status') return;
    statsPeriods = [...(live.value ?? []), ...(historical.value ?? [])].sort((left, right) =>
      right.reporting_year - left.reporting_year ||
      right.reporting_month - left.reporting_month ||
      (right.reporting_week ?? 0) - (left.reporting_week ?? 0) ||
      Number(Boolean(right.monthlyReport)) - Number(Boolean(left.monthlyReport))
    );
    if (!statsPeriods.length) {
      showFeedback(output, 'error', 'Student statistics could not be loaded.');
      const retry = textElement('button', 'Try again', 'secondary section-actions');
      retry.type = 'button';
      retry.addEventListener('click', () => openStats(periodKey));
      output.append(retry);
      return;
    }
    const select = byId('stats-period');
    const groups = [
      ['Weekly reports', statsPeriods.filter(period => period.reporting_week)],
      ['Monthly reports', statsPeriods.filter(period => period.monthlyReport)],
      ['Historical monthly figures', statsPeriods.filter(period => !period.reporting_week && !period.monthlyReport)]
    ];
    select.replaceChildren(...groups.filter(([, periods]) => periods.length).map(([label, periods]) => {
      const group = document.createElement('optgroup');
      group.dataset.label = label;
      group.label = tr(label);
      group.append(...periods.map(period => new Option(statsPeriodText(period), period.key)));
      return group;
    }));
    select.value = statsPeriods.some(period => period.key === periodKey) ? periodKey : statsPeriods[0].key;
    byId('stats-controls').hidden = false;
    output.replaceChildren();
    if (live.status === 'rejected') showFeedback(output, 'info', 'Saved reports could not be loaded.');
    else if (historical.status === 'rejected') showFeedback(output, 'info', 'Historical figures could not be loaded.');
    renderStats();
  } catch (error) {
    if (activeScreen === 'status') showFeedback(output, 'error',
      error.name === 'AbortError' ? 'Statistics took too long to load.' : error.message);
  }
}

function loadMonthlyStats() {
  monthlyStatsRequest ??= fetchMonthlyStats().catch(error => {
    monthlyStatsRequest = undefined;
    throw error;
  });
  return monthlyStatsRequest;
}

async function fetchMonthlyStats() {
  for (const url of MONTHLY_STATS_FILES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const periods = await response.json();
      if (!Array.isArray(periods) || !periods.length) continue;
      return periods.map(period => ({
        ...period, branches: period.branches.map(row => ({ ...row, branch: displayBranchName(row.branch) }))
      }));
    } catch {
      // Try the next copy when a request fails or the response is unreadable.
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('The monthly figures could not be loaded.');
}

function statsPeriodText(period) {
  return period.reporting_week
    ? periodText(period)
    : monthLabel(period.reporting_month) + ' ' + period.reporting_year +
      ' · ' + tr(period.monthlyReport ? 'Monthly reports' : 'Monthly figures');
}

function selectedStatsPeriod() {
  return statsPeriods.find(period => period.key === byId('stats-period').value);
}

function renderStats() {
  const period = selectedStatsPeriod();
  const branches = period.branches;
  const historical = !period.reporting_week && !period.monthlyReport;
  const sum = fieldName => branches.reduce((total, row) => total + (row[fieldName] ?? 0), 0);
  const average = (fieldName, total) => {
    const reported = branches.filter(row => row[fieldName] != null).length;
    return reported ? total / reported : null;
  };
  const branchEnglish = sum('english');
  const branchComputer = sum('computer');
  const english = period.source_totals?.english ?? branchEnglish;
  const computer = period.source_totals?.computer ?? branchComputer;
  const stats = [
    ['Total active students', english + computer], ['English students', english],
    ['Computer students', computer],
    ['Average English students per reporting branch', average('english', branchEnglish)],
    ['Average Computer students per reporting branch', average('computer', branchComputer)]
  ];
  if (!historical) {
    const englishClasses = sum('englishClasses');
    const computerClasses = sum('computerClasses');
    const inCount = sum('inCount');
    const outCount = sum('outCount');
    stats.push(
      ['Total active classes', englishClasses + computerClasses],
      ['English students per class', englishClasses ? english / englishClasses : null],
      ['Computer students per class', computerClasses ? computer / computerClasses : null],
      ['Total academic personnel', sum('academia')],
      ['Students IN', inCount], ['Students OUT', outCount], ['Net movement', inCount - outCount]
    );
  }
  const output = byId('stats-summary');
  const coverage = historical
    ? tr('Figures for') + ' ' + branches.length + ' ' + tr('of') + ' ' + period.listed_branches + ' ' + tr('listed branches.')
    : tr('Reports from') + ' ' + branches.length + ' ' + tr('of') + ' ' + BRANCHES.length + ' ' + tr('listed branches.');
  output.replaceChildren(
    textElement('h2', statsPeriodText(period)),
    textElement('p', coverage, 'hint'),
    metricList(stats),
    textElement('h2', 'Branch breakdown')
  );
  if (historical) {
    const message = period.source_totals
      ? 'Totals match the LPIA Active Students summary. The averages and breakdown use all recorded branch figures.'
      : 'Historical figures from LPIA Active Students.';
    output.firstElementChild.after(textElement('p', message, 'hint'));
  }
  if (period.monthlyReport) {
    output.firstElementChild.after(textElement('p',
      'Active counts use each branch’s latest weekly report. Student movement totals cover the weeks reported.', 'hint'));
  }
  const branchTotal = row => (row.english ?? 0) + (row.computer ?? 0);
  const valueText = value => value == null ? '—' : formatCount.format(value);
  const ranking = [...branches].sort((a, b) => branchTotal(b) - branchTotal(a) || a.branch.localeCompare(b.branch));
  const max = Math.max(1, branchTotal(ranking[0]));
  const list = document.createElement('div');
  list.className = 'stats-branches';
  for (const row of ranking) {
    const card = document.createElement('article');
    card.className = 'stat-branch';
    const total = branchTotal(row);
    const bar = document.createElement('meter');
    bar.max = max;
    bar.value = total;
    bar.setAttribute('aria-label', row.branch + ' ' + tr('active students'));
    const countLabel = ' ' + tr(row.english == null || row.computer == null ? 'students recorded' : 'students');
    const classes = historical ? '' : ' · ' + formatCount.format(row.englishClasses + row.computerClasses) + ' ' + tr('classes');
    card.append(textElement('h3', row.branch + ' · ' + formatCount.format(total) + countLabel), bar,
      textElement('p', tr('English') + ' ' + valueText(row.english) + ' · ' + tr('Computer') + ' ' + valueText(row.computer) + classes, 'hint'));
    if (period.monthlyReport) {
      card.append(textElement('p', tr('Latest: Week') + ' ' + row.latestWeek + ' · ' + row.weeksReported + ' ' + tr('weeks reported'), 'hint'));
    }
    list.append(card);
  }
  output.append(list);
}

function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadStats() {
  const period = selectedStatsPeriod();
  if (!period) return;
  const rows = [[
    'period', 'branch', 'english_students', 'computer_students', 'active_students',
    'english_classes', 'computer_classes', 'academic_personnel', 'students_in', 'students_out',
    'latest_reporting_week', 'weeks_reported'
  ], ...period.branches.map(row => [
    statsPeriodText(period), row.branch, row.english, row.computer, (row.english ?? 0) + (row.computer ?? 0),
    row.englishClasses, row.computerClasses, row.academia, row.inCount, row.outCount,
    row.latestWeek ?? period.reporting_week, row.weeksReported ?? (period.reporting_week ? 1 : '')
  ])];
  const sum = key => period.branches.some(row => row[key] != null)
    ? period.branches.reduce((total, row) => total + (row[key] ?? 0), 0)
    : '';
  const branchEnglish = sum('english');
  const branchComputer = sum('computer');
  rows.push([statsPeriodText(period), period.source_totals ? 'Total of recorded branches' : 'Total',
    branchEnglish, branchComputer, Number(branchEnglish) + Number(branchComputer),
    sum('englishClasses'), sum('computerClasses'), sum('academia'), sum('inCount'), sum('outCount'), '', '']);
  if (period.source_totals) {
    rows.push([statsPeriodText(period), 'Total in LPIA Active Students',
      period.source_totals.english, period.source_totals.computer, totalStudents(period), '', '', '', '', '', '', '']);
  }
  const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
  downloadCsv('LPIA-' + period.key + '.csv', csv + '\r\n');
}

async function openHistory() {
  showScreen('history');
  const output = byId('history-feedback');
  byId('history-search').value = '';
  byId('history-list').replaceChildren();
  historyReports = [];
  showFeedback(output, 'progress', 'Loading saved reports…');
  try {
    const reports = await loadPublicReports();
    if (activeScreen !== 'history') return;
    historyReports = reports.sort((a, b) => b.report_id.localeCompare(a.report_id));
    if (!historyReports.some(report => report.report_id === savedReport.report_id)) {
      historyReports.unshift(savedReport);
    }
    output.replaceChildren();
    renderHistory();
  } catch (error) {
    if (activeScreen === 'history') showFeedback(output, 'error', error.message);
  }
}

function renderHistory() {
  const query = byId('history-search').value.trim().toLowerCase();
  const visible = historyReports.filter(report =>
    (report.branch_name + ' ' + periodText(report) + ' ' + report.report_id).toLowerCase().includes(query)
  );
  const output = byId('history-list');
  output.replaceChildren();
  if (!visible.length) {
    output.append(textElement('p', 'No reports match this search.', 'hint'));
    return;
  }
  for (const report of visible) {
    const current = report.report_id === savedReport.report_id;
    const card = document.createElement('article');
    card.className = 'history-card' + (current ? ' current' : '');
    const summary = document.createElement('div');
    summary.append(textElement('h3', report.branch_name + ' · ' + periodText(report)),
      textElement('p', report.report_id + ' · ' + formatCount.format(report.total_active_students) + ' ' + tr('active students'), 'hint'));
    if (current) summary.append(textElement('p', 'Report just opened', 'hint'));
    card.append(summary);
    if (report.can_view_full !== false) {
      const open = textElement('button', 'View report', 'secondary');
      open.type = 'button';
      open.addEventListener('click', () => showDetail(report, 'history'));
      card.append(open);
    }
    output.append(card);
  }
}

function showDetail(report, previousScreen) {
  currentDetailReport = report;
  detailPreviousScreen = previousScreen;
  const output = byId('report-detail');
  const when = new Intl.DateTimeFormat(language === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  }).format(new Date(report.submitted_at));
  output.replaceChildren(
    textElement('h2', report.branch_name + ' · ' + periodText(report)),
    textElement('p', report.report_id + ' · ' + tr('Saved') + ' ' + when + ' WIB', 'hint'),
    textElement('p', tr("Coordinator's/Staff's Name") + ": " + report.reporter_name),
    metricList([
      ['Total Active Students', report.total_active_students], ['Total Active Classes', report.total_active_classes],
      ['English Students per Class', report.active_english_classes ? report.active_english_students / report.active_english_classes : null],
      ['Computer Students per Class', report.active_computer_classes ? report.active_computer_students / report.active_computer_classes : null],
      ['Net Student Movement', report.total_net_movement]
    ])
  );
  const titles = ['New recruits', 'Academic Numbers', 'Tests', 'Students & Classes', 'Students (IN/OUT)'];
  Object.values(FIELD_GROUPS).forEach((fields, index) => {
    const panel = document.createElement('section');
    panel.className = 'report-panel';
    panel.append(textElement('h2', titles[index]), metricList(
      Object.entries(fields).map(([key, label]) => [label, report[key]])
    ));
    output.append(panel);
  });
  if (report.remarks) {
    const panel = document.createElement('section');
    panel.className = 'report-panel';
    panel.append(textElement('h2', 'Remarks'), textElement('p', report.remarks, 'notes'));
    output.append(panel);
  }
  byId('detail-back').onclick = () => showScreen(previousScreen);
  showScreen('detail');
}

function finish() {
  form.reset();
  reviewingEdits = false;
  setEntryStep(0);
  clearSubmissionFallback();
  clearSubmissionAccess();
  academicRequest += 1;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    try { Promise.resolve(exit?.call(document)).catch(() => {}); } catch { /* Browser-controlled fullscreen. */ }
  }
  savedReport = undefined;
  historyReports = [];
  carriedAcademicFields.clear();
  for (const id of ['history-list', 'report-detail', 'saved-receipt', 'feedback', 'academic-feedback']) {
    byId(id).replaceChildren();
  }
  byId('share-whatsapp').removeAttribute('href');
  showScreen('finished');
}

byId('start').addEventListener('click', beginFullscreen);
byId('open-status').addEventListener('click', () => openStats());
byId('open-entry').addEventListener('click', () => showScreen('entry'));
byId('status-yes').addEventListener('click', () => showScreen('entry'));
byId('status-no').addEventListener('click', finish);
byId('stats-period').addEventListener('change', renderStats);
byId('download-stats').addEventListener('click', downloadStats);
byId('download-detail').addEventListener('click', () => {
  if (currentDetailReport) downloadCsv(currentDetailReport.report_id + '.csv', encodeCSV([currentDetailReport]));
});
document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => window.print()));
document.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', () => showScreen('menu')));
document.querySelector('[data-saved]').addEventListener('click', () => showScreen('saved'));
byId('view-new-report').addEventListener('click', () => showDetail(savedReport, 'saved'));
byId('view-history').addEventListener('click', openHistory);
byId('history-search').addEventListener('input', renderHistory);
byId('finish').addEventListener('click', finish);
byId('fallback-github').addEventListener('click', continueToGitHub);

function initPickers() {
  const dialog = byId('field-picker');
  if (typeof dialog.showModal !== 'function') return;
  const optionsList = byId('picker-options');
  const settings = {
    branch: ['Branch', 'Select a branch'],
    year: ['Reporting year', 'Select a year'],
    month: ['Reporting month', 'Select a month'],
    week: ['Reporting week', 'Select a week']
  };
  for (const select of form.querySelectorAll('[data-picker]')) {
    const [name, placeholder] = settings[select.dataset.picker];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'secondary picker-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);

    const sync = () => {
      trigger.textContent = select.value ? select.selectedOptions[0].textContent : tr(placeholder);
      trigger.setAttribute('aria-label', tr(name) + ', ' + trigger.textContent);
    };

    trigger.addEventListener('click', () => {
      pickerTrigger = trigger;
      byId('picker-title').textContent = tr(name);
      dialog.dataset.kind = select.dataset.picker;
      const choices = [...select.options].filter(option => option.value).map(option => {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'secondary';
        choice.textContent = option.textContent;
        if (option.value === select.value) choice.setAttribute('aria-current', 'true');
        choice.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          dialog.close();
        });
        return choice;
      });
      optionsList.replaceChildren(...choices);
      dialog.showModal();
      const current = optionsList.querySelector('[aria-current]') ?? choices[0];
      current?.focus();
      optionsList.scrollTop = current ? current.offsetTop - choices[0].offsetTop : 0;
    });

    const label = select.closest('label');
    const wrapper = document.createElement('div');
    label.before(wrapper);
    wrapper.append(label, trigger);
    select.hidden = true;
    select.addEventListener('change', sync);
    pickerTriggers.set(select.name, trigger);
    pickerUpdates.push(sync);
    sync();
  }
  byId('picker-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => pickerTrigger?.focus({ preventScroll: true }));
  optionsList.addEventListener('keydown', event => {
    const choices = [...optionsList.querySelectorAll('button')];
    const index = choices.indexOf(document.activeElement);
    const target = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: choices.length - 1 }[event.key];
    if (target == null) return;
    event.preventDefault();
    choices[Math.max(0, Math.min(target, choices.length - 1))]?.focus();
  });
}

const translations = {
  'LPIA Academic Report':'Laporan Akademik LPIA',
  'LPIA Academic Reporter':'Pelaporan Akademik LPIA',
  'LPIA Academic Affairs':'Akademik LPIA',
  'START':'Mulai','Overview':'Ringkasan','Enrollment':'Data siswa','Weekly report':'Laporan mingguan',
  'Academic overview':'Ringkasan akademik',
  'Monitor enrollment across LPIA branches and manage weekly reports.':'Pantau jumlah siswa cabang LPIA dan kelola laporan mingguan.',
  'Enrollment details':'Rincian data siswa','New weekly report':'Buat laporan mingguan','Enrollment overview':'Ringkasan data siswa',
  'Academic population':'Jumlah siswa','Active students':'Siswa aktif','Student enrollment':'Jumlah siswa aktif',
  'English students':'Siswa Bahasa Inggris','Computer students':'Siswa Komputer','Reporting coverage':'Cakupan laporan',
  'Branches with available figures':'Cabang dengan data yang tersedia','Branches with figures':'Cabang dengan data',
  'Branches listed':'Cabang terdaftar','Awaiting figures':'Data belum tersedia','Enrollment trend':'Tren jumlah siswa',
  'New reports received':'Laporan baru diterima','Weekly students':'Siswa mingguan','Monthly students':'Siswa bulanan',
  'Back to menu':'Kembali ke ringkasan','Back to saved report':'Kembali ke laporan tersimpan','Back':'Kembali',
  'Download CSV':'Unduh CSV','Print':'Cetak','Weekly reporting':'Pelaporan mingguan',
  'Weekly academic report':'Laporan akademik mingguan','Previous section':'Bagian sebelumnya',
  'Next section':'Bagian berikutnya','Section':'Bagian','of':'dari','Review report':'Tinjau laporan',
  'Enter 0 when there were none. Remarks are optional.':'Masukkan 0 jika tidak ada. Catatan bersifat opsional.',
  'Report Identification':'Identitas laporan','Branch':'Cabang',"Coordinator's/Staff's Name":'Nama koordinator atau staf',
  'Reporting year':'Tahun laporan','Reporting month':'Bulan laporan','Reporting week':'Minggu laporan',
  'Reporting period':'Periode laporan','Select a branch':'Pilih cabang','Select a year':'Pilih tahun',
  'Select a month':'Pilih bulan','Select a week':'Pilih minggu','Week':'Minggu',
  'New Recruits':'Rekrutmen baru','New recruits':'Rekrutmen baru',
  'Count newly recruited academic personnel.':'Masukkan jumlah tenaga akademik yang baru direkrut.',
  'Academic Numbers':'Tenaga akademik','The last saved counts fill in automatically. Update them when needed.':'Jumlah terakhir terisi otomatis. Perbarui bila perlu.',
  'Academic Coordinators':'Koordinator akademik','Academic Staff':'Staf akademik',
  'Permanent English Instructors':'Pengajar tetap Bahasa Inggris','Permanent Computer Instructors':'Pengajar tetap Komputer',
  'Freelance English Instructors':'Pengajar lepas Bahasa Inggris','Freelance Computer Instructors':'Pengajar lepas Komputer',
  'Tests':'Tes','Count students or persons.':'Masukkan jumlah peserta.','English Placement':'Tes penempatan Bahasa Inggris',
  'English Promotion':'Tes kenaikan tingkat Bahasa Inggris','Computer Counseling':'Konseling Komputer','Computer Promotion':'Tes kenaikan tingkat Komputer',
  'Students & Classes':'Siswa dan kelas','Active English Students':'Siswa aktif Bahasa Inggris','Active English Classes':'Kelas aktif Bahasa Inggris',
  'Active Computer Students':'Siswa aktif Komputer','Active Computer Classes':'Kelas aktif Komputer',
  'Total Active Students':'Total siswa aktif','Total active students':'Total siswa aktif','Total Active Classes':'Total kelas aktif',
  'Total active classes':'Total kelas aktif','English Students per Class':'Siswa Bahasa Inggris per kelas',
  'Computer Students per Class':'Siswa Komputer per kelas','English students per class':'Siswa Bahasa Inggris per kelas',
  'Computer students per class':'Siswa Komputer per kelas',
  'Students (IN/OUT)':'Perpindahan siswa','English Students IN':'Siswa masuk Bahasa Inggris','English Students OUT':'Siswa keluar Bahasa Inggris',
  'Computer Students IN':'Siswa masuk Komputer','Computer Students OUT':'Siswa keluar Komputer',
  'English Net Movement':'Selisih siswa Bahasa Inggris','Computer Net Movement':'Selisih siswa Komputer',
  'Total Students IN':'Total siswa masuk','Total Students OUT':'Total siswa keluar','Total Net Movement':'Selisih total siswa',
  'Net Student Movement':'Selisih siswa','Net movement':'Selisih siswa','Students IN':'Siswa masuk','Students OUT':'Siswa keluar',
  'Remarks':'Catatan','Academic observations or circumstances (optional)':'Catatan atau kondisi akademik (opsional)',
  'Up to 1,000 characters.':'Maksimal 1.000 karakter.','Choose a branch and reporting period.':'Pilih cabang dan periode laporan.',
  'I certify that the information in this report is accurate and reflects the actual conditions at my LPIA branch.':'Saya menyatakan data ini akurat dan sesuai dengan kondisi cabang LPIA saya.',
  'Reporting access code':'Kode akses laporan','Check report':'Periksa laporan','Continue submission':'Lanjutkan pengiriman',
  'Report to copy':'Laporan untuk disalin','Close':'Tutup','Edit entries':'Edit isian','Submit report':'Kirim laporan',
  'Check your entries before submitting.':'Periksa isian sebelum mengirim laporan.',
  'Report saved':'Laporan tersimpan','Your submission has been saved and verified.':'Laporan Anda telah tersimpan dan terverifikasi.',
  'View saved report':'Lihat laporan tersimpan','View report history':'Lihat riwayat laporan','Report history':'Riwayat laporan',
  'Share with Academic Affairs via WhatsApp':'Bagikan ke Akademik Pusat via WhatsApp','Finish':'Selesai',
  'Search by branch, period, or report ID':'Cari cabang, periode, atau ID laporan','Report details':'Rincian laporan',
  'Thank you for using Academic Report App.':'Terima kasih telah menggunakan aplikasi laporan akademik.',
  'English':'Bahasa Inggris','Computer':'Komputer','students':'siswa','classes':'kelas','students recorded':'siswa tercatat',
  'active students':'siswa aktif','Figures for':'Data untuk','Reports from':'Laporan dari','listed branches.':'cabang terdaftar.',
  'Branch breakdown':'Rincian cabang','Saved':'Tersimpan','Average English students per reporting branch':'Rata-rata siswa Bahasa Inggris per cabang pelapor',
  'Average Computer students per reporting branch':'Rata-rata siswa Komputer per cabang pelapor',
  'Total academic personnel':'Total tenaga akademik','Historical monthly figures':'Data historis bulanan',
  'Weekly reports':'Laporan mingguan','Monthly reports':'Laporan bulanan','Latest: Week':'Terbaru: Minggu',
  'weeks reported':'minggu dilaporkan','Historical figures from LPIA Active Students.':'Data historis dari LPIA Active Students.',
  'Totals match the LPIA Active Students summary. The averages and breakdown use all recorded branch figures.':'Total mengikuti ringkasan LPIA Active Students. Rata-rata dan rincian menggunakan seluruh data cabang yang tercatat.',
  'Active counts use each branch’s latest weekly report. Student movement totals cover the weeks reported.':'Jumlah aktif memakai laporan terakhir tiap cabang. Perpindahan siswa dijumlahkan dari seluruh minggu yang dilaporkan.',
  'Saving and verifying your report…':'Menyimpan dan memverifikasi laporan…','Checking saved reports…':'Memeriksa laporan tersimpan…',
  'No saved report was found for this branch and period.':'Belum ada laporan tersimpan untuk cabang dan periode ini.',
  'Previous counts could not be loaded. You can enter them here.':'Data sebelumnya tidak dapat dimuat. Masukkan data secara manual.',
  'The report could not be saved.':'Laporan tidak dapat disimpan.','The request timed out. Use Check Report before trying again.':'Waktu permintaan habis. Pilih Periksa laporan sebelum mencoba lagi.',
  'Your report is ready to send.':'Laporan siap dikirim.','Check the highlighted fields.':'Periksa isian yang ditandai.',
  'Select a value.':'Pilih salah satu.','Enter a whole number from 0 to 1,000,000.':'Masukkan bilangan bulat dari 0 hingga 1.000.000.',
  'Loading student statistics…':'Memuat statistik siswa…','Saved reports could not be loaded.':'Laporan tersimpan tidak dapat dimuat.',
  'Historical figures could not be loaded.':'Data historis tidak dapat dimuat.','Student statistics could not be loaded.':'Statistik siswa tidak dapat dimuat.',
  'Try again':'Coba lagi','Open':'Buka','View report':'Lihat laporan','Edit':'Edit',
  'and':'dan','Review':'Periksa','Active students were entered with 0 active classes.':'Ada siswa aktif dengan jumlah kelas aktif 0.',
  'Filled from':'Diisi dari','Monthly figures':'Data bulanan','Loading saved reports…':'Memuat laporan tersimpan…',
  'Report just opened':'Laporan yang baru dibuka','No reports match this search.':'Tidak ada laporan yang sesuai dengan pencarian ini.',
  'Continue submission, paste the report into Body, and click Create.':'Lanjutkan pengiriman, tempel laporan di kolom Body, lalu klik Create.',
  'Continue submission. The report is already in Body. Click Create to send it.':'Lanjutkan pengiriman. Laporan sudah ada di kolom Body. Klik Create untuk mengirim.',
  'The report is filled in. Click Create to send it.':'Laporan sudah terisi. Klik Create untuk mengirim.',
  'Report copied. Paste it into Body to finish sending.':'Laporan disalin. Tempel di kolom Body untuk menyelesaikan pengiriman.',
  'Copy the selected report text.':'Salin teks laporan yang dipilih.',
  'Waiting for confirmation that the report was saved…':'Menunggu konfirmasi bahwa laporan tersimpan…',
  'A different report already exists for this branch and period. Open Check Report to review it.':'Sudah ada laporan berbeda untuk cabang dan periode ini. Pilih Periksa laporan untuk meninjaunya.',
  'This report is still waiting for confirmation. Use Check Report to check again.':'Laporan masih menunggu konfirmasi. Pilih Periksa laporan untuk memeriksa kembali.',
  'Enter your branch’s access code, then review and submit the report.':'Masukkan kode akses cabang, lalu tinjau dan kirim laporan.',
  'The saved report could not be verified. Use Check Report before trying again.':'Laporan tersimpan tidak dapat diverifikasi. Pilih Periksa laporan sebelum mencoba lagi.',
  'Statistics took too long to load.':'Statistik terlalu lama dimuat.',
  "Enter the coordinator's or staff member's name.":'Masukkan nama koordinator atau staf.',
  'Keep remarks to 1,000 characters or fewer.':'Batasi catatan hingga 1.000 karakter.',
  'This branch already has a different report for the selected period. Open the saved report to review it.':'Cabang ini sudah memiliki laporan berbeda untuk periode tersebut. Buka laporan tersimpan untuk meninjaunya.'
};

let language = 'en';
let detailPreviousScreen = 'saved';
const pickerUpdates = [];
const entrySections = [...form.querySelectorAll('fieldset')];
let entryStep = 0;
let reviewingEdits = false;
const localNodes = [];
function tr(text) {
  if (language !== 'id' || typeof text !== 'string') return text;
  return translations[text] ?? text;
}
function monthLabel(month) {
  return new Intl.DateTimeFormat(language === 'id' ? 'id-ID' : 'en', {
    month:'long', timeZone:'UTC'
  }).format(new Date(Date.UTC(2026,month-1,1)));
}
function captureLocalText(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const source = node.nodeValue.trim();
    if (!node.parentElement?.closest('#language-options') && Object.hasOwn(translations,source)) localNodes.push([node,source]);
  }
}
function setLanguage(next, remember = true) {
  language = next === 'id' ? 'id' : 'en';
  document.documentElement.lang = language;
  document.title = tr('LPIA Academic Reporter');
  formatCount = new Intl.NumberFormat(language, { maximumFractionDigits:2 });
  if (remember) try { localStorage.setItem('lpia-language',language); } catch {}
  for (const [node,source] of localNodes) node.nodeValue = node.nodeValue.replace(node.nodeValue.trim(),tr(source));
  byId('language-current').textContent = language.toUpperCase();
  byId('language-toggle').setAttribute('aria-label', language === 'id' ? 'Bahasa: Bahasa Indonesia' : 'Language: English');
  byId('language-flag').textContent = language === 'id' ? '🇮🇩' : '🇺🇸';
  for (const [index,option] of [...field('reporting_month').options].entries()) option.textContent = monthLabel(index + 1);
  for (const option of field('reporting_week').options) {
    option.textContent = option.value ? tr('Week') + ' ' + option.value : tr('Select a week');
  }
  for (const refresh of pickerUpdates) refresh();
  setEntryStep(entryStep);
  updateSelection();
  updateTotals();
  if (activeScreen === 'menu') { showMenuYearProgress(); showMenuTotals(); }
  if (activeScreen === 'status' && statsPeriods.length) {
    for (const item of byId('stats-period').options) {
      const period = statsPeriods.find(row=>row.key===item.value);
      if (period) item.textContent = statsPeriodText(period);
    }
    for (const group of byId('stats-period').querySelectorAll('optgroup')) {
      if (!group.dataset.label) group.dataset.label = group.label;
      group.label = tr(group.dataset.label);
    }
    if (selectedStatsPeriod()) renderStats();
  }
  if (activeScreen === 'saved' && savedReport) {
    byId('saved-receipt').textContent = savedReport.branch_name + ' · ' + periodText(savedReport) + ' · ' + savedReport.report_id;
  }
  if (activeScreen === 'history') renderHistory();
  if (activeScreen === 'detail' && currentDetailReport) showDetail(currentDetailReport,detailPreviousScreen);
}
function setEntryStep(step, focus = false) {
  entryStep = step;
  for (const [index,section] of entrySections.entries()) section.hidden = index !== step;
  byId('step-counter').textContent = tr('Section') + ' ' + (step + 1) + ' ' + tr('of') + ' ' + entrySections.length;
  byId('step-progress').replaceChildren(...entrySections.map((_,index)=>textElement('span','',index <= step ? 'filled' : '')));
  byId('step-back').disabled = busy || step === 0;
  byId('step-next').hidden = step === entrySections.length - 1;
  byId('step-next').disabled = busy || step === entrySections.length - 1;
  byId('submit').hidden = !reviewingEdits && step !== entrySections.length - 1;
  document.querySelector('.submission-buttons').classList.toggle('with-review', !byId('submit').hidden);
  document.querySelector('.attestation').hidden = step !== entrySections.length - 1;
  if (focus) byId('app-content').scrollTop = 0;
}
function renderOverviewPanel(period) {
  const total = totalStudents(period);
  const english = period.source_totals?.english ?? period.branches.reduce((sum,row)=>sum+(row.english??0),0);
  const computer = period.source_totals?.computer ?? period.branches.reduce((sum,row)=>sum+(row.computer??0),0);
  const count = period.branches.filter(row=>row.english!=null || row.computer!=null).length;
  const listed = period.listed_branches;
  const output = byId('overview-summary');
  const node = (tag,text,cls) => textElement(tag,text,cls);
  const panel = node('article','','population-panel');
  const header = node('header','');
  header.append(node('h2','Academic population'),node('span',monthLabel(period.reporting_month)+' '+period.reporting_year,'population-period'));
  const track = node('div','','population-track');
  track.setAttribute('aria-hidden','true');
  for (const value of [english,computer]) {
    const segment = node('span','');
    segment.style.width = (total ? 100*value/total : 0)+'%';
    track.append(segment);
  }
  const metrics = node('dl','','population-mix');
  for (const [label,value] of [['English students',english],['Computer students',computer]]) {
    const metric = node('div','');
    metric.append(node('dt',label),node('dd',formatCount.format(value)));
    metrics.append(metric);
  }
  panel.append(header,node('strong',formatCount.format(total),'population-count'),node('p','Active students','population-caption'),track,metrics);
  const coverage = node('article','','coverage-panel');
  const coverageAmount = node('strong',String(count));
  coverageAmount.append(node('span',' / '+listed));
  const coverageTrack = node('div','','coverage-track');
  const fill = node('span','');
  fill.style.width = (listed ? 100*count/listed : 0)+'%';
  coverageTrack.append(fill);
  const coverageMetrics = node('dl','');
  for (const [label,value] of [['Branches with figures',count],['Awaiting figures',listed-count],['Branches listed',listed]]) {
    const metric = node('div','');
    metric.append(node('dt',label),node('dd',String(value)));
    coverageMetrics.append(metric);
  }
  coverage.append(node('h2','Reporting coverage'),node('p','Branches with available figures','hint'),coverageAmount,coverageTrack,coverageMetrics);
  output.replaceChildren(panel,coverage);
  output.hidden = false;
}
function showReview(candidate) {
  const report = makeReport(candidate);
  const dialog = byId('review-dialog');
  const output = byId('review-content');
  const groups = [
    ['Report Identification',[['Branch',report.branch_name],['Reporting period',periodText(report)],["Coordinator's/Staff's Name",report.reporter_name]]],
    ['Students & Classes',[['Total Active Students',report.total_active_students],['Total Active Classes',report.total_active_classes],['Net Student Movement',report.total_net_movement]]]
  ];
  for (const [index,fields] of Object.values(FIELD_GROUPS).entries()) {
    const title = ['New Recruits','Academic Numbers','Tests','Students & Classes','Students (IN/OUT)'][index];
    groups.push([title,Object.entries(fields).map(([key,label])=>[label,report[key]])]);
  }
  groups.push(['Remarks',[['Remarks',report.remarks||'—']]]);
  output.replaceChildren(...groups.map(([name,items],index)=>{
    const block = textElement('section','','report-panel');
    const list = textElement('dl','','review-lines');
    for (const [label,value] of items) {
      const line = textElement('div','');
      const entry = textElement('dd','');
      entry.textContent = typeof value === 'number' ? formatCount.format(value) : value;
      line.append(textElement('dt',label),entry);
      list.append(line);
    }
    const heading = textElement('div','','review-group-heading');
    const edit = textElement('button','Edit','secondary');
    edit.type = 'button';
    edit.setAttribute('aria-label',tr('Edit') + ' · ' + tr(name));
    const section = [0, 4, 1, 2, 3, 4, 5, 6][index];
    edit.addEventListener('click',()=>editSection(section));
    heading.append(textElement('h3',name),edit);
    block.append(heading,list);
    return block;
  }));
  dialog.showModal();
  dialog.scrollTop = 0;
}
function editSection(step) {
  byId('review-dialog').close();
  reviewingEdits = true;
  setEntryStep(step,true);
  const first = entrySections[step].querySelector('.picker-trigger, input, textarea');
  first?.focus({preventScroll:true});
}
function toggleLanguageMenu(open) {
  byId('language-options').hidden = !open;
  byId('language-toggle').setAttribute('aria-expanded', String(open));
}

populate();
initPickers();
captureLocalText(document.body);
for (const template of document.querySelectorAll('template')) captureLocalText(template.content);
let storedLanguage;
try { storedLanguage = localStorage.getItem('lpia-language'); } catch {}
setLanguage(storedLanguage,false);
byId('language-toggle').addEventListener('click',()=>toggleLanguageMenu(byId('language-options').hidden));
for (const option of document.querySelectorAll('[data-language]')) option.addEventListener('click',()=>{
  setLanguage(option.dataset.language);
  toggleLanguageMenu(false);
  byId('language-toggle').focus();
});
document.addEventListener('click',event=>{
  if (!event.target.closest('.language-control')) toggleLanguageMenu(false);
});
document.addEventListener('keydown',event=>{
  if (event.key === 'Escape' && !byId('language-options').hidden) {
    toggleLanguageMenu(false);
    byId('language-toggle').focus();
  }
});
byId('nav-enrollment').addEventListener('click',()=>openStats());
byId('nav-report').addEventListener('click',()=>showScreen('entry'));
byId('step-back').addEventListener('click',()=>setEntryStep(entryStep-1,true));
byId('step-next').addEventListener('click',()=>setEntryStep(entryStep+1,true));
byId('review-edit').addEventListener('click',()=>editSection(0));
byId('review-submit').addEventListener('click',()=>{
  byId('review-dialog').close();
  reviewingEdits = false;
  setEntryStep(entrySections.length-1);
  sendReport('submit');
});

form.addEventListener('input', event => {
  if (fallbackReport && event.target.name) clearSubmissionFallback();
  carriedAcademicFields.delete(event.target.name);
  if (event.target.hasAttribute('aria-invalid')) {
    event.target.setCustomValidity('');
    event.target.removeAttribute('aria-invalid');
  }
  if (countNames.includes(event.target.name)) updateTotals();
});
form.addEventListener('change', event => {
  if (!PERIOD_FIELDS.includes(event.target.name)) return;
  if (fallbackReport) clearSubmissionFallback();
  field(event.target.name).setCustomValidity('');
  field(event.target.name).removeAttribute('aria-invalid');
  pickerTriggers.get(event.target.name)?.removeAttribute('aria-invalid');
  updateSelection();
  autoFillAcademicNumbers();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || activeScreen !== 'entry') return;
  if (submitButton.hidden) {
    setEntryStep(entryStep + 1, true);
    return;
  }
  const candidate = collectReport('submit', feedback);
  if (!candidate) return;
  try { showReview(candidate); }
  catch (error) { showFeedback(feedback,'error',error.message); }
});
checkButton.addEventListener('click', () => sendReport('status'));
