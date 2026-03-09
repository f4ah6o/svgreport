#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { KintoneRestAPIClient } from '@kintone/rest-api-client';

function getArg(name, fallback = undefined) {
  const key = `--${name}`;
  const idx = process.argv.indexOf(key);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function parseIntArg(name, fallback) {
  const raw = getArg(name, fallback === undefined ? undefined : String(fallback));
  if (!raw) throw new Error(`Missing --${name}`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --${name}: ${raw}`);
  return n;
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, token, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}/api/v1/health`, { headers });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  throw new Error(`report-api did not become healthy within ${timeoutMs}ms`);
}

function startProcess(cmd, args, env, label) {
  const child = spawn(cmd, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => process.stdout.write(`[${label}] ${buf}`));
  child.stderr.on('data', (buf) => process.stderr.write(`[${label}] ${buf}`));
  return child;
}

async function main() {
  const sourceAppId = parseIntArg('source-app-id', 45);
  const sourceRecordId = getArg('source-record-id', '1');
  const templateCode = getArg('template-code', 'demo_delivery_slip');
  const templateVersion = getArg('template-version', 'v1');
  const actionCode = getArg('action-code', 'todo_delivery');
  const templateDir = getArg('template-dir', 'test-templates/delivery-slip/v1');
  const requestedBy = getArg('requested-by', `${process.env.username || 'unknown'}:${Date.now()}`);
  const reuseServices = getArg('reuse-services', 'false') === 'true';

  const baseUrl = requiredEnv('KINTONE_BASE_URL');
  const apiTokens = requiredEnv('KINTONE_API_TOKEN').split(',').map((v) => v.trim()).filter(Boolean);
  const templateAppId = parseIntArg('template-app-id', Number.parseInt(requiredEnv('REPORT_TEMPLATE_APP_ID'), 10));
  const apiHost = process.env.REPORT_API_HOST || '127.0.0.1';
  const apiPort = process.env.REPORT_API_PORT || '8790';
  const apiAuthToken = process.env.REPORT_API_AUTH_TOKEN || '';
  const playwrightCmd = getArg('playwright-command', './scripts/kintone/playwright-cmd.sh');

  const apiBase = `http://${apiHost}:${apiPort}`;

  const client = new KintoneRestAPIClient({
    baseUrl,
    auth: { apiToken: apiTokens.length === 1 ? apiTokens[0] : apiTokens },
  });

  const childEnv = { ...process.env };
  const children = [];
  try {
    if (!reuseServices) {
      const apiProc = startProcess('node', ['.tmp/tsc/cli.js', 'report-api'], childEnv, 'report-api');
      children.push(apiProc);
      const workerProc = startProcess('node', ['.tmp/tsc/cli.js', 'report-worker', '--playwright-command', playwrightCmd], childEnv, 'report-worker');
      children.push(workerProc);
    }

    await waitForHealth(apiBase, apiAuthToken, 30000);

    const beforeRec = await client.record.getRecord({ app: sourceAppId, id: Number(sourceRecordId) });
    const beforeFiles = Array.isArray(beforeRec.record.Attachments?.value) ? beforeRec.record.Attachments.value : [];

    const tplDirAbs = path.resolve(templateDir);
    const [renderRaw, page1, pageFollow] = await Promise.all([
      fs.readFile(path.join(tplDirAbs, 'template.json'), 'utf8'),
      fs.readFile(path.join(tplDirAbs, 'page-1.svg')),
      fs.readFile(path.join(tplDirAbs, 'page-follow.svg')),
    ]);
    const render = JSON.parse(renderRaw);

    const [f1, f2] = await Promise.all([
      client.file.uploadFile({ file: { name: 'page-1.svg', data: page1 } }),
      client.file.uploadFile({ file: { name: 'page-follow.svg', data: pageFollow } }),
    ]);

    const headers = { 'Content-Type': 'application/json' };
    if (apiAuthToken) headers.Authorization = `Bearer ${apiAuthToken}`;
    const api = async (pathname, method, body) => {
      const res = await fetch(`${apiBase}${pathname}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(`${method} ${pathname} failed: ${res.status} ${JSON.stringify(json)}`);
      }
      return json;
    };

    const draftBody = {
      source_app_id: sourceAppId,
      action_code: actionCode,
      template: {
        schema: 'report-template/v1',
        template: {
          code: templateCode,
          version: templateVersion,
          source_app_id: sourceAppId,
          status: 'Draft',
        },
        output: {
          output_attachment_field_code: 'Attachments',
          pdf_filename_expr: 'delivery_{record_id}_{timestamp}.pdf',
        },
        render,
        mapping: {
          schema: 'report-mapping/v1',
          kv_bindings: [],
          table: {
            source: { kind: 'subtable', field_code: 'テーブル_0' },
            columns: [
              { name: 'no', expr: "row('文字列__1行_')" },
              { name: 'name', expr: "row('文字列__1行_')" },
              { name: 'qty', expr: "row('数値')" },
            ],
          },
        },
      },
      page_1_svg_file_key: f1.fileKey,
      page_follow_svg_file_key: f2.fileKey,
    };

    const draft = await api(`/api/v1/templates/${encodeURIComponent(templateCode)}/${encodeURIComponent(templateVersion)}/draft`, 'PUT', draftBody);
    const published = await api(`/api/v1/templates/${encodeURIComponent(templateCode)}/${encodeURIComponent(templateVersion)}/publish`, 'POST', {
      source_app_id: sourceAppId,
    });

    const queued = await api('/api/v1/jobs', 'POST', {
      schema: 'report-job/v1',
      app_id: sourceAppId,
      record_id: sourceRecordId,
      template_action_code: actionCode,
      requested_by: requestedBy,
    });

    let final = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(2000);
      const j = await api(`/api/v1/jobs/${encodeURIComponent(queued.job_id)}`, 'GET');
      if (j.status === 'SUCCEEDED' || j.status === 'FAILED') {
        final = j;
        break;
      }
    }

    if (!final) throw new Error(`Job polling timed out: ${queued.job_id}`);
    if (final.status !== 'SUCCEEDED') {
      throw new Error(`Job failed: ${final.error_code || ''} ${final.error_message || ''}`);
    }

    const afterRec = await client.record.getRecord({ app: sourceAppId, id: Number(sourceRecordId) });
    const afterFiles = Array.isArray(afterRec.record.Attachments?.value) ? afterRec.record.Attachments.value : [];

    const out = {
      ok: true,
      source_app_id: sourceAppId,
      source_record_id: sourceRecordId,
      template_app_id: templateAppId,
      template_code: templateCode,
      template_version: templateVersion,
      action_code: actionCode,
      draft_record_id: draft.record_id,
      published_record_id: published.record_id,
      published_seq: published.published_seq,
      job_id: queued.job_id,
      status: final.status,
      attachments_before: beforeFiles.length,
      attachments_after: afterFiles.length,
      latest_attachment_name: afterFiles.at(-1)?.name || null,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGINT');
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
