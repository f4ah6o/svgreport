export const REPORT_MAPPING_V1_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://svgreport.local/schema/report-mapping/v1.schema.json',
  title: 'Report Mapping v1',
  type: 'object',
  required: ['schema', 'kv_bindings', 'table'],
  properties: {
    schema: { const: 'report-mapping/v1' },
    kv_bindings: {
      type: 'array',
      items: { $ref: '#/$defs/kvBinding' },
    },
    table: { $ref: '#/$defs/table' },
  },
  additionalProperties: false,
  $defs: {
    kvBinding: {
      type: 'object',
      required: ['key', 'expr'],
      properties: {
        key: { type: 'string', minLength: 1 },
        expr: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    table: {
      type: 'object',
      required: ['source', 'columns'],
      properties: {
        source: { $ref: '#/$defs/tableSource' },
        columns: {
          type: 'array',
          minItems: 1,
          items: { $ref: '#/$defs/tableColumn' },
        },
        ops: {
          type: 'array',
          items: { $ref: '#/$defs/tableOp' },
        },
      },
      additionalProperties: false,
    },
    tableSource: {
      type: 'object',
      required: ['kind', 'field_code'],
      properties: {
        kind: { const: 'subtable' },
        field_code: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    tableColumn: {
      type: 'object',
      required: ['name', 'expr'],
      properties: {
        name: { type: 'string', minLength: 1 },
        expr: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    tableOp: {
      oneOf: [
        {
          type: 'object',
          required: ['op', 'columns'],
          properties: {
            op: { const: 'select' },
            columns: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'map'],
          properties: {
            op: { const: 'rename' },
            map: {
              type: 'object',
              additionalProperties: { type: 'string', minLength: 1 },
            },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'expr'],
          properties: {
            op: { const: 'filter' },
            expr: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'keys'],
          properties: {
            op: { const: 'sort' },
            keys: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['column'],
                properties: {
                  column: { type: 'string', minLength: 1 },
                  direction: { type: 'string', enum: ['asc', 'desc'] },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'index', 'column', 'value'],
          properties: {
            op: { const: 'pivot' },
            index: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            column: { type: 'string', minLength: 1 },
            value: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['op', 'keep', 'columns', 'key_name', 'value_name'],
          properties: {
            op: { const: 'unpivot' },
            keep: { type: 'array', items: { type: 'string', minLength: 1 } },
            columns: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            key_name: { type: 'string', minLength: 1 },
            value_name: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      ],
    },
  },
} as const;
