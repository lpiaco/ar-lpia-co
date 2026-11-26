# LPIA Academic Report

The app at `ar.lpia.co` uses GitHub Pages and stores reports in [reports.csv](https://github.com/lpiaco/ar-lpia-co/blob/report-data/reports.csv) on the `report-data` branch of this repository. The main branch serves the site. The CSV is public.

## Submit a report

1. Press **START**, select **Enter Data of LPIA Students**, complete the form, and press **Submit report**. The site copies the report and opens a new GitHub issue tab with its title prefilled.
2. Sign in to GitHub if needed, paste into **Description**, and click **Create**. If the browser could not copy automatically, use **Copy report** or select the text on the confirmation screen. The same screen has an **Open GitHub** button if the new tab was blocked.
3. Return to `ar.lpia.co`. GitHub Actions validates the issue and writes the row to the CSV. The site shows the receipt only after it reads the matching row from GitHub. The issue receives a verification comment from the workflow.

The GitHub issue must keep its prefilled title. Its body contains the form data as JSON, pasted only into GitHub. **Check saved report** and **Check CSV again** can recover a saved receipt. One report is stored per branch and period. A repeated identical submission returns the existing row. A conflicting one leaves the original report in place.

The dashboard, searchable history, report details and Academic Numbers prefill read the public CSV. The WhatsApp button opens a message draft. The coordinator selects and sends to the recipient. Set `ACADEMIC_OFFICE_WHATSAPP` in `app.js` if the office number becomes available. To add the logo, place it in the site repository and set `BRAND_LOGO_URL` in `app.js`.

## Storage and export

The GitHub workflow uses its built-in token with contents and issues write permissions. No browser or long-lived project token is required. The workflow writes to `report-data` only. It retries concurrent file-SHA conflicts and reads back the exact commit before posting a receipt.

Download the raw `reports.csv` from GitHub. The UTF-8, comma-delimited CSV is compatible with spreadsheet import. Set `branch_id` to text to retain leading zeroes. Formula-like user text is escaped. Timestamps are in ISO UTC, and the site displays them in WIB.

## Checks

Run `node checks/reports.test.mjs`. Set `PLAYWRIGHT_MODULE` and, optionally, `CHROMIUM_PATH` to run the browser suite.
