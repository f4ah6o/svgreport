#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error('Usage: check-deploy-status.mjs --file <deploy-status.json>');
  process.exit(2);
}

const json = JSON.parse(await readFile(args.file, 'utf-8'));
const apps = Array.isArray(json.apps) ? json.apps : [];
if (apps.length === 0) {
  console.error('No deploy status payload found');
  process.exit(1);
}

let hasProcessing = false;
for (const app of apps) {
  const appId = app.app ?? '(unknown)';
  const status = app.status ?? '(none)';
  console.log(`app=${appId} status=${status}`);
  if (status === 'FAIL') process.exit(1);
  if (status !== 'SUCCESS') hasProcessing = true;
}

if (hasProcessing) {
  process.exit(10);
}

process.exit(0);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    parsed[item.slice(2)] = argv[i + 1];
    i += 1;
  }
  return parsed;
}

