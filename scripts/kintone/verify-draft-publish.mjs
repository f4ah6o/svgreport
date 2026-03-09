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

function startApi(env) {
  const child = spawn('node', ['.tmp/tsc/cli.js', 'report-api'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => process.stdout.write(`[report-api] ${buf}`));
  child.stderr.on('data', (buf) => process.stderr.write(`[report-api] ${buf}`));
  return child;
}

async function main() {
  const sourceAppId = Number.parseInt(getArg('source-app-id', '45'), 10);
  const templateVersion = getArg('template-version', 'v1');
  const actionCode = getArg('action-code', 'todo_delivery');
  const templateDir = getArg('template-dir', 'test-templates/delivery-slip/v1');
  const templateCode = getArg('template-code', `verify_delivery_${Date.now()}`);
  const reuseServices = getArg('reuse-services', 'false') === 'true';

  const baseUrl = requiredEnv('KINTONE_BASE_URL');
  const apiTokens = requiredEnv('KINTONE_API_TOKEN').split(',').map((v) => v.trim()).filter(Boolean);
  const apiHost = process.env.REPORT_API_HOST || '127.0.0.1';
  const apiPort = process.env.REPORT_API_PORT || '8790';
  const apiAuthToken = process.env.REPORT_API_AUTH_TOKEN || '';

  const apiBase = `http://${apiHost}:${apiPort}`;
  const client = new KintoneRestAPIClient({ baseUrl, auth: { apiToken: apiTokens.length === 1 ? apiTokens[0] : apiTokens } });

  const children = [];
  try {
    if (!reuseServices) {
      children.push(startApi({ ...process.env }));
    }
    await waitForHealth(apiBase, apiAuthToken, 30000);

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

    const draft = await api(`/api/v1/templates/${encodeURIComponent(templateCode)}/${encodeURIComponent(templateVersion)}/draft`, 'PUT', {
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
          pdf_filename_expr: 'verify_{record_id}_{timestamp}.pdf',
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
    });

    const published = await api(`/api/v1/templates/${encodeURIComponent(templateCode)}/${encodeURIComponent(templateVersion)}/publish`, 'POST', {
      source_app_id: sourceAppId,
    });

    const actions = await api(`/api/v1/apps/${sourceAppId}/template-actions`, 'GET');
    const matched = (actions.actions || []).find((a) => a.action_code === actionCode);
    const visible = Boolean(matched);

    const out = {
      ok: true,
      template_code: templateCode,
      template_version: templateVersion,
      action_code: actionCode,
      draft_record_id: draft.record_id,
      published_record_id: published.record_id,
      published_seq: published.published_seq,
      listed_in_template_actions: visible,
      listed_template_code: matched?.template_code ?? null,
      listed_template_version: matched?.version ?? null,
    };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    for (const child of children) {
      if (!child.killed) child.kill('SIGINT');
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
