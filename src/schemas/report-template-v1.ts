export const REPORT_TEMPLATE_V1_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'report-template/v1.schema.json',
  title: 'Report Template v1',
  type: 'object',
  required: ['schema', 'template', 'output', 'render', 'mapping'],
  properties: {
    schema: { const: 'report-template/v1' },
    template: {
      type: 'object',
      required: ['code', 'version', 'source_app_id', 'status'],
      properties: {
        code: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1 },
        source_app_id: { type: 'integer', minimum: 1 },
        status: { type: 'string', enum: ['Draft', 'Published'] },
        published_seq: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    output: {
      type: 'object',
      required: ['output_attachment_field_code', 'pdf_filename_expr'],
      properties: {
        output_attachment_field_code: { type: 'string', minLength: 1 },
        pdf_filename_expr: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
    render: {
      type: 'object',
      description: 'svgreport-template/v0.2 compatible payload',
      required: ['schema', 'template', 'pages', 'fields'],
      properties: {
        schema: { const: 'svgreport-template/v0.2' },
        template: {
          type: 'object',
          required: ['id', 'version'],
          properties: {
            id: { type: 'string', minLength: 1 },
            version: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
        pages: { type: 'array', minItems: 1 },
        fields: { type: 'array' },
        formatters: { type: 'object' },
      },
      additionalProperties: true,
    },
    mapping: { $ref: 'https://svgreport.local/schema/report-mapping/v1.schema.json' },
  },
  additionalProperties: false,
} as const;
