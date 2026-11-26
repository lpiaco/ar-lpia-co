#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID GITHUB_REPORT_TOKEN REPORT_ACCESS_CODES; do
  if [[ -z ${!name:-} ]]; then
    printf 'Missing deployment binding: %s\n' "$name" >&2
    exit 1
  fi
done

umask 077
secret_file=$(mktemp)
trap 'rm -f -- "$secret_file"' EXIT
node --input-type=module - "$secret_file" <<'JS'
import { writeFileSync } from 'node:fs';
const env = process.env;
const siteRepository = 'lpiaco/ar-lpia-co';
const keys = ['REPORT_REPOSITORY', 'REPORT_BRANCH', 'GITHUB_REPORT_TOKEN', 'REPORT_ACCESS_CODES'];
const config = Object.fromEntries(keys.flatMap(key => env[key] ? [[key, env[key]]] : []));
config.REPORT_REPOSITORY ||= siteRepository;
const siteRepo = config.REPORT_REPOSITORY.toLowerCase() === siteRepository;
config.REPORT_BRANCH ||= siteRepo ? 'report-data' : 'main';
if (siteRepo && config.REPORT_BRANCH !== 'report-data') {
  throw new Error('The website repository accepts report writes only on report-data.');
}
const response = await fetch('https://api.github.com/repos/' + config.REPORT_REPOSITORY, {
  redirect: 'error',
  headers: {
    Authorization: 'Bearer ' + config.GITHUB_REPORT_TOKEN,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'LPIA-Academic-Report'
  }
});
const repository = response.ok ? await response.json() : {};
if ((!siteRepo && repository.private !== true) || !repository.permissions?.push) {
  throw new Error('The runtime token must have write access to an approved reports repository.');
}
const codes = JSON.parse(config.REPORT_ACCESS_CODES);
if (!Object.entries(codes).some(([key, value]) =>
  /^(all|0[1-9]|1[0-9]|2[0-4])$/.test(key) && typeof value === 'string' && value.length >= 12 && value.length <= 128
)) throw new Error('At least one branch code or central access code is required.');
writeFileSync(process.argv[2], JSON.stringify(config), { mode: 0o600 });
JS
WRANGLER_SEND_METRICS=false npx --yes wrangler@4 deploy --secrets-file "$secret_file"
curl --fail-with-body --silent --show-error --max-time 20 https://ar.lpia.co/api/reports
printf '\n'
