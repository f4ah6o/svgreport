# kintone plugin bootstrap

This directory contains a minimal runtime script for the record detail view:

- `record-generate.js`: renders one button per `template_action_code` and enqueues an async report job through `/api/v1/jobs`.

## Required plugin config keys

- `REPORT_API_BASE_URL`: e.g. `https://report-api.example.internal`
- `REPORT_API_TOKEN`: bearer token for `report-api` command

## Runtime requirements

- Install the script in target source apps.
- Add `kintone-plugin/record-generate.js` as JavaScript customization (or bundle it in your plugin package).
- Ensure the backend API server is reachable from the kintone domain.
