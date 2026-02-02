// core/paginator.ts
// Pure functions for chunking table rows into pages

import type { PageConfig } from '../types/index.js';
import { SVGReportError } from '../types/index.js';

/**
 * Represents a chunk of table rows for a single page
 */
export interface TableChunk {
  rows: Record<string, string>[];
  startIndex: number;
  endIndex: number;
  totalRows: number;
}

/**
 * Represents page information with chunk assignment
 */
export interface PageInfo {
  pageNumber: number;
  kind: 'first' | 'repeat';
  tableChunks: Map<string, TableChunk>; // source name -> chunk
}

/**
 * Split table rows into chunks based on rows_per_page
 * Pure function - no side effects
 */
export function chunkTableRows(
  rows: Record<string, string>[],
  rowsPerPage: number
): TableChunk[] {
  if (rowsPerPage <= 0) {
    throw new SVGReportError(
      'Invalid rows_per_page',
      'table',
      `rows_per_page must be > 0, got ${rowsPerPage}`
    );
  }

  const chunks: TableChunk[] = [];
  const totalRows = rows.length;

  for (let i = 0; i < totalRows; i += rowsPerPage) {
    const end = Math.min(i + rowsPerPage, totalRows);
    chunks.push({
      rows: rows.slice(i, end),
      startIndex: i,
      endIndex: end - 1,
      totalRows,
    });
  }

  return chunks;
}

/**
 * Calculate total number of pages needed
 * Pure function - no side effects
 */
export function calculateTotalPages(
  tableData: Map<string, Record<string, string>[]>,
  firstPage: PageConfig,
  _repeatPage: PageConfig | null
): number {
  let maxChunks = 1; // At least one page even if no tables

  for (const table of firstPage.tables) {
    const rows = tableData.get(table.source) ?? [];
    const rowsPerPage = table.rows_per_page;
    const chunks = Math.ceil(rows.length / rowsPerPage);
    maxChunks = Math.max(maxChunks, chunks);
  }

  return maxChunks;
}

/**
 * Build page plan - which table chunks go on which pages
 * Pure function - no side effects
 */
export function buildPagePlan(
  tableData: Map<string, Record<string, string>[]>,
  firstPage: PageConfig,
  repeatPage: PageConfig | null,
  totalPages: number
): PageInfo[] {
  const pages: PageInfo[] = [];

  // Pre-chunk all tables
  const tableChunks = new Map<string, TableChunk[]>();
  
  for (const table of firstPage.tables) {
    const rows = tableData.get(table.source) ?? [];
    const chunks = chunkTableRows(rows, table.rows_per_page);
    tableChunks.set(table.source, chunks);
  }

  // Build pages
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const isFirst = pageNum === 1;
    const pageKind: 'first' | 'repeat' = isFirst ? 'first' : 'repeat';
    
    const pageInfo: PageInfo = {
      pageNumber: pageNum,
      kind: pageKind,
      tableChunks: new Map(),
    };

    // Get appropriate page config for this page
    const pageConfig = isFirst ? firstPage : repeatPage ?? firstPage;

    // Assign chunks for each table
    for (const table of pageConfig.tables) {
      const chunks = tableChunks.get(table.source) ?? [];
      const chunkIndex = pageNum - 1;
      
      if (chunkIndex < chunks.length) {
        pageInfo.tableChunks.set(table.source, chunks[chunkIndex]);
      } else {
        // No more rows for this table on this page
        pageInfo.tableChunks.set(table.source, {
          rows: [],
          startIndex: 0,
          endIndex: -1,
          totalRows: tableData.get(table.source)?.length ?? 0,
        });
      }
    }

    pages.push(pageInfo);
  }

  return pages;
}

/**
 * Get rows per page for a specific table on a specific page kind
 * Pure function - no side effects
 */
export function getRowsPerPage(
  tableSource: string,
  pageKind: 'first' | 'repeat',
  firstPage: PageConfig,
  repeatPage: PageConfig | null
): number {
  const pageConfig = pageKind === 'first' ? firstPage : repeatPage ?? firstPage;
  const table = pageConfig.tables.find(t => t.source === tableSource);
  return table?.rows_per_page ?? 0;
}

/**
 * Validate that table sources referenced in template exist in data
 */
export function validateTableSources(
  pageConfigs: PageConfig[],
  availableSources: Set<string>
): void {
  const requiredSources = new Set<string>();
  
  for (const page of pageConfigs) {
    for (const table of page.tables) {
      requiredSources.add(table.source);
    }
  }

  const missing = Array.from(requiredSources).filter(s => !availableSources.has(s));
  
  if (missing.length > 0) {
    throw new SVGReportError(
      `Missing table data sources: ${missing.join(', ')}`,
      'template',
      `Available sources: ${Array.from(availableSources).join(', ')}`
    );
  }
}
