#!/usr/bin/env node
// scripts/create-test-job.ts
// Create test job zip from example data

import JSZip from 'jszip';
import fs from 'fs/promises';
import path from 'path';

async function createJobZip(itemsFile = 'items.csv') {
  const zip = new JSZip();
  
  const baseDir = 'examples/invoice-job';
  
  // Add manifest
  zip.file('manifest.json', await fs.readFile(path.join(baseDir, 'manifest.json'), 'utf-8'));
  
  // Add meta
  zip.file('meta.csv', await fs.readFile(path.join(baseDir, 'meta.csv'), 'utf-8'));
  
  // Add items
  zip.file('items.csv', await fs.readFile(path.join(baseDir, itemsFile), 'utf-8'));
  
  // Generate zip
  const content = await zip.generateAsync({ type: 'nodebuffer' });
  const outputName = itemsFile === 'items.csv' ? 'test-job.zip' : 'test-job-multi.zip';
  await fs.writeFile(outputName, content);
  
  console.log(`Created: ${outputName}`);
}

createJobZip(process.argv[2] || 'items.csv').catch(console.error);
