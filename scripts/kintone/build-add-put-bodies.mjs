#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const args = parseArgs(process.argv.slice(2));
if (!args.current || !args.desired || !args.app || !args['out-add'] || !args['out-put']) {
  console.error('Usage: build-add-put-bodies.mjs --current <json> --desired <json> --app <id> --out-add <json> --out-put <json>');
  process.exit(2);
}

const currentRaw = JSON.parse(await readFile(args.current, 'utf-8'));
const desired = JSON.parse(await readFile(args.desired, 'utf-8'));
const app = Number.parseInt(args.app, 10);

if (!Number.isFinite(app) || app <= 0) {
  console.error(`Invalid app id: ${args.app}`);
  process.exit(2);
}

const current = currentRaw.properties ?? {};
const addProperties = {};

for (const [code, fieldDef] of Object.entries(desired)) {
  if (!current[code]) {
    addProperties[code] = fieldDef;
  }
}

const addBody = { app, properties: addProperties };
const putBody = { app, properties: desired };

await writeFile(args['out-add'], JSON.stringify(addBody), 'utf-8');
await writeFile(args['out-put'], JSON.stringify(putBody), 'utf-8');

console.log(`Prepared add/put payloads: add=${Object.keys(addProperties).length}, put=${Object.keys(desired).length}`);

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

