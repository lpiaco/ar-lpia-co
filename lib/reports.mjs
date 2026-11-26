export const BRANCHES = [
  'Buaran', 'Tambun', 'Pondok Gede', 'Cibinong', 'Dukuh Zamrud', 'Taman Wisma Asri',
  'Pemalang', 'Setu Bekasi', 'Ungaran', 'Cikarang JB', 'Jatimurni', 'Cipinang',
  'Karadenan', 'Rawasari', 'Pondok Cabe', 'Ciracas', 'Pondok Kelapa', 'Pondok Labu',
  'Taman Nusa Indah', 'Tugu Koja', 'Solo', 'Jatiwarna', 'Tanah Baru', 'Jatisampurna'
];
const branchAliases = new Map([
  ['D Zamrud', 'Dukuh Zamrud'], ['Setu', 'Setu Bekasi'],
  ['TNI', 'Taman Nusa Indah'], ['TWA', 'Taman Wisma Asri']
]);

export const displayBranchName = branch => branchAliases.get(branch) ?? branch.replace(/^Pd\.?\s+/i, 'Pondok ');
export const FIRST_REPORT_YEAR = 2026;
export const LAST_REPORT_YEAR = 2036;

export const ACADEMIC_FIELDS = [
  'academic_coordinators', 'academic_staff', 'permanent_english_instructors',
  'permanent_computer_instructors', 'freelance_english_instructors', 'freelance_computer_instructors'
];
export const COUNT_FIELDS = [
  'new_recruits_english', 'new_recruits_computer', ...ACADEMIC_FIELDS,
  'english_placement', 'english_promotion', 'computer_counseling', 'computer_promotion',
  'active_english_students', 'active_english_classes', 'active_computer_students', 'active_computer_classes',
  'english_students_in', 'english_students_out', 'computer_students_in', 'computer_students_out'
];
export const COLUMNS = [
  'report_id', 'submitted_at', 'branch_id', 'branch_name', 'reporter_name',
  'reporting_year', 'reporting_month', 'reporting_week', ...COUNT_FIELDS,
  'total_active_students', 'total_active_classes', 'english_net_movement', 'computer_net_movement',
  'total_students_in', 'total_students_out', 'total_net_movement', 'remarks'
];

export class ReporterError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const enforce = (condition, message) => {
  if (!condition) throw new ReporterError(400, message);
};

export const branchValid = id => typeof id === 'string' && /^(0[1-9]|1[0-9]|2[0-4])$/.test(id);
const integerIn = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

export function validatePeriod(input) {
  enforce(input && branchValid(input.branch_id) &&
    integerIn(input.reporting_year, 2020, 2100) &&
    integerIn(input.reporting_month, 1, 12) && integerIn(input.reporting_week, 1, 5),
  'Choose a valid branch and reporting period.');
  return {
    branch_id: input.branch_id, reporting_year: input.reporting_year,
    reporting_month: input.reporting_month, reporting_week: input.reporting_week
  };
}

export function periodKey(report) {
  return [report.reporting_year, String(report.reporting_month).padStart(2, '0'), 'W' + report.reporting_week].join('-');
}

export const reportId = report => periodKey(report) + '-' + report.branch_id;

export function makeReport(input, timestamp = new Date().toISOString()) {
  const period = validatePeriod(input);
  enforce(typeof input.reporter_name === 'string' && input.reporter_name.trim() &&
    input.reporter_name.length <= 100 && !/[\r\n]/.test(input.reporter_name), "Enter the coordinator's or staff member's name.");
  enforce(typeof input.remarks === 'string' && input.remarks.length <= 1000, 'Keep remarks within 1,000 characters.');
  enforce(COUNT_FIELDS.every(key => integerIn(input[key], 0, 1000000)), 'Enter a whole number for every count.');
  const counts = Object.fromEntries(COUNT_FIELDS.map(key => [key, input[key]]));
  const inCount = counts.english_students_in + counts.computer_students_in;
  const outCount = counts.english_students_out + counts.computer_students_out;
  return {
    ...period, ...counts,
    report_id: reportId(period), submitted_at: timestamp,
    branch_name: BRANCHES[Number(period.branch_id) - 1],
    reporter_name: input.reporter_name.trim(), remarks: input.remarks.replace(/\r\n?/g, '\n'),
    total_active_students: counts.active_english_students + counts.active_computer_students,
    total_active_classes: counts.active_english_classes + counts.active_computer_classes,
    english_net_movement: counts.english_students_in - counts.english_students_out,
    computer_net_movement: counts.computer_students_in - counts.computer_students_out,
    total_students_in: inCount, total_students_out: outCount, total_net_movement: inCount - outCount
  };
}

const numericColumns = new Set(COLUMNS.filter(key => ![
  'report_id', 'submitted_at', 'branch_id', 'branch_name', 'reporter_name', 'remarks'
].includes(key)));
const userTextColumns = new Set(['reporter_name', 'remarks']);

function csvCell(key, value) {
  let text = String(value);
  // Encode leading apostrophes too so a CSV round-trip restores user input exactly.
  if (userTextColumns.has(key) && /^(?:'|[\t\r\n]|\s*[=+\-@])/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function encodeCSV(reports) {
  return [COLUMNS.join(','), ...reports.map(row => COLUMNS.map(key => csvCell(key, row[key])).join(','))]
    .join('\r\n') + '\r\n';
}

export function decodeCSV(csv) {
  // Cells generated by this application are quoted. Accept unquoted header and
  // numeric cells as well, while rejecting malformed or truncated CSV.
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const emitCell = () => { row.push(cell); cell = ''; closed = false; };
  for (let offset = 0; offset < csv.length; offset += 1) {
    const char = csv[offset];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (csv[offset + 1] === '"') { cell += '"'; offset += 1; }
      else { quoted = false; closed = true; }
    } else if (char === ',') {
      emitCell();
    } else if (char === '\n' || char === '\r') {
      emitCell();
      rows.push(row);
      row = [];
      if (char === '\r' && csv[offset + 1] === '\n') offset += 1;
    } else if (char === '"' && !cell && !closed) {
      quoted = true;
    } else {
      if (closed || char === '"') throw new Error('Invalid CSV cell');
      cell += char;
    }
  }
  if (quoted) throw new Error('Unclosed CSV cell');
  if (row.length || cell || closed) { emitCell(); rows.push(row); }
  if (rows.shift()?.join(',') !== COLUMNS.join(',')) throw new Error('Invalid CSV header');

  const seen = new Set();
  return rows.map(values => {
    if (values.length !== COLUMNS.length) throw new Error('Invalid CSV row');
    const data = Object.fromEntries(COLUMNS.map((key, index) => {
      const value = values[index];
      if (numericColumns.has(key)) {
        if (!/^-?\d+$/.test(value)) throw new Error('Invalid CSV number');
        return [key, Number(value)];
      }
      return [key, userTextColumns.has(key) && value.startsWith("'") ? value.slice(1) : value];
    }));
    data.branch_name = displayBranchName(data.branch_name);
    const report = makeReport(data, data.submitted_at);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data.submitted_at) ||
        COLUMNS.some(key => report[key] !== data[key]) || seen.has(data.report_id)) {
      throw new Error('Inconsistent CSV report');
    }
    seen.add(data.report_id);
    return report;
  });
}

export function publicStats(reports) {
  const periods = [...new Set(reports.map(periodKey))].sort().reverse();
  return periods.map(key => {
    const selected = reports.filter(report => periodKey(report) === key);
    const { reporting_year, reporting_month, reporting_week } = selected[0];
    return {
      key, reporting_year, reporting_month, reporting_week,
      branches: selected.map(report => ({
        branch: report.branch_name,
        english: report.active_english_students,
        computer: report.active_computer_students,
        englishClasses: report.active_english_classes,
        computerClasses: report.active_computer_classes,
        academia: ACADEMIC_FIELDS.reduce((total, field) => total + report[field], 0),
        inCount: report.total_students_in,
        outCount: report.total_students_out
      })).sort((left, right) => left.branch.localeCompare(right.branch, 'en'))
    };
  });
}
