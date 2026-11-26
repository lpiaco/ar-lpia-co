import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../../lib/report-store.mjs';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const issue = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')).issue;
if (repository?.toLowerCase() !== 'lpiaco/ar-lpia-co' ||
    !token || issue?.title !== 'LPIA Academic Report' || !Number.isSafeInteger(issue.number)) {
  throw new Error('Invalid reporting workflow event.');
}

const origin = 'https://ar.lpia.co';
let report;
try {
  if (typeof issue.body === 'string' && issue.body.length <= 10000) report = JSON.parse(issue.body);
} catch {
  // The handler produces a validation error when the submission is not valid JSON.
}

const accessCode = randomUUID();
const response = await createHandler()(new Request(origin + '/api/reports', {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation: 'submit', report, accessCode })
}), {
  GITHUB_REPORT_TOKEN: token,
  REPORT_ACCESS_CODES: JSON.stringify({ all: accessCode })
});
const result = await response.json();
const message = response.ok
  ? 'Verified in [reports.csv](https://github.com/lpiaco/ar-lpia-co/blob/report-data/reports.csv) · ' + result.report.report_id
  : (report ? result.message : 'Paste the complete report copied by ar.lpia.co into the description and edit this issue.');
const comment = await fetch('https://api.github.com/repos/' + repository + '/issues/' + issue.number + '/comments', {
  method: 'POST',
  headers: {
    Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'
  },
  body: JSON.stringify({ body: message })
});
if (!comment.ok) console.error('Could not post the receipt comment. HTTP ' + comment.status);
if (!response.ok) throw new Error('Report was not saved. HTTP ' + response.status);
console.log('Verified report ' + result.report.report_id);
