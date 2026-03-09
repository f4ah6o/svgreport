#!/usr/bin/env node
import process from 'node:process';
import { KintoneRestAPIClient } from '@kintone/rest-api-client';

function getArg(name, fallback = undefined) {
  const key = `--${name}`;
  const idx = process.argv.indexOf(key);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseCsv(value) {
  return (value || '').split(',').map((v) => v.trim()).filter(Boolean);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const sourceAppId = Number.parseInt(getArg('source-app-id', '45'), 10);
  const sourceRecordId = Number.parseInt(getArg('source-record-id', '1'), 10);
  const actionCodes = parseCsv(getArg('action-codes', 'todo_delivery'));
  const templateCodes = parseCsv(getArg('template-codes', 'demo_delivery_slip,diag_delivery'));
  const dryRun = getArg('dry-run', 'false') === 'true';

  const client = new KintoneRestAPIClient({
    baseUrl: requiredEnv('KINTONE_BASE_URL'),
    auth: {
      apiToken: requiredEnv('KINTONE_API_TOKEN').split(',').map((v) => v.trim()).filter(Boolean),
    },
  });

  const templateAppId = Number.parseInt(requiredEnv('REPORT_TEMPLATE_APP_ID'), 10);
  const jobAppId = Number.parseInt(requiredEnv('REPORT_JOB_APP_ID'), 10);

  const actionFilter = actionCodes.length
    ? actionCodes.map((c) => `template_action_code = "${c.replaceAll('"', '\\"')}"`).join(' or ')
    : '';
  const failedQuery = [
    'status in ("FAILED","RETRY_WAIT")',
    actionFilter ? `and (${actionFilter})` : '',
    'order by $id asc limit 500',
  ].filter(Boolean).join(' ');

  const failedJobs = await client.record.getRecords({ app: jobAppId, query: failedQuery });
  const failedIds = failedJobs.records.map((r) => Number.parseInt(r.$id.value, 10));

  const templateFilter = templateCodes.length
    ? templateCodes.map((c) => `template_code = "${c.replaceAll('"', '\\"')}"`).join(' or ')
    : '';
  const templateQuery = [
    templateFilter ? `(${templateFilter})` : '',
    'order by $id asc limit 500',
  ].filter(Boolean).join(' ');
  const templates = templateQuery ? await client.record.getRecords({ app: templateAppId, query: templateQuery }) : { records: [] };
  const templateIds = templates.records.map((r) => Number.parseInt(r.$id.value, 10));

  const source = await client.record.getRecord({ app: sourceAppId, id: sourceRecordId });
  const files = Array.isArray(source.record.Attachments?.value) ? source.record.Attachments.value : [];
  const kept = [];
  const removed = [];
  for (const f of files) {
    const name = String(f.name || '');
    if (/^delivery_.*\.pdf$/i.test(name) || name === 'ping.txt') {
      removed.push(name);
      continue;
    }
    kept.push({ fileKey: f.fileKey });
  }

  if (!dryRun) {
    for (const ids of chunk(failedIds, 100)) {
      if (ids.length) {
        await client.record.deleteRecords({ app: jobAppId, ids });
      }
    }
    for (const ids of chunk(templateIds, 100)) {
      if (ids.length) {
        await client.record.deleteRecords({ app: templateAppId, ids });
      }
    }
    if (removed.length) {
      await client.record.updateRecord({
        app: sourceAppId,
        id: sourceRecordId,
        revision: Number.parseInt(source.record.$revision.value, 10),
        record: {
          Attachments: { value: kept },
        },
      });
    }
  }

  const out = {
    ok: true,
    dry_run: dryRun,
    deleted_failed_jobs: failedIds.length,
    deleted_template_records: templateIds.length,
    removed_source_attachments: removed,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
