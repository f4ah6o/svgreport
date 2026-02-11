import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import test from 'node:test';
import { extractTextElements } from './text-inspector.js';

async function writeTempSvg(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'svgpaper-text-inspector-'));
  const svgPath = path.join(dir, 'page-1.svg');
  await fs.writeFile(svgPath, content, 'utf-8');
  return svgPath;
}

test('extractTextElements extracts normal text nodes', async () => {
  const svgPath = await writeTempSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">
      <text x="10" y="20">Hello</text>
    </svg>
  `);

  const analysis = await extractTextElements(svgPath);
  assert.equal(analysis.statistics.total, 1);
  assert.ok([null, ''].includes(analysis.textElements[0]?.textAnchor ?? ''));
  assert.equal(analysis.textElements[0]?.isPath, false);
  assert.equal(analysis.textElements[0]?.content, 'Hello');
});

test('extractTextElements falls back to glyph <use> nodes when <text> is missing', async () => {
  const svgPath = await writeTempSvg(`
    <svg xmlns="http://www.w3.org/2000/svg"
         xmlns:xlink="http://www.w3.org/1999/xlink"
         width="120"
         height="60">
      <defs>
        <g id="glyph-0">
          <path d="M 0 0 L 5 0 L 5 -8 L 0 -8 Z" />
        </g>
      </defs>
      <use xlink:href="#glyph-0" x="10" y="20" />
      <use xlink:href="#glyph-0" x="20" y="20" />
      <use xlink:href="#glyph-0" x="30" y="20" />
      <use xlink:href="#glyph-0" x="80" y="20" />
      <use xlink:href="#glyph-0" x="90" y="20" />
      <use xlink:href="#glyph-0" x="150" y="20" />
    </svg>
  `);

  const analysis = await extractTextElements(svgPath);
  assert.equal(analysis.statistics.total, 3);
  assert.equal(analysis.textElements.every((el) => el.isPath), true);
  assert.equal(analysis.textElements.every((el) => Boolean(el.bbox)), true);
  assert.equal(analysis.warnings.some((w) => w.includes('Fallback detected')), true);
  assert.equal(analysis.textElements[0]?.x, 10);
  assert.equal(analysis.textElements[1]?.x, 80);
});

test('extractTextElements avoids over-splitting compact glyph runs while keeping wide gaps split', async () => {
  const svgPath = await writeTempSvg(`
    <svg xmlns="http://www.w3.org/2000/svg"
         xmlns:xlink="http://www.w3.org/1999/xlink"
         width="220"
         height="80">
      <defs>
        <g id="glyph-0">
          <path d="M 0 0 L 5 0 L 5 -8 L 0 -8 Z" />
        </g>
      </defs>
      <!-- compact CJK-like run that should stay merged -->
      <use xlink:href="#glyph-0" x="10" y="30" />
      <use xlink:href="#glyph-0" x="18" y="30" />
      <use xlink:href="#glyph-0" x="30" y="30" />
      <!-- wide field gap that should split -->
      <use xlink:href="#glyph-0" x="76" y="30" />
      <use xlink:href="#glyph-0" x="84" y="30" />
      <use xlink:href="#glyph-0" x="92" y="30" />
    </svg>
  `);

  const analysis = await extractTextElements(svgPath);
  assert.equal(analysis.statistics.total, 2);
  assert.equal(analysis.textElements[0]?.x, 10);
  assert.equal(analysis.textElements[1]?.x, 76);
});
