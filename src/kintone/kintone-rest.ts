import { KintoneRestAPIClient } from '@kintone/rest-api-client';
import type { KintoneLikeRecord } from './report-mapping.js';

export interface KintoneApiConfig {
  baseUrl: string;
  apiToken: string | string[];
}

export interface KintoneAttachment {
  fileKey: string;
  name: string;
  contentType?: string;
  size?: string;
}

export interface KintoneRecordEnvelope {
  id: string;
  revision: string;
  fields: Record<string, unknown>;
}

export class KintoneRestGateway {
  private client: KintoneRestAPIClient;

  constructor(config: KintoneApiConfig) {
    this.client = new KintoneRestAPIClient({
      baseUrl: config.baseUrl,
      auth: {
        apiToken: config.apiToken,
      },
    });
  }

  async getRecord(app: number, id: string): Promise<KintoneRecordEnvelope> {
    const response = await this.client.record.getRecord({ app, id: Number.parseInt(id, 10) });
    const rawRecord = response.record as unknown as Record<string, { value?: unknown }>;
    return {
      id: toEntityValueString(rawRecord.$id),
      revision: toEntityValueString(rawRecord.$revision),
      fields: response.record as unknown as Record<string, unknown>,
    };
  }

  async getRecords(app: number, query: string): Promise<KintoneRecordEnvelope[]> {
    const response = await this.client.record.getRecords({ app, query });
    return response.records.map((record) => ({
      id: toEntityValueString((record as unknown as Record<string, { value?: unknown }>).$id),
      revision: toEntityValueString((record as unknown as Record<string, { value?: unknown }>).$revision),
      fields: record as unknown as Record<string, unknown>,
    }));
  }

  async addRecord(app: number, record: Record<string, unknown>): Promise<{ id: string; revision: string }> {
    const response = await this.client.record.addRecord({
      app,
      record: record as Record<string, never>,
    });
    return { id: response.id, revision: response.revision };
  }

  async updateRecord(
    app: number,
    id: string,
    record: Record<string, unknown>,
    revision?: string
  ): Promise<{ revision: string }> {
    const response = await this.client.record.updateRecord({
      app,
      id: Number.parseInt(id, 10),
      revision: revision ? Number.parseInt(revision, 10) : undefined,
      record: record as Record<string, never>,
    });
    return { revision: response.revision };
  }

  async uploadFile(name: string, content: Buffer): Promise<{ fileKey: string }> {
    const response = await this.client.file.uploadFile({
      file: {
        name,
        data: content,
      },
    });
    return { fileKey: response.fileKey };
  }

  async downloadFile(fileKey: string): Promise<Buffer> {
    const response = await this.client.file.downloadFile({ fileKey });
    return Buffer.from(response);
  }
}

export function toMappingRecord(fields: Record<string, unknown>): KintoneLikeRecord {
  const scalar: Record<string, string> = {};
  const subtables: Record<string, Record<string, string>[]> = {};
  for (const [fieldCode, raw] of Object.entries(fields)) {
    const value = raw as { type?: string; value?: unknown };
    if (!value || typeof value !== 'object' || !('value' in value)) continue;
    if (value.type === 'SUBTABLE' && Array.isArray(value.value)) {
      subtables[fieldCode] = value.value.map((row) => {
        const rowValue = row as { value?: Record<string, { value?: unknown }> };
        const cols: Record<string, string> = {};
        for (const [colCode, colRaw] of Object.entries(rowValue.value ?? {})) {
          cols[colCode] = toKintoneString((colRaw as { value?: unknown }).value);
        }
        return cols;
      });
      continue;
    }
    scalar[fieldCode] = toKintoneString(value.value);
  }
  return { fields: scalar, subtables };
}

export function readAttachments(
  fields: Record<string, unknown>,
  fieldCode: string
): KintoneAttachment[] {
  const raw = fields[fieldCode] as { value?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.value)) return [];
  return raw.value.map((item) => {
    const file = item as Record<string, unknown>;
    return {
      fileKey: String(file.fileKey ?? ''),
      name: String(file.name ?? ''),
      contentType: file.contentType ? String(file.contentType) : undefined,
      size: file.size ? String(file.size) : undefined,
    };
  });
}

function toKintoneString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => toKintoneString(v)).join(',');
  return JSON.stringify(value);
}

function toEntityValueString(raw: { value?: unknown } | undefined): string {
  if (!raw) return '';
  const value = raw.value;
  return value === undefined || value === null ? '' : String(value);
}
