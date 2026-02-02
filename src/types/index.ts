// types/index.ts

// ============================================
// Job Manifest Types
// ============================================

export interface JobManifest {
  schema: 'svgreport-job/v0.1';
  job_id: string;
  template: TemplateRef;
  encoding: 'utf-8';
  locale?: string;
  inputs: Record<string, InputSpec>;
}

export interface TemplateRef {
  id: string;
  version: string;
}

export interface InputSpec {
  type: 'csv';
  path: string;
  kind: 'kv' | 'table';
  options?: CsvOptions;
}

export interface CsvOptions {
  has_header?: boolean;
  delimiter?: string;
  quote?: string;
}

// ============================================
// Template Types
// ============================================

export interface TemplateConfig {
  schema: 'svgreport-template/v0.1';
  template: TemplateRef;
  pages: PageConfig[];
  fields: FieldBinding[];
  formatters?: Record<string, FormatterDef>;
}

export interface PageConfig {
  id: string;
  svg: string;
  kind: 'first' | 'repeat';
  tables: TableBinding[];
  page_number?: PageNumberConfig;
}

export interface PageNumberConfig {
  svg_id: string;
  format?: string;
}

export interface TableBinding {
  source: string;
  row_group_id: string;
  row_height_mm: number;
  rows_per_page: number;
  start_y_mm?: number;
  cells: TableCell[];
}

export interface TableCell {
  svg_id: string;
  column: string;
  fit?: 'none' | 'shrink' | 'wrap' | 'clip';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export interface FieldBinding {
  svg_id: string;
  source: string;
  key: string;
  fit?: 'none' | 'shrink' | 'wrap' | 'clip';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export interface FormatterDef {
  kind?: 'date' | 'number' | 'currency';
  pattern?: string;
  currency?: string;
}

// ============================================
// Data Types
// ============================================

export type KVData = Record<string, string>;

export interface TableData {
  headers: string[];
  rows: Record<string, string>[];
}

export type DataSource = KVData | TableData;

/**
 * Type guard for KVData
 */
export function isKvData(source: DataSource): source is KVData {
  return !('headers' in source);
}

/**
 * Type guard for TableData
 */
export function isTableData(source: DataSource): source is TableData {
  return 'headers' in source && 'rows' in source;
}

// ============================================
// Runtime Types
// ============================================

export interface JobData {
  manifest: JobManifest;
  sources: Map<string, DataSource>;
}

export interface TemplateData {
  config: TemplateConfig;
  svgs: Map<string, Document>; // page ID -> SVG Document
}

export interface PageRenderContext {
  pageIndex: number;
  totalPages: number;
  currentPage: number;
  meta: KVData;
  tableChunk: Record<string, string>[];
}

export interface RenderedPage {
  pageNumber: number;
  svgDocument: Document;
  svgString: string;
}

export interface RenderResult {
  jobId: string;
  templateId: string;
  templateVersion: string;
  totalPages: number;
  pages: RenderedPage[];
}

// ============================================
// Error Types
// ============================================

export class SVGReportError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
    public readonly reason?: string
  ) {
    super(message);
    this.name = 'SVGReportError';
  }
}
