# LPIA Academic Report

The site at `ar.lpia.co` is served by GitHub Pages from `main`. The public [reports.csv](https://github.com/lpiaco/ar-lpia-co/blob/report-data/reports.csv) lives on this repository's `report-data` branch. Import it as UTF-8 comma-delimited data and set `branch_id` to text to retain leading zeros.

## Application

- **START** requests fullscreen. The main views scroll inside the app and show the LPIA logo and heading. The closing screen exits fullscreen. Browsers that decline fullscreen keep their browser controls visible.
- The entry form uses scrollable branch, year, and month pickers where HTML dialogs are supported. The year range is 2026–2036. Academic Numbers use the most recent saved counts for the selected branch, up to the selected week, and remain editable.
- The dashboard shows weekly data from the CSV alongside monthly snapshots from January 2023 through November 2026. Monthly data contains aggregate branch counts and no coordinator names. Blank counts in the source remain unknown.
- **Check Report** reads the selected report from the CSV. **SUBMIT** sends JSON to the same-origin `POST /api/reports` endpoint. The site opens no external page and shows a receipt only after the API verifies the GitHub CSV commit. If the endpoint is unavailable, the form displays the problem and retains the entered values.
- The saved-report screen includes report details, searchable history, and a WhatsApp draft. Set `ACADEMIC_OFFICE_WHATSAPP` in `app.js` if the office number becomes available.

## Connect direct submission

The endpoint implementation is `lib/report-store.mjs`. GitHub Pages serves static files. Deploy the endpoint with the included `wrangler.jsonc` to the existing Cloudflare zone at `ar.lpia.co/api/reports`. It uses a GitHub token scoped to the repository and writes only to the `report-data` branch.

The two runtime secrets are:

- `GITHUB_REPORT_TOKEN`: GitHub token with repository Contents read/write access.
- `REPORT_ACCESS_CODES`: JSON mapping zero-padded branch IDs to reporting access codes. The `all` key is optional central access. Codes must be 12 to 128 characters and are requested in the form when needed.

An authorized Cloudflare deployment must attach those secrets and the route. Keep actual values outside this repository and ZIP. The existing issue workflow remains available for previously created GitHub issues. The application no longer opens the issue workflow.

At the handoff, the live endpoint returned HTTP 404. The browser success, access-code prompt, validation, and error paths were exercised against a simulated endpoint. The production direct-write test is pending a deployment with the required access.

## Local checks

Run `node checks/reports.test.mjs`. Supply `PLAYWRIGHT_MODULE` and optionally `CHROMIUM_PATH` to exercise the browser suite, including modal dimensions, automatic CSV prefill, direct POST, preserved input on failure, receipt, history, and exit.
