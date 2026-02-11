// core/text-inspector.ts
// Extract and analyze text elements from SVG for template editing

import * as fs from 'fs/promises';
import * as path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { SVGReportError } from '../types/index.js';

export interface TextElementInfo {
  id: string | null;
  content: string;
  x: number;
  y: number;
  domIndex: number;
  textAnchor: string | null;
  fontSize: number | null;
  fontFamily: string | null;
  suggestedId: string;
  isPath: boolean;
  parentGroup?: string;
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface SvgTextAnalysis {
  file: string;
  pageSize: {
    width: number;
    height: number;
    unit: string;
  };
  textElements: TextElementInfo[];
  statistics: {
    total: number;
    withId: number;
    withoutId: number;
    pathText: number;
    averageFontSize: number | null;
  };
  warnings: string[];
}

export interface ExtractTextOptions {
  glyphSplitProfile?: 'balanced' | 'split' | 'merge';
}

/**
 * Extract text elements from SVG file
 */
export async function extractTextElements(svgPath: string, options: ExtractTextOptions = {}): Promise<SvgTextAnalysis> {
  const content = await fs.readFile(svgPath, 'utf-8');
  
  const parser = new DOMParser({
    errorHandler: (level, msg) => {
      if (level === 'error') {
        throw new SVGReportError('Failed to parse SVG', svgPath, msg);
      }
    },
  });

  const doc = parser.parseFromString(content, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg || svg.tagName !== 'svg') {
    throw new SVGReportError('Invalid SVG - no root svg element', svgPath);
  }

  // Get page dimensions
  const width = svg.getAttribute('width') || '0';
  const height = svg.getAttribute('height') || '0';
  const viewBox = svg.getAttribute('viewBox');

  let widthNum = parseFloat(width);
  let heightNum = parseFloat(height);
  let unit = 'px';

  // Try to extract from viewBox if dimensions not set
  if ((!widthNum || !heightNum) && viewBox) {
    const parts = viewBox.split(/\s+/).map(parseFloat);
    if (parts.length === 4) {
      widthNum = parts[2];
      heightNum = parts[3];
    }
  }

  // Detect unit
  if (width.includes('mm')) unit = 'mm';
  else if (width.includes('pt')) unit = 'pt';
  else if (width.includes('cm')) unit = 'cm';

  // Extract text elements
  const textElements: TextElementInfo[] = [];
  const textNodes = Array.from(svg.getElementsByTagName('text'));
  const classFontSizes = extractClassFontSizes(svg);
  const warnings: string[] = [];
  let fontSizeSum = 0;
  let fontSizeCount = 0;
  let glyphPathCount = 0;

  if (textNodes.length > 0) {
    for (let i = 0; i < textNodes.length; i += 1) {
      const text = textNodes[i];
      const id = text.getAttribute('id');
      const textContent = text.textContent?.trim() || '';
      const localX = parseFloat(text.getAttribute('x') || '0');
      const localY = parseFloat(text.getAttribute('y') || '0');
      const textAnchor = text.getAttribute('text-anchor');
      const fontSize = text.getAttribute('font-size');
      const fontFamily = text.getAttribute('font-family');

      // Calculate font size
      const fontSizeNum = resolveFontSize(text, fontSize, classFontSizes);
      if (fontSizeNum) {
        fontSizeSum += fontSizeNum;
        fontSizeCount++;
      }

      // Generate suggested ID
      const matrix = getCumulativeTransformMatrix(text);
      const point = applyMatrixToPoint(matrix, localX, localY);
      const suggestedId = generateSuggestedId(textContent, point.x, point.y);

      textElements.push({
        id,
        content: textContent,
        x: point.x,
        y: point.y,
        domIndex: i + 1,
        textAnchor,
        fontSize: fontSizeNum,
        fontFamily,
        suggestedId,
        isPath: false,
        parentGroup: findParentGroupId(text),
      });
    }
  } else {
    const fallback = extractGlyphUseElements(svg, warnings, options);
    glyphPathCount = fallback.glyphCount;
    textElements.push(...fallback.elements);
    for (const el of fallback.elements) {
      if (el.fontSize) {
        fontSizeSum += el.fontSize;
        fontSizeCount += 1;
      }
    }
  }

  // Check for path-based text (text converted to paths - common in PDF conversion)
  const pathNodes = Array.from(svg.getElementsByTagName('path'));
  let pathTextCount = 0;

  for (const path of pathNodes) {
    const id = path.getAttribute('id') || '';
    // Heuristic: paths with text-related IDs or classes
    if (id.match(/text|label|caption|title|header/i) ||
        path.getAttribute('class')?.match(/text|font/i)) {
      pathTextCount++;
    }
  }

  pathTextCount = Math.max(pathTextCount, glyphPathCount);

  if (pathTextCount > 0 && glyphPathCount === 0) {
    warnings.push(`Found ${pathTextCount} potential text-as-path elements. These may need to be converted to <text> elements for data binding.`);
  }

  // Sort by Y position (top to bottom), then X position (left to right)
  textElements.sort((a, b) => {
    if (Math.abs(a.y - b.y) < 5) { // Within 5 units, sort by X
      return a.x - b.x;
    }
    return a.y - b.y;
  });

  // Calculate statistics
  const withId = textElements.filter(t => t.id).length;
  const withoutId = textElements.filter(t => !t.id).length;

  return {
    file: svgPath,
    pageSize: {
      width: widthNum,
      height: heightNum,
      unit,
    },
    textElements,
    statistics: {
      total: textElements.length,
      withId,
      withoutId,
      pathText: pathTextCount,
      averageFontSize: fontSizeCount > 0 ? fontSizeSum / fontSizeCount : null,
    },
    warnings,
  };
}

function extractGlyphUseElements(svg: Element, warnings: string[], options: ExtractTextOptions): { elements: TextElementInfo[]; glyphCount: number } {
  const useNodes = Array.from(svg.getElementsByTagName('use'));
  const glyphUses: Array<{
    element: Element;
    id: string | null;
    domIndex: number;
    x: number;
    y: number;
    parentGroup?: string;
  }> = [];

  for (let i = 0; i < useNodes.length; i += 1) {
    const use = useNodes[i];
    const href = getUseHref(use);
    if (!href || !/^#glyph-/i.test(href)) continue;

    const localX = parseFloat(use.getAttribute('x') || '0');
    const localY = parseFloat(use.getAttribute('y') || '0');
    const matrix = getCumulativeTransformMatrix(use);
    const point = applyMatrixToPoint(matrix, localX, localY);

    glyphUses.push({
      element: use,
      id: use.getAttribute('id'),
      domIndex: i + 1,
      x: point.x,
      y: point.y,
      parentGroup: findParentGroupId(use),
    });
  }

  if (glyphUses.length === 0) {
    return { elements: [], glyphCount: 0 };
  }

  warnings.push(`No <text> elements found. Fallback detected ${glyphUses.length} glyph nodes from <use> references.`);

  const idBackedCount = glyphUses.reduce((count, glyph) => count + (glyph.id ? 1 : 0), 0);
  const idBackedRatio = idBackedCount / glyphUses.length;
  if (idBackedRatio >= 0.7) {
    const elements = extractIdBackedGlyphElements(glyphUses);
    warnings.push(`Detected ID-backed glyph uses. Kept ${elements.length} <use> nodes as separate candidates.`);
    return { elements, glyphCount: glyphUses.length };
  }

  const sortedByY = [...glyphUses].sort((a, b) => {
    if (Math.abs(a.y - b.y) < 0.01) return a.x - b.x;
    return a.y - b.y;
  });

  const lines: Array<{ y: number; glyphs: typeof glyphUses }> = [];
  const yTolerance = 1.5;
  for (const glyph of sortedByY) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine || Math.abs(glyph.y - lastLine.y) > yTolerance) {
      lines.push({ y: glyph.y, glyphs: [glyph] });
      continue;
    }
    lastLine.glyphs.push(glyph);
    const n = lastLine.glyphs.length;
    lastLine.y = ((lastLine.y * (n - 1)) + glyph.y) / n;
  }

  const elements: TextElementInfo[] = [];

  const profile = options.glyphSplitProfile || 'balanced';

  for (const line of lines) {
    const glyphs = [...line.glyphs].sort((a, b) => a.x - b.x);
    if (glyphs.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < glyphs.length; i += 1) {
      const gap = glyphs[i].x - glyphs[i - 1].x;
      if (gap > 0.1) gaps.push(gap);
    }
    const typicalStep = computeTypicalStep(gaps);
    // Keep initial split fairly strict for table headers, then relax only when
    // the line looks heavily over-split (e.g. CJK words split per glyph).
    const splitGap = profile === 'split'
      ? Math.max(6, typicalStep * 1.15, typicalStep + 1)
      : profile === 'merge'
        ? Math.max(12, typicalStep * 1.9, typicalStep + 5)
        : Math.max(6.8, typicalStep * 1.22, typicalStep + 1.2);
    let runs = splitGlyphRuns(glyphs, splitGap);

    if (profile === 'split') {
      const refinedRuns: typeof runs = [];
      for (const run of runs) {
        refinedRuns.push(...splitRunByLargeGaps(run, typicalStep));
      }
      runs = refinedRuns;
    }

    const singleGlyphRuns = runs.reduce((count, run) => count + (run.length === 1 ? 1 : 0), 0);
    const looksOverSplit = runs.length >= 3 && singleGlyphRuns / runs.length >= 0.6;
    if (looksOverSplit && profile !== 'split') {
      const relaxedSplitGap = Math.max(12, typicalStep * 1.8, typicalStep + 5);
      if (relaxedSplitGap > splitGap) {
        const relaxedRuns = splitGlyphRuns(glyphs, relaxedSplitGap);
        if (relaxedRuns.length < runs.length) {
          runs = relaxedRuns;
        }
      }
    }

    // Second-stage merge for CJK-like short-run fragmentation while preserving wide column gaps.
    const avgRunLen = runs.length > 0 ? glyphs.length / runs.length : glyphs.length;
    const shouldMergeNearby = profile !== 'split' && runs.length >= 3 && (looksOverSplit || avgRunLen <= 2.35);
    if (shouldMergeNearby) {
      const mergeGap = Math.max(14.2, typicalStep * 2.0, typicalStep + 6.2);
      const mergedRuns = mergeNearbyRuns(runs, mergeGap, typicalStep);
      if (mergedRuns.length < runs.length) {
        runs = mergedRuns;
      }
    }

    for (const run of runs) {
      const first = run[0];
      const last = run[run.length - 1];
      const runGaps: number[] = [];
      for (let i = 1; i < run.length; i += 1) {
        const gap = run[i].x - run[i - 1].x;
        if (gap > 0.1) runGaps.push(gap);
      }
      const runStep = computeTypicalStep(runGaps.length > 0 ? runGaps : [typicalStep]);
      const fontSize = clamp(runStep * 1.8, 8, 24);
      const width = Math.max(runStep, (last.x - first.x) + runStep);
      const height = Math.max(6, fontSize * 1.2);
      const suggestedId = generateSuggestedId('', first.x, first.y);

      elements.push({
        id: first.id,
        content: '',
        x: first.x,
        y: first.y,
        domIndex: first.domIndex,
        textAnchor: 'start',
        fontSize,
        fontFamily: null,
        suggestedId,
        isPath: true,
        parentGroup: first.parentGroup,
        bbox: {
          x: first.x,
          y: first.y - fontSize,
          w: width,
          h: height,
        },
      });
    }
  }

  warnings.push(`Grouped glyph nodes into ${elements.length} candidate text segments.`);
  return { elements, glyphCount: glyphUses.length };
}

function extractIdBackedGlyphElements(
  glyphUses: Array<{
    id: string | null;
    domIndex: number;
    x: number;
    y: number;
    parentGroup?: string;
  }>,
): TextElementInfo[] {
  const sortedByY = [...glyphUses].sort((a, b) => {
    if (Math.abs(a.y - b.y) < 0.01) return a.x - b.x;
    return a.y - b.y;
  });
  const lines: Array<{ y: number; glyphs: typeof glyphUses }> = [];
  const yTolerance = 1.5;
  for (const glyph of sortedByY) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine || Math.abs(glyph.y - lastLine.y) > yTolerance) {
      lines.push({ y: glyph.y, glyphs: [glyph] });
      continue;
    }
    lastLine.glyphs.push(glyph);
    const n = lastLine.glyphs.length;
    lastLine.y = ((lastLine.y * (n - 1)) + glyph.y) / n;
  }

  const elements: TextElementInfo[] = [];
  for (const line of lines) {
    const glyphs = [...line.glyphs].sort((a, b) => a.x - b.x);
    if (glyphs.length === 0) continue;
    const lineGaps: number[] = [];
    for (let i = 1; i < glyphs.length; i += 1) {
      const gap = glyphs[i].x - glyphs[i - 1].x;
      if (gap > 0.1) lineGaps.push(gap);
    }
    const lineStep = computeTypicalStep(lineGaps);

    for (let i = 0; i < glyphs.length; i += 1) {
      const glyph = glyphs[i];
      const prevGap = i > 0 ? glyph.x - glyphs[i - 1].x : lineStep;
      const nextGap = i < glyphs.length - 1 ? glyphs[i + 1].x - glyph.x : lineStep;
      const localStep = computeTypicalStep([prevGap, nextGap, lineStep]);
      const fontSize = clamp(localStep * 1.6, 8, 24);
      // ID-backed glyphs from PDF often represent narrower visual units.
      // Keep bbox compact to avoid coarse merged-looking targets.
      const width = clamp(Math.min(prevGap, nextGap, lineStep * 0.95), 4.5, 24);
      const height = Math.max(6, fontSize * 1.2);
      elements.push({
        id: glyph.id,
        content: '',
        x: glyph.x,
        y: glyph.y,
        domIndex: glyph.domIndex,
        textAnchor: 'start',
        fontSize,
        fontFamily: null,
        suggestedId: generateSuggestedId('', glyph.x, glyph.y),
        isPath: true,
        parentGroup: glyph.parentGroup,
        bbox: {
          x: glyph.x,
          y: glyph.y - fontSize,
          w: width,
          h: height,
        },
      });
    }
  }
  return elements;
}

function getUseHref(use: Element): string | null {
  return use.getAttribute('href') || use.getAttribute('xlink:href');
}

function findParentGroupId(element: Element): string | undefined {
  let parent = element.parentNode;
  while (parent && parent.nodeType === 1) {
    const el = parent as Element;
    if (el.tagName === 'g') {
      const gid = el.getAttribute('id');
      if (gid) return gid;
    }
    parent = parent.parentNode;
  }
  return undefined;
}

function computeTypicalStep(values: number[]): number {
  const normalized = values
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (normalized.length === 0) return 6;

  const sampleCount = Math.max(1, Math.floor((normalized.length + 1) / 2));
  const sample = normalized.slice(0, sampleCount);
  return median(sample);
}

function splitGlyphRuns<T extends { x: number }>(glyphs: T[], splitGap: number): T[][] {
  const runs: T[][] = [];
  let currentRun: T[] = [];
  for (const glyph of glyphs) {
    if (currentRun.length === 0) {
      currentRun = [glyph];
      continue;
    }
    const prev = currentRun[currentRun.length - 1];
    const gap = glyph.x - prev.x;
    if (gap > splitGap) {
      runs.push(currentRun);
      currentRun = [glyph];
    } else {
      currentRun.push(glyph);
    }
  }
  if (currentRun.length > 0) runs.push(currentRun);
  return runs;
}

function splitRunByLargeGaps<T extends { x: number }>(run: T[], typicalStep: number): T[][] {
  if (run.length < 3) return [run];
  const gaps: number[] = [];
  for (let i = 1; i < run.length; i += 1) {
    const gap = run[i].x - run[i - 1].x;
    if (gap > 0.1) gaps.push(gap);
  }
  if (gaps.length === 0) return [run];
  const sorted = [...gaps].sort((a, b) => a - b);
  const sampleCount = Math.max(1, Math.floor((sorted.length + 1) / 2));
  const baseGap = median(sorted.slice(0, sampleCount));
  const splitThreshold = Math.max(typicalStep * 1.15, baseGap * 1.9, baseGap + 1.5);

  const out: T[][] = [];
  let current: T[] = [run[0]];
  for (let i = 1; i < run.length; i += 1) {
    const gap = run[i].x - run[i - 1].x;
    if (gap > splitThreshold) {
      out.push(current);
      current = [run[i]];
      continue;
    }
    current.push(run[i]);
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [run];
}

function mergeNearbyRuns<T extends { x: number }>(runs: T[][], mergeGap: number, typicalStep: number): T[][] {
  if (runs.length <= 1) return runs;
  const merged: T[][] = [];
  let current = [...runs[0]];
  for (let i = 1; i < runs.length; i += 1) {
    const next = runs[i];
    if (current.length === 0 || next.length === 0) continue;
    const prevLast = current[current.length - 1];
    const nextFirst = next[0];
    const gap = nextFirst.x - prevLast.x;
    const strictGapForMultiRuns = Math.max(typicalStep * 1.45, typicalStep + 2);
    const bothAreMultiGlyph = current.length >= 2 && next.length >= 2;
    const allowedGap = bothAreMultiGlyph ? Math.min(mergeGap, strictGapForMultiRuns) : mergeGap;
    if (gap <= allowedGap) {
      current = [...current, ...next];
      continue;
    }
    merged.push(current);
    current = [...next];
  }
  if (current.length > 0) merged.push(current);
  return merged;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveFontSize(text: Element, inlineFontSize: string | null, classFontSizes: Map<string, number>): number | null {
  const inline = inlineFontSize ? parseFloat(inlineFontSize) : NaN;
  if (!Number.isNaN(inline)) return inline;

  const styleAttr = text.getAttribute('style') || '';
  const styleMatch = styleAttr.match(/font-size\s*:\s*([0-9.]+)(px|pt|mm|cm)?/i);
  if (styleMatch) {
    const size = parseFloat(styleMatch[1]);
    if (!Number.isNaN(size)) return size;
  }

  const classAttr = text.getAttribute('class') || '';
  const classes = classAttr.split(/\s+/).filter(Boolean);
  for (const cls of classes) {
    const size = classFontSizes.get(cls);
    if (size !== undefined) return size;
  }

  return null;
}

function extractClassFontSizes(svg: Element): Map<string, number> {
  const map = new Map<string, number>();
  const styleNodes = Array.from(svg.getElementsByTagName('style'));

  for (const styleNode of styleNodes) {
    const css = styleNode.textContent || '';
    const ruleRegex = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
    let ruleMatch: RegExpExecArray | null;
    while ((ruleMatch = ruleRegex.exec(css)) !== null) {
      const className = ruleMatch[1];
      const declarations = ruleMatch[2];
      const sizeMatch = declarations.match(/font-size\s*:\s*([0-9.]+)(px|pt|mm|cm)?/i);
      if (!sizeMatch) continue;
      const size = parseFloat(sizeMatch[1]);
      if (!Number.isNaN(size)) {
        map.set(className, size);
      }
    }
  }

  return map;
}

type Matrix2D = [number, number, number, number, number, number];

function getCumulativeTransformMatrix(element: Element): Matrix2D {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.push(current);
    const parent: Node | null = current.parentNode;
    current = parent && parent.nodeType === 1 ? parent as Element : null;
  }

  // root -> leaf
  chain.reverse();
  let matrix: Matrix2D = [1, 0, 0, 1, 0, 0];
  for (const node of chain) {
    const transform = node.getAttribute('transform');
    if (!transform) continue;
    const local = parseTransform(transform);
    matrix = multiplyMatrix(matrix, local);
  }
  return matrix;
}

function parseTransform(input: string): Matrix2D {
  let matrix: Matrix2D = [1, 0, 0, 1, 0, 0];
  const fnRegex = /([a-zA-Z]+)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = fnRegex.exec(input)) !== null) {
    const fn = match[1].toLowerCase();
    const values = match[2]
      .split(/[,\s]+/)
      .map(v => v.trim())
      .filter(Boolean)
      .map(v => parseFloat(v))
      .filter(v => !Number.isNaN(v));

    let local: Matrix2D = [1, 0, 0, 1, 0, 0];

    if (fn === 'matrix' && values.length >= 6) {
      local = [values[0], values[1], values[2], values[3], values[4], values[5]];
    } else if (fn === 'translate' && values.length >= 1) {
      local = [1, 0, 0, 1, values[0], values[1] || 0];
    } else if (fn === 'scale' && values.length >= 1) {
      local = [values[0], 0, 0, values[1] ?? values[0], 0, 0];
    } else {
      continue;
    }

    matrix = multiplyMatrix(matrix, local);
  }

  return matrix;
}

function multiplyMatrix(a: Matrix2D, b: Matrix2D): Matrix2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyMatrixToPoint(m: Matrix2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

/**
 * Generate a suggested ID from text content and position
 */
function generateSuggestedId(content: string, x: number, y: number): string {
  if (!content) {
    return `text_${Math.round(x)}_${Math.round(y)}`;
  }

  // Remove common placeholders
  let cleanContent = content
    .replace(/^\d+[).]\s*/, '') // "1. " or "1) "
    .replace(/^[([]\d+[)\]]\s*/, '') // "(1) " or "[1] "
    .replace(/^No\.?\s*/i, '') // "No. " or "No "
    .trim();

  // Convert to snake_case
  let suggested = cleanContent
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '') // Remove special chars
    .replace(/\s+/g, '_') // Spaces to underscores
    .replace(/_+/g, '_') // Multiple underscores to single
    .substring(0, 40);

  // Remove trailing underscore
  suggested = suggested.replace(/_$/, '');

  // Fallback if empty
  if (!suggested || suggested.length < 2) {
    suggested = `text_${Math.round(x)}_${Math.round(y)}`;
  }

  return suggested;
}

/**
 * Analyze multiple SVG files (e.g., page-1.svg and page-follow.svg)
 */
export async function analyzeTemplateSvgs(templateDir: string): Promise<SvgTextAnalysis[]> {
  const files = await fs.readdir(templateDir);
  const svgFiles = files
    .filter(f => f.endsWith('.svg'))
    .sort();

  if (svgFiles.length === 0) {
    throw new SVGReportError('No SVG files found in template directory', templateDir);
  }

  const results: SvgTextAnalysis[] = [];

  for (const file of svgFiles) {
    const filePath = path.join(templateDir, file);
    const analysis = await extractTextElements(filePath);
    results.push(analysis);
  }

  return results;
}

/**
 * Print text analysis report to console
 */
export function printTextReport(analysis: SvgTextAnalysis): void {
  console.log(`\n=== Text Elements Analysis: ${path.basename(analysis.file)} ===`);
  console.log(`Page Size: ${analysis.pageSize.width.toFixed(1)}x${analysis.pageSize.height.toFixed(1)} ${analysis.pageSize.unit}`);
  
  console.log('\nStatistics:');
  console.log(`  Total text elements: ${analysis.statistics.total}`);
  console.log(`  With ID: ${analysis.statistics.withId}`);
  console.log(`  Without ID: ${analysis.statistics.withoutId}`);
  if (analysis.statistics.averageFontSize) {
    console.log(`  Average font size: ${analysis.statistics.averageFontSize.toFixed(1)}px`);
  }
  if (analysis.statistics.pathText > 0) {
    console.log(`  ⚠ Path-based text: ${analysis.statistics.pathText}`);
  }

  if (analysis.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of analysis.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  console.log('\nText Elements (top-to-bottom):');
  console.log('  #  | ID          | X      | Y      | Font   | Content');
  console.log('  ---|-------------|--------|--------|--------|------------------------------');

  for (let i = 0; i < analysis.textElements.length; i++) {
    const el = analysis.textElements[i];
    const idStr = el.id ? el.id.substring(0, 11).padEnd(11) : '[missing]  ';
    const contentPreview = el.content.length > 30 ? el.content.substring(0, 27) + '...' : el.content.padEnd(30);
    const fontSizeStr = el.fontSize ? el.fontSize.toFixed(1).padStart(6) : '  N/A';
    
    console.log(`  ${String(i + 1).padStart(2)} | ${idStr} | ${el.x.toFixed(1).padStart(6)} | ${el.y.toFixed(1).padStart(6)} | ${fontSizeStr} | ${contentPreview}`);
  }

  if (analysis.statistics.withoutId > 0) {
    console.log('\nSuggested IDs for elements without ID:');
    for (const el of analysis.textElements.filter(e => !e.id)) {
      console.log(`  "${el.content.substring(0, 40)}" → ${el.suggestedId}`);
    }
  }

  console.log('=====================================\n');
}

/**
 * Export text elements to JSON for external tools
 */
export async function exportTextElementsJson(
  svgPath: string,
  outputPath: string
): Promise<void> {
  const analysis = await extractTextElements(svgPath);
  
  const exportData = {
    file: analysis.file,
    pageSize: analysis.pageSize,
    elements: analysis.textElements.map((el, index) => ({
      index: index + 1,
      id: el.id,
      suggestedId: el.suggestedId,
      content: el.content,
      position: { x: el.x, y: el.y },
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      parentGroup: el.parentGroup,
    })),
    statistics: analysis.statistics,
    warnings: analysis.warnings,
  };

  await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
}
