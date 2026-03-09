# Run Artifacts

The orchestrator writes these artifacts into `.tmp/kintone-report-rollout/<run-id>/`.

## Source app exports

- `source-app-info.json`
- `source-fields.json`
- `source-layout.json`
- `source-settings.json`
- `source-sample-record.json` when `--sample-record-id` is provided

## Sandbox outputs

- `sandbox-seed-records.json`
- sandbox app ID and token item references inside `run.json`

## Template and mapping outputs

- `templates/<template-code>/<version>/template.json`
- `text-elements-page-1.json`
- `text-elements-page-follow.json`
- `mapping-candidate.json`
- `binding-candidate.md`
- `mapping-review.md`

## Review rule

Treat `mapping-candidate.json` and `binding-candidate.md` as proposals.
Do not assume they are production-ready until the user confirms them.
