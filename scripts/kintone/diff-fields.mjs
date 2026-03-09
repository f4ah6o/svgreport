#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
const label = args.label || 'app';
const strict = args.strict === 'true';

if (!args.current || !args.desired) {
  console.error('Usage: diff-fields.mjs --current <file> --desired <file> [--label <name>] [--strict true|false]');
  process.exit(2);
}

const currentRaw = JSON.parse(await readFile(args.current, 'utf-8'));
const desired = JSON.parse(await readFile(args.desired, 'utf-8'));
const current = currentRaw.properties ?? {};

const missing = [];
const typeMismatch = [];
const optionMismatch = [];

for (const [code, desiredField] of Object.entries(desired)) {
  const currentField = current[code];
  if (!currentField) {
    missing.push(code);
    continue;
  }
  if ((currentField.type ?? '') !== desiredField.type) {
    typeMismatch.push({
      code,
      expected: desiredField.type,
      actual: currentField.type ?? '(none)',
    });
  }
  if (desiredField.type === 'DROP_DOWN') {
    const expectedOptions = Object.keys(desiredField.options ?? {}).sort();
    const actualOptions = Object.keys(currentField.options ?? {}).sort();
    if (expectedOptions.join('\u0001') !== actualOptions.join('\u0001')) {
      optionMismatch.push({
        code,
        expected: expectedOptions,
        actual: actualOptions,
      });
    }
  }
}

console.log(`[${label}] missing fields: ${missing.length}`);
for (const fieldCode of missing) {
  console.log(`  - ${fieldCode}`);
}

console.log(`[${label}] type mismatches: ${typeMismatch.length}`);
for (const item of typeMismatch) {
  console.log(`  - ${item.code}: expected=${item.expected} actual=${item.actual}`);
}

console.log(`[${label}] option mismatches: ${optionMismatch.length}`);
for (const item of optionMismatch) {
  console.log(`  - ${item.code}: expected=[${item.expected.join(',')}] actual=[${item.actual.join(',')}]`);
}

if (strict && (missing.length > 0 || typeMismatch.length > 0 || optionMismatch.length > 0)) {
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    parsed[key] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

