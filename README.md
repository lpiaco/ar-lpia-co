# LPIA Academic Report

The public frontend is plain HTML, CSS, and JavaScript on GitHub Pages at `ar.lpia.co`. The only report datastore is a CSV in a private GitHub repository. A same-origin Cloudflare Worker serves `/api/reports` and holds the credentials for GitHub. Everything else on the domain continues to be served by GitHub Pages.

## What the app does

- **START** requests fullscreen and opens the main menu. Browsers that decline fullscreen still open the menu. There is a space reserved for the upcoming logo.
- **Current Status** shows aggregate reports by selected period, branch coverage, a branch ranking, students, classes, academic personnel, and student movement. Averages divide by branches reporting or by the applicable class count. Missing branches are not counted as zero. Empty or disconnected storage is labelled.
- **Enter Data** provides the approved branch form, with live totals and authorized lookup of earlier Academic Numbers. A central access code can read all report history. An individual branch access code can view only that branch's reports.
- After a verified save, choose the latest report, searchable report history, a WhatsApp summary, or **Selesai**. The WhatsApp link opens a draft; the coordinator chooses the recipient and sends it. Set `ACADEMIC_OFFICE_WHATSAPP` in `app.js` to the confirmed number in international digits if available. To add the upcoming logo, place it in the site repository and set `BRAND_LOGO_URL` in `app.js`.

## Release

The production site repository is `lpiaco/ar-lpia-co`, which is public. Keep the report CSV and credentials outside this repository.

The backend requires an initialized **private** GitHub repository such as `lpiaco/ar-lpia-reports`. Its first verified report creates `reports.csv`. The Worker route is limited to `ar.lpia.co/api/*`. It requires a Cloudflare token that can deploy Workers and update the route for `lpia.co`. The GitHub runtime token should be scoped to the private data repository with Contents read/write access.

With those secure bindings available in the deployment environment, the deployment and HTTP smoke test use one command.

```sh
bash worker/deploy.sh
```

Bindings used by the command:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Worker deployment and route management |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account |
| `REPORT_REPOSITORY` | Private repository name, e.g. `lpiaco/ar-lpia-reports` |
| `GITHUB_REPORT_TOKEN` | Runtime access to the private report repository |
| `REPORT_ACCESS_CODES` | JSON object mapping branch IDs to access codes. Optional key `all` is the central access code. Use unique random codes of at least 12 characters and share them privately. |
| `REPORT_BRANCH` | Optional data repository branch, defaults to `main` |

Deployment bindings and institution access codes belong in secure settings. The frontend sends access codes only in same-origin POST request bodies and clears them when the user finishes. Public statistics contain counts and branch labels. Full records, including academic names and remarks, require authorized access.

## CSV export

An authorized owner can download the raw `reports.csv` from the private data repository. Its header, UTF-8 encoding, and comma delimiters are compatible with spreadsheet import. When importing, select comma as the separator and keep `branch_id` as text to retain leading zeroes. Text that could be interpreted as a formula is escaped for spreadsheet import. Timestamps are stored in ISO UTC and shown in WIB on the site. The current file size limit is 950 KB.

A report ID identifies one branch and period. A matching retry returns the stored report. A different submission to an existing ID is rejected without overwriting. Concurrent writes use the GitHub file SHA and retry on conflict. Success requires reading back the new CSV at the exact commit SHA.

## Checks

```sh
node checks/reports.test.mjs
```

The API tests simulate GitHub's contents API. To run the browser suite against the same test endpoint, also supply `PLAYWRIGHT_MODULE` and, when needed, `CHROMIUM_PATH`. Demo fixtures are confined to the test code.
