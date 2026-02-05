// core/preview-generator.ts
// Generate preview HTML/SVG from template with dummy/sample data

import * as fs from 'fs/promises';
import * as path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { parseTemplate } from './template.js';
import { createRenderer } from './renderer.js';
import { generateHtml, generateDebugJson } from './html-writer.js';
import { SVGReportError, type TemplateConfig, type KVData, type TableData, type JobManifest } from '../types/index.js';

export interface PreviewOptions {
  sampleData?: 'minimal' | 'realistic' | 'multi-page';
  outputDir: string;
  includeDebug?: boolean;
  data?: {
    meta?: KVData;
    items?: TableData;
  };
}

export interface PreviewResult {
  templateId: string;
  templateVersion: string;
  outputDir: string;
  htmlPath: string;
  pageCount: number;
  dataSummary: {
    metaFields: number;
    itemCount: number;
  };
}

/**
 * Generate preview from template with dummy data
 */
export async function generatePreview(
  templateDir: string,
  options: PreviewOptions
): Promise<PreviewResult> {
  const { sampleData = 'realistic', outputDir, includeDebug = true, data } = options;

  // Load template
  const templateJsonPath = path.join(templateDir, 'template.json');
  const templateJson = await fs.readFile(templateJsonPath, 'utf-8');
  const templateConfig = parseTemplate(templateJson);

  // Load SVGs
  const pageSvgs = new Map<string, Document>();
  for (const page of templateConfig.pages) {
    const svgPath = path.join(templateDir, page.svg);
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    if (!doc.documentElement) {
      throw new SVGReportError('Failed to parse SVG', svgPath);
    }
    pageSvgs.set(page.id, doc);
  }

  // Generate dummy data
  const fallback = generateDummyData(templateConfig, sampleData);
  const meta = data?.meta ?? fallback.meta;
  const items = normalizeTableData(data?.items ?? fallback.items);

  // Create mock manifest
  const manifest: JobManifest = {
    schema: 'svgreport-job/v0.1',
    job_id: `preview-${templateConfig.template.id}-${Date.now()}`,
    template: templateConfig.template,
    encoding: 'utf-8',
    locale: 'ja-JP',
    inputs: {
      meta: { type: 'csv', path: 'meta.csv', kind: 'kv' },
      items: { type: 'csv', path: 'items.csv', kind: 'table' },
    },
  };

  // Create data sources map
  const sources = new Map<string, KVData | TableData>();
  sources.set('meta', meta);
  sources.set('items', items);

  // Render
  const renderer = createRenderer(manifest, templateConfig, sources, pageSvgs);
  const result = renderer.render({ debug: includeDebug });

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Write HTML
  const htmlPath = path.join(outputDir, 'index.html');
  const html = generateHtml(result, {
    title: `Preview: ${templateConfig.template.id} v${templateConfig.template.version}`,
    includePrintStyles: true,
  });
  await fs.writeFile(htmlPath, html, 'utf-8');

  // Write individual SVGs
  const pagesDir = path.join(outputDir, 'pages');
  await fs.mkdir(pagesDir, { recursive: true });

  for (const page of result.pages) {
    const pagePath = path.join(pagesDir, `page-${String(page.pageNumber).padStart(3, '0')}.svg`);
    await fs.writeFile(pagePath, page.svgString, 'utf-8');
  }

  // Write debug info
  if (includeDebug) {
    const debugDir = path.join(outputDir, 'debug');
    await fs.mkdir(debugDir, { recursive: true });

    await fs.writeFile(
      path.join(debugDir, 'meta.json'),
      JSON.stringify(meta, null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(debugDir, 'items.json'),
      JSON.stringify(items, null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(debugDir, 'render.json'),
      generateDebugJson(result),
      'utf-8'
    );
  }

  return {
    templateId: templateConfig.template.id,
    templateVersion: templateConfig.template.version,
    outputDir,
    htmlPath,
    pageCount: result.totalPages,
    dataSummary: {
      metaFields: Object.keys(meta).length,
      itemCount: items.rows.length,
    },
  };
}

/**
 * Generate dummy data based on template configuration
 */
function generateDummyData(
  templateConfig: TemplateConfig,
  sampleData: 'minimal' | 'realistic' | 'multi-page'
): { meta: KVData; items: TableData } {
  const meta: KVData = {};
  const items: TableData = { headers: [], rows: [] };

  // Collect all unique keys
  const metaKeys = new Set<string>();
  const itemKeys = new Set<string>();

  for (const field of templateConfig.fields) {
    if (field.value.type !== 'data') continue;
    if (field.value.source === 'meta') {
      metaKeys.add(field.value.key);
    } else {
      itemKeys.add(field.value.key);
    }
  }

  for (const page of templateConfig.pages) {
    for (const field of page.fields ?? []) {
      if (field.value.type === 'data') {
        if (field.value.source === 'meta') {
          metaKeys.add(field.value.key);
        } else {
          itemKeys.add(field.value.key);
        }
      }
    }
    for (const table of page.tables) {
      if (table.header?.cells) {
        for (const cell of table.header.cells) {
          if (cell.value.type === 'data') {
            if (cell.value.source === 'meta') {
              metaKeys.add(cell.value.key);
            } else {
              itemKeys.add(cell.value.key);
            }
          }
        }
      }
      for (const cell of table.cells) {
        if (cell.value.type === 'data') {
          if (cell.value.source === 'meta') {
            metaKeys.add(cell.value.key);
          } else {
            itemKeys.add(cell.value.key);
          }
        }
      }
    }
  }

  // Generate meta data based on field names
  for (const key of metaKeys) {
    meta[key] = generateMetaValue(key, sampleData);
  }

  // Ensure common fields exist
  if (!meta['customer.name']) {
    meta['customer.name'] = sampleData === 'minimal' ? 'テスト' : '株式会社サンプル商事';
  }
  if (!meta['customer.address']) {
    meta['customer.address'] = sampleData === 'minimal' ? '住所' : '東京都新宿区西新宿1-1-1 サンプルビル10F';
  }
  if (!meta['invoice_no']) {
    meta['invoice_no'] = 'INV-' + String(Math.floor(Math.random() * 9000) + 1000);
  }
  if (!meta['issue_date']) {
    meta['issue_date'] = new Date().toISOString().split('T')[0];
  }
  if (!meta['due_date']) {
    const due = new Date();
    due.setDate(due.getDate() + 30);
    meta['due_date'] = due.toISOString().split('T')[0];
  }
  if (!meta['subtotal']) {
    meta['subtotal'] = '100000';
  }
  if (!meta['tax']) {
    meta['tax'] = '10000';
  }
  if (!meta['total']) {
    meta['total'] = '110000';
  }

  // Collect table columns from all pages
  const tableColumns = new Set<string>(itemKeys);
  items.headers = Array.from(tableColumns);
  if (items.headers.length === 0) {
    items.headers = ['name', 'price', 'qty', 'amount'];
  }

  // Generate item rows based on sample data mode
  const rowCount = sampleData === 'minimal' ? 1 : sampleData === 'realistic' ? 5 : 25;

  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, string> = {};
    
    for (const col of items.headers) {
      row[col] = generateItemValue(col, i, sampleData);
    }

    // Calculate amount if needed
    if (row['price'] && row['qty'] && !row['amount']) {
      const price = parseInt(row['price'].replace(/[^0-9]/g, '')) || 0;
      const qty = parseInt(row['qty']) || 0;
      row['amount'] = (price * qty).toString();
    }

    // Add row number if needed
    if (items.headers.includes('no') || items.headers.includes('item_no')) {
      const noKey = items.headers.includes('no') ? 'no' : 'item_no';
      row[noKey] = (i + 1).toString();
    }

    items.rows.push(row);
  }

  return { meta, items };
}

function normalizeTableData(input: TableData): TableData {
  if (input.headers && input.headers.length > 0) {
    return input;
  }
  if (!input.rows || input.rows.length === 0) {
    return { headers: [], rows: [] };
  }
  return { headers: Object.keys(input.rows[0]), rows: input.rows };
}

/**
 * Generate a value for a meta field based on its key
 */
function generateMetaValue(key: string, sampleData: string): string {
  const realistic = sampleData !== 'minimal';

  if (key.includes('name')) {
    return realistic ? '株式会社サンプル商事' : 'テスト';
  }
  if (key.includes('address')) {
    return realistic ? '東京都新宿区西新宿1-1-1 サンプルビル10F' : '住所';
  }
  if (key.includes('date') || key.includes('day')) {
    return new Date().toISOString().split('T')[0];
  }
  if (key.includes('no') || key.includes('number')) {
    return 'INV-' + String(Math.floor(Math.random() * 9000) + 1000);
  }
  if (key.includes('total') || key.includes('amount') || key.includes('price') || key.includes('tax')) {
    return realistic ? String(Math.floor(Math.random() * 900000) + 100000) : '100000';
  }
  if (key.includes('tel') || key.includes('phone')) {
    return realistic ? '03-1234-5678' : 'TEL';
  }
  if (key.includes('email')) {
    return 'sample@example.com';
  }
  if (key.includes('person') || key.includes('contact')) {
    return realistic ? '山田 太郎' : '担当';
  }

  return realistic ? 'サンプルデータ' : 'TEST';
}

/**
 * Generate a value for an item column
 */
function generateItemValue(column: string, index: number, sampleData: string): string {
  const realistic = sampleData !== 'minimal';

  switch (column.toLowerCase()) {
    case 'no':
    case 'item_no':
      return (index + 1).toString();
    
    case 'name':
    case 'item_name':
    case 'product':
      if (realistic) {
        const products = [
          'オフィスチェア エルゴノミクス',
          'デスク 幅1400mm',
          'モニターアーム 可動式',
          'LEDデスクライト 調光機能付き',
          'キーボード ワイヤレス',
          'マウス エルゴノミクス',
          'Webカメラ フルHD',
          'ヘッドセット ノイズキャンセリング',
          'USBハブ 10ポート',
          'ケーブル整理ボックス',
        ];
        return products[index % products.length] + (index >= 10 ? ` (${Math.floor(index / 10) + 1})` : '');
      }
      return `商品${index + 1}`;
    
    case 'price':
    case 'unit_price':
      if (realistic) {
        const prices = [15000, 45000, 8000, 12000, 5000, 3000, 15000, 20000, 4000, 2500];
        return prices[index % prices.length].toString();
      }
      return '10000';
    
    case 'qty':
    case 'quantity':
      return realistic ? String(Math.floor(Math.random() * 5) + 1) : '1';
    
    case 'unit':
      return '個';
    
    case 'amount':
      return '';
    
    default:
      return realistic ? `データ${index + 1}` : 'TEST';
  }
}
