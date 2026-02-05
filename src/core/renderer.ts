// core/renderer.ts
// Orchestrator that coordinates all modules for report rendering

import type {
  JobManifest,
  TemplateConfig,
  DataSource,
  KVData,
  RenderedPage,
  RenderResult,
  PageConfig,
  ValueBinding,
  TableCell,
} from '../types/index.js';
import { SVGReportError, isKvData, isTableData } from '../types/index.js';
import * as paginator from './paginator.js';
import * as svgEngine from './svg-engine.js';
import * as template from './template.js';
import { registerCustomFormatters } from './formatter.js';

export interface RenderOptions {
  debug?: boolean;
}

export class Renderer {
  private manifest: JobManifest;
  private templateConfig: TemplateConfig;
  private dataSources: Map<string, DataSource>;
  private pageSvgs: Map<string, Document>; // page ID -> SVG Document

  constructor(
    manifest: JobManifest,
    templateConfig: TemplateConfig,
    dataSources: Map<string, DataSource>,
    pageSvgs: Map<string, Document>
  ) {
    this.manifest = manifest;
    this.templateConfig = templateConfig;
    this.dataSources = dataSources;
    this.pageSvgs = pageSvgs;

    // Register custom formatters from template
    if (templateConfig.formatters) {
      registerCustomFormatters(templateConfig.formatters);
    }
  }

  render(_options?: RenderOptions): RenderResult {
    const firstPage = template.getFirstPage(this.templateConfig);
    const repeatPage = template.getRepeatPage(this.templateConfig);
    const meta = this.getMetaData();

    // Build table data map
    const tableData = this.buildTableDataMap();

    // Calculate total pages
    const totalPages = paginator.calculateTotalPages(tableData, firstPage, repeatPage);

    // Build page plan
    const pagePlan = paginator.buildPagePlan(tableData, firstPage, repeatPage, totalPages);

    // Render each page
    const renderedPages: RenderedPage[] = [];

    for (const pageInfo of pagePlan) {
      const pageConfig = pageInfo.kind === 'first' ? firstPage : repeatPage ?? firstPage;
      const svgDoc = this.cloneSvgForPage(pageConfig.id);

      // Apply field bindings
      this.applyFields(svgDoc, meta, pageInfo.pageNumber, totalPages);

      // Apply table bindings
      this.applyTables(svgDoc, pageConfig, pageInfo);

      // Set page number
      if (pageConfig.page_number) {
        svgEngine.setPageNumber(
          svgDoc,
          pageConfig.page_number.svg_id,
          pageInfo.pageNumber,
          totalPages,
          pageConfig.page_number.format ?? '{current}/{total}'
        );
      }

      renderedPages.push({
        pageNumber: pageInfo.pageNumber,
        svgDocument: svgDoc,
        svgString: svgEngine.serializeSvg(svgDoc),
      });
    }

    return {
      jobId: this.manifest.job_id,
      templateId: this.templateConfig.template.id,
      templateVersion: this.templateConfig.template.version,
      totalPages,
      pages: renderedPages,
    };
  }

  private getMetaData(): KVData {
    const meta = this.dataSources.get('meta');
    if (!meta || !isKvData(meta)) {
      throw new SVGReportError('Meta data not found or invalid', 'inputs', 'Expected kv data source named "meta"');
    }
    return meta;
  }

  private buildTableDataMap(): Map<string, Record<string, string>[]> {
    const map = new Map<string, Record<string, string>[]>();
    
    for (const [name, source] of this.dataSources.entries()) {
      if (isTableData(source)) {
        map.set(name, source.rows);
      }
    }
    
    return map;
  }

  private cloneSvgForPage(pageId: string): Document {
    const svgDoc = this.pageSvgs.get(pageId);
    if (!svgDoc) {
      throw new SVGReportError(
        `SVG not found for page: ${pageId}`,
        'template',
        `No SVG loaded for page id "${pageId}"`
      );
    }

    // Deep clone the SVG document
    const cloned = svgDoc.cloneNode(true) as Document;
    return cloned;
  }

  private applyFields(svgDoc: Document, _meta: KVData, _currentPage: number, _totalPages: number): void {
    this.applyFieldList(svgDoc, this.templateConfig.fields);
  }

  private applyTables(
    svgDoc: Document,
    pageConfig: PageConfig,
    pageInfo: paginator.PageInfo
  ): void {
    if (pageConfig.fields?.length) {
      this.applyFieldList(svgDoc, pageConfig.fields);
    }
    for (const tableBinding of pageConfig.tables) {
      if (tableBinding.header?.cells?.length) {
        for (const cell of tableBinding.header.cells) {
          const value = this.resolveValue(cell.value);
          try {
            svgEngine.applyTextBinding(svgDoc, cell, value);
          } catch (error) {
            if (error instanceof SVGReportError) {
              console.warn(`Warning: ${error.message}`);
            }
          }
        }
      }

      const chunk = pageInfo.tableChunks.get(tableBinding.source);
      if (!chunk || chunk.rows.length === 0) {
        continue;
      }

      try {
        svgEngine.applyTableBinding(
          svgDoc,
          tableBinding,
          chunk.rows,
          chunk.startIndex,
          tableBinding.start_y_mm ?? 0,
          tableBinding.row_height_mm,
          (cell: TableCell, rowData) => this.resolveValue(cell.value, rowData, tableBinding.source)
        );
      } catch (error) {
        if (error instanceof SVGReportError) {
          console.warn(`Warning: ${error.message}`);
        }
      }
    }
  }

  private applyFieldList(svgDoc: Document, fields: { svg_id: string; value: ValueBinding; fit?: string; align?: string; format?: string }[]): void {
    for (const field of fields) {
      const value = this.resolveValue(field.value);
      try {
        svgEngine.applyTextBinding(svgDoc, field, value);
      } catch (error) {
        if (error instanceof SVGReportError) {
          console.warn(`Warning: ${error.message}`);
        }
      }
    }
  }

  private resolveValue(
    value: ValueBinding,
    rowData?: Record<string, string>,
    rowSource?: string
  ): string {
    if (value.type === 'static') {
      return value.text ?? '';
    }

    const sourceName = value.source;
    const source = this.dataSources.get(sourceName);

    if (rowData && rowSource && sourceName === rowSource) {
      return rowData[value.key] ?? '';
    }

    if (source && isKvData(source)) {
      return source[value.key] ?? '';
    }

    if (source && isTableData(source)) {
      return source.rows[0]?.[value.key] ?? '';
    }

    return '';
  }
}

export function createRenderer(
  manifest: JobManifest,
  templateConfig: TemplateConfig,
  dataSources: Map<string, DataSource>,
  pageSvgs: Map<string, Document>,
  _options?: RenderOptions
): Renderer {
  return new Renderer(manifest, templateConfig, dataSources, pageSvgs);
}
