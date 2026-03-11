import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { SVGReportError } from '../types/index.js';
import { createRenderer } from '../core/renderer.js';
import { parseSvg } from '../core/svg-engine.js';
import { KintoneJobQueue, type JobQueueConfig } from './kintone-job-queue.js';
import { KintoneRestGateway, readAttachments, toMappingRecord, type KintoneApiConfig } from './kintone-rest.js';
import { KintoneTemplateStore, type TemplateStoreConfig } from './kintone-template-store.js';
import { mapRecordToReportData } from './report-mapping.js';
import { generatePdfWithPlaywrightCli } from '../core/pdf-playwright.js';

export interface ReportWorkerOptions {
  kintone: KintoneApiConfig;
  queue: JobQueueConfig;
  templates: TemplateStoreConfig;
  pollIntervalMs?: number;
  retryBackoffMs?: number;
  playwrightCommand?: string;
}

export async function startReportWorker(options: ReportWorkerOptions): Promise<void> {
  const gateway = new KintoneRestGateway(options.kintone);
  const queue = new KintoneJobQueue(gateway, options.queue);
  const store = new KintoneTemplateStore(gateway, options.templates);
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const retryBackoffMs = options.retryBackoffMs ?? 10_000;

  console.log(`Report worker started (poll=${pollIntervalMs}ms)`);

  while (true) {
    const claimed = await queue.claimNext(new Date());
    if (!claimed) {
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      const job = claimed.job;
      console.log(`Processing job ${job.job_id} (app=${job.app_id}, record=${job.record_id}, action=${job.template_action_code})`);
      const resolved = await store.resolvePublishedLatest(job.app_id, job.template_action_code);
      console.log(`Resolved template ${resolved.template.template.code}:${resolved.template.template.version}`);
      const recordEnvelope = await gateway.getRecord(job.app_id, job.record_id);
      const mappingInput = toMappingRecord(recordEnvelope.fields);
      const mapped = mapRecordToReportData(mappingInput, resolved.template.mapping);

      const pageSvgs = new Map<string, Document>();
      const firstPage = resolved.template.render.pages.find((p) => p.kind === 'first');
      if (!firstPage) {
        throw new SVGReportError('Template render config does not include first page', resolved.template.template.code);
      }

      const firstSvg = await gateway.downloadFile(resolved.page1SvgFileKey);
      pageSvgs.set(firstPage.id, parseSvg(firstSvg.toString('utf-8')));

      const repeatPage = resolved.template.render.pages.find((p) => p.kind === 'repeat');
      if (repeatPage) {
        const repeatKey = resolved.pageFollowSvgFileKey ?? resolved.page1SvgFileKey;
        const repeatSvg = await gateway.downloadFile(repeatKey);
        pageSvgs.set(repeatPage.id, parseSvg(repeatSvg.toString('utf-8')));
      }

      const manifest = {
        schema: 'svgreport-job/v0.1' as const,
        job_id: job.job_id,
        template: {
          id: resolved.template.render.template.id,
          version: resolved.template.render.template.version,
        },
        encoding: 'utf-8' as const,
        locale: 'ja-JP',
        inputs: {},
      };
      const sources = new Map<string, { headers: string[]; rows: Record<string, string>[] } | Record<string, string>>();
      sources.set('meta', mapped.kv);
      sources.set('items', { headers: Object.keys(mapped.table[0] ?? {}), rows: mapped.table });
      const renderer = createRenderer(manifest, resolved.template.render, sources, pageSvgs);
      const result = renderer.render();
      console.log(`Rendered ${result.totalPages} page(s) for job ${job.job_id}`);

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svgreport-out-'));
      const pdfPath = path.join(tempDir, buildPdfFileName(resolved.template.output.pdf_filename_expr, mapped.kv, job.record_id));
      await generatePdfWithPlaywrightCli(
        result.pages.map((p) => p.svgString),
        pdfPath,
        { command: options.playwrightCommand }
      );
      const pdfContent = await fs.readFile(pdfPath);
      console.log(`Generated PDF bytes=${pdfContent.length}`);
      const uploadedForSource = await gateway.uploadFile(path.basename(pdfPath), pdfContent);
      console.log(`Uploaded source PDF fileKey=${uploadedForSource.fileKey}`);

      const attachmentField = resolved.template.output.output_attachment_field_code;
      const currentAttachments = readAttachments(recordEnvelope.fields, attachmentField);
      const attachmentPayload = [...currentAttachments.map((a) => ({ fileKey: a.fileKey })), { fileKey: uploadedForSource.fileKey }];
      await gateway.updateRecord(job.app_id, job.record_id, {
        [attachmentField]: {
          value: attachmentPayload,
        },
      }, recordEnvelope.revision);
      console.log(`Updated source record attachments for app=${job.app_id} record=${job.record_id}`);

      // fileKey is single-use on record update, so upload another copy for the job app attachment.
      const uploadedForJob = await gateway.uploadFile(path.basename(pdfPath), pdfContent);
      console.log(`Uploaded job PDF fileKey=${uploadedForJob.fileKey}`);

      const attempts = job.attempts + 1;
      await queue.markSucceeded(claimed.queueRecordId, {
        templateCode: resolved.template.template.code,
        templateVersion: resolved.template.template.version,
        outputFileKey: uploadedForJob.fileKey,
        attempts,
        debugJson: JSON.stringify({
          pageCount: result.totalPages,
          hash: createHash('sha256').update(pdfContent).digest('hex'),
        }),
      });
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`Job ${job.job_id} marked SUCCEEDED`);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`Job ${claimed.job.job_id} failed: ${message}`);
      if (error && typeof error === 'object' && 'errors' in error) {
        console.error(`kintone errors: ${JSON.stringify((error as { errors?: unknown }).errors)}`);
      }
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      const attempts = claimed.job.attempts + 1;
      const maxAttempts = claimed.job.max_attempts || 3;
      await queue.markFailed(claimed.queueRecordId, {
        attempts,
        maxAttempts,
        errorCode: classifyErrorCode(error),
        errorMessage: message,
        retryAfterMs: retryBackoffMs * Math.max(1, attempts),
      });
    }
  }
}

function buildPdfFileName(expr: string, kv: Record<string, string>, recordId: string): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const replaced = expr
    .replaceAll('{record_id}', recordId)
    .replaceAll('{timestamp}', ts)
    .replace(/\{kv\.([a-zA-Z0-9_.-]+)\}/g, (_all, key) => kv[key] ?? '');
  const sanitized = replaced.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  if (!sanitized.toLowerCase().endsWith('.pdf')) {
    return `${sanitized || 'report'}.pdf`;
  }
  return sanitized || 'report.pdf';
}

function classifyErrorCode(error: unknown): string {
  if (error instanceof SVGReportError) return 'SVG_REPORT_ERROR';
  if (error instanceof Error) return 'UNHANDLED_ERROR';
  return 'UNKNOWN_ERROR';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
