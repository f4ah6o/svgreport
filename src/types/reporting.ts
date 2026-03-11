type TemplateConfig = import('./index.js').TemplateConfig;

export type ReportJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'SUCCEEDED'
  | 'FAILED';

export interface ReportTemplateIdentity {
  code: string;
  version: string;
  source_app_id: number;
  status: 'Draft' | 'Published';
  published_seq?: number;
}

export interface ReportOutputConfig {
  output_attachment_field_code: string;
  pdf_filename_expr: string;
}

export interface ReportTemplateV1 {
  schema: 'report-template/v1';
  template: ReportTemplateIdentity;
  output: ReportOutputConfig;
  render: TemplateConfig;
  mapping: ReportMappingSpecV1;
}

export interface ReportMappingSpecV1 {
  schema: 'report-mapping/v1';
  kv_bindings: KvBinding[];
  table: TableMappingSpec;
}

export interface KvBinding {
  key: string;
  expr: string;
}

export interface TableMappingSpec {
  source: TableSource;
  columns: TableColumnBinding[];
  ops?: TableOp[];
}

export interface TableSource {
  kind: 'subtable';
  field_code: string;
}

export interface TableColumnBinding {
  name: string;
  expr: string;
}

export type TableOp =
  | SelectOp
  | RenameOp
  | FilterOp
  | SortOp
  | PivotOp
  | UnpivotOp;

export interface SelectOp {
  op: 'select';
  columns: string[];
}

export interface RenameOp {
  op: 'rename';
  map: Record<string, string>;
}

export interface FilterOp {
  op: 'filter';
  expr: string;
}

export interface SortOp {
  op: 'sort';
  keys: Array<{
    column: string;
    direction?: 'asc' | 'desc';
  }>;
}

export interface PivotOp {
  op: 'pivot';
  index: string[];
  column: string;
  value: string;
}

export interface UnpivotOp {
  op: 'unpivot';
  keep: string[];
  columns: string[];
  key_name: string;
  value_name: string;
}

export interface ReportJobRequestV1 {
  schema: 'report-job/v1';
  app_id: number;
  record_id: string;
  template_action_code: string;
  requested_by: string;
}

export interface ReportJobResultV1 {
  schema: 'report-job/v1';
  job_id: string;
  idempotency_key: string;
  status: ReportJobStatus;
  app_id: number;
  record_id: string;
  template_action_code: string;
  template_code: string;
  template_version: string;
  output_file_key?: string;
  attempts: number;
  max_attempts: number;
  started_at?: string;
  finished_at?: string;
  error_code?: string;
  error_message?: string;
}
