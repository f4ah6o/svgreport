import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTableOps, evaluateExpression, mapRecordToReportData } from './report-mapping.js';
import type { ReportMappingSpecV1 } from '../types/reporting.js';

test('evaluateExpression supports field/row and boolean ops', () => {
  const truthy = evaluateExpression('and(eq(field("status"), "active"), gt(row("qty"), 1))', {
    record: { status: 'active' },
    row: { qty: '2' },
  });
  const falsy = evaluateExpression('contains(field("name"), "ZZZ")', {
    record: { name: '株式会社サンプル' },
    row: null,
  });
  assert.equal(truthy, true);
  assert.equal(falsy, false);
});

test('applyTableOps supports select/rename/filter/sort', () => {
  const rows = [
    { item: 'B', qty: '2', keep: 'yes' },
    { item: 'A', qty: '1', keep: 'no' },
  ];
  const out = applyTableOps(
    rows,
    [
      { op: 'filter', expr: 'eq(row("keep"), "yes")' },
      { op: 'select', columns: ['item', 'qty'] },
      { op: 'rename', map: { item: 'name' } },
      { op: 'sort', keys: [{ column: 'name', direction: 'asc' }] },
    ],
    {}
  );
  assert.deepEqual(out, [{ name: 'B', qty: '2' }]);
});

test('pivot and unpivot transforms rows', () => {
  const pivoted = applyTableOps(
    [
      { id: '1', metric: 'sales', value: '10' },
      { id: '1', metric: 'cost', value: '6' },
    ],
    [{ op: 'pivot', index: ['id'], column: 'metric', value: 'value' }],
    {}
  );
  assert.deepEqual(pivoted, [{ id: '1', sales: '10', cost: '6' }]);

  const unpivoted = applyTableOps(
    [{ id: '1', jan: '10', feb: '20' }],
    [{ op: 'unpivot', keep: ['id'], columns: ['jan', 'feb'], key_name: 'month', value_name: 'amount' }],
    {}
  );
  assert.deepEqual(unpivoted, [
    { id: '1', month: 'jan', amount: '10' },
    { id: '1', month: 'feb', amount: '20' },
  ]);
});

test('mapRecordToReportData builds kv and table', () => {
  const mapping: ReportMappingSpecV1 = {
    schema: 'report-mapping/v1',
    kv_bindings: [{ key: 'customer_name', expr: 'field("customer")' }],
    table: {
      source: { kind: 'subtable', field_code: 'details' },
      columns: [
        { name: 'name', expr: 'row("name")' },
        { name: 'amount', expr: 'row("amount")' },
      ],
      ops: [{ op: 'sort', keys: [{ column: 'name', direction: 'asc' }] }],
    },
  };

  const result = mapRecordToReportData(
    {
      fields: { customer: '株式会社サンプル' },
      subtables: {
        details: [
          { name: 'B', amount: '200' },
          { name: 'A', amount: '100' },
        ],
      },
    },
    mapping
  );

  assert.deepEqual(result.kv, { customer_name: '株式会社サンプル' });
  assert.deepEqual(result.table, [
    { name: 'A', amount: '100' },
    { name: 'B', amount: '200' },
  ]);
});

