// core/svg-id-reindexer.ts
// Reindex text element IDs in SVG files

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as fs from 'fs/promises';
import { SVGReportError } from '../types/index.js';

export interface SvgReindexResult {
  updated: boolean;
  mapping: Array<{ oldId: string | null; newId: string; domIndex: number }>;
  duplicateOldIds: string[];
  writtenPath: string;
}

/**
 * Reindex all <text> IDs in SVG and persist file atomically.
 * New IDs are generated as `${prefix}${index}` with conflict resolution.
 */
export async function reindexSvgTextIds(
  inputPath: string,
  prefix = 'text_'
): Promise<SvgReindexResult> {
  const idPrefix = typeof prefix === 'string' && prefix.length > 0 ? prefix : 'text_';

  const content = await fs.readFile(inputPath, 'utf-8');
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg) {
    throw new SVGReportError('Invalid SVG file', inputPath);
  }

  const allElements = Array.from(svg.getElementsByTagName('*'));
  const textNodes = Array.from(svg.getElementsByTagName('text'));
  const textSet = new Set<Element>(textNodes);
  const existingIds = new Set<string>();

  for (const el of allElements) {
    if (textSet.has(el)) continue;
    const id = el.getAttribute('id');
    if (id) existingIds.add(id);
  }

  const oldIdCounts = new Map<string, number>();
  for (const text of textNodes) {
    const id = text.getAttribute('id');
    if (!id) continue;
    oldIdCounts.set(id, (oldIdCounts.get(id) || 0) + 1);
  }

  const duplicateOldIds = Array.from(oldIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const mapping: Array<{ oldId: string | null; newId: string; domIndex: number }> = [];
  let updated = false;

  for (let i = 0; i < textNodes.length; i += 1) {
    const text = textNodes[i];
    const oldId = text.getAttribute('id');
    const base = `${idPrefix}${i + 1}`;
    let candidate = base;
    let counter = 2;
    while (existingIds.has(candidate)) {
      candidate = `${base}_${counter}`;
      counter += 1;
    }
    existingIds.add(candidate);
    if (!oldId || oldId !== candidate) {
      text.setAttribute('id', candidate);
      updated = true;
    }
    mapping.push({ oldId: oldId || null, newId: candidate, domIndex: i + 1 });
  }

  if (updated) {
    const serializer = new XMLSerializer();
    const updatedContent = serializer.serializeToString(doc);
    const tempPath = `${inputPath}.tmp`;
    await fs.writeFile(tempPath, updatedContent, 'utf-8');
    await fs.rename(tempPath, inputPath);
  }

  return {
    updated,
    mapping,
    duplicateOldIds,
    writtenPath: inputPath,
  };
}
