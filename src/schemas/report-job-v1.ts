export const REPORT_JOB_V1_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'report-job/v1.schema.json',
  title: 'Report Job v1',
  type: 'object',
  required: ['schema', 'app_id', 'record_id', 'template_action_code', 'requested_by'],
  properties: {
    schema: { const: 'report-job/v1' },
    app_id: { type: 'integer', minimum: 1 },
    record_id: { type: 'string', minLength: 1 },
    template_action_code: { type: 'string', minLength: 1 },
    requested_by: { type: 'string', minLength: 1 },
  },
  additionalProperties: false,
} as const;

