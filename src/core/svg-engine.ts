// core/svg-engine.ts
// SVG manipulation using @xmldom/xmldom + xpath
// IMPORTANT: SVG is treated as XML, not HTML DOM

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import type { FieldBinding, TableBinding } from '../types/index.js';
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

export function applyFieldBinding(doc: Document, binding: FieldBinding, value: string): void {
  const element = requireElementById(doc, binding.svg_id, `field:${binding.key}`);
  const formattedValue = format(value, binding.format);
  setTextContent(element, formattedValue);

  if (binding.align) {
    applyTextAlignment(element, binding.align);
  }

  if (binding.fit === 'shrink') {
    applyTextShrink(element, formattedValue);
  }
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

export function applyTextShrink(element: Element, text: string): void {
  const fontSize = parseFloat(element.getAttribute('font-size') ?? '12');
  
  if (text.length > 20 && fontSize > 8) {
    const newSize = Math.max(8, fontSize * 0.8);
    element.setAttribute('font-size', String(newSize));
  }
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
  rowHeightMm: number
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
        const value = rowData[cell.column] ?? '';
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
