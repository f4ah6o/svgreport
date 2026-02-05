// RPC API Types

export interface VersionResponse {
  request_id: string;
  app: {
    name: string;
    version: string;
  };
  api: {
    version: string;
  };
  schemas: {
    job: {
      id: string;
      schema_id: string;
    };
    template: {
      id: string;
      schema_id: string;
    };
  };
  capabilities: {
    convert: boolean;
    normalize: boolean;
    validate: boolean;
    preview: boolean;
    inspectText: boolean;
    generate: boolean;
    wrap: boolean;
  };
}

export interface WorkspaceResponse {
  request_id: string;
  root: string;
  templatesDirDefault: string;
  outputDirDefault: string;
}

export interface TemplateListItem {
  id: string;
  version: string;
  path: string;
}

export interface TemplatesListResponse {
  request_id: string;
  templates: TemplateListItem[];
}

export interface TemplateConfig {
  schema: string;
  template: {
    id: string;
    version: string;
  };
  pages: PageConfig[];
  fields: FieldBinding[];
  formatters?: Record<string, FormatterDef>;
}

export interface PageConfig {
  id: string;
  svg: string;
  kind: 'first' | 'repeat';
  fields?: FieldBinding[];
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
  header?: TableHeader;
  cells: TableCell[];
}

export interface TableCell {
  svg_id: string;
  value: ValueBinding;
  fit?: 'none' | 'shrink' | 'wrap' | 'clip';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export interface FieldBinding {
  svg_id: string;
  value: ValueBinding;
  fit?: 'none' | 'shrink' | 'wrap' | 'clip';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export interface TableHeader {
  cells: TableCell[];
}

export type ValueBinding = StaticValueBinding | DataValueBinding;

export interface StaticValueBinding {
  type: 'static';
  text: string;
}

export interface DataValueBinding {
  type: 'data';
  source: string;
  key: string;
}

export interface FormatterDef {
  kind?: 'date' | 'number' | 'currency';
  pattern?: string;
  currency?: string;
}

export interface TextElement {
  index: number;
  domIndex?: number;
  id: string | null;
  suggestedId?: string;
  text: string;
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  position: {
    x: number;
    y: number;
  };
  font: {
    size: number | null;
  };
}

export interface InspectTextResponse {
  request_id: string;
  file?: string;
  directory?: string;
  page?: {
    widthMm: number;
    heightMm: number;
  };
  warnings: Array<{
    code: string;
    message: string;
  }>;
  texts: TextElement[];
  files?: InspectTextResponse[];
}

export interface SvgReadResponse {
  request_id: string;
  contentType: string;
  svg: string;
}

export interface ValidationError {
  code: string;
  file: string;
  path: string;
  message: string;
}

export interface ValidationResponse {
  request_id: string;
  ok: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface PreviewResponse {
  request_id: string;
  ok: boolean;
  output?: {
    dir: string;
    html: string;
    pages: string[];
    debug: string[];
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface SaveResponse {
  request_id: string;
  saved: boolean;
  path: string;
  validation?: {
    ok: boolean;
    errors: ValidationError[];
    warnings: string[];
  };
}

export interface RpcErrorResponse {
  request_id: string;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
