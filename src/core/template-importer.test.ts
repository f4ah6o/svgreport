import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { importPdfTemplate } from './template-importer.js';

test('importPdfTemplate rejects invalid template id', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svgpaper-import-test-'));
  await assert.rejects(
    importPdfTemplate({
      templateId: 'invalid id',
      version: 'v1',
      baseDir,
      pdfBuffer: Buffer.from('dummy'),
    }),
    (error) => {
      return error instanceof Error && error.message === 'Invalid template ID';
    }
  );
});

test('importPdfTemplate rejects invalid version', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svgpaper-import-test-'));
  await assert.rejects(
    importPdfTemplate({
      templateId: 'invoice',
      version: 'v/1',
      baseDir,
      pdfBuffer: Buffer.from('dummy'),
    }),
    (error) => {
      return error instanceof Error && error.message === 'Invalid version';
    }
  );
});

test('importPdfTemplate returns ID_CONFLICT when target already exists', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svgpaper-import-test-'));
  const target = path.join(baseDir, 'invoice', 'v1');
  await fs.mkdir(target, { recursive: true });

  await assert.rejects(
    importPdfTemplate({
      templateId: 'invoice',
      version: 'v1',
      baseDir,
      pdfBuffer: Buffer.from('dummy'),
    }),
    (error) => {
      if (!(error instanceof Error)) return false;
      return 'reason' in error && (error as Error & { reason?: string }).reason === 'ID_CONFLICT';
    }
  );
});
