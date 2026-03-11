#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { KintoneRestAPIClient } from '@kintone/rest-api-client';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const SVGREPORT_DIR = path.resolve(SKILL_DIR, '..', '..');
const ROOT_TMP_DIR = path.join(SVGREPORT_DIR, '.tmp', 'kintone-report-rollout');
const DEFAULT_AUTH_ITEM = 'kintone開発者アカウント';
const DEFAULT_REPORT_ENV_ITEM = 'kintone帳票';
const DEFAULT_KCC_DIR =
  process.env.KCC_DIR || path.resolve(SVGREPORT_DIR, '..', '..', 'kintone-control-center');
const DEFAULT_REPORT_HOST = '127.0.0.1';
const DEFAULT_REPORT_PORT = '8790';
const REPORT_REQUESTED_BY = 'kintone-svgreport-rollout';

const CLONEABLE_FIELD_TYPES = new Set([
  'SINGLE_LINE_TEXT',
  'MULTI_LINE_TEXT',
  'RICH_TEXT',
  'NUMBER',
  'CALC',
  'CHECK_BOX',
  'RADIO_BUTTON',
  'MULTI_SELECT',
  'DROP_DOWN',
  'USER_SELECT',
  'ORGANIZATION_SELECT',
  'GROUP_SELECT',
  'DATE',
  'TIME',
  'DATETIME',
  'LINK',
  'FILE',
  'SUBTABLE',
]);

const UNSUPPORTED_SEED_FIELD_TYPES = new Set([
  'FILE',
  'USER_SELECT',
  'ORGANIZATION_SELECT',
  'GROUP_SELECT',
  'REFERENCE_TABLE',
  'CATEGORY',
  'STATUS',
  'STATUS_ASSIGNEE',
  'CREATOR',
  'MODIFIER',
  'RECORD_NUMBER',
  'CREATED_TIME',
  'UPDATED_TIME',
  'CALC',
]);

function usage() {
  console.log(`Usage:
  node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs <command> [options]

Commands:
  inspect-source   Export source app metadata and optionally issue a source app API token
  clone-sandbox    Optional: create a sandbox app and clone source app fields/layout/settings
  seed-sandbox     Optional: create dummy records in the sandbox app
  scaffold-template Import a PDF into a template workspace and collect mapping context
  prepare-mapping  Generate report mapping candidates and review notes
  upload-draft     Upload the current template + mapping as a Draft through report-api
  verify-sandbox   Publish and run a report job against the sandbox app if present, otherwise the source app
  cutover-prod     Re-draft/publish for the production app and optionally run one smoke job

Shared options:
  --run-id <id>                 Stable run identifier
  --auth-item <title>           1Password auth item title (default: ${DEFAULT_AUTH_ITEM})
  --report-env-item <title>     1Password report env item title (default: ${DEFAULT_REPORT_ENV_ITEM})
  --headed <true|false>         Show Playwright browser for token issuance (default: false)

Examples:
  node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs inspect-source --run-id demo --source-app-id 42 --sample-record-id 1
  node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs scaffold-template --run-id demo --pdf /abs/path/source.pdf --template-code invoice_demo --version v1 --action-code print_invoice
  node skills/kintone-svgreport-rollout/scripts/report-rollout.mjs verify-sandbox --run-id demo --record-id 1
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const args = parseArgs(argv.slice(1));

  switch (command) {
    case 'inspect-source':
      await cmdInspectSource(args);
      break;
    case 'clone-sandbox':
      await cmdCloneSandbox(args);
      break;
    case 'seed-sandbox':
      await cmdSeedSandbox(args);
      break;
    case 'scaffold-template':
      await cmdScaffoldTemplate(args);
      break;
    case 'prepare-mapping':
      await cmdPrepareMapping(args);
      break;
    case 'upload-draft':
      await cmdUploadDraft(args);
      break;
    case 'verify-sandbox':
      await cmdVerifySandbox(args);
      break;
    case 'cutover-prod':
      await cmdCutoverProd(args);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function cmdInspectSource(args) {
  const context = await loadRunContext(args, { create: true });
  const sourceAppId = parseRequiredInt(args['source-app-id'], '--source-app-id');
  const sampleRecordId = args['sample-record-id'] || '';
  const issueToken = readBooleanOption(args['issue-token'], true);
  const headed = readBooleanOption(args.headed, false);
  const auth = await loadAuthConfig(context.run.authItem);
  const sourceTokenEnvKey = tokenEnvKeyForApp(sourceAppId);
  const sourceTokenTitle = tokenTitleForApp(sourceAppId);
  const source = await fetchSourceAppSnapshot(auth, sourceAppId);
  const outputAttachmentFieldCode = detectOutputAttachmentField(source.fields.properties);
  const warnings = collectCloneWarnings(source.fields.properties);

  if (issueToken) {
    issueApiToken({
      appId: sourceAppId,
      permissions: ['read', 'add', 'edit'],
      envKey: sourceTokenEnvKey,
      headed,
    });
  }

  const runDir = context.runDir;
  const appInfoPath = path.join(runDir, 'source-app-info.json');
  const fieldsPath = path.join(runDir, 'source-fields.json');
  const layoutPath = path.join(runDir, 'source-layout.json');
  const settingsPath = path.join(runDir, 'source-settings.json');
  await Promise.all([
    writeJson(appInfoPath, source.appInfo),
    writeJson(fieldsPath, source.fields),
    writeJson(layoutPath, source.layout),
    writeJson(settingsPath, source.settings),
  ]);

  let sampleRecordPath = '';
  if (sampleRecordId) {
    const tokenItem = issueToken
      ? { title: sourceTokenTitle, envKey: sourceTokenEnvKey }
      : context.run.source?.tokenItem;
    if (!tokenItem) {
      throw new Error('Fetching a sample record requires an existing source app token. Re-run with --issue-token true or keep the prior token item in run.json.');
    }
    const sourceToken = await readTokenFromItem(tokenItem.title, tokenItem.envKey);
    const client = createApiTokenClient(auth.baseUrl, [sourceToken]);
    const sampleRecord = await client.record.getRecord({ app: sourceAppId, id: Number(sampleRecordId) });
    sampleRecordPath = path.join(runDir, 'source-sample-record.json');
    await writeJson(sampleRecordPath, sampleRecord);
  }

  context.run.source = {
    appId: sourceAppId,
    sampleRecordId,
    appInfoPath,
    fieldsPath,
    layoutPath,
    settingsPath,
    sampleRecordPath,
    outputAttachmentFieldCode,
    tokenItem: issueToken ? { title: sourceTokenTitle, envKey: sourceTokenEnvKey } : context.run.source?.tokenItem,
    warnings,
  };
  context.run.warnings = uniqueStrings([...(context.run.warnings || []), ...warnings]);
  await context.save();
  printSummary('inspect-source', {
    source_app_id: sourceAppId,
    output_attachment_field_code: outputAttachmentFieldCode || '(not detected)',
    sample_record_id: sampleRecordId || '(not saved)',
    warnings,
  });
}

async function cmdCloneSandbox(args) {
  const context = await loadRunContext(args, { create: false });
  ensureSourceRun(context.run);
  const headed = readBooleanOption(args.headed, false);
  const auth = await loadAuthConfig(context.run.authItem);
  const sourceFields = await readJson(context.run.source.fieldsPath);
  const sourceLayout = await readJson(context.run.source.layoutPath);
  const sourceSettings = await readJson(context.run.source.settingsPath);
  const sourceAppInfo = await readJson(context.run.source.appInfoPath);
  const sourceApp = pickSourceApp(sourceAppInfo, context.run.source.appId);
  const sandboxName = args['sandbox-name'] || buildSandboxAppName(sourceApp.name || `app-${context.run.source.appId}`);
  const createBody = { name: sandboxName };
  if (sourceApp.spaceId) {
    createBody.space = Number(sourceApp.spaceId);
    if (sourceApp.threadId) {
      createBody.thread = Number(sourceApp.threadId);
    }
  }
  const createResponse = await kintoneAdminRequest(auth, '/k/v1/preview/app.json', 'POST', createBody);
  const sandboxAppId = Number(createResponse.app);
  const cloneResult = buildClonePayloads(sourceFields.properties, sourceLayout.layout, sourceSettings, sandboxName);

  if (Object.keys(cloneResult.fields.properties).length > 0) {
    await kintoneAdminRequest(auth, '/k/v1/preview/app/form/fields.json', 'POST', {
      app: sandboxAppId,
      properties: cloneResult.fields.properties,
    });
  }
  await kintoneAdminRequest(auth, '/k/v1/preview/app/form/layout.json', 'PUT', {
    app: sandboxAppId,
    layout: cloneResult.layout,
  });
  await kintoneAdminRequest(auth, '/k/v1/preview/app/settings.json', 'PUT', {
    app: sandboxAppId,
    ...cloneResult.settings,
  });
  await deployPreviewApp(auth, sandboxAppId);

  const sandboxTokenEnvKey = tokenEnvKeyForApp(sandboxAppId);
  const sandboxTokenTitle = tokenTitleForApp(sandboxAppId);
  issueApiToken({
    appId: sandboxAppId,
    permissions: ['read', 'add', 'edit'],
    envKey: sandboxTokenEnvKey,
    headed,
  });

  context.run.sandbox = {
    appId: sandboxAppId,
    name: sandboxName,
    tokenItem: { title: sandboxTokenTitle, envKey: sandboxTokenEnvKey },
    warnings: cloneResult.warnings,
    seedRecordIds: [],
  };
  context.run.warnings = uniqueStrings([...(context.run.warnings || []), ...cloneResult.warnings]);
  await context.save();
  printSummary('clone-sandbox', {
    sandbox_app_id: sandboxAppId,
    sandbox_name: sandboxName,
    warnings: cloneResult.warnings,
  });
}

async function cmdSeedSandbox(args) {
  const context = await loadRunContext(args, { create: false });
  ensureSandboxRun(context.run);
  const count = parseRequiredInt(args['record-count'] || '3', '--record-count');
  const overridesPath = args.overrides || '';
  const overrides = overridesPath ? await readJson(path.resolve(overridesPath)) : {};
  const auth = await loadAuthConfig(context.run.authItem);
  const sandboxToken = await readTokenFromItem(context.run.sandbox.tokenItem.title, context.run.sandbox.tokenItem.envKey);
  const sourceFields = await readJson(context.run.source.fieldsPath);
  const sandboxClient = createApiTokenClient(auth.baseUrl, [sandboxToken]);
  const recordPayloads = [];
  const warnings = [];
  for (let index = 0; index < count; index += 1) {
    const result = buildDummyRecord(sourceFields.properties, overrides, index);
    if (result.errors.length > 0) {
      throw new Error(`Cannot synthesize sandbox record ${index + 1}: ${result.errors.join('; ')}`);
    }
    warnings.push(...result.warnings);
    recordPayloads.push(result.record);
  }

  const response = await sandboxClient.record.addAllRecords({
    app: context.run.sandbox.appId,
    records: recordPayloads,
  });
  const seedRecordIds = response.records.map((item) => String(item.id));
  const outPath = path.join(context.runDir, 'sandbox-seed-records.json');
  await writeJson(outPath, { records: recordPayloads, ids: seedRecordIds });
  context.run.sandbox.seedRecordIds = seedRecordIds;
  context.run.sandbox.seedRecordsPath = outPath;
  context.run.warnings = uniqueStrings([...(context.run.warnings || []), ...warnings]);
  await context.save();
  printSummary('seed-sandbox', {
    sandbox_app_id: context.run.sandbox.appId,
    created_record_ids: seedRecordIds,
    warnings: uniqueStrings(warnings),
  });
}

async function cmdScaffoldTemplate(args) {
  const context = await loadRunContext(args, { create: false });
  ensureSourceRun(context.run);
  const pdfPath = resolveRequiredPath(args.pdf, '--pdf');
  const templateCode = requiredString(args['template-code'], '--template-code');
  const version = requiredString(args.version, '--version');
  const actionCode = requiredString(args['action-code'], '--action-code');
  const templateBaseDir = path.join(context.runDir, 'templates');
  await ensureSvgreportBuild();
  const { importPdfTemplate, extractTextElements } = await importDistModule('index.js');
  const pdfBuffer = await fs.readFile(pdfPath);
  const imported = await importPdfTemplate({
    templateId: templateCode,
    version,
    baseDir: templateBaseDir,
    pdfBuffer,
    pdfFileName: path.basename(pdfPath),
  });
  const page1Path = path.join(imported.templateDir, 'page-1.svg');
  const pageFollowPath = path.join(imported.templateDir, 'page-follow.svg');
  const page1Text = await extractTextElements(page1Path);
  const page1TextPath = path.join(context.runDir, 'text-elements-page-1.json');
  await writeJson(page1TextPath, page1Text);
  let pageFollowTextPath = '';
  if (await pathExists(pageFollowPath)) {
    const pageFollowText = await extractTextElements(pageFollowPath);
    pageFollowTextPath = path.join(context.runDir, 'text-elements-page-follow.json');
    await writeJson(pageFollowTextPath, pageFollowText);
  }

  context.run.template = {
    ...(context.run.template || {}),
    pdfPath,
    templateCode,
    version,
    actionCode,
    templateDir: imported.templateDir,
    page1TextPath,
    pageFollowTextPath,
    templateJsonPath: path.join(imported.templateDir, 'template.json'),
  };
  context.run.warnings = uniqueStrings([...(context.run.warnings || []), ...(imported.warnings || [])]);
  await context.save();
  printSummary('scaffold-template', {
    template_dir: imported.templateDir,
    adopted_pages: imported.pageSummary.adopted,
    warnings: imported.warnings || [],
  });
}

async function cmdPrepareMapping(args) {
  const context = await loadRunContext(args, { create: false });
  ensureTemplateRun(context.run);
  const sourceFields = await readJson(context.run.source.fieldsPath);
  const sampleRecord = context.run.source.sampleRecordPath ? await readOptionalJson(context.run.source.sampleRecordPath) : null;
  const page1Text = await readJson(context.run.template.page1TextPath);
  const pageFollowText = context.run.template.pageFollowTextPath ? await readOptionalJson(context.run.template.pageFollowTextPath) : null;
  const mappingCandidate = buildMappingCandidate(sourceFields.properties, sampleRecord?.record || null);
  const renderHints = buildRenderHints(sourceFields.properties, page1Text, pageFollowText);
  const mappingCandidatePath = path.join(context.runDir, 'mapping-candidate.json');
  const renderHintsPath = path.join(context.runDir, 'binding-candidate.md');
  const reviewPath = path.join(context.runDir, 'mapping-review.md');
  await Promise.all([
    writeJson(mappingCandidatePath, mappingCandidate),
    fs.writeFile(renderHintsPath, renderHints.markdown, 'utf-8'),
    fs.writeFile(reviewPath, buildMappingReviewMarkdown(mappingCandidate, renderHints), 'utf-8'),
  ]);
  context.run.template.mappingCandidatePath = mappingCandidatePath;
  context.run.template.bindingCandidatePath = renderHintsPath;
  context.run.template.mappingReviewPath = reviewPath;
  context.run.warnings = uniqueStrings([
    ...(context.run.warnings || []),
    ...(mappingCandidate.warnings || []),
    ...(renderHints.warnings || []),
  ]);
  await context.save();
  printSummary('prepare-mapping', {
    mapping_candidate_path: mappingCandidatePath,
    binding_candidate_path: renderHintsPath,
    warnings: uniqueStrings([...(mappingCandidate.warnings || []), ...(renderHints.warnings || [])]),
  });
}

async function cmdUploadDraft(args) {
  const context = await loadRunContext(args, { create: false });
  applyDraftOverrides(context.run, args);
  ensureDraftInputs(context.run);
  await ensureSvgreportBuild();
  const runtime = await buildRuntimeContext(context.run);
  const reportTemplate = await buildReportTemplateFromRun(context.run, context.run.sandbox?.appId || context.run.source.appId);
  const result = await withReportApi(runtime.env, async () => {
    return await uploadDraft(runtime, context.run.template.templateDir, reportTemplate, context.run.sandbox?.appId || context.run.source.appId, context.run.template.actionCode);
  });
  context.run.template.draft = {
    recordId: result.record_id,
    sourceAppId: context.run.sandbox?.appId || context.run.source.appId,
    uploadedAt: new Date().toISOString(),
  };
  await context.save();
  printSummary('upload-draft', {
    draft_record_id: result.record_id,
    source_app_id: context.run.sandbox?.appId || context.run.source.appId,
  });
}

async function cmdVerifySandbox(args) {
  const context = await loadRunContext(args, { create: false });
  ensureSourceRun(context.run);
  applyDraftOverrides(context.run, args);
  ensureDraftInputs(context.run);
  await ensureSvgreportBuild();
  const runtime = await buildRuntimeContext(context.run);
  const targetAppId = context.run.sandbox?.appId || context.run.source.appId;
  const verificationMode = context.run.sandbox?.appId ? 'sandbox' : 'source';
  const sourceRecordId = args['record-id'] || context.run.sandbox?.seedRecordIds?.[0] || context.run.source.sampleRecordId || '';
  if (!sourceRecordId) {
    throw new Error('Missing verification record id. Pass --record-id or keep a sample record id in run.json.');
  }
  const reportTemplate = await buildReportTemplateFromRun(context.run, targetAppId);

  const outcome = await withReportServices(runtime.env, async () => {
    const draft = await uploadDraft(runtime, context.run.template.templateDir, reportTemplate, targetAppId, context.run.template.actionCode);
    const publish = await publishTemplate(runtime, context.run.template.templateCode, context.run.template.version, targetAppId);
    const job = await enqueueJob(runtime, targetAppId, sourceRecordId, context.run.template.actionCode);
    const finalStatus = await waitForJob(runtime, job.job_id);
    const attachmentCheck = await verifySourceAttachment(runtime, targetAppId, sourceRecordId, reportTemplate.output.output_attachment_field_code);
    return { draft, publish, job, finalStatus, attachmentCheck };
  });

  context.run.template.draft = {
    recordId: outcome.draft.record_id,
    sourceAppId: targetAppId,
    uploadedAt: new Date().toISOString(),
  };
  context.run.template.publish = {
    recordId: outcome.publish.record_id,
    publishedSeq: outcome.publish.published_seq,
    sourceAppId: targetAppId,
    publishedAt: new Date().toISOString(),
  };
  context.run.verification = {
    ...(context.run.verification || {}),
    mode: verificationMode,
    targetAppId,
    sandboxJobId: verificationMode === 'sandbox' ? outcome.job.job_id : context.run.verification?.sandboxJobId,
    sandboxStatus: verificationMode === 'sandbox' ? outcome.finalStatus.status : context.run.verification?.sandboxStatus,
    sandboxRecordId: verificationMode === 'sandbox' ? sourceRecordId : context.run.verification?.sandboxRecordId,
    sandboxAttachmentCount: verificationMode === 'sandbox' ? outcome.attachmentCheck.count : context.run.verification?.sandboxAttachmentCount,
    sourceJobId: verificationMode === 'source' ? outcome.job.job_id : context.run.verification?.sourceJobId,
    sourceStatus: verificationMode === 'source' ? outcome.finalStatus.status : context.run.verification?.sourceStatus,
    sourceRecordId: verificationMode === 'source' ? sourceRecordId : context.run.verification?.sourceRecordId,
    sourceAttachmentCount: verificationMode === 'source' ? outcome.attachmentCheck.count : context.run.verification?.sourceAttachmentCount,
  };
  await context.save();
  printSummary('verify-sandbox', {
    mode: verificationMode,
    target_app_id: targetAppId,
    sandbox_job_id: outcome.job.job_id,
    status: outcome.finalStatus.status,
    attachment_count: outcome.attachmentCheck.count,
  });
}

async function cmdCutoverProd(args) {
  const context = await loadRunContext(args, { create: false });
  ensureSourceRun(context.run);
  applyDraftOverrides(context.run, args);
  ensureDraftInputs(context.run);
  if (args.confirm !== 'production') {
    throw new Error('Refusing production cutover without --confirm production');
  }
  await ensureSvgreportBuild();
  const runtime = await buildRuntimeContext(context.run);
  const reportTemplate = await buildReportTemplateFromRun(context.run, context.run.source.appId);
  const smokeRecordId = args['record-id'] || context.run.source.sampleRecordId || '';
  const outcome = await withReportServices(runtime.env, async () => {
    const draft = await uploadDraft(runtime, context.run.template.templateDir, reportTemplate, context.run.source.appId, context.run.template.actionCode);
    const publish = await publishTemplate(runtime, context.run.template.templateCode, context.run.template.version, context.run.source.appId);
    let smoke = null;
    if (smokeRecordId) {
      const job = await enqueueJob(runtime, context.run.source.appId, smokeRecordId, context.run.template.actionCode);
      const finalStatus = await waitForJob(runtime, job.job_id);
      smoke = { job, finalStatus };
    }
    return { draft, publish, smoke };
  });
  context.run.template.productionDraft = {
    recordId: outcome.draft.record_id,
    sourceAppId: context.run.source.appId,
    uploadedAt: new Date().toISOString(),
  };
  context.run.template.productionPublish = {
    recordId: outcome.publish.record_id,
    publishedSeq: outcome.publish.published_seq,
    sourceAppId: context.run.source.appId,
    publishedAt: new Date().toISOString(),
  };
  context.run.verification = {
    ...(context.run.verification || {}),
    prodJobId: outcome.smoke?.job.job_id || '',
    prodStatus: outcome.smoke?.finalStatus.status || 'PUBLISHED',
    prodRecordId: smokeRecordId,
  };
  await context.save();
  printSummary('cutover-prod', {
    production_publish_record_id: outcome.publish.record_id,
    production_published_seq: outcome.publish.published_seq,
    smoke_job_id: outcome.smoke?.job.job_id || '(skipped)',
    smoke_status: outcome.smoke?.finalStatus.status || '(skipped)',
  });
}

async function loadRunContext(args, options) {
  const runId = requiredString(args['run-id'], '--run-id');
  const runDir = path.join(ROOT_TMP_DIR, runId);
  const runPath = path.join(runDir, 'run.json');
  await fs.mkdir(runDir, { recursive: true });
  let run = null;
  if (await pathExists(runPath)) {
    run = await readJson(runPath);
  } else if (!options.create) {
    throw new Error(`Run not found: ${runPath}`);
  }
  if (!run) {
    run = {
      schema: 'kintone-svgreport-rollout/v1',
      runId,
      authItem: args['auth-item'] || DEFAULT_AUTH_ITEM,
      reportEnvItem: args['report-env-item'] || DEFAULT_REPORT_ENV_ITEM,
      warnings: [],
    };
  }
  run.authItem = args['auth-item'] || run.authItem || DEFAULT_AUTH_ITEM;
  run.reportEnvItem = args['report-env-item'] || run.reportEnvItem || DEFAULT_REPORT_ENV_ITEM;
  run.runDir = runDir;
  return {
    run,
    runDir,
    runPath,
    async save() {
      await writeJson(runPath, run);
    },
  };
}

async function fetchSourceAppSnapshot(auth, appId) {
  const appInfo = await kintoneAdminRequest(auth, '/k/v1/apps.json', 'GET', null, { ids: String(appId) });
  const [fields, layout, settings] = await Promise.all([
    kintoneAdminRequest(auth, '/k/v1/app/form/fields.json', 'GET', null, { app: String(appId) }),
    kintoneAdminRequest(auth, '/k/v1/app/form/layout.json', 'GET', null, { app: String(appId) }),
    kintoneAdminRequest(auth, '/k/v1/app/settings.json', 'GET', null, { app: String(appId) }),
  ]);
  return { appInfo, fields, layout, settings };
}

async function loadAuthConfig(itemTitle) {
  const injected = readInjectedFields([itemTitle], ['username', 'password', 'credential', 'KINTONE_BASE_URL']);
  const username = injected.username || '';
  const password = injected.password || injected.credential || '';
  const baseUrl = normalizeBaseUrl(injected.KINTONE_BASE_URL || '');
  if (!username || !password || !baseUrl) {
    throw new Error(`Missing username/password/KINTONE_BASE_URL in 1Password item: ${itemTitle}`);
  }
  return { username, password, baseUrl };
}

async function buildRuntimeContext(run) {
  const auth = await loadAuthConfig(run.authItem);
  const envFields = readInjectedFields([run.authItem, run.reportEnvItem], [
    'KINTONE_API_TOKEN',
    'REPORT_TEMPLATE_APP_ID',
    'REPORT_JOB_APP_ID',
    'REPORT_API_AUTH_TOKEN',
    'REPORT_API_HOST',
    'REPORT_API_PORT',
    'REPORT_TEMPLATE_FIELD_TEMPLATE_CODE',
    'REPORT_TEMPLATE_FIELD_VERSION',
    'REPORT_TEMPLATE_FIELD_SOURCE_APP_ID',
    'REPORT_TEMPLATE_FIELD_STATUS',
    'REPORT_TEMPLATE_FIELD_PUBLISHED_SEQ',
    'REPORT_TEMPLATE_FIELD_ACTION_CODE',
    'REPORT_TEMPLATE_FIELD_TEMPLATE_JSON',
    'REPORT_TEMPLATE_FIELD_PAGE1_SVG',
    'REPORT_TEMPLATE_FIELD_PAGE_FOLLOW_SVG',
    'REPORT_JOB_FIELD_JOB_ID',
    'REPORT_JOB_FIELD_IDEMPOTENCY_KEY',
    'REPORT_JOB_FIELD_STATUS',
    'REPORT_JOB_FIELD_APP_ID',
    'REPORT_JOB_FIELD_RECORD_ID',
    'REPORT_JOB_FIELD_TEMPLATE_ACTION_CODE',
    'REPORT_JOB_FIELD_TEMPLATE_CODE',
    'REPORT_JOB_FIELD_TEMPLATE_VERSION',
    'REPORT_JOB_FIELD_REQUESTED_BY',
    'REPORT_JOB_FIELD_ATTEMPTS',
    'REPORT_JOB_FIELD_MAX_ATTEMPTS',
    'REPORT_JOB_FIELD_NEXT_RUN_AT',
    'REPORT_JOB_FIELD_STARTED_AT',
    'REPORT_JOB_FIELD_FINISHED_AT',
    'REPORT_JOB_FIELD_INPUT_SNAPSHOT_JSON',
    'REPORT_JOB_FIELD_RENDER_DEBUG_JSON',
    'REPORT_JOB_FIELD_OUTPUT_PDF',
    'REPORT_JOB_FIELD_OUTPUT_SVG_ZIP',
    'REPORT_JOB_FIELD_ERROR_CODE',
    'REPORT_JOB_FIELD_ERROR_MESSAGE',
  ]);
  const tokenValues = [];
  if (envFields.KINTONE_API_TOKEN) {
    tokenValues.push(...envFields.KINTONE_API_TOKEN.split(',').map((value) => value.trim()).filter(Boolean));
  }
  for (const tokenRef of [run.source?.tokenItem, run.sandbox?.tokenItem].filter(Boolean)) {
    tokenValues.push(await readTokenFromItem(tokenRef.title, tokenRef.envKey));
  }
  const env = {
    ...process.env,
    KINTONE_BASE_URL: auth.baseUrl,
    KINTONE_API_TOKEN: uniqueStrings(tokenValues).join(','),
    REPORT_TEMPLATE_APP_ID: envFields.REPORT_TEMPLATE_APP_ID || '',
    REPORT_JOB_APP_ID: envFields.REPORT_JOB_APP_ID || '',
    REPORT_API_AUTH_TOKEN: envFields.REPORT_API_AUTH_TOKEN || '',
    REPORT_API_HOST: envFields.REPORT_API_HOST || DEFAULT_REPORT_HOST,
    REPORT_API_PORT: envFields.REPORT_API_PORT || DEFAULT_REPORT_PORT,
  };
  for (const [key, value] of Object.entries(envFields)) {
    if (key.startsWith('REPORT_') && value && !env[key]) {
      env[key] = value;
    }
  }
  if (!env.REPORT_TEMPLATE_APP_ID || !env.REPORT_JOB_APP_ID || !env.KINTONE_API_TOKEN) {
    throw new Error(`Missing REPORT_TEMPLATE_APP_ID / REPORT_JOB_APP_ID / KINTONE_API_TOKEN in runtime context for run ${run.runId}`);
  }
  return {
    auth,
    env,
    apiBase: `http://${env.REPORT_API_HOST || DEFAULT_REPORT_HOST}:${env.REPORT_API_PORT || DEFAULT_REPORT_PORT}`,
    client: createApiTokenClient(auth.baseUrl, env.KINTONE_API_TOKEN.split(',').filter(Boolean)),
  };
}

async function buildReportTemplateFromRun(run, sourceAppId) {
  const templateJson = await readJson(run.template.templateJsonPath);
  const preferredMappingPath = run.template.mappingApprovedPath || run.template.mappingCandidatePath;
  if (!preferredMappingPath) {
    throw new Error('Missing mapping candidate path in run manifest.');
  }
  const mapping = await readJson(preferredMappingPath);
  const outputAttachmentFieldCode = run.source.outputAttachmentFieldCode || detectOutputAttachmentField((await readJson(run.source.fieldsPath)).properties);
  if (!outputAttachmentFieldCode) {
    throw new Error('Could not determine output attachment field code. Set an Attachments/FILE field first.');
  }
  return {
    schema: 'report-template/v1',
    template: {
      code: run.template.templateCode,
      version: run.template.version,
      source_app_id: sourceAppId,
      status: 'Draft',
    },
    output: {
      output_attachment_field_code: outputAttachmentFieldCode,
      pdf_filename_expr: `${run.template.templateCode}_{record_id}_{timestamp}.pdf`,
    },
    render: templateJson,
    mapping: {
      schema: 'report-mapping/v1',
      kv_bindings: mapping.kv_bindings || [],
      table: mapping.table || {
        source: { kind: 'subtable', field_code: 'TODO_SUBTABLE' },
        columns: [],
      },
    },
  };
}

async function uploadDraft(runtime, templateDir, reportTemplate, sourceAppId, actionCode) {
  const [page1Key, pageFollowKey] = await uploadTemplateFiles(runtime.client, templateDir);
  const draftBody = {
    source_app_id: sourceAppId,
    action_code: actionCode,
    template: reportTemplate,
    page_1_svg_file_key: page1Key,
    ...(pageFollowKey ? { page_follow_svg_file_key: pageFollowKey } : {}),
  };
  return await reportApiRequest(runtime.apiBase, runtime.env.REPORT_API_AUTH_TOKEN, `templates/${encodeURIComponent(reportTemplate.template.code)}/${encodeURIComponent(reportTemplate.template.version)}/draft`, 'PUT', draftBody);
}

async function uploadTemplateFiles(client, templateDir) {
  const page1Path = path.join(templateDir, 'page-1.svg');
  const pageFollowPath = path.join(templateDir, 'page-follow.svg');
  const page1 = await fs.readFile(page1Path);
  const page1Upload = await client.file.uploadFile({ file: { name: path.basename(page1Path), data: page1 } });
  let pageFollowUpload = null;
  if (await pathExists(pageFollowPath)) {
    const pageFollow = await fs.readFile(pageFollowPath);
    pageFollowUpload = await client.file.uploadFile({ file: { name: path.basename(pageFollowPath), data: pageFollow } });
  }
  return [page1Upload.fileKey, pageFollowUpload?.fileKey || ''];
}

async function publishTemplate(runtime, templateCode, version, sourceAppId) {
  return await reportApiRequest(runtime.apiBase, runtime.env.REPORT_API_AUTH_TOKEN, `templates/${encodeURIComponent(templateCode)}/${encodeURIComponent(version)}/publish`, 'POST', {
    source_app_id: sourceAppId,
  });
}

async function enqueueJob(runtime, appId, recordId, actionCode) {
  return await reportApiRequest(runtime.apiBase, runtime.env.REPORT_API_AUTH_TOKEN, 'jobs', 'POST', {
    schema: 'report-job/v1',
    app_id: appId,
    record_id: String(recordId),
    template_action_code: actionCode,
    requested_by: REPORT_REQUESTED_BY,
  });
}

async function waitForJob(runtime, jobId, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await reportApiRequest(runtime.apiBase, runtime.env.REPORT_API_AUTH_TOKEN, `jobs/${encodeURIComponent(jobId)}`, 'GET');
    if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
      return result;
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function verifySourceAttachment(runtime, appId, recordId, attachmentFieldCode) {
  const record = await runtime.client.record.getRecord({ app: appId, id: Number(recordId) });
  const files = Array.isArray(record.record[attachmentFieldCode]?.value) ? record.record[attachmentFieldCode].value : [];
  return { count: files.length };
}

async function withReportApi(env, fn) {
  const proc = startReportProcess(env, ['dist/cli.js', 'report-api'], 'report-api');
  try {
    await waitForHealth(`http://${env.REPORT_API_HOST || DEFAULT_REPORT_HOST}:${env.REPORT_API_PORT || DEFAULT_REPORT_PORT}`, env.REPORT_API_AUTH_TOKEN || '');
    return await fn();
  } finally {
    proc.kill('SIGINT');
  }
}

async function withReportServices(env, fn) {
  const apiProc = startReportProcess(env, ['dist/cli.js', 'report-api'], 'report-api');
  const workerProc = startReportProcess(env, ['dist/cli.js', 'report-worker'], 'report-worker');
  try {
    await waitForHealth(`http://${env.REPORT_API_HOST || DEFAULT_REPORT_HOST}:${env.REPORT_API_PORT || DEFAULT_REPORT_PORT}`, env.REPORT_API_AUTH_TOKEN || '');
    return await fn();
  } finally {
    workerProc.kill('SIGINT');
    apiProc.kill('SIGINT');
  }
}

function startReportProcess(env, args, label) {
  const child = spawn('node', args, {
    cwd: SVGREPORT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => process.stdout.write(`[${label}] ${buf}`));
  child.stderr.on('data', (buf) => process.stderr.write(`[${label}] ${buf}`));
  return child;
}

async function waitForHealth(baseUrl, authToken) {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
      const response = await fetch(`${baseUrl}/api/v1/health`, { headers });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error(`report-api did not become healthy at ${baseUrl}`);
}

async function reportApiRequest(baseUrl, authToken, relativePath, method, body = undefined) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${baseUrl}/api/v1/${relativePath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${method} /api/v1/${relativePath} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function ensureSvgreportBuild() {
  runCommand('pnpm', ['build'], { cwd: SVGREPORT_DIR });
}

async function importDistModule(relativePath) {
  const filePath = path.join(SVGREPORT_DIR, 'dist', relativePath);
  return await import(pathToFileURL(filePath).href);
}

function buildClonePayloads(sourceProperties, sourceLayout, sourceSettings, sandboxName) {
  const properties = {};
  const skipped = [];
  const allowedFieldCodes = new Set();
  for (const [fieldCode, definition] of Object.entries(sourceProperties || {})) {
    const cloneable = normalizeCloneableField(definition);
    if (!cloneable) {
      skipped.push(`${fieldCode}:${definition.type || 'unknown'}`);
      continue;
    }
    properties[fieldCode] = cloneable;
    allowedFieldCodes.add(fieldCode);
  }
  const layout = sanitizeLayout(sourceLayout, allowedFieldCodes);
  const settings = buildSettingsPayload(sourceSettings, sandboxName, allowedFieldCodes);
  return {
    fields: { properties },
    layout,
    settings,
    warnings: skipped.length > 0 ? [`Skipped clone-incompatible fields: ${skipped.join(', ')}`] : [],
  };
}

function normalizeCloneableField(definition) {
  if (!definition || typeof definition !== 'object') return null;
  if (!CLONEABLE_FIELD_TYPES.has(definition.type)) return null;
  const cloned = stripReadOnlyKeys(definition, ['referenceTable']);
  if (definition.code) {
    cloned.code = definition.code;
  }
  if (definition.type === 'SUBTABLE' && definition.fields) {
    const children = {};
    for (const [childCode, childDef] of Object.entries(definition.fields)) {
      const normalized = normalizeCloneableField(childDef);
      if (normalized) {
        children[childCode] = normalized;
      }
    }
    cloned.fields = children;
  }
  return cloned;
}

function stripReadOnlyKeys(value, extraKeys = []) {
  if (Array.isArray(value)) {
    return value.map((item) => stripReadOnlyKeys(item, extraKeys));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const skip = new Set(['code', 'id', 'revision', 'createdAt', 'updatedAt', ...extraKeys]);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (skip.has(key)) continue;
    out[key] = stripReadOnlyKeys(item, extraKeys);
  }
  return out;
}

function sanitizeLayout(node, allowedFieldCodes) {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizeLayout(item, allowedFieldCodes)).filter(Boolean);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  if (typeof node.fieldCode === 'string' && !allowedFieldCodes.has(node.fieldCode)) {
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      const next = value.map((item) => sanitizeLayout(item, allowedFieldCodes)).filter(Boolean);
      if (next.length > 0 || key === 'layout') {
        out[key] = next;
      }
      continue;
    }
    if (value && typeof value === 'object') {
      const next = sanitizeLayout(value, allowedFieldCodes);
      if (next) out[key] = next;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function buildSettingsPayload(sourceSettings, sandboxName, allowedFieldCodes) {
  const titleField = sourceSettings.titleField?.code && allowedFieldCodes.has(sourceSettings.titleField.code)
    ? sourceSettings.titleField
    : undefined;
  return {
    name: sandboxName,
    description: sourceSettings.description || '',
    enableBulkDeletion: booleanAsString(sourceSettings.enableBulkDeletion),
    enableComments: booleanAsString(sourceSettings.enableComments),
    enableDuplicateRecord: booleanAsString(sourceSettings.enableDuplicateRecord),
    enableInlineRecordEditing: booleanAsString(sourceSettings.enableInlineRecordEditing),
    enableThumbnails: booleanAsString(sourceSettings.enableThumbnails),
    firstMonthOfFiscalYear: sourceSettings.firstMonthOfFiscalYear || '1',
    icon: sourceSettings.icon,
    numberPrecision: sourceSettings.numberPrecision,
    theme: sourceSettings.theme || 'WHITE',
    ...(titleField ? { titleField } : {}),
  };
}

function buildDummyRecord(sourceProperties, overrides = {}, recordIndex = 0) {
  const record = {};
  const errors = [];
  const warnings = [];
  for (const [fieldCode, definition] of Object.entries(sourceProperties || {})) {
    const override = overrides[fieldCode];
    const result = buildDummyFieldValue(fieldCode, definition, override, recordIndex);
    if (result.skip) continue;
    if (result.error) {
      errors.push(result.error);
      continue;
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
    record[fieldCode] = { value: result.value };
  }
  return { record, errors, warnings };
}

function buildDummyFieldValue(fieldCode, definition, override, recordIndex) {
  if (!definition || typeof definition !== 'object') {
    return { skip: true };
  }
  const required = toBoolean(definition.required);
  if (override !== undefined) {
    return { value: override };
  }
  if (UNSUPPORTED_SEED_FIELD_TYPES.has(definition.type)) {
    if (required) {
      return { error: `${fieldCode} (${definition.type}) requires an explicit override` };
    }
    return { skip: true, warning: `Skipped unsupported optional field ${fieldCode} (${definition.type})` };
  }
  switch (definition.type) {
    case 'SINGLE_LINE_TEXT':
    case 'LINK':
      return { value: `${fieldCode}_DUMMY_${recordIndex + 1}` };
    case 'MULTI_LINE_TEXT':
    case 'RICH_TEXT':
      return { value: `${fieldCode} dummy line ${recordIndex + 1}` };
    case 'NUMBER':
      return { value: String(recordIndex + 1) };
    case 'DATE':
      return { value: '2026-03-09' };
    case 'TIME':
      return { value: '09:00' };
    case 'DATETIME':
      return { value: '2026-03-09T09:00:00Z' };
    case 'DROP_DOWN':
    case 'RADIO_BUTTON': {
      const option = firstOptionKey(definition.options);
      if (!option) {
        return required ? { error: `${fieldCode} has no selectable option` } : { skip: true };
      }
      return { value: option };
    }
    case 'CHECK_BOX':
    case 'MULTI_SELECT': {
      const option = firstOptionKey(definition.options);
      if (!option) {
        return required ? { error: `${fieldCode} has no selectable option` } : { skip: true };
      }
      return { value: [option] };
    }
    case 'SUBTABLE': {
      const rows = [];
      const childFields = definition.fields || {};
      for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
        const rowValues = {};
        for (const [childCode, childDef] of Object.entries(childFields)) {
          const childOverride = override?.[rowIndex]?.[childCode];
          const child = buildDummyFieldValue(childCode, childDef, childOverride, rowIndex);
          if (child.error) {
            return { error: `${fieldCode}.${child.error}` };
          }
          if (child.skip) continue;
          rowValues[childCode] = { value: child.value };
        }
        rows.push({ value: rowValues });
      }
      return { value: rows };
    }
    default:
      if (required) {
        return { error: `${fieldCode} (${definition.type}) requires an explicit override` };
      }
      return { skip: true };
  }
}

function buildMappingCandidate(sourceProperties, sampleRecord) {
  const scalarFields = [];
  const subtables = [];
  for (const [fieldCode, definition] of Object.entries(sourceProperties || {})) {
    if (definition.type === 'SUBTABLE') {
      subtables.push({
        code: fieldCode,
        label: definition.label || fieldCode,
        columns: Object.entries(definition.fields || {}).map(([childCode, childDef]) => ({
          code: childCode,
          label: childDef.label || childCode,
        })),
      });
      continue;
    }
    if (UNSUPPORTED_SEED_FIELD_TYPES.has(definition.type) || definition.type === 'FILE') continue;
    if (isRecordDataField(definition.type)) {
      scalarFields.push({
        code: fieldCode,
        label: definition.label || fieldCode,
      });
    }
  }
  const primaryTable = pickPrimarySubtable(subtables, sampleRecord);
  const warnings = [];
  if (!primaryTable) {
    warnings.push('No subtable candidate was found. Replace TODO_SUBTABLE before upload.');
  }
  if (subtables.length > 1) {
    warnings.push(`Multiple subtables detected: ${subtables.map((item) => item.code).join(', ')}`);
  }
  return {
    schema: 'report-mapping/v1',
    kv_bindings: scalarFields.map((field) => ({
      key: normalizeDataKey(field.code),
      expr: `field('${field.code}')`,
    })),
    table: {
      source: {
        kind: 'subtable',
        field_code: primaryTable?.code || 'TODO_SUBTABLE',
      },
      columns: (primaryTable?.columns || []).map((column) => ({
        name: normalizeDataKey(column.code),
        expr: `row('${column.code}')`,
      })),
    },
    warnings,
  };
}

function buildRenderHints(sourceProperties, page1Text, pageFollowText) {
  const scalarFields = [];
  for (const [fieldCode, definition] of Object.entries(sourceProperties || {})) {
    if (definition.type === 'SUBTABLE') continue;
    scalarFields.push({
      code: fieldCode,
      label: definition.label || fieldCode,
      type: definition.type,
    });
  }
  const textCandidates = [...(page1Text?.textElements || []), ...(pageFollowText?.textElements || [])];
  const lines = [];
  const warnings = [];
  lines.push('# Binding Candidate');
  lines.push('');
  lines.push('Use this file together with the imported SVGs. The matches below are suggestions only.');
  lines.push('');
  lines.push('## Scalar Fields');
  lines.push('');
  for (const field of scalarFields.slice(0, 50)) {
    const best = scoreTextMatches(field, textCandidates).slice(0, 3);
    if (best.length === 0) {
      warnings.push(`No text candidate found for ${field.code}`);
      lines.push(`- ${field.code} (${field.label}, ${field.type}): no obvious SVG text candidate`);
      continue;
    }
    lines.push(`- ${field.code} (${field.label}, ${field.type}): ${best.map((item) => `${item.id || item.suggestedId}="${item.content}" score=${item.score}`).join(' | ')}`);
  }
  const markdown = `${lines.join('\n')}\n`;
  return { markdown, warnings };
}

function buildMappingReviewMarkdown(mappingCandidate, renderHints) {
  const lines = [];
  lines.push('# Mapping Review');
  lines.push('');
  lines.push('Confirm these items before uploading a draft:');
  lines.push('');
  lines.push('- `template.json` has real `render.fields` and `pages[].tables` bindings, not empty placeholders.');
  lines.push('- `mapping-candidate.json` points to the correct subtable and column expressions.');
  lines.push('- `output_attachment_field_code` is a writable FILE field on the source app.');
  lines.push('- `action_code`, `templateCode`, and `version` are the intended production identifiers.');
  lines.push('');
  lines.push('## Candidate Summary');
  lines.push('');
  lines.push(`- kv_bindings: ${mappingCandidate.kv_bindings.length}`);
  lines.push(`- table source: ${mappingCandidate.table?.source?.field_code || '(unset)'}`);
  lines.push(`- table columns: ${(mappingCandidate.table?.columns || []).length}`);
  if ((mappingCandidate.warnings || []).length > 0 || (renderHints.warnings || []).length > 0) {
    lines.push('');
    lines.push('## Warnings');
    lines.push('');
    for (const warning of uniqueStrings([...(mappingCandidate.warnings || []), ...(renderHints.warnings || [])])) {
      lines.push(`- ${warning}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function scoreTextMatches(field, textCandidates) {
  const needle = normalizeSearchText(`${field.code} ${field.label}`);
  const out = [];
  for (const candidate of textCandidates) {
    const hay = normalizeSearchText(`${candidate.id || ''} ${candidate.suggestedId || ''} ${candidate.content || ''}`);
    let score = 0;
    for (const token of needle.split(' ').filter(Boolean)) {
      if (hay.includes(token)) score += token.length;
    }
    if (score > 0) {
      out.push({ ...candidate, score });
    }
  }
  out.sort((left, right) => right.score - left.score);
  return out;
}

function pickPrimarySubtable(subtables, sampleRecord) {
  if (subtables.length === 0) return null;
  if (!sampleRecord) return subtables[0];
  let best = subtables[0];
  let bestCount = -1;
  for (const table of subtables) {
    const current = Array.isArray(sampleRecord[table.code]?.value) ? sampleRecord[table.code].value.length : 0;
    if (current > bestCount) {
      best = table;
      bestCount = current;
    }
  }
  return best;
}

async function deployPreviewApp(auth, appId) {
  await kintoneAdminRequest(auth, '/k/v1/preview/app/deploy.json', 'POST', {
    apps: [{ app: appId }],
  });
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const status = await kintoneAdminRequest(auth, '/k/v1/preview/app/deploy.json', 'GET', null, { apps: String(appId) });
    const app = Array.isArray(status.apps) ? status.apps[0] : null;
    if (app?.status === 'SUCCESS') return;
    if (app?.status === 'FAIL' || app?.status === 'CANCEL') {
      throw new Error(`Sandbox app deploy failed: ${JSON.stringify(status)}`);
    }
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for preview app deploy: ${appId}`);
}

function issueApiToken({ appId, permissions, envKey, headed }) {
  const command = [
    'opz',
    shellQuote(DEFAULT_AUTH_ITEM),
    '--',
    'pnpm',
    'run',
    'kintone:issue-api-token',
    '--app-id',
    String(appId),
    ...permissions.flatMap((permission) => ['--permission', shellQuote(permission)]),
    '--env-key',
    shellQuote(envKey),
    ...(headed ? ['--headed'] : []),
  ].join(' ');
  runCommand('bash', ['-lc', command], { cwd: DEFAULT_KCC_DIR });
}

async function kintoneAdminRequest(auth, pathname, method, body = null, query = null) {
  const url = new URL(pathname, `${auth.baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    }
  }
  const headers = {
    'X-Cybozu-Authorization': Buffer.from(`${auth.username}:${auth.password}`).toString('base64'),
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${url.pathname} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function readInjectedFields(itemTitles, fieldNames) {
  const present = {};
  let allPresent = true;
  for (const field of fieldNames) {
    const value = process.env[field];
    if (value === undefined) {
      allPresent = false;
      break;
    }
    present[field] = value;
  }
  if (allPresent) {
    return present;
  }
  const lines = fieldNames.map((field) => `printf '%s=%s\\n' '${field}' \"\${${field}:-}\"`);
  const command = [
    'opz',
    ...itemTitles.map((item) => shellQuote(item)),
    '--',
    'bash',
    '-lc',
    shellQuote(lines.join('; ')),
  ].join(' ');
  const stdout = runCommand('bash', ['-lc', command], { cwd: SVGREPORT_DIR, capture: true });
  const out = {};
  for (const line of stdout.split('\n')) {
    if (!line.includes('=')) continue;
    const index = line.indexOf('=');
    out[line.slice(0, index)] = line.slice(index + 1);
  }
  return out;
}

async function readTokenFromItem(title, envKey) {
  const injected = readInjectedFields([title], [envKey]);
  const value = injected[envKey] || '';
  if (!value) {
    throw new Error(`Missing ${envKey} in token item ${title}`);
  }
  return value;
}

function createApiTokenClient(baseUrl, tokens) {
  return new KintoneRestAPIClient({
    baseUrl,
    auth: { apiToken: tokens.length === 1 ? tokens[0] : tokens },
  });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || SVGREPORT_DIR,
    env: options.env || process.env,
    encoding: 'utf-8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = options.capture ? result.stderr : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return options.capture ? result.stdout : '';
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function printSummary(command, payload) {
  process.stdout.write(`${JSON.stringify({ command, ...payload }, null, 2)}\n`);
}

function requiredString(value, flagName) {
  if (!value) {
    throw new Error(`Missing ${flagName}`);
  }
  return String(value);
}

function parseRequiredInt(value, flagName) {
  const parsed = Number.parseInt(requiredString(value, flagName), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function resolveRequiredPath(value, flagName) {
  const resolved = path.resolve(requiredString(value, flagName));
  return resolved;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/$/, '');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function readBooleanOption(value, fallback) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function buildSandboxAppName(sourceAppName) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const normalized = `${sourceAppName}`.replace(/\s+/g, ' ').trim();
  return `${normalized} - svgreport sbx ${yyyy}${mm}${dd}`.slice(0, 64);
}

function booleanAsString(value) {
  return toBoolean(value) ? 'true' : 'false';
}

function toBoolean(value) {
  return value === true || value === 'true';
}

function firstOptionKey(options) {
  if (!options || typeof options !== 'object') return '';
  return Object.keys(options)[0] || '';
}

function detectOutputAttachmentField(properties) {
  if (properties?.Attachments?.type === 'FILE') {
    return 'Attachments';
  }
  for (const [fieldCode, definition] of Object.entries(properties || {})) {
    if (definition.type === 'FILE') {
      return fieldCode;
    }
  }
  return '';
}

function collectCloneWarnings(properties) {
  const out = [];
  const cloneSkipped = [];
  for (const [fieldCode, definition] of Object.entries(properties || {})) {
    if (!CLONEABLE_FIELD_TYPES.has(definition.type)) {
      cloneSkipped.push(`${fieldCode}:${definition.type}`);
    }
  }
  if (cloneSkipped.length > 0) {
    out.push(`Clone will skip non-form/report-safe fields: ${cloneSkipped.join(', ')}`);
  }
  return out;
}

function applyDraftOverrides(run, args) {
  if (!run.template) return;
  if (args['mapping-file']) {
    run.template.mappingApprovedPath = path.resolve(args['mapping-file']);
  }
  if (args['template-dir']) {
    run.template.templateDir = path.resolve(args['template-dir']);
    run.template.templateJsonPath = path.join(run.template.templateDir, 'template.json');
  }
  if (args['output-attachment-field']) {
    run.source.outputAttachmentFieldCode = args['output-attachment-field'];
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, ' ')
    .trim();
}

function normalizeDataKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'field';
}

function isRecordDataField(type) {
  return !new Set([
    'FILE',
    'REFERENCE_TABLE',
    'CATEGORY',
    'STATUS',
    'STATUS_ASSIGNEE',
    'CREATOR',
    'MODIFIER',
    'RECORD_NUMBER',
    'CREATED_TIME',
    'UPDATED_TIME',
    'SUBTABLE',
  ]).has(type);
}

function tokenEnvKeyForApp(appId) {
  return `KINTONE_API_TOKEN_APP_${appId}`;
}

function tokenTitleForApp(appId) {
  return `kintone-api-token-${appId}`;
}

function pickSourceApp(appInfoResponse, appId) {
  const app = (appInfoResponse.apps || []).find((entry) => Number(entry.appId || entry.app) === Number(appId));
  if (!app) {
    throw new Error(`Source app metadata does not include app ${appId}`);
  }
  return app;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf-8'));
}

async function readOptionalJson(filePath) {
  if (!filePath || !(await pathExists(filePath))) return null;
  return await readJson(filePath);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function ensureSourceRun(run) {
  if (!run.source?.appId || !run.source?.fieldsPath || !run.source?.layoutPath || !run.source?.settingsPath) {
    throw new Error('Run does not contain source app metadata. Run inspect-source first.');
  }
}

function ensureSandboxRun(run) {
  ensureSourceRun(run);
  if (!run.sandbox?.appId || !run.sandbox?.tokenItem) {
    throw new Error('Run does not contain sandbox app metadata. Run clone-sandbox first.');
  }
}

function ensureTemplateRun(run) {
  if (!run.template?.templateDir || !run.template?.templateJsonPath || !run.template?.page1TextPath) {
    throw new Error('Run does not contain template workspace metadata. Run scaffold-template first.');
  }
}

function ensureDraftInputs(run) {
  ensureTemplateRun(run);
  if (!run.template?.mappingCandidatePath && !run.template?.mappingApprovedPath) {
    throw new Error('Run does not contain mapping artifacts. Run prepare-mapping first.');
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

export {
  buildClonePayloads,
  buildDummyRecord,
  buildDummyFieldValue,
  buildMappingCandidate,
  buildRenderHints,
  buildSandboxAppName,
  buildSettingsPayload,
  detectOutputAttachmentField,
  normalizeCloneableField,
  normalizeDataKey,
  sanitizeLayout,
};
