---
name: kintone-svgreport-rollout
description: Automate repo-local svgreport rollout work for kintone using kintone-control-center and 1Password. Use when inspecting a development-stage source app, issuing API tokens, optionally cloning a sandbox app, importing a PDF into an SVG template workspace, preparing report mapping candidates, uploading/publishing report templates, verifying report generation, or gating production cutover.
---

# Kintone Svgreport Rollout

Use this skill for end-to-end report rollout work inside this repository.

## Workflow

1. Read [references/workflow.md](references/workflow.md).
2. Keep all state in `.tmp/kintone-report-rollout/<run-id>/run.json`.
3. For development-stage apps, run the orchestrator in this order unless the run already contains the later artifacts:
   - `inspect-source`
   - `scaffold-template`
   - `prepare-mapping`
   - human review
   - `upload-draft`
   - `verify-sandbox`
   - `cutover-prod --confirm production`
4. Only insert `clone-sandbox` and `seed-sandbox` when you explicitly need an isolated verification app.

## Quick Start

Run from the `svgreport` repository root:

```bash
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs inspect-source \
  --run-id demo \
  --source-app-id 42 \
  --sample-record-id 1

node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs scaffold-template \
  --run-id demo \
  --pdf /abs/path/source.pdf \
  --template-code invoice_demo \
  --version v1 \
  --action-code print_invoice

node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs prepare-mapping \
  --run-id demo
```

Optional isolation flow:

```bash
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs clone-sandbox --run-id demo
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs seed-sandbox --run-id demo --record-count 3
```

## Human Review Gate

- Stop after `prepare-mapping`.
- Review [references/run-artifacts.md](references/run-artifacts.md).
- Confirm these files before any draft upload:
  - `templates/<template-code>/<version>/template.json`
  - `mapping-candidate.json`
  - `binding-candidate.md`
  - `mapping-review.md`
- When editing kintone mapping expressions, also read the existing local skill:
  [../kintone-template-mapping/SKILL.md](../kintone-template-mapping/SKILL.md)

## Upload And Verification

After review, continue with:

```bash
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs upload-draft --run-id demo
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs verify-sandbox --run-id demo --record-id 1
```

Use `verify-sandbox` as the main acceptance check. It drafts, publishes, queues a job, waits for completion, and checks that the output file was attached to the verification record. If a sandbox app exists in the run manifest it uses that app first; otherwise it verifies directly on the source app.

## Production Gate

- Never run production cutover implicitly.
- Require `--confirm production`.
- Prefer supplying a known-safe production record for the optional smoke job.

```bash
node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs cutover-prod \
  --run-id demo \
  --confirm production \
  --record-id 1
```

## Rules

- Use 1Password items `kintone開発者アカウント` and `kintone帳票` unless the user explicitly overrides them.
- Use `kintone-control-center` for API token issuance.
- Treat cloned-app warnings, lookup/reference-table dependencies, and unresolved mapping items as blocking review items, not background noise.
- Do not claim rollout completion until verification succeeds on the intended development-stage app or the blocking reason is explicit.
