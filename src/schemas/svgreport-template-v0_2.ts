// schemas/svgreport-template-v0_2.ts
// SVG Report Template Schema v0.2 (Value bindings)

export const SVGREPORT_TEMPLATE_V0_2_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'svgreport-template/v0.2.schema.json',
  title: 'SVG Report Template v0.2',
  type: 'object',
  required: ['schema', 'template', 'pages', 'fields'],
  properties: {
    schema: {
      const: 'svgreport-template/v0.2',
    },
    template: {
      type: 'object',
      required: ['id', 'version'],
      properties: {
        id: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    pages: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/page' },
    },
    fields: {
      type: 'array',
      items: { $ref: '#/$defs/fieldBinding' },
      description: 'Bindings for non-repeating fields (meta or single-value items).',
    },
    formatters: {
      type: 'object',
      description: 'Optional named formatter presets (future-proof).',
      additionalProperties: { $ref: '#/$defs/formatter' },
    },
  },
  additionalProperties: false,
  $defs: {
    page: {
      type: 'object',
      required: ['id', 'svg', 'kind', 'tables'],
      properties: {
        id: { type: 'string', minLength: 1 },
        svg: { type: 'string', minLength: 1, description: 'SVG filename (e.g., page-1.svg)' },
        kind: { type: 'string', enum: ['first', 'repeat'] },
        tables: {
          type: 'array',
          items: { $ref: '#/$defs/tableBinding' },
        },
        page_number: { $ref: '#/$defs/pageNumber' },
      },
      additionalProperties: false,
    },
    pageNumber: {
      type: 'object',
      properties: {
        svg_id: { type: 'string', minLength: 1, description: 'Target text element id in SVG.' },
        format: { type: 'string', default: '{current}/{total}' },
      },
      additionalProperties: false,
    },
    tableBinding: {
      type: 'object',
      required: ['source', 'row_group_id', 'row_height_mm', 'rows_per_page', 'cells'],
      properties: {
        source: { type: 'string', minLength: 1, description: 'Data source name in manifest.inputs (e.g., items).' },
        row_group_id: { type: 'string', minLength: 1, description: 'The <g id=...> that represents a single row template.' },
        row_height_mm: { type: 'number', exclusiveMinimum: 0, description: 'Row pitch in millimeters.' },
        rows_per_page: { type: 'integer', minimum: 0, description: 'How many records fit on this page.' },
        start_y_mm: { type: 'number', description: "Optional override: starting Y (mm). If omitted, use row template's original position." },
        header: { $ref: '#/$defs/tableHeader' },
        cells: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/tableCell' },
          description: 'Mapping from SVG elements inside row_group_id to table values.',
        },
      },
      additionalProperties: false,
    },
    tableHeader: {
      type: 'object',
      required: ['cells'],
      properties: {
        cells: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/tableCell' },
        },
      },
      additionalProperties: false,
    },
    tableCell: {
      type: 'object',
      required: ['svg_id', 'value'],
      properties: {
        svg_id: { type: 'string', minLength: 1, description: 'Target element id in SVG.' },
        value: { $ref: '#/$defs/valueBinding' },
        fit: { type: 'string', enum: ['none', 'shrink', 'wrap', 'clip'], default: 'none' },
        align: { type: 'string', enum: ['left', 'center', 'right'], default: 'left' },
        format: { type: 'string', default: 'raw', description: 'Formatter name or builtin (raw/date/number/yen...).' },
      },
      additionalProperties: false,
    },
    fieldBinding: {
      type: 'object',
      required: ['svg_id', 'value'],
      properties: {
        svg_id: { type: 'string', minLength: 1, description: 'Target element id in SVG.' },
        value: { $ref: '#/$defs/valueBinding' },
        fit: { type: 'string', enum: ['none', 'shrink', 'wrap', 'clip'], default: 'none' },
        align: { type: 'string', enum: ['left', 'center', 'right'], default: 'left' },
        format: { type: 'string', default: 'raw' },
      },
      additionalProperties: false,
    },
    valueBinding: {
      oneOf: [
        {
          type: 'object',
          required: ['type', 'text'],
          properties: {
            type: { const: 'static' },
            text: { type: 'string' },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['type', 'source', 'key'],
          properties: {
            type: { const: 'data' },
            source: { type: 'string', minLength: 1 },
            key: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      ],
    },
    formatter: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['date', 'number', 'currency'] },
        pattern: { type: 'string' },
        currency: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
} as const;
