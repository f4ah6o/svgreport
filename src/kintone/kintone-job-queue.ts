import { randomUUID } from 'crypto';
import { SVGReportError } from '../types/index.js';
import type { ReportJobRequestV1, ReportJobResultV1, ReportJobStatus } from '../types/reporting.js';
import { KintoneRestGateway } from './kintone-rest.js';

export interface JobQueueConfig {
  app: number;
  fields: {
    jobId: string;
    idempotencyKey: string;
    status: string;
    appId: string;
    recordId: string;
    templateActionCode: string;
    templateCode: string;
    templateVersion: string;
    requestedBy: string;
    attempts: string;
    maxAttempts: string;
    nextRunAt: string;
    startedAt: string;
    finishedAt: string;
    inputSnapshotJson: string;
    renderDebugJson: string;
    outputPdf: string;
    outputSvgZip: string;
    errorCode: string;
    errorMessage: string;
  };
}

export interface ClaimedJob {
  queueRecordId: string;
  job: ReportJobResultV1;
  revision: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export class KintoneJobQueue {
  constructor(
    private gateway: KintoneRestGateway,
    private config: JobQueueConfig
  ) {}

  async enqueue(request: ReportJobRequestV1, idempotencyKey: string): Promise<ReportJobResultV1> {
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing && existing.status !== 'FAILED') {
      return existing;
    }

    const nowIso = new Date().toISOString();
    const record = {
      [this.config.fields.jobId]: { value: randomUUID() },
      [this.config.fields.idempotencyKey]: { value: idempotencyKey },
      [this.config.fields.status]: { value: 'QUEUED' },
      [this.config.fields.appId]: { value: String(request.app_id) },
      [this.config.fields.recordId]: { value: request.record_id },
      [this.config.fields.templateActionCode]: { value: request.template_action_code },
      [this.config.fields.requestedBy]: { value: request.requested_by },
      [this.config.fields.attempts]: { value: '0' },
      [this.config.fields.maxAttempts]: { value: String(DEFAULT_MAX_ATTEMPTS) },
      [this.config.fields.nextRunAt]: { value: nowIso },
      [this.config.fields.startedAt]: { value: '' },
      [this.config.fields.finishedAt]: { value: '' },
      [this.config.fields.errorCode]: { value: '' },
      [this.config.fields.errorMessage]: { value: '' },
    };

    const added = await this.gateway.addRecord(this.config.app, record);
    const loaded = await this.gateway.getRecord(this.config.app, added.id);
    return decodeJobRecord(loaded.fields, this.config.fields);
  }

  async claimNext(now: Date): Promise<ClaimedJob | null> {
    const query = `${this.config.fields.status} in ("QUEUED","RETRY_WAIT") order by $id asc limit 20`;
    const records = await this.gateway.getRecords(this.config.app, query);

    for (const record of records) {
      const decoded = decodeJobRecord(record.fields, this.config.fields);
      const nextRunAt = readDateValue(record.fields[this.config.fields.nextRunAt]);
      if (nextRunAt && nextRunAt.getTime() > now.getTime()) {
        continue;
      }

      const startedAt = now.toISOString();
      try {
        await this.gateway.updateRecord(
          this.config.app,
          record.id,
          {
            [this.config.fields.status]: { value: 'RUNNING' },
            [this.config.fields.startedAt]: { value: startedAt },
          },
          record.revision
        );
        return {
          queueRecordId: record.id,
          job: { ...decoded, status: 'RUNNING', started_at: startedAt },
          revision: record.revision,
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  async markSucceeded(
    recordId: string,
    payload: {
      templateCode: string;
      templateVersion: string;
      outputFileKey: string;
      attempts: number;
      debugJson: string;
    }
  ): Promise<void> {
    await this.gateway.updateRecord(this.config.app, recordId, {
      [this.config.fields.status]: { value: 'SUCCEEDED' },
      [this.config.fields.templateCode]: { value: payload.templateCode },
      [this.config.fields.templateVersion]: { value: payload.templateVersion },
      [this.config.fields.finishedAt]: { value: new Date().toISOString() },
      [this.config.fields.attempts]: { value: String(payload.attempts) },
      [this.config.fields.renderDebugJson]: { value: payload.debugJson },
      [this.config.fields.outputPdf]: { value: [{ fileKey: payload.outputFileKey }] },
      [this.config.fields.errorCode]: { value: '' },
      [this.config.fields.errorMessage]: { value: '' },
    });
  }

  async markFailed(
    recordId: string,
    payload: {
      attempts: number;
      maxAttempts: number;
      errorCode: string;
      errorMessage: string;
      retryAfterMs: number;
    }
  ): Promise<void> {
    const hasRetry = payload.attempts < payload.maxAttempts;
    const status: ReportJobStatus = hasRetry ? 'RETRY_WAIT' : 'FAILED';
    const nextRunAt = new Date(Date.now() + payload.retryAfterMs).toISOString();
    await this.gateway.updateRecord(this.config.app, recordId, {
      [this.config.fields.status]: { value: status },
      [this.config.fields.attempts]: { value: String(payload.attempts) },
      [this.config.fields.nextRunAt]: { value: hasRetry ? nextRunAt : '' },
      [this.config.fields.finishedAt]: { value: hasRetry ? '' : new Date().toISOString() },
      [this.config.fields.errorCode]: { value: payload.errorCode },
      [this.config.fields.errorMessage]: { value: payload.errorMessage.slice(0, 4000) },
    });
  }

  async findByJobId(jobId: string): Promise<ReportJobResultV1 | null> {
    const escaped = jobId.replace(/"/g, '\\"');
    const query = `${this.config.fields.jobId} = "${escaped}" order by $id desc limit 1`;
    const records = await this.gateway.getRecords(this.config.app, query);
    if (!records.length) return null;
    return decodeJobRecord(records[0].fields, this.config.fields);
  }

  private async findByIdempotencyKey(idempotencyKey: string): Promise<ReportJobResultV1 | null> {
    const escaped = idempotencyKey.replace(/"/g, '\\"');
    const query = `${this.config.fields.idempotencyKey} = "${escaped}" order by $id desc limit 1`;
    const records = await this.gateway.getRecords(this.config.app, query);
    if (!records.length) return null;
    return decodeJobRecord(records[0].fields, this.config.fields);
  }
}

function decodeJobRecord(
  fields: Record<string, unknown>,
  map: JobQueueConfig['fields']
): ReportJobResultV1 {
  const schema = 'report-job/v1' as const;
  const jobId = readStringValue(fields[map.jobId]) || readStringValue(fields.$id) || '';
  const idempotencyKey = readStringValue(fields[map.idempotencyKey]);
  const status = (readStringValue(fields[map.status]) || 'QUEUED') as ReportJobStatus;
  const appId = Number.parseInt(readStringValue(fields[map.appId]) || '0', 10);
  const recordId = readStringValue(fields[map.recordId]);
  const templateActionCode = readStringValue(fields[map.templateActionCode]);
  const templateCode = readStringValue(fields[map.templateCode]);
  const templateVersion = readStringValue(fields[map.templateVersion]);
  const attempts = Number.parseInt(readStringValue(fields[map.attempts]) || '0', 10);
  const maxAttempts = Number.parseInt(readStringValue(fields[map.maxAttempts]) || '3', 10);

  return {
    schema,
    job_id: jobId,
    idempotency_key: idempotencyKey,
    status,
    app_id: appId,
    record_id: recordId,
    template_action_code: templateActionCode,
    template_code: templateCode,
    template_version: templateVersion,
    attempts,
    max_attempts: maxAttempts,
    started_at: readStringValue(fields[map.startedAt]) || undefined,
    finished_at: readStringValue(fields[map.finishedAt]) || undefined,
    error_code: readStringValue(fields[map.errorCode]) || undefined,
    error_message: readStringValue(fields[map.errorMessage]) || undefined,
  };
}

function readStringValue(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const value = (raw as { value: unknown }).value;
    return value === undefined || value === null ? '' : String(value);
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

function readDateValue(raw: unknown): Date | null {
  const text = readStringValue(raw);
  if (!text) return null;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) {
    throw new SVGReportError('Invalid datetime in queue record', text);
  }
  return d;
}
