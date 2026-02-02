// core/svg-normalizer.ts
// SVG normalization: page size standardization, transform flattening, cleanup

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SVGReportError } from '../types/index.js';

export interface NormalizationOptions {
  pageSize?: 'a4' | 'a3' | { width: number; height: number };
  flattenTransforms?: boolean;
  removeEmptyGroups?: boolean;
  removeUnusedDefs?: boolean;
  convertCoordinates?: boolean;
}

export interface NormalizationResult {
  inputFile: string;
  outputFile: string;
  changes: string[];
  warnings: string[];
  metrics: {
    originalViewBox: string | null;
    normalizedViewBox: string;
    widthMm: number;
    heightMm: number;
    textElementCount: number;
  };
}

// Standard page sizes in mm
const PAGE_SIZES = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
};

// MM to pixel conversion (at 96 DPI, common for SVG)
const MM_TO_PX = 3.779527559;

/**
 * Normalize a single SVG file
 */
export async function normalizeSvg(
  inputPath: string,
  outputPath: string,
  options: NormalizationOptions = {}
): Promise<NormalizationResult> {
  const {
    pageSize,
    flattenTransforms = true,
    removeEmptyGroups = true,
    removeUnusedDefs = true,
  } = options;

  // Read input
  const content = await fs.readFile(inputPath, 'utf-8');
  
  // Parse SVG
  const parser = new DOMParser({
    errorHandler: (level, msg) => {
      if (level === 'error') {
        throw new SVGReportError(
          'Failed to parse SVG',
          inputPath,
          msg
        );
      }
    },
  });

  const doc = parser.parseFromString(content, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg || svg.tagName !== 'svg') {
    throw new SVGReportError(
      'Invalid SVG file - no root svg element',
      inputPath
    );
  }

  const changes: string[] = [];
  const warnings: string[] = [];

  // Get original viewBox
  const originalViewBox = svg.getAttribute('viewBox');

  // Step 1: Standardize page dimensions
  const targetSize = pageSize 
    ? (typeof pageSize === 'string' ? PAGE_SIZES[pageSize] : pageSize)
    : null;

  if (targetSize) {
    const widthPx = targetSize.width * MM_TO_PX;
    const heightPx = targetSize.height * MM_TO_PX;
    const viewBoxValue = `0 0 ${widthPx} ${heightPx}`;

    svg.setAttribute('width', `${targetSize.width}mm`);
    svg.setAttribute('height', `${targetSize.height}mm`);
    svg.setAttribute('viewBox', viewBoxValue);

    changes.push(`Standardized to ${targetSize.width}x${targetSize.height}mm`);
  } else {
    // Try to extract and convert existing dimensions
    const width = svg.getAttribute('width');
    const height = svg.getAttribute('height');
    const viewBox = svg.getAttribute('viewBox');

    if (viewBox) {
      // Keep existing viewBox but ensure mm units
      const parts = viewBox.split(/\s+/).map(parseFloat);
      if (parts.length === 4) {
        const widthPx = parts[2];
        const heightPx = parts[3];
        
        // Convert to mm if not already
        if (!width?.includes('mm')) {
          svg.setAttribute('width', `${widthPx / MM_TO_PX}mm`);
        }
        if (!height?.includes('mm')) {
          svg.setAttribute('height', `${heightPx / MM_TO_PX}mm`);
        }
        
        changes.push('Converted dimensions to mm units');
      }
    } else if (width && height) {
      // Create viewBox from width/height
      const w = parseFloat(width);
      const h = parseFloat(height);
      if (!isNaN(w) && !isNaN(h)) {
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        changes.push('Created viewBox from width/height');
      }
    }
  }

  // Step 2: Flatten transforms (simplified - only handle translate)
  if (flattenTransforms) {
    const groups = Array.from(svg.getElementsByTagName('g'));
    let flattenedCount = 0;

    for (const g of groups) {
      const transform = g.getAttribute('transform');
      if (transform && transform.includes('translate')) {
        // Extract translate values
        const match = transform.match(/translate\(([^,\)]+)(?:,\s*([^\)]+))?\)/);
        if (match) {
          const tx = parseFloat(match[1]) || 0;
          const ty = parseFloat(match[2]) || 0;

          // Apply translation to children
          const children = Array.from(g.childNodes);
          for (const child of children) {
            if (child.nodeType === 1) { // Element node
              const el = child as Element;
              const childTransform = el.getAttribute('transform') || '';
              const newTransform = childTransform 
                ? `translate(${tx},${ty}) ${childTransform}`
                : `translate(${tx},${ty})`;
              el.setAttribute('transform', newTransform);
            }
          }

          // Remove transform from group
          g.removeAttribute('transform');
          flattenedCount++;
        }
      }
    }

    if (flattenedCount > 0) {
      changes.push(`Flattened ${flattenedCount} group transforms`);
    }
  }

  // Step 3: Remove empty groups
  if (removeEmptyGroups) {
    let removedCount = 0;
    let foundEmpty = true;

    while (foundEmpty) {
      foundEmpty = false;
      const groups = Array.from(svg.getElementsByTagName('g'));
      
      for (const g of groups) {
        // Check if group has no element children (text nodes don't count)
        const hasElementChildren = Array.from(g.childNodes).some(
          n => n.nodeType === 1
        );
        
        if (!hasElementChildren) {
          g.parentNode?.removeChild(g);
          removedCount++;
          foundEmpty = true;
        }
      }
    }

    if (removedCount > 0) {
      changes.push(`Removed ${removedCount} empty groups`);
    }
  }

  // Step 4: Remove unused defs
  if (removeUnusedDefs) {
    const defs = svg.getElementsByTagName('defs')[0];
    if (defs) {
      const content = new XMLSerializer().serializeToString(doc);
      const children = Array.from(defs.childNodes);
      let removedCount = 0;

      for (const child of children) {
        if (child.nodeType === 1) {
          const el = child as Element;
          const id = el.getAttribute('id');
          
          if (id) {
            // Check if this def is referenced
            const isReferenced = content.includes(`#${id}`) || 
                                content.includes(`url(#${id})`);
            
            if (!isReferenced) {
              defs.removeChild(child);
              removedCount++;
            }
          }
        }
      }

      if (removedCount > 0) {
        changes.push(`Removed ${removedCount} unused defs`);
      }

      // Remove empty defs
      if (defs.childNodes.length === 0) {
        defs.parentNode?.removeChild(defs);
        changes.push('Removed empty defs section');
      }
    }
  }

  // Step 5: Ensure IDs are valid (remove invalid characters)
  const allElements = Array.from(svg.getElementsByTagName('*'));
  let idFixedCount = 0;

  for (const el of allElements) {
    const id = el.getAttribute('id');
    if (id) {
      // Replace invalid characters with underscore
      const validId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (id !== validId) {
        el.setAttribute('id', validId);
        idFixedCount++;
      }
    }
  }

  if (idFixedCount > 0) {
    changes.push(`Fixed ${idFixedCount} invalid IDs`);
  }

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Serialize and write
  const serializer = new XMLSerializer();
  const normalized = serializer.serializeToString(doc);
  await fs.writeFile(outputPath, normalized, 'utf-8');

  // Collect metrics
  const normalizedViewBox = svg.getAttribute('viewBox') || '0 0 0 0';
  const viewBoxParts = normalizedViewBox.split(/\s+/).map(parseFloat);
  const textElements = svg.getElementsByTagName('text');

  return {
    inputFile: inputPath,
    outputFile: outputPath,
    changes,
    warnings,
    metrics: {
      originalViewBox,
      normalizedViewBox,
      widthMm: viewBoxParts[2] ? viewBoxParts[2] / MM_TO_PX : 0,
      heightMm: viewBoxParts[3] ? viewBoxParts[3] / MM_TO_PX : 0,
      textElementCount: textElements.length,
    },
  };
}

/**
 * Normalize multiple SVG files in a directory
 */
export async function normalizeSvgBatch(
  inputDir: string,
  outputDir: string,
  options: NormalizationOptions = {}
): Promise<NormalizationResult[]> {
  const files = await fs.readdir(inputDir);
  const svgFiles = files.filter(f => f.endsWith('.svg')).sort();

  if (svgFiles.length === 0) {
    throw new SVGReportError(
      'No SVG files found in input directory',
      inputDir
    );
  }

  const results: NormalizationResult[] = [];

  for (const file of svgFiles) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, file);
    
    const result = await normalizeSvg(inputPath, outputPath, options);
    results.push(result);
  }

  return results;
}

/**
 * Extract candidate text elements from SVG for GUI editor
 */
export async function extractTextCandidates(
  svgPath: string
): Promise<Array<{
  id: string | null;
  content: string;
  x: number;
  y: number;
  fontSize: number | null;
  suggestedId: string;
}>> {
  const content = await fs.readFile(svgPath, 'utf-8');
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'image/svg+xml');
  const svg = doc.documentElement;

  if (!svg) {
    throw new SVGReportError('Failed to parse SVG', svgPath);
  }

  const textElements = Array.from(svg.getElementsByTagName('text'));
  const candidates: ReturnType<typeof extractTextCandidates> extends Promise<infer T> ? T : never = [];

  for (const text of textElements) {
    const id = text.getAttribute('id');
    const content = text.textContent?.trim() || '';
    const x = parseFloat(text.getAttribute('x') || '0');
    const y = parseFloat(text.getAttribute('y') || '0');
    const fontSize = text.getAttribute('font-size');
    
    // Generate suggested ID from content
    let suggestedId = content
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 30);
    
    if (!suggestedId || suggestedId === '_') {
      suggestedId = `text_${Math.round(x)}_${Math.round(y)}`;
    }

    candidates.push({
      id,
      content,
      x,
      y,
      fontSize: fontSize ? parseFloat(fontSize) : null,
      suggestedId,
    });
  }

  return candidates;
}
