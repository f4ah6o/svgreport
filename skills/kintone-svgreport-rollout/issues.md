# Issues

## 2026-03-09

- The first implementation used `op` directly for item reads. In this shell model that did not survive between subprocesses, so the skill now reads everything through `opz ... -- bash -lc ...`.
- The first implementation also called `just issue-api-token ... env_key=...`, but that recipe forwards `env_key=...` as the literal `--env-key` value. The skill now bypasses the recipe and calls `opz ... -- pnpm run kintone:issue-api-token --env-key ...` directly.
- `inspect-source` still treats `--sample-record-id` as mandatory if provided, and app `119` does not have record `1`. The workflow exported app metadata successfully, then stopped on `[404] [GAIA_RE01]`. For now the operator must rerun with an existing record ID.
- `clone-sandbox` only forwarded `space` when cloning an app inside a kintone space. App `119` lives in `spaceId=8` / `threadId=8`, and kintone preview app creation rejected the request until `thread` was also sent.
- `clone-sandbox` originally stripped the `code` property from each cloned field definition. kintone preview form APIs still require `properties[*].code`, so app `119` failed with `Required field` errors for every field until the skill restored field codes in the payload.
- `scaffold-template` assumed unbundled files like `dist/core/template-importer.js` existed after `pnpm build`, but the current rolldown output only emits `dist/index.js` and `dist/cli.js`. The skill needs to import public exports from `dist/index.js` instead.
- App `119` has no writable `FILE` field, so `output_attachment_field_code` stays empty. The rollout cannot proceed to `upload-draft` / `verify-sandbox` until the source app design includes a PDF attachment destination or the skill is extended to add one deliberately.
- The supplied `/home/f12o/src/SVGasFormReport/sample領収証.pdf` converts to SVG, but the imported text elements are path-only glyphs with empty `content`. That leaves `binding-candidate.md` without usable matches and makes automatic field-to-visual mapping effectively impossible without OCR or manual SVG annotation.
- `verify-sandbox` hit another 1Password edge: the rollout script called `opz` from inside a process that already needed `opz`-injected data, and the nested authorization prompt was dismissed. The practical fix is to let the script consume already-injected env vars before falling back to `opz`.
- `report-template/v1` currently rejects `mapping.table.columns: []` even when the render template has no table bindings. For scalar-only receipts, the rollout needs a harmless placeholder column or the schema must be relaxed.
- `REPORT_PLAYWRIGHT_CMD` is passed to `spawn()` as a single executable name. Values like `npx playwright` do not work directly; they need a wrapper script or argument-aware command handling in the worker.
