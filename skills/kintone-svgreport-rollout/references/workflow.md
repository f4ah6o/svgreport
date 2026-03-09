# Workflow

## Required state

Keep one run manifest at `.tmp/kintone-report-rollout/<run-id>/run.json`.
Do not invent alternate state files.

The normal sequence is:

1. `inspect-source`
2. `clone-sandbox`
3. `seed-sandbox`
4. `scaffold-template`
5. `prepare-mapping`
6. Human confirms `template.json` and mapping artifacts
7. `upload-draft`
8. `verify-sandbox`
9. `cutover-prod --confirm production`

## Runtime assumptions

- Read secrets from 1Password items `kintone開発者アカウント` and `kintone帳票`.
- Issue per-app API tokens through `kintone-control-center`.
- Compose `KINTONE_API_TOKEN` at runtime from the report env item plus token items recorded in the run manifest.
- Keep all generated files under `.tmp/kintone-report-rollout/<run-id>/`.

## Human gates

- Stop after `prepare-mapping` until the user confirms `template.json` render bindings and mapping output.
- Stop before `cutover-prod` unless the command includes `--confirm production`.

## Out of scope for v1

- Automatic deployment of kintone front-end JavaScript/plugin customization
- Automatic reconciliation of lookup/reference-table dependencies across cloned apps
- Fully automatic SVG field binding from PDF visuals without human review
