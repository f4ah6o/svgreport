import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClonePayloads,
  buildDummyRecord,
  buildMappingCandidate,
  buildSandboxAppName,
  buildSettingsPayload,
  detectOutputAttachmentField,
  sanitizeLayout,
} from './report-rollout.mjs';

test('buildSandboxAppName appends deterministic suffix without losing source name', () => {
  const name = buildSandboxAppName('Sales Invoice');
  assert.match(name, /^Sales Invoice - svgreport sbx \d{8}$/);
});

test('detectOutputAttachmentField prefers Attachments then first FILE field', () => {
  assert.equal(detectOutputAttachmentField({ Attachments: { type: 'FILE' } }), 'Attachments');
  assert.equal(detectOutputAttachmentField({ Upload: { type: 'FILE' } }), 'Upload');
});

test('sanitizeLayout removes rows for skipped fields', () => {
  const layout = [
    { type: 'ROW', fields: [{ fieldCode: 'keep_me' }, { fieldCode: 'drop_me' }] },
    { type: 'ROW', fields: [{ fieldCode: 'keep_me_too' }] },
  ];
  const sanitized = sanitizeLayout(layout, new Set(['keep_me', 'keep_me_too']));
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0].fields.length, 1);
  assert.equal(sanitized[0].fields[0].fieldCode, 'keep_me');
});

test('buildSettingsPayload coerces booleans and drops invalid titleField', () => {
  const payload = buildSettingsPayload(
    {
      description: 'desc',
      enableComments: true,
      enableThumbnails: false,
      theme: 'BLUE',
      titleField: { code: 'missing' },
    },
    'Sandbox',
    new Set(['existing'])
  );
  assert.equal(payload.name, 'Sandbox');
  assert.equal(payload.enableComments, 'true');
  assert.equal(payload.enableThumbnails, 'false');
  assert.equal(payload.titleField, undefined);
});

test('buildClonePayloads skips non cloneable fields and preserves cloneable layout', () => {
  const clone = buildClonePayloads(
    {
      text_1: { type: 'SINGLE_LINE_TEXT', label: 'Text', required: false },
      status_1: { type: 'STATUS', label: 'Status' },
    },
    [{ type: 'ROW', fields: [{ fieldCode: 'text_1' }, { fieldCode: 'status_1' }] }],
    { enableComments: true },
    'Sandbox'
  );
  assert.deepEqual(Object.keys(clone.fields.properties), ['text_1']);
  assert.equal(clone.layout[0].fields.length, 1);
  assert.match(clone.warnings[0], /status_1:STATUS/);
});

test('buildDummyRecord synthesizes scalar and subtable values', () => {
  const result = buildDummyRecord({
    customer_name: { type: 'SINGLE_LINE_TEXT', required: true },
    amount: { type: 'NUMBER', required: true },
    items: {
      type: 'SUBTABLE',
      required: false,
      fields: {
        item_name: { type: 'SINGLE_LINE_TEXT', required: true },
        qty: { type: 'NUMBER', required: true },
      },
    },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.record.customer_name.value, 'customer_name_DUMMY_1');
  assert.equal(result.record.amount.value, '1');
  assert.equal(result.record.items.value.length, 2);
  assert.equal(result.record.items.value[0].value.item_name.value, 'item_name_DUMMY_1');
});

test('buildMappingCandidate chooses the first subtable and normalizes data keys', () => {
  const mapping = buildMappingCandidate({
    CustomerName: { type: 'SINGLE_LINE_TEXT', label: 'Customer Name' },
    Items: {
      type: 'SUBTABLE',
      label: 'Items',
      fields: {
        ItemName: { type: 'SINGLE_LINE_TEXT', label: 'Item Name' },
        Qty: { type: 'NUMBER', label: 'Qty' },
      },
    },
  });
  assert.equal(mapping.kv_bindings[0].key, 'customer_name');
  assert.equal(mapping.table.source.field_code, 'Items');
  assert.equal(mapping.table.columns[0].name, 'item_name');
});
