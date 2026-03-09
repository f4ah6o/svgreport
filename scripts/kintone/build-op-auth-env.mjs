#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const itemTitle = args.item || 'kintone帳票';
const outFile = args['out-file'] || '.tmp/kintone/op-auth.env';

const itemJsonText = execFileSync('op', ['item', 'get', itemTitle, '--format', 'json'], { encoding: 'utf-8' });
const item = JSON.parse(itemJsonText);

const username = readFieldValue(item, 'username');
const password = readFieldValue(item, 'credential');
const baseUrl = readFieldValue(item, 'KINTONE_BASE_URL');

if (!username) {
  console.error('Missing field "username" in 1Password item');
  process.exit(2);
}
if (!password) {
  console.error('Missing field "credential" in 1Password item');
  process.exit(2);
}
if (!baseUrl) {
  console.error('Missing field "KINTONE_BASE_URL" in 1Password item');
  process.exit(2);
}

await mkdir(path.dirname(outFile), { recursive: true });
const content = [
  `username=${shellEscape(username)}`,
  `password=${shellEscape(password)}`,
  `KINTONE_BASE_URL=${shellEscape(baseUrl)}`,
].join('\n') + '\n';
await writeFile(outFile, content, 'utf-8');
console.log(`Generated auth env: ${outFile}`);

function readFieldValue(itemJson, label) {
  const field = (itemJson.fields || []).find((f) => f.label === label);
  if (!field) return '';
  if (field.value !== undefined && field.value !== null && String(field.value) !== '') {
    return String(field.value);
  }
  if (!field.reference) return '';
  return execFileSync('op', ['read', field.reference], { encoding: 'utf-8' }).trim();
}

function shellEscape(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    parsed[token.slice(2)] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

