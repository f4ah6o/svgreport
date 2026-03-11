import { SVGReportError } from '../types/index.js';
import type {
  KvBinding,
  ReportMappingSpecV1,
  TableColumnBinding,
  TableOp,
  TableSource,
} from '../types/reporting.js';

export type RecordValues = Record<string, string>;
export interface KintoneLikeRecord {
  fields: RecordValues;
  subtables: Record<string, RecordValues[]>;
}

export interface MappingResult {
  kv: RecordValues;
  table: RecordValues[];
}

interface EvalContext {
  record: RecordValues;
  row: RecordValues | null;
}

type ExprValue = string | number | boolean | null;
type ExprNode = LiteralNode | CallNode;

interface LiteralNode {
  kind: 'literal';
  value: ExprValue;
}

interface CallNode {
  kind: 'call';
  name: string;
  args: ExprNode[];
}

interface Token {
  kind: 'ident' | 'string' | 'number' | 'boolean' | 'null' | 'comma' | 'lparen' | 'rparen';
  value: string;
}

export function mapRecordToReportData(
  record: KintoneLikeRecord,
  mapping: ReportMappingSpecV1
): MappingResult {
  const sourceRows = getSourceRows(record, mapping.table.source);
  const columnsApplied = sourceRows.map((row) => applyColumns(row, mapping.table.columns, record.fields));
  const transformed = applyTableOps(columnsApplied, mapping.table.ops ?? [], record.fields);
  const kv = buildKv(record.fields, mapping.kv_bindings);
  return { kv, table: transformed };
}

function getSourceRows(record: KintoneLikeRecord, source: TableSource): RecordValues[] {
  if (source.kind !== 'subtable') {
    throw new SVGReportError('Unsupported table source', source.kind, 'Only subtable source is supported');
  }
  return record.subtables[source.field_code] ?? [];
}

function buildKv(recordFields: RecordValues, bindings: KvBinding[]): RecordValues {
  const output: RecordValues = {};
  for (const binding of bindings) {
    output[binding.key] = stringify(evaluateExpression(binding.expr, { record: recordFields, row: null }));
  }
  return output;
}

function applyColumns(row: RecordValues, columns: TableColumnBinding[], record: RecordValues): RecordValues {
  const out: RecordValues = {};
  for (const column of columns) {
    out[column.name] = stringify(evaluateExpression(column.expr, { record, row }));
  }
  return out;
}

export function applyTableOps(
  inputRows: RecordValues[],
  ops: TableOp[],
  record: RecordValues
): RecordValues[] {
  let rows = inputRows.map((r) => ({ ...r }));
  for (const op of ops) {
    rows = applyTableOp(rows, op, record);
  }
  return rows;
}

function applyTableOp(rows: RecordValues[], op: TableOp, record: RecordValues): RecordValues[] {
  if (op.op === 'select') {
    return rows.map((row) => {
      const selected: RecordValues = {};
      for (const name of op.columns) {
        selected[name] = row[name] ?? '';
      }
      return selected;
    });
  }

  if (op.op === 'rename') {
    return rows.map((row) => {
      const renamed: RecordValues = {};
      for (const [key, value] of Object.entries(row)) {
        renamed[op.map[key] ?? key] = value;
      }
      return renamed;
    });
  }

  if (op.op === 'filter') {
    return rows.filter((row) => truthy(evaluateExpression(op.expr, { record, row })));
  }

  if (op.op === 'sort') {
    const collator = new Intl.Collator('ja-JP', { numeric: true, sensitivity: 'base' });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      for (const key of op.keys) {
        const direction = key.direction === 'desc' ? -1 : 1;
        const left = a[key.column] ?? '';
        const right = b[key.column] ?? '';
        const comp = collator.compare(left, right);
        if (comp !== 0) return comp * direction;
      }
      return 0;
    });
    return sorted;
  }

  if (op.op === 'pivot') {
    const grouped = new Map<string, RecordValues>();
    for (const row of rows) {
      const identity = op.index.map((k) => row[k] ?? '').join('\u001f');
      const pivotKey = row[op.column] ?? '';
      const pivotValue = row[op.value] ?? '';
      const base = grouped.get(identity) ?? {};
      for (const indexKey of op.index) {
        base[indexKey] = row[indexKey] ?? '';
      }
      base[pivotKey] = pivotValue;
      grouped.set(identity, base);
    }
    return [...grouped.values()];
  }

  if (op.op === 'unpivot') {
    const expanded: RecordValues[] = [];
    for (const row of rows) {
      for (const column of op.columns) {
        const base: RecordValues = {};
        for (const keep of op.keep) {
          base[keep] = row[keep] ?? '';
        }
        base[op.key_name] = column;
        base[op.value_name] = row[column] ?? '';
        expanded.push(base);
      }
    }
    return expanded;
  }

  return rows;
}

export function evaluateExpression(expr: string, context: EvalContext): ExprValue {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens);
  const node = parser.parseExpression();
  parser.ensureComplete();
  return evalNode(node, context);
}

function evalNode(node: ExprNode, context: EvalContext): ExprValue {
  if (node.kind === 'literal') return node.value;
  const args = node.args.map((arg) => evalNode(arg, context));
  switch (node.name) {
    case 'field':
      return context.record[stringify(args[0])] ?? '';
    case 'row':
    case 'col':
      return context.row?.[stringify(args[0])] ?? '';
    case 'const':
      return args[0] ?? '';
    case 'concat':
      return args.map(stringify).join('');
    case 'coalesce':
      return args.find((v) => stringify(v) !== '') ?? '';
    case 'eq':
      return stringify(args[0]) === stringify(args[1]);
    case 'ne':
      return stringify(args[0]) !== stringify(args[1]);
    case 'gt':
      return toNumber(args[0]) > toNumber(args[1]);
    case 'gte':
      return toNumber(args[0]) >= toNumber(args[1]);
    case 'lt':
      return toNumber(args[0]) < toNumber(args[1]);
    case 'lte':
      return toNumber(args[0]) <= toNumber(args[1]);
    case 'contains':
      return stringify(args[0]).includes(stringify(args[1]));
    case 'and':
      return args.every(truthy);
    case 'or':
      return args.some(truthy);
    case 'not':
      return !truthy(args[0]);
    case 'if':
      return truthy(args[0]) ? (args[1] ?? '') : (args[2] ?? '');
    default:
      throw new SVGReportError('Unknown expression function', node.name, exprFunctionHint(node.name));
  }
}

function exprFunctionHint(name: string): string {
  return `Unsupported function "${name}". Use field,row,col,const,concat,coalesce,eq,ne,gt,gte,lt,lte,contains,and,or,not,if`;
}

function toNumber(value: ExprValue): number {
  const num = Number.parseFloat(stringify(value));
  if (Number.isNaN(num)) return 0;
  return num;
}

function stringify(value: ExprValue): string {
  if (value === null) return '';
  return String(value);
}

function truthy(value: ExprValue): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return stringify(value).trim() !== '' && stringify(value) !== 'false' && stringify(value) !== '0';
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ch });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      const quote = ch;
      i += 1;
      let value = '';
      while (i < input.length) {
        const next = input[i];
        if (next === '\\') {
          const escaped = input[i + 1] ?? '';
          value += escaped;
          i += 2;
          continue;
        }
        if (next === quote) break;
        value += next;
        i += 1;
      }
      if (input[i] !== quote) {
        throw new SVGReportError('Expression parse error', input, 'Unterminated string literal');
      }
      i += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i));
    if (identMatch) {
      const ident = identMatch[0];
      i += ident.length;
      if (ident === 'true' || ident === 'false') {
        tokens.push({ kind: 'boolean', value: ident });
      } else if (ident === 'null') {
        tokens.push({ kind: 'null', value: ident });
      } else {
        tokens.push({ kind: 'ident', value: ident });
      }
      continue;
    }
    const numMatch = /^-?\d+(?:\.\d+)?/.exec(input.slice(i));
    if (numMatch) {
      tokens.push({ kind: 'number', value: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }
    throw new SVGReportError('Expression parse error', input, `Unexpected token near "${input.slice(i, i + 16)}"`);
  }
  return tokens;
}

class Parser {
  constructor(private tokens: Token[], private pos = 0) {}

  parseExpression(): ExprNode {
    const token = this.peek();
    if (!token) {
      throw new SVGReportError('Expression parse error', '', 'Empty expression');
    }
    if (token.kind === 'string') {
      this.pos += 1;
      return { kind: 'literal', value: token.value };
    }
    if (token.kind === 'number') {
      this.pos += 1;
      return { kind: 'literal', value: Number.parseFloat(token.value) };
    }
    if (token.kind === 'boolean') {
      this.pos += 1;
      return { kind: 'literal', value: token.value === 'true' };
    }
    if (token.kind === 'null') {
      this.pos += 1;
      return { kind: 'literal', value: null };
    }
    if (token.kind === 'ident') {
      this.pos += 1;
      const name = token.value;
      this.expect('lparen');
      const args: ExprNode[] = [];
      if (!this.match('rparen')) {
        do {
          args.push(this.parseExpression());
        } while (this.match('comma'));
        this.expect('rparen');
      }
      return { kind: 'call', name, args };
    }
    throw new SVGReportError('Expression parse error', token.value, `Unexpected token kind: ${token.kind}`);
  }

  ensureComplete(): void {
    if (this.pos !== this.tokens.length) {
      const next = this.tokens[this.pos];
      throw new SVGReportError('Expression parse error', next.value, 'Trailing tokens detected');
    }
  }

  private peek(): Token | null {
    return this.tokens[this.pos] ?? null;
  }

  private match(kind: Token['kind']): boolean {
    const token = this.peek();
    if (token && token.kind === kind) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expect(kind: Token['kind']): void {
    const token = this.peek();
    if (!token || token.kind !== kind) {
      throw new SVGReportError('Expression parse error', token?.value, `Expected ${kind}`);
    }
    this.pos += 1;
  }
}

