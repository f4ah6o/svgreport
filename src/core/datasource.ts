// core/datasource.ts
// CSV parser for meta.csv (kv) and items.csv (table) formats

import { parse } from 'csv-parse/sync';
import type { KVData, TableData, DataSource, InputSpec, CsvOptions } from '../types/index.js';
import { SVGReportError } from '../types/index.js';

const DEFAULT_CSV_OPTIONS: Required<CsvOptions> = {
  has_header: true,
  delimiter: ',',
  quote: '"',
};

/**
 * Parse CSV content based on input specification
 */
export function parseCsv(content: Buffer, spec: InputSpec): DataSource {
  const options = { ...DEFAULT_CSV_OPTIONS, ...spec.options };

  try {
    const records = parse(content, {
      delimiter: options.delimiter,
      quote: options.quote,
      columns: spec.kind === 'table',
      skip_empty_lines: true,
      trim: true,
    });

    if (spec.kind === 'kv') {
      return parseKvData(records);
    } else {
      return parseTableData(records);
    }
  } catch (error) {
    throw new SVGReportError(
      `Failed to parse CSV: ${spec.path}`,
      spec.path,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Parse key-value CSV format
 * Expected: rows of [key, value] pairs
 * First row is header: key,value (skipped if has_header=true)
 */
function parseKvData(records: unknown[]): KVData {
  const result: KVData = {};

  for (const record of records) {
    if (!Array.isArray(record) || record.length < 2) {
      continue;
    }

    const [key, value] = record;
    if (typeof key === 'string' && key.trim()) {
      result[key.trim()] = String(value ?? '');
    }
  }

  return result;
}

/**
 * Parse table CSV format
 * Expected: first row is headers, subsequent rows are data
 */
function parseTableData(records: unknown[]): TableData {
  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  // With columns: true, csv-parse returns objects
  const rows: Record<string, string>[] = [];

  for (const record of records) {
    if (typeof record !== 'object' || record === null) {
      continue;
    }

    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      row[key] = String(value ?? '');
    }
    rows.push(row);
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { headers, rows };
}

/**
 * Get value from KV data using dot notation
 * Example: getKvValue(data, 'customer.name') -> data['customer.name']
 */
export function getKvValue(data: KVData, key: string): string {
  return data[key] ?? '';
}

/**
 * Get value from table row
 */
export function getTableValue(row: Record<string, string>, column: string): string {
  return row[column] ?? '';
}

/**
 * Validate that required data sources are present
 */
export function validateDataSources(
  required: string[],
  available: Map<string, DataSource>
): void {
  const missing = required.filter(name => !available.has(name));

  if (missing.length > 0) {
    throw new SVGReportError(
      `Missing required data sources: ${missing.join(', ')}`,
      'inputs',
      `Expected: ${required.join(', ')}`
    );
  }
}
