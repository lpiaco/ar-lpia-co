import {
  BRANCHES, FIRST_REPORT_YEAR, LAST_REPORT_YEAR, decodeCSV, displayBranchName, publicStats, reportId
} from './lib/reports.mjs';

// Public options. Leave blank to use the WhatsApp contact picker.
const ACADEMIC_OFFICE_WHATSAPP = '';
const REPORTS_API = '/api/reports';
const PUBLIC_REPORTS_CSV = 'https://raw.githubusercontent.com/lpiaco/ar-lpia-co/report-data/reports.csv';
const MONTHLY_STATS_FILE = 'data/active-students.json';

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
const formatCount = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
let busy = false;
let activeScreen = 'start';
let savedReport;
let academicSource;
let academicRequest = 0;
const pickerTriggers = new Map();
let pickerTrigger;
let historyReports = [];
let statsPeriods = [];

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
      input.type = 'text';
      input.name = name;
      input.inputMode = 'numeric';
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
  const warningText = unusual.length ? `Review ${unusual.join(' and ')}. Active students were entered with 0 active classes.` : '';
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
  return `Week ${period.reporting_week}, ${MONTHS[period.reporting_month - 1]} ${period.reporting_year}`;
}

function updateSelection() {
  const period = selectedPeriod();
  document.querySelector('#selection').textContent = Object.values(period).every(Boolean)
    ? `${BRANCHES[Number(period.branch_id) - 1]} · ${periodText(period)}`
    : 'Choose a branch and reporting period.';
}

function collectReport(operation, output) {
  const report = selectedPeriod();
  const errors = [];
  const mark = (name, message) => {
    const control = field(name);
    control.setCustomValidity(message);
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
    paragraph.textContent = text;
    return paragraph;
  }));
}

function setBusy(value) {
  busy = value;
  submitButton.disabled = value;
  checkButton.disabled = value;
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
      showFeedback(academicFeedback, 'info', 'Filled from ' + periodText(latest) + '.');
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
  document.querySelectorAll('.screen').forEach(section => { section.hidden = section.id !== name + '-screen'; });
  const standalone = name === 'start' || name === 'menu' || name === 'finished';
  document.body.classList.toggle('app-running', name !== 'start' && name !== 'finished');
  byId('app-content').hidden = standalone;
  byId('masthead').hidden = standalone;
  byId('app-content').scrollTop = 0;
  window.scrollTo(0, 0);
  byId(headings[name])?.focus({ preventScroll: true });
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
    const response = await fetch(PUBLIC_REPORTS_CSV + '?read=' + Date.now(), {
      cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) throw new Error('The report CSV could not be loaded.');
    return decodeCSV(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

function showReceipt(report) {
  savedReport = report;
  byId('saved-receipt').textContent = report.branch_name + ' · ' + periodText(report) + ' · ' + report.report_id;
  const text = [
    'LPIA Academic Report', report.branch_name + ' · ' + periodText(report),
    'Report ID ' + report.report_id,
    'Active students: ' + report.total_active_students + ' (English ' + report.active_english_students +
      ', Computer ' + report.active_computer_students + ')',
    'Active classes: ' + report.total_active_classes,
    'Student movement: ' + report.total_students_in + ' IN / ' + report.total_students_out + ' OUT'
  ].join('\n');
  byId('share-whatsapp').href = 'https://wa.me/' + ACADEMIC_OFFICE_WHATSAPP + '?text=' + encodeURIComponent(text);
  showScreen('saved');
}

async function submitDirectly(report) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(REPORTS_API, {
      method: 'POST', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'submit', report, accessCode: byId('submission-code').value
      })
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('Direct submission is not available yet. Your entries are still here.');
    }

    const result = await response.json();
    if (response.status === 403 && result.message === 'The access code is invalid for this branch.') {
      byId('submission-access').hidden = false;
      byId('submission-code').value = '';
      throw new Error('Enter the reporting access code for your branch, then press SUBMIT.');
    }
    if (!response.ok) throw new Error(result.message || 'The report could not be saved.');
    if (!['saved', 'already_saved'].includes(result.status) ||
        result.report?.report_id !== reportId(report) ||
        !Object.keys(report).every(key => result.report[key] === report[key])) {
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
    showFeedback(feedback, 'error', error.name === 'AbortError'
      ? 'The request timed out. Use Check Report before trying again.'
      : error.message);
  } finally {
    setBusy(false);
    if (activeScreen === 'entry') {
      const access = byId('submission-access');
      if (operation === 'submit' && !access.hidden && !byId('submission-code').value) byId('submission-code').focus();
      else feedback.focus({ preventScroll: true });
    }
  }
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
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

async function openStats() {
  showScreen('status');
  const output = byId('stats-feedback');
  byId('stats-summary').replaceChildren();
  byId('stats-controls').hidden = true;
  showFeedback(output, 'progress', 'Loading student statistics…');
  try {
    const [weekly, monthly] = await Promise.allSettled([
      loadPublicReports().then(publicStats),
      loadMonthlyStats()
    ]);
    if (activeScreen !== 'status') return;
    statsPeriods = [...(weekly.value ?? []), ...(monthly.value ?? [])].sort((left, right) =>
      right.reporting_year - left.reporting_year ||
      right.reporting_month - left.reporting_month ||
      (right.reporting_week ?? 0) - (left.reporting_week ?? 0)
    );
    if (!statsPeriods.length) throw new Error('Student statistics could not be loaded.');
    const select = byId('stats-period');
    select.replaceChildren(...statsPeriods.map(period => new Option(statsPeriodText(period), period.key)));
    byId('stats-controls').hidden = false;
    output.replaceChildren();
    if (weekly.status === 'rejected') showFeedback(output, 'info', 'Weekly reports could not be loaded.');
    else if (monthly.status === 'rejected') showFeedback(output, 'info', 'Monthly figures could not be loaded.');
    renderStats();
  } catch (error) {
    if (activeScreen === 'status') showFeedback(output, 'error',
      error.name === 'AbortError' ? 'Statistics took too long to load.' : error.message);
  }
}

async function loadMonthlyStats() {
  const response = await fetch(MONTHLY_STATS_FILE);
  if (!response.ok) throw new Error('The monthly figures could not be loaded.');
  const periods = await response.json();
  if (!Array.isArray(periods)) throw new Error('The monthly figures are invalid.');
  return periods.map(period => ({
    ...period, branches: period.branches.map(row => ({ ...row, branch: displayBranchName(row.branch) }))
  }));
}

function statsPeriodText(period) {
  return period.reporting_week
    ? periodText(period)
    : MONTHS[period.reporting_month - 1] + ' ' + period.reporting_year + ' · Monthly figures';
}

function renderStats() {
  const period = statsPeriods.find(item => item.key === byId('stats-period').value);
  const branches = period.branches;
  const monthly = period.reporting_week == null;
  const sum = fieldName => branches.reduce((total, row) => total + (row[fieldName] ?? 0), 0);
  const average = (fieldName, total) => {
    const reported = branches.filter(row => row[fieldName] != null).length;
    return reported ? total / reported : null;
  };
  const english = sum('english');
  const computer = sum('computer');
  const stats = [
    ['Total active students', english + computer], ['English students', english],
    ['Computer students', computer],
    ['Average English students per reporting branch', average('english', english)],
    ['Average Computer students per reporting branch', average('computer', computer)]
  ];
  if (!monthly) {
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
  const coverage = monthly
    ? 'Figures for ' + branches.length + ' of ' + period.listed_branches + ' listed branches.'
    : 'Reports from ' + branches.length + ' of ' + BRANCHES.length + ' listed branches.';
  output.replaceChildren(
    textElement('h2', statsPeriodText(period)),
    textElement('p', coverage, 'hint'),
    metricList(stats),
    textElement('h2', 'Branch breakdown')
  );
  if (monthly) {
    const source = textElement('a', 'LPIA Active Students');
    source.href = 'https://docs.google.com/spreadsheets/d/1Eo9JzotF1V8pDoOe75kJa4ghgOcunoBXVt2bvogXf60/edit';
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const note = textElement('p', 'Monthly source: ', 'hint');
    note.append(source, '. Totals sum the recorded branch figures.');
    output.firstElementChild.after(note);
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
    bar.setAttribute('aria-label', row.branch + ' active students');
    const countLabel = row.english == null || row.computer == null ? ' students recorded' : ' students';
    const classes = monthly ? '' : ' · ' + formatCount.format(row.englishClasses + row.computerClasses) + ' classes';
    card.append(textElement('h3', row.branch + ' · ' + formatCount.format(total) + countLabel), bar,
      textElement('p', 'English ' + valueText(row.english) + ' · Computer ' + valueText(row.computer) + classes, 'hint'));
    list.append(card);
  }
  output.append(list);
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
      textElement('p', report.report_id + ' · ' + formatCount.format(report.total_active_students) + ' active students', 'hint'));
    if (current) summary.append(textElement('p', 'Laporan yang baru dibuka', 'hint'));
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
  const output = byId('report-detail');
  const when = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  }).format(new Date(report.submitted_at));
  output.replaceChildren(
    textElement('h2', report.branch_name + ' · ' + periodText(report)),
    textElement('p', report.report_id + ' · Saved ' + when + ' WIB', 'hint'),
    textElement('p', "Coordinator's/Staff's Name: " + report.reporter_name),
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
byId('open-status').addEventListener('click', openStats);
byId('open-entry').addEventListener('click', () => showScreen('entry'));
byId('status-yes').addEventListener('click', () => showScreen('entry'));
byId('status-no').addEventListener('click', finish);
byId('stats-period').addEventListener('change', renderStats);
document.querySelectorAll('[data-menu]').forEach(button => button.addEventListener('click', () => showScreen('menu')));
document.querySelector('[data-saved]').addEventListener('click', () => showScreen('saved'));
byId('view-new-report').addEventListener('click', () => showDetail(savedReport, 'saved'));
byId('view-history').addEventListener('click', openHistory);
byId('history-search').addEventListener('input', renderHistory);
byId('finish').addEventListener('click', finish);

function initPickers() {
  const dialog = byId('field-picker');
  if (typeof dialog.showModal !== 'function') return;
  const optionsList = byId('picker-options');
  const settings = {
    branch: ['Branch', 'Select a branch'],
    year: ['Reporting year', 'Select a year'],
    month: ['Reporting month', 'Select a month']
  };
  for (const select of form.querySelectorAll('[data-picker]')) {
    const [name, placeholder] = settings[select.dataset.picker];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'secondary picker-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);

    const sync = () => {
      trigger.textContent = select.value ? select.selectedOptions[0].textContent : placeholder;
      trigger.setAttribute('aria-label', name + ', ' + trigger.textContent);
    };

    trigger.addEventListener('click', () => {
      pickerTrigger = trigger;
      byId('picker-title').textContent = name;
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

populate();
initPickers();
updateTotals();
updateSelection();
form.addEventListener('input', event => {
  carriedAcademicFields.delete(event.target.name);
  if (event.target.hasAttribute('aria-invalid')) {
    event.target.setCustomValidity('');
    event.target.removeAttribute('aria-invalid');
  }
  if (countNames.includes(event.target.name)) updateTotals();
});
form.addEventListener('change', event => {
  if (!PERIOD_FIELDS.includes(event.target.name)) return;
  field(event.target.name).setCustomValidity('');
  field(event.target.name).removeAttribute('aria-invalid');
  pickerTriggers.get(event.target.name)?.removeAttribute('aria-invalid');
  updateSelection();
  autoFillAcademicNumbers();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  sendReport('submit');
});
checkButton.addEventListener('click', () => sendReport('status'));
