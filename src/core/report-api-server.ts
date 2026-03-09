import * as http from 'http';
import { createHash, randomUUID } from 'crypto';
import { getReportJobValidator, getReportTemplateValidator } from './schema-registry.js';
import type { ReportJobRequestV1, ReportTemplateV1 } from '../types/reporting.js';
import { KintoneJobQueue, type JobQueueConfig } from './kintone-job-queue.js';
import { KintoneRestGateway, type KintoneApiConfig } from './kintone-rest.js';
import type { TemplateStoreConfig } from './kintone-template-store.js';

export interface ReportApiServerOptions {
  host?: string;
  port?: number;
  authToken?: string;
  kintone: KintoneApiConfig;
  queue: JobQueueConfig;
  templates: TemplateStoreConfig;
}

interface TemplateActionSummary {
  action_code: string;
  template_code: string;
  version: string;
}

export class ReportApiServer {
  private server: http.Server;
  private gateway: KintoneRestGateway;
  private queue: KintoneJobQueue;

  constructor(private options: ReportApiServerOptions) {
    this.server = http.createServer(this.handleRequest.bind(this));
    this.gateway = new KintoneRestGateway(options.kintone);
    this.queue = new KintoneJobQueue(this.gateway, options.queue);
  }

  start(): Promise<void> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 8790;
    return new Promise((resolve, reject) => {
      this.server.listen(port, host, () => {
        console.log(`Report API server started at http://${host}:${port}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = randomUUID();
    try {
      if (this.options.authToken) {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
        if (token !== this.options.authToken) {
          this.sendJson(res, 401, requestId, { error: 'Unauthorized' });
          return;
        }
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/api/v1/health' && req.method === 'GET') {
        this.sendJson(res, 200, requestId, { ok: true });
        return;
      }

      if (req.method === 'GET' && /^\/api\/v1\/apps\/\d+\/template-actions$/.test(pathname)) {
        const appId = Number.parseInt(pathname.split('/')[4], 10);
        const actions = await this.listTemplateActions(appId);
        this.sendJson(res, 200, requestId, { actions });
        return;
      }

      if (pathname === '/api/v1/jobs' && req.method === 'POST') {
        const body = await this.readJson(req) as ReportJobRequestV1;
        const validator = getReportJobValidator();
        if (!validator || !validator(body)) {
          this.sendJson(res, 400, requestId, { error: 'Invalid report-job payload', details: validator?.errors ?? [] });
          return;
        }
        const idempotencyKey = computeIdempotencyKey(body);
        const queued = await this.queue.enqueue(body, idempotencyKey);
        this.sendJson(res, 202, requestId, { ...queued });
        return;
      }

      if (req.method === 'PUT' && /^\/api\/v1\/templates\/[^/]+\/[^/]+\/draft$/.test(pathname)) {
        const [, , , , templateCode, version] = pathname.split('/');
        const body = await this.readJson(req) as {
          source_app_id: number;
          action_code: string;
          template: ReportTemplateV1;
          page_1_svg_file_key: string;
          page_follow_svg_file_key?: string;
        };
        const validation = this.validateTemplatePayload(body.template);
        if (!validation.ok) {
          this.sendJson(res, 400, requestId, { error: 'Invalid report-template payload', details: validation.errors });
          return;
        }
        const saved = await this.saveDraftTemplate(templateCode, version, body);
        this.sendJson(res, 200, requestId, saved);
        return;
      }

      if (req.method === 'POST' && /^\/api\/v1\/templates\/[^/]+\/[^/]+\/validate$/.test(pathname)) {
        const body = await this.readJson(req) as { template: ReportTemplateV1 };
        const validation = this.validateTemplatePayload(body.template);
        this.sendJson(res, 200, requestId, validation);
        return;
      }

      if (req.method === 'POST' && /^\/api\/v1\/templates\/[^/]+\/[^/]+\/publish$/.test(pathname)) {
        const [, , , , templateCode, version] = pathname.split('/');
        const body = await this.readJson(req) as { source_app_id: number };
        const published = await this.publishTemplate(templateCode, version, body.source_app_id);
        this.sendJson(res, 200, requestId, published);
        return;
      }

      if (req.method === 'GET' && /^\/api\/v1\/jobs\/[^/]+$/.test(pathname)) {
        const jobId = decodeURIComponent(pathname.split('/').at(-1) ?? '');
        const found = await this.queue.findByJobId(jobId);
        if (!found) {
          this.sendJson(res, 404, requestId, { error: 'Job not found' });
          return;
        }
        this.sendJson(res, 200, requestId, { ...found });
        return;
      }

      this.sendJson(res, 404, requestId, { error: 'Not Found' });
    } catch (error) {
      const kintoneError = error as { code?: unknown; errors?: unknown };
      this.sendJson(res, 500, requestId, {
        error: error instanceof Error ? error.message : String(error),
        code: kintoneError.code,
        details: kintoneError.errors,
      });
    }
  }

  private async listTemplateActions(appId: number): Promise<TemplateActionSummary[]> {
    const f = this.options.templates.fields;
    const query = `${f.sourceAppId} = "${appId}" and ${f.status} in ("Published") order by ${f.publishedSeq} desc limit 500`;
    const records = await this.gateway.getRecords(this.options.templates.app, query);
    const seen = new Set<string>();
    const actions: TemplateActionSummary[] = [];
    for (const record of records) {
      const actionCode = readStringField(record.fields[f.actionCode]);
      if (!actionCode || seen.has(actionCode)) continue;
      seen.add(actionCode);
      actions.push({
        action_code: actionCode,
        template_code: readStringField(record.fields[f.templateCode]),
        version: readStringField(record.fields[f.version]),
      });
    }
    return actions;
  }

  private validateTemplatePayload(template: ReportTemplateV1): { ok: boolean; errors: unknown[] } {
    const validator = getReportTemplateValidator();
    if (!validator || !validator(template)) {
      return {
        ok: false,
        errors: validator?.errors ?? [],
      };
    }
    return { ok: true, errors: [] };
  }

  private async saveDraftTemplate(
    templateCode: string,
    version: string,
    payload: {
      source_app_id: number;
      action_code: string;
      template: ReportTemplateV1;
      page_1_svg_file_key: string;
      page_follow_svg_file_key?: string;
    }
  ): Promise<{ saved: boolean; record_id: string }> {
    const f = this.options.templates.fields;
    const escapedCode = templateCode.replace(/"/g, '\\"');
    const escapedVersion = version.replace(/"/g, '\\"');
    const query = [
      `${f.templateCode} = "${escapedCode}"`,
      `and ${f.version} = "${escapedVersion}"`,
      `and ${f.sourceAppId} = "${payload.source_app_id}"`,
      'order by $id desc',
      'limit 1',
    ].join(' ');
    const existing = await this.gateway.getRecords(this.options.templates.app, query);
    const recordData = {
      [f.templateCode]: { value: templateCode },
      [f.version]: { value: version },
      [f.sourceAppId]: { value: String(payload.source_app_id) },
      [f.actionCode]: { value: payload.action_code },
      [f.status]: { value: 'Draft' },
      [f.templateJson]: { value: JSON.stringify(payload.template) },
      [f.page1Svg]: { value: [{ fileKey: payload.page_1_svg_file_key }] },
      [f.pageFollowSvg]: { value: payload.page_follow_svg_file_key ? [{ fileKey: payload.page_follow_svg_file_key }] : [] },
    };
    if (existing.length > 0) {
      await this.gateway.updateRecord(this.options.templates.app, existing[0].id, recordData, existing[0].revision);
      return { saved: true, record_id: existing[0].id };
    }
    const created = await this.gateway.addRecord(this.options.templates.app, recordData);
    return { saved: true, record_id: created.id };
  }

  private async publishTemplate(
    templateCode: string,
    version: string,
    sourceAppId: number
  ): Promise<{ published: boolean; record_id: string; published_seq: number }> {
    const f = this.options.templates.fields;
    const escapedCode = templateCode.replace(/"/g, '\\"');
    const escapedVersion = version.replace(/"/g, '\\"');
    const targetQuery = [
      `${f.templateCode} = "${escapedCode}"`,
      `and ${f.version} = "${escapedVersion}"`,
      `and ${f.sourceAppId} = "${sourceAppId}"`,
      'order by $id desc',
      'limit 1',
    ].join(' ');
    const target = await this.gateway.getRecords(this.options.templates.app, targetQuery);
    if (!target.length) {
      throw new Error(`Template not found for publish: ${templateCode}:${version}`);
    }

    const latestPublishedQuery = [
      `${f.templateCode} = "${escapedCode}"`,
      `and ${f.sourceAppId} = "${sourceAppId}"`,
      `and ${f.status} in ("Published")`,
      `order by ${f.publishedSeq} desc`,
      'limit 1',
    ].join(' ');
    const latest = await this.gateway.getRecords(this.options.templates.app, latestPublishedQuery);
    const nextSeq = latest.length > 0 ? Number.parseInt(readStringField(latest[0].fields[f.publishedSeq]) || '0', 10) + 1 : 1;

    await this.gateway.updateRecord(this.options.templates.app, target[0].id, {
      [f.status]: { value: 'Published' },
      [f.publishedSeq]: { value: String(nextSeq) },
    }, target[0].revision);
    return { published: true, record_id: target[0].id, published_seq: nextSeq };
  }

  private async readJson(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw) return {};
    return JSON.parse(raw);
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    requestId: string,
    payload: Record<string, unknown>
  ): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ request_id: requestId, ...payload }));
  }
}

function readStringField(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const value = (raw as { value: unknown }).value;
    return value === undefined || value === null ? '' : String(value);
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

function computeIdempotencyKey(payload: ReportJobRequestV1): string {
  const input = `${payload.app_id}:${payload.record_id}:${payload.template_action_code}:${payload.requested_by}`;
  return createHash('sha256').update(input).digest('hex');
}

export async function startReportApiServer(options: ReportApiServerOptions): Promise<ReportApiServer> {
  const server = new ReportApiServer(options);
  await server.start();
  return server;
}
