#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = args['out-dir'] || '.tmp/kintone';

await mkdir(outDir, { recursive: true });

const templateFields = buildTemplateFields();
const jobFields = buildJobFields();

await writeJson(path.join(outDir, 'template-properties.json'), templateFields);
await writeJson(path.join(outDir, 'job-properties.json'), jobFields);

console.log(`Generated field payloads in ${outDir}`);

function buildTemplateFields() {
  const templateCode = requiredEnv('REPORT_TEMPLATE_FIELD_TEMPLATE_CODE');
  const version = requiredEnv('REPORT_TEMPLATE_FIELD_VERSION');
  const sourceAppId = requiredEnv('REPORT_TEMPLATE_FIELD_SOURCE_APP_ID');
  const status = requiredEnv('REPORT_TEMPLATE_FIELD_STATUS');
  const publishedSeq = requiredEnv('REPORT_TEMPLATE_FIELD_PUBLISHED_SEQ');
  const actionCode = requiredEnv('REPORT_TEMPLATE_FIELD_ACTION_CODE');
  const templateJson = requiredEnv('REPORT_TEMPLATE_FIELD_TEMPLATE_JSON');
  const page1Svg = requiredEnv('REPORT_TEMPLATE_FIELD_PAGE1_SVG');
  const pageFollowSvg = requiredEnv('REPORT_TEMPLATE_FIELD_PAGE_FOLLOW_SVG');

  return {
    [templateCode]: singleLine(templateCode, 'Template Code'),
    [version]: singleLine(version, 'Version'),
    [sourceAppId]: numberField(sourceAppId, 'Source App ID'),
    [status]: dropDown(status, 'Status', ['Draft', 'Published']),
    [publishedSeq]: numberField(publishedSeq, 'Published Sequence'),
    [actionCode]: singleLine(actionCode, 'Action Code'),
    [templateJson]: multiLine(templateJson, 'Template JSON'),
    [page1Svg]: fileField(page1Svg, 'Page 1 SVG'),
    [pageFollowSvg]: fileField(pageFollowSvg, 'Page Follow SVG'),
  };
}

function buildJobFields() {
  const jobId = requiredEnv('REPORT_JOB_FIELD_JOB_ID');
  const idempotencyKey = requiredEnv('REPORT_JOB_FIELD_IDEMPOTENCY_KEY');
  const status = requiredEnv('REPORT_JOB_FIELD_STATUS');
  const appId = requiredEnv('REPORT_JOB_FIELD_APP_ID');
  const recordId = requiredEnv('REPORT_JOB_FIELD_RECORD_ID');
  const templateActionCode = requiredEnv('REPORT_JOB_FIELD_TEMPLATE_ACTION_CODE');
  const templateCode = requiredEnv('REPORT_JOB_FIELD_TEMPLATE_CODE');
  const templateVersion = requiredEnv('REPORT_JOB_FIELD_TEMPLATE_VERSION');
  const requestedBy = requiredEnv('REPORT_JOB_FIELD_REQUESTED_BY');
  const attempts = requiredEnv('REPORT_JOB_FIELD_ATTEMPTS');
  const maxAttempts = requiredEnv('REPORT_JOB_FIELD_MAX_ATTEMPTS');
  const nextRunAt = requiredEnv('REPORT_JOB_FIELD_NEXT_RUN_AT');
  const startedAt = requiredEnv('REPORT_JOB_FIELD_STARTED_AT');
  const finishedAt = requiredEnv('REPORT_JOB_FIELD_FINISHED_AT');
  const inputSnapshot = requiredEnv('REPORT_JOB_FIELD_INPUT_SNAPSHOT_JSON');
  const renderDebug = requiredEnv('REPORT_JOB_FIELD_RENDER_DEBUG_JSON');
  const outputPdf = requiredEnv('REPORT_JOB_FIELD_OUTPUT_PDF');
  const outputSvgZip = requiredEnv('REPORT_JOB_FIELD_OUTPUT_SVG_ZIP');
  const errorCode = requiredEnv('REPORT_JOB_FIELD_ERROR_CODE');
  const errorMessage = requiredEnv('REPORT_JOB_FIELD_ERROR_MESSAGE');

  return {
    [jobId]: singleLine(jobId, 'Job ID'),
    [idempotencyKey]: singleLine(idempotencyKey, 'Idempotency Key'),
    [status]: dropDown(status, 'Status', ['QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED']),
    [appId]: numberField(appId, 'Source App ID'),
    [recordId]: singleLine(recordId, 'Source Record ID'),
    [templateActionCode]: singleLine(templateActionCode, 'Template Action Code'),
    [templateCode]: singleLine(templateCode, 'Template Code'),
    [templateVersion]: singleLine(templateVersion, 'Template Version'),
    [requestedBy]: singleLine(requestedBy, 'Requested By'),
    [attempts]: numberField(attempts, 'Attempts'),
    [maxAttempts]: numberField(maxAttempts, 'Max Attempts'),
    [nextRunAt]: datetimeField(nextRunAt, 'Next Run At'),
    [startedAt]: datetimeField(startedAt, 'Started At'),
    [finishedAt]: datetimeField(finishedAt, 'Finished At'),
    [inputSnapshot]: multiLine(inputSnapshot, 'Input Snapshot JSON'),
    [renderDebug]: multiLine(renderDebug, 'Render Debug JSON'),
    [outputPdf]: fileField(outputPdf, 'Output PDF'),
    [outputSvgZip]: fileField(outputSvgZip, 'Rendered SVG ZIP'),
    [errorCode]: singleLine(errorCode, 'Error Code'),
    [errorMessage]: multiLine(errorMessage, 'Error Message'),
  };
}

function singleLine(code, label) {
  return { type: 'SINGLE_LINE_TEXT', code, label };
}

function multiLine(code, label) {
  return { type: 'MULTI_LINE_TEXT', code, label };
}

function numberField(code, label) {
  return { type: 'NUMBER', code, label };
}

function datetimeField(code, label) {
  return { type: 'DATETIME', code, label };
}

function fileField(code, label) {
  return { type: 'FILE', code, label };
}

function dropDown(code, label, options) {
  const mapped = {};
  options.forEach((name, i) => {
    mapped[name] = { index: i, label: name };
  });
  return { type: 'DROP_DOWN', code, label, options: mapped };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    parsed[key] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return value;
}
