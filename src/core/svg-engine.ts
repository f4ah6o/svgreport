// core/svg-engine.ts
// SVG manipulation using @xmldom/xmldom + xpath
// IMPORTANT: SVG is treated as XML, not HTML DOM

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import type { TableBinding, TableCell } from '../types/index.js';
import { SVGReportError } from '../types/index.js';
import { format } from './formatter.js';

// SVG namespace
const SVG_NS = 'http://www.w3.org/2000/svg';

// XPath with SVG namespace
const nsSelect = xpath.useNamespaces({ svg: SVG_NS });

export function parseSvg(content: string | Buffer): Document {
  const parser = new DOMParser({
    errorHandler: {
      warning: () => {},
      error: (msg: string) => {
        throw new SVGReportError('SVG parse error', 'svg', msg);
      },
      fatalError: (msg: string) => {
        throw new SVGReportError('SVG fatal parse error', 'svg', msg);
      },
    },
  });

  const doc = parser.parseFromString(content.toString(), 'image/svg+xml');
  
  if (!doc || !doc.documentElement) {
    throw new SVGReportError('Failed to parse SVG', 'svg', 'Document is empty or invalid');
  }

  return doc;
}

export function serializeSvg(doc: Document): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

export function findById(doc: Document, id: string): Element | null {
  const result = nsSelect(`//*[@id="${id}"]`, doc, true) as Element | null;
  return result;
}

export function requireElementById(doc: Document, id: string, context: string): Element {
  const element = findById(doc, id);
  if (!element) {
    throw new SVGReportError(
      `Required element not found: #${id}`,
      context,
      `Element with id="${id}" does not exist in SVG`
    );
  }
  return element;
}

export function setTextContent(element: Element, text: string): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  const textNode = element.ownerDocument?.createTextNode(text);
  if (textNode) {
    element.appendChild(textNode);
  }
}

export function getTextContent(element: Element): string {
  return element.textContent ?? '';
}

export interface TextBinding {
  svg_id: string;
  fit?: 'none' | 'shrink' | 'wrap' | 'clip';
  align?: 'left' | 'center' | 'right';
  format?: string;
}

export function applyTextBinding(doc: Document, binding: TextBinding, value: string): void {
  const element = requireElementById(doc, binding.svg_id, `binding:${binding.svg_id}`);
  const formattedValue = format(value, binding.format);

  if (binding.align) {
    applyTextAlignment(element, binding.align);
  }

  const fitWidthAttr = element.getAttribute('data-fit-width');
  const hasFitWidth = fitWidthAttr && Number.isFinite(parseFloat(fitWidthAttr));
  const fitLinesAttr = element.getAttribute('data-fit-lines');
  const fitLines = fitLinesAttr ? parseInt(fitLinesAttr, 10) : null;
  const hasFitLines = Number.isFinite(fitLines) && (fitLines ?? 0) > 0;
  let maxWidth: number | undefined;
  if (fitWidthAttr) {
    const fitWidth = parseFloat(fitWidthAttr);
    if (Number.isFinite(fitWidth) && fitWidth > 0) {
      maxWidth = fitWidth;
    }
  }
  const labelId = element.getAttribute('data-fit-label');
  if (labelId && maxWidth === undefined) {
    try {
      const label = requireElementById(doc, labelId, `fit-label:${labelId}`);
      const labelText = getTextContent(label);
      const labelFontSize = getFontSize(label, 12);
      if (labelText) {
        maxWidth = estimateTextWidth(labelText, labelFontSize);
      }
    } catch {
      // ignore missing label
    }
  }

  const singleLine = hasFitLines && (fitLines ?? 0) === 1;

  if (binding.fit === 'wrap' || formattedValue.includes('\n') || (hasFitLines && !singleLine)) {
    applyTextWrap(element, formattedValue, maxWidth, hasFitLines ? fitLines ?? undefined : undefined);
    return;
  }

  setTextContent(element, formattedValue);

  if (binding.fit === 'shrink' || singleLine || hasFitWidth || maxWidth !== undefined) {
    applyTextShrink(element, formattedValue, maxWidth);
    return;
  }
}

export function applyFieldBinding(doc: Document, binding: TextBinding, value: string): void {
  applyTextBinding(doc, binding, value);
}

export function applyTextAlignment(element: Element, align: string): void {
  const anchorMap: Record<string, string> = {
    left: 'start',
    center: 'middle',
    right: 'end',
  };

  const anchor = anchorMap[align];
  if (anchor) {
    element.setAttribute('text-anchor', anchor);
  }
}

export function applyTextShrink(element: Element, text: string, maxWidth?: number): void {
  let fontSize = getFontSize(element, 12);

  if (maxWidth) {
    const units = estimateTextWidth(text, 1);
    if (units > 0) {
      const desired = maxWidth / units;
      const clamped = Math.max(4, Math.min(fontSize, desired));
      setInlineFontSize(element, clamped);
      return;
    }
    let width = estimateTextWidth(text, fontSize);
    while (width > maxWidth && fontSize > 4) {
      fontSize = Math.max(4, fontSize * 0.9);
      width = estimateTextWidth(text, fontSize);
    }
    setInlineFontSize(element, fontSize);
    return;
  }

  if (text.length > 20 && fontSize > 8) {
    const newSize = Math.max(8, fontSize * 0.8);
    setInlineFontSize(element, newSize);
  }
}

function getFontSize(element: Element, fallback: number): number {
  const value = parseFloat(element.getAttribute('font-size') ?? String(fallback));
  return Number.isFinite(value) ? value : fallback;
}

function setInlineFontSize(element: Element, size: number): void {
  const raw = element.getAttribute('style') ?? '';
  const normalized = raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.toLowerCase().startsWith('font-size:'))
  normalized.push(`font-size:${size}px`)
  element.setAttribute('style', normalized.join('; '))
  element.setAttribute('font-size', String(size))
}

function estimateTextWidth(text: string, fontSize: number): number {
  if (!text) return fontSize;
  let units = 0;
  for (const ch of Array.from(text)) {
    if (/[\u3000-\u9fff]/.test(ch)) {
      units += 1;
    } else if (/[A-Z0-9]/.test(ch)) {
      units += 0.75;
    } else {
      units += 0.6;
    }
  }
  return units * fontSize;
}

function applyTextWrap(element: Element, text: string, maxWidth?: number, maxLines?: number): void {
  const fontSize = getFontSize(element, 12);
  const lineHeight = fontSize * 1.2;
  const x = element.getAttribute('x');
  const y = element.getAttribute('y');
  const lines: string[] = [];
  const rawLines = text.split(/\r?\n/);
  for (const raw of rawLines) {
    if (maxWidth) {
      lines.push(...wrapTextByWidth(raw, fontSize, maxWidth));
    } else {
      lines.push(raw);
    }
  }
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  const doc = element.ownerDocument;
  if (!doc) return;
  if (maxLines && lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines);
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    const doc = element.ownerDocument;
    if (!doc) return;
    trimmed.forEach((line, index) => {
      const tspan = doc.createElementNS(SVG_NS, 'tspan');
      if (x) tspan.setAttribute('x', x);
      if (index > 0) {
        tspan.setAttribute('dy', String(lineHeight));
      } else {
        tspan.setAttribute('dy', '0');
      }
      tspan.appendChild(doc.createTextNode(line));
      element.appendChild(tspan);
    });
    if (y) {
      element.setAttribute('y', y);
    }
    return;
  }

  lines.forEach((line, index) => {
    const tspan = doc.createElementNS(SVG_NS, 'tspan');
    if (x) tspan.setAttribute('x', x);
    if (index > 0) {
      tspan.setAttribute('dy', String(lineHeight));
    } else {
      tspan.setAttribute('dy', '0');
    }
    tspan.appendChild(doc.createTextNode(line));
    element.appendChild(tspan);
  });
  if (y) {
    element.setAttribute('y', y);
  }
}

function wrapTextByWidth(text: string, fontSize: number, maxWidth: number): string[] {
  if (!text) return [''];
  const hasSpaces = /\s/.test(text);
  if (!hasSpaces) {
    const chars = Array.from(text);
    const lines: string[] = [];
    let current = '';
    for (const ch of chars) {
      const next = current + ch;
      if (estimateTextWidth(next, fontSize) <= maxWidth || current.length === 0) {
        current = next;
      } else {
        lines.push(current);
        current = ch;
      }
    }
    if (current.length > 0) lines.push(current);
    return lines;
  }

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
      continue;
    }
    const broken = wrapTextByWidth(word, fontSize, maxWidth);
    lines.push(...broken.slice(0, -1));
    current = broken[broken.length - 1] ?? '';
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function cloneRowTemplate(doc: Document, rowGroupId: string): Element {
  const template = requireElementById(doc, rowGroupId, `row-template:${rowGroupId}`);
  const clone = template.cloneNode(true) as Element;
  clone.removeAttribute('id');
  return clone;
}

export function getRowYPosition(element: Element): number {
  const transform = element.getAttribute('transform') ?? '';
  const match = transform.match(/translate\([^,]+,\s*([\d.]+)\)/);
  
  if (match) {
    return parseFloat(match[1]);
  }
  
  const y = element.getAttribute('y');
  if (y) {
    return parseFloat(y);
  }
  
  return 0;
}

export function setRowYPosition(element: Element, y: number): void {
  const transform = element.getAttribute('transform') ?? '';
  
  if (transform.includes('translate')) {
    const newTransform = transform.replace(
      /translate\(([^,]+),\s*[^)]+\)/,
      `translate($1, ${y})`
    );
    element.setAttribute('transform', newTransform);
  } else {
    const x = element.getAttribute('x') ?? '0';
    element.setAttribute('transform', `translate(${x}, ${y})`);
    element.removeAttribute('x');
  }
}

export function findRowContainer(doc: Document, rowGroupId: string): Element {
  const template = requireElementById(doc, rowGroupId, `row-template:${rowGroupId}`);
  const parent = template.parentNode as Element | null;
  
  if (!parent) {
    throw new SVGReportError(
      `Row template #${rowGroupId} has no parent container`,
      'svg',
      'Row template must be inside a group or container'
    );
  }
  
  return parent;
}

export function applyTableBinding(
  doc: Document,
  binding: TableBinding,
  rows: Record<string, string>[],
  rowOffset: number,
  startY: number,
  rowHeightMm: number,
  resolveValue: (cell: TableCell, rowData: Record<string, string>) => string
): void {
  const container = findRowContainer(doc, binding.row_group_id);
  const template = findById(doc, binding.row_group_id);
  
  if (!template) {
    throw new SVGReportError(
      `Row template not found: #${binding.row_group_id}`,
      'table',
      'Row group id does not exist'
    );
  }

  const MM_TO_UNITS = 3.7795;
  const rowHeight = rowHeightMm * MM_TO_UNITS;
  const baseY = startY || getRowYPosition(template);

  // Remove existing data rows (keep template)
  const childrenToRemove: Element[] = [];
  for (let i = 0; i < container.childNodes.length; i++) {
    const child = container.childNodes[i] as Element;
    if (child && child.nodeType === 1 && child.getAttribute('data-row-type') === 'data') {
      childrenToRemove.push(child);
    }
  }
  childrenToRemove.forEach(child => container.removeChild(child));

  // Create clones for each row
  rows.forEach((rowData, index) => {
    const clone = cloneRowTemplate(doc, binding.row_group_id);
    clone.setAttribute('data-row-type', 'data');
    clone.setAttribute('data-row-index', String(rowOffset + index));
    
    const y = baseY + (index * rowHeight);
    setRowYPosition(clone, y);

    // Fill in cell data
    for (const cell of binding.cells) {
      const cellElement = findById(doc, cell.svg_id);
      if (cellElement && clone.contains(cellElement)) {
        const value = resolveValue(cell, rowData);
        const formattedValue = format(value, cell.format);
        setTextContent(cellElement, formattedValue);

        if (cell.align) {
          applyTextAlignment(cellElement, cell.align);
        }

        if (cell.fit === 'shrink') {
          applyTextShrink(cellElement, formattedValue);
        }
      }
    }

    container.appendChild(clone);
  });
}

export function setPageNumber(
  doc: Document,
  svgId: string,
  currentPage: number,
  totalPages: number,
  format: string
): void {
  const element = findById(doc, svgId);
  if (!element) return;
  
  const text = format
    .replace('{current}', String(currentPage))
    .replace('{total}', String(totalPages));
  
  setTextContent(element, text);
}
