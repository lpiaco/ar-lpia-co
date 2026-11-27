# LPIA Academic Report

The site at `ar.lpia.co` is served by GitHub Pages from `main`. The public [reports.csv](https://github.com/lpiaco/ar-lpia-co/blob/report-data/reports.csv) lives on this repository's `report-data` branch. Import it as UTF-8 comma-delimited data and set `branch_id` to text to retain leading zeros.

## Application

- **START** requests fullscreen. The main views scroll inside the app and show the LPIA logo and heading. The closing screen exits fullscreen. Browsers that decline fullscreen keep their browser controls visible.
- The entry form uses scrollable branch, year, month, and week pickers where HTML dialogs are supported. The year range is 2026–2036. Academic Numbers use the most recent saved counts for the selected branch, up to the selected week, and remain editable.
- The dashboard shows weekly data from the CSV alongside monthly snapshots from January 2023 through November 2026. Monthly data contains aggregate branch counts and no coordinator names. Blank counts in the source remain unknown.
- The main menu shows historical progress since January by month, with a separate summary of new reports. Select a historical month to open its details. New-report totals and the dashboard read saved reports from the CSV. Monthly active counts use each branch’s latest weekly report, and monthly movement totals cover reported weeks. Dashboard summaries and individual reports can be downloaded as CSV and printed. **Check Report** reads the selected report from the CSV. **SUBMIT** sends JSON to the same-origin `POST /api/reports` endpoint. The site opens no external page and shows a receipt only after the API verifies the GitHub CSV commit. If the endpoint is unavailable, the form retains the entered values and offers **Continue submission**, which prefills the new issue’s **Body**. Click **Create** to send it. The app also attempts to copy the report as a backup. If the encoded link is too long, paste the copied report or copy the selected text manually. The issue workflow writes the CSV and triggers its Google Sheets mirror. The form watches the CSV and shows a receipt when the saved values match.
- The saved-report screen includes report details, searchable history, and a WhatsApp draft. Set `ACADEMIC_OFFICE_WHATSAPP` in `app.js` if the office number becomes available.

## Connect direct submission

The endpoint implementation is `lib/report-store.mjs`. GitHub Pages serves static files. Deploy the endpoint with the included `wrangler.jsonc` to the existing Cloudflare zone at `ar.lpia.co/api/reports`. It uses a GitHub token scoped to the repository and writes only to the `report-data` branch.

Direct submissions do not require a coordinator access code. Configure `GITHUB_REPORT_TOKEN` with Contents read/write permission for the report repository. `REPORT_ACCESS_CODES` is used only by restricted API queries. The site’s reporting views read the public CSV.

An authorized Cloudflare deployment must attach the token and the route. Keep token values outside the repository and ZIP. The existing issue workflow remains available through the explicit fallback link.

The production Worker route is responding. While it returns HTTP 503 with `Report storage is not connected yet.`, verify its repository settings and token binding. The browser tests exercise a direct submission without any access-code binding and the fallback path.

## Local checks

Run `node checks/reports.test.mjs`. Supply `PLAYWRIGHT_MODULE` and optionally `CHROMIUM_PATH` to exercise the browser suite, including modal dimensions, automatic CSV prefill, direct POST, preserved input on failure, receipt, history, and exit.

## Google Sheets mirror

GitHub remains the source of truth. The **Sync reports.csv to Google Sheets** workflow mirrors the latest CSV from `report-data` to the **GitHub Reports** tab of the [prototype spreadsheet](https://docs.google.com/spreadsheets/d/15aUuGb1WaXvaXR39FO5Bby2YBLjC_UFZvv4ALaW-exQ/edit). The source spreadsheet and other tabs are outside the sync. After creating its destination tab, the sync marks it as managed and refuses to overwrite a same-named tab that it did not create. Manual edits to the managed tab are replaced on the next sync.

A push to `report-data` calls the sync through the workflow file stored on that branch. Commits made with GitHub Actions' built-in token do not trigger push workflows, so a separate `workflow_run` trigger runs after successful **Save LPIA report** runs. This job reads the current branch head and its pinned CSV. It never writes to GitHub or blocks a report save. The workflow can also be run manually.

Set up access one time:

1. Enable the Google Sheets API in a Google Cloud project and create a dedicated service account. Share only the prototype spreadsheet with that account as **Editor**.
2. Store the service-account JSON key as the GitHub Actions repository secret `GOOGLE_SERVICE_ACCOUNT_JSON`. Use **Settings → Secrets and variables → Actions → New repository secret**.
3. Run **Sync reports.csv to Google Sheets** once from **Actions**. The job reports the CSV commit and how many rows it verified. Counts remain numbers, IDs retain leading zeroes, and any formula-like text is written literally.

Run `node checks/sync-reports-to-sheet.test.mjs` to exercise the sync locally with simulated services.
