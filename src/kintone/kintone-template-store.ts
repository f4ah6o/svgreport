import { SVGReportError } from '../types/index.js';
import type { ReportTemplateV1 } from '../types/reporting.js';
import { KintoneRestGateway, readAttachments } from './kintone-rest.js';

export interface TemplateStoreConfig {
  app: number;
  fields: {
    templateCode: string;
    version: string;
    sourceAppId: string;
    status: string;
    publishedSeq: string;
    actionCode: string;
    templateJson: string;
    page1Svg: string;
    pageFollowSvg: string;
  };
}

export interface ResolvedTemplate {
  recordId: string;
  template: ReportTemplateV1;
  page1SvgFileKey: string;
  pageFollowSvgFileKey?: string;
}

export class KintoneTemplateStore {
  constructor(
    private gateway: KintoneRestGateway,
    private config: TemplateStoreConfig
  ) {}

  async resolvePublishedLatest(
    sourceAppId: number,
    actionCode: string
  ): Promise<ResolvedTemplate> {
    const escapedAction = actionCode.replace(/"/g, '\\"');
    const query = [
      `${this.config.fields.sourceAppId} = "${sourceAppId}"`,
      `and ${this.config.fields.status} in ("Published")`,
      `and ${this.config.fields.actionCode} = "${escapedAction}"`,
      `order by ${this.config.fields.publishedSeq} desc`,
      'limit 1',
    ].join(' ');
    const records = await this.gateway.getRecords(this.config.app, query);
    if (!records.length) {
      throw new SVGReportError(
        'Published template not found',
        actionCode,
        `No template for app=${sourceAppId}, action=${actionCode}`
      );
    }
    const record = records[0];
    const rawJson = readStringField(record.fields[this.config.fields.templateJson]);
    if (!rawJson) {
      throw new SVGReportError('Template JSON is empty', record.id);
    }
    const parsed = JSON.parse(rawJson) as ReportTemplateV1;
    const first = readAttachments(record.fields, this.config.fields.page1Svg).at(0);
    if (!first?.fileKey) {
      throw new SVGReportError('page-1 SVG attachment not found', record.id);
    }
    const follow = readAttachments(record.fields, this.config.fields.pageFollowSvg).at(0);
    return {
      recordId: record.id,
      template: parsed,
      page1SvgFileKey: first.fileKey,
      pageFollowSvgFileKey: follow?.fileKey,
    };
  }
}

function readStringField(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    const value = (raw as { value: unknown }).value;
    return value === undefined || value === null ? '' : String(value);
  }
  return raw === undefined || raw === null ? '' : String(raw);
}
