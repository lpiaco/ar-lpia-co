'use strict';

// Public options. Leave blank to use the WhatsApp contact picker.
const ACADEMIC_OFFICE_WHATSAPP = '';
const BRAND_LOGO_URL = '';
const REPORTS_API = '/api/reports';

const COUNT_LIMIT = 1000000;
const FIRST_YEAR = 2020;
const LAST_YEAR = 2100;
const BRANCHES = [
  'Buaran', 'Tambun', 'Pd Gede', 'Cibinong', 'D Zamrud', 'TWA',
  'Pemalang', 'Setu', 'Ungaran', 'Cikarang JB', 'Jatimurni', 'Cipinang',
  'Karadenan', 'Rawasari', 'Pd Cabe', 'Ciracas', 'Pd Kelapa', 'Pd Labu',
  'TNI', 'Tugu Koja', 'Solo', 'Jatiwarna', 'Tanah Baru', 'Jatisampurna'
];
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
let historyAccess;
let historyReports = [];
let statsPeriods = [];

function populate() {
  BRANCHES.map((name, index) => ({ name, id: String(index + 1).padStart(2, '0') }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .forEach(({ name, id }) => field('branch_id').add(new Option(name, id)));
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
    field('reporting_year').add(new Option(String(year), String(year)));
  }
  MONTHS.forEach((name, index) => field('reporting_month').add(new Option(name, String(index + 1))));

  const today = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric'
  }).formatToParts();
  field('reporting_year').value = today.find(part => part.type === 'year').value;
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
      errors.push(control);
    } else {
      control.removeAttribute('aria-invalid');
    }
  };
  const periodChecks = {
    branch_id: /^(0[1-9]|1[0-9]|2[0-4])$/.test(report.branch_id),
    reporting_year: Number.isInteger(report.reporting_year) && report.reporting_year >= FIRST_YEAR &&
      report.reporting_year <= LAST_YEAR,
    reporting_month: Number.isInteger(report.reporting_month) && report.reporting_month >= 1 && report.reporting_month <= 12,
    reporting_week: Number.isInteger(report.reporting_week) && report.reporting_week >= 1 && report.reporting_week <= 5
  };
  PERIOD_FIELDS.forEach(name => mark(name, periodChecks[name] ? '' : 'Select a value.'));
  const accessCode = field('access_code').value;
  mark('access_code', accessCode.length >= 12 && accessCode.length <= 128 ? '' : 'Enter your branch access code.');
  if (operation === 'submit') {
    report.reporter_name = field('reporter_name').value.trim();
    report.remarks = field('remarks').value;
    mark('reporter_name', report.reporter_name && report.reporter_name.length <= 100 ? '' : 'Enter an Academic Name.');
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
    errors[0].reportValidity();
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

function fillAcademicNumbers(response, report) {
  if (response.status !== 'academia_found') {
    showFeedback(academicFeedback, response.status === 'not_found' ? 'info' : 'error',
      typeof response.message === 'string' ? response.message : 'Previous Academic Numbers could not be confirmed.');
    return;
  }
  const { counts, period } = response;
  if (!period || period.branch_id !== report.branch_id || !MONTHS[period.reporting_month - 1] ||
      !counts || !academicNames.every(name =>
        Number.isSafeInteger(counts[name]) && counts[name] >= 0 && counts[name] <= COUNT_LIMIT
      )) {
    showFeedback(academicFeedback, 'error', 'Previous Academic Numbers could not be confirmed.');
    return;
  }

  const blankFields = academicNames.filter(name => field(name).value === '');
  blankFields.forEach(name => {
    const control = field(name);
    control.value = String(counts[name]);
    control.setCustomValidity('');
    control.removeAttribute('aria-invalid');
    carriedAcademicFields.add(name);
  });
  showFeedback(academicFeedback, 'success', blankFields.length
    ? 'Blank fields filled from ' + periodText(period) + '. Review the counts for this report.'
    : 'All Academic Numbers already have values.');
}


populate();
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
  carriedAcademicFields.forEach(name => { field(name).value = ''; });
  carriedAcademicFields.clear();
  academicFeedback.replaceChildren();
  updateSelection();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  sendReport('submit');
});
checkButton.addEventListener('click', () => sendReport('status'));
document.querySelector('#load-academia').addEventListener('click', () => sendReport('academia'));

const byId = id => document.getElementById(id);
const headings = {
  menu: 'menu-title', status: 'status-title', entry: 'entry-title',
  saved: 'saved-title', history: 'history-title', detail: 'detail-title', finished: 'finished-title'
};

function showScreen(name) {
  activeScreen = name;
  document.querySelectorAll('.screen').forEach(section => { section.hidden = section.id !== name + '-screen'; });
  const standalone = name === 'start' || name === 'finished';
  byId('app-content').hidden = standalone;
  byId('masthead').hidden = standalone;
  window.scrollTo(0, 0);
  byId(headings[name])?.focus({ preventScroll: true });
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

async function requestReports(operation, report, accessCode) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(REPORTS_API, {
      cache: 'no-store', signal: controller.signal,
      ...(operation ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, report, accessCode })
      } : {})
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('Report storage is not connected yet.');
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Report storage could not be reached.');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function idFor(period) {
  return period.reporting_year + '-' + String(period.reporting_month).padStart(2, '0') +
    '-W' + period.reporting_week + '-' + period.branch_id;
}

function showReceipt(report, accessCode) {
  savedReport = report;
  historyAccess = { branch: report.branch_id, code: accessCode };
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

async function sendReport(operation) {
  if (busy || activeScreen !== 'entry') return;
  const output = operation === 'academia' ? academicFeedback : feedback;
  const report = collectReport(operation, output);
  if (!report) return;
  const accessCode = field('access_code').value;
  setBusy(true);
  const progress = {
    submit: 'Saving and verifying the report…',
    status: 'Checking saved reports…',
    academia: 'Looking up previous Academic Numbers…'
  };
  showFeedback(output, 'progress', progress[operation]);
  try {
    const result = await requestReports(operation, report, accessCode);
    if (operation === 'academia') {
      fillAcademicNumbers(result, report);
    } else if (result.status === 'not_found') {
      showFeedback(output, 'info', result.message);
    } else if (['saved', 'already_saved', 'found'].includes(result.status) &&
      result.report?.report_id === idFor(report)) {
      showReceipt(result.report, accessCode);
    } else {
      showFeedback(output, 'error', 'The saved report could not be verified.');
    }
  } catch (error) {
    const message = error.name === 'AbortError' ? 'The request timed out. Check for a saved report before retrying.' : error.message;
    showFeedback(output, 'error', message);
  } finally {
    setBusy(false);
    if (activeScreen === 'entry') output.focus({ preventScroll: true });
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
  showFeedback(output, 'progress', 'Loading submitted reports…');
  try {
    const data = await requestReports();
    if (activeScreen !== 'status') return;
    statsPeriods = data.periods;
    if (!Array.isArray(statsPeriods) || !statsPeriods.length) {
      showFeedback(output, 'info', 'No reports have been submitted yet.');
      return;
    }
    const select = byId('stats-period');
    select.replaceChildren(...statsPeriods.map(period => new Option(periodText(period), period.key)));
    byId('stats-controls').hidden = false;
    output.replaceChildren();
    renderStats();
  } catch (error) {
    if (activeScreen === 'status') showFeedback(output, 'error',
      error.name === 'AbortError' ? 'Statistics took too long to load.' : error.message);
  }
}

function renderStats() {
  const period = statsPeriods.find(item => item.key === byId('stats-period').value);
  const branches = period.branches;
  const sum = fieldName => branches.reduce((total, row) => total + row[fieldName], 0);
  const english = sum('english');
  const computer = sum('computer');
  const englishClasses = sum('englishClasses');
  const computerClasses = sum('computerClasses');
  const inCount = sum('inCount');
  const outCount = sum('outCount');
  const output = byId('stats-summary');
  output.replaceChildren(
    textElement('h2', periodText(period)),
    textElement('p', 'Reports from ' + branches.length + ' of ' + BRANCHES.length + ' listed branches.', 'hint'),
    metricList([
      ['Total active students', english + computer], ['English students', english],
      ['Computer students', computer], ['Total active classes', englishClasses + computerClasses],
      ['Average English students per reporting branch', english / branches.length],
      ['Average Computer students per reporting branch', computer / branches.length],
      ['English students per class', englishClasses ? english / englishClasses : null],
      ['Computer students per class', computerClasses ? computer / computerClasses : null],
      ['Total academic personnel', sum('academia')],
      ['Students IN', inCount], ['Students OUT', outCount], ['Net movement', inCount - outCount]
    ]),
    textElement('h2', 'Branch breakdown')
  );
  const ranking = [...branches].sort((a, b) => b.english + b.computer - a.english - a.computer ||
    a.branch.localeCompare(b.branch));
  const max = Math.max(1, ranking[0].english + ranking[0].computer);
  const list = document.createElement('div');
  list.className = 'stats-branches';
  for (const row of ranking) {
    const card = document.createElement('article');
    card.className = 'stat-branch';
    const total = row.english + row.computer;
    const bar = document.createElement('meter');
    bar.max = max;
    bar.value = total;
    bar.setAttribute('aria-label', row.branch + ' active students');
    card.append(textElement('h3', row.branch + ' · ' + formatCount.format(total) + ' students'), bar,
      textElement('p', 'English ' + formatCount.format(row.english) + ' · Computer ' + formatCount.format(row.computer) +
        ' · ' + formatCount.format(row.englishClasses + row.computerClasses) + ' classes', 'hint'));
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
    const data = await requestReports('history', { branch_id: historyAccess.branch }, historyAccess.code);
    if (activeScreen !== 'history') return;
    historyReports = data.reports;
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
    const open = textElement('button', 'View report', 'secondary');
    open.type = 'button';
    open.addEventListener('click', () => showDetail(report, 'history'));
    card.append(summary, open);
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
    textElement('p', 'Academic Name: ' + report.reporter_name),
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
  savedReport = undefined;
  historyAccess = undefined;
  historyReports = [];
  carriedAcademicFields.clear();
  for (const id of ['history-list', 'report-detail', 'saved-receipt', 'feedback', 'academic-feedback']) {
    byId(id).replaceChildren();
  }
  byId('share-whatsapp').removeAttribute('href');
  showScreen('finished');
}

if (BRAND_LOGO_URL) {
  const logo = byId('brand-logo');
  logo.addEventListener('load', () => {
    logo.hidden = false;
    document.querySelector('.logo-placeholder').hidden = true;
  });
  logo.src = BRAND_LOGO_URL;
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
