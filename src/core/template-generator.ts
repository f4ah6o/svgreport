// core/template-generator.ts
// Generate new template package structure

import * as fs from 'fs/promises';
import * as path from 'path';
import { SVGReportError } from '../types/index.js';

export interface TemplateGeneratorOptions {
  templateId: string;
  version: string;
  baseDir: string;
  pageTypes?: ('first' | 'repeat')[];
}

export interface GeneratedTemplate {
  templateDir: string;
  files: string[];
}

/**
 * Generate new template package structure
 */
export async function generateTemplate(
  options: TemplateGeneratorOptions
): Promise<GeneratedTemplate> {
  const { templateId, version, baseDir, pageTypes = ['first', 'repeat'] } = options;

  // Validate inputs
  if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) {
    throw new SVGReportError(
      'Invalid template ID',
      templateId,
      'Use only alphanumeric characters, hyphens, and underscores'
    );
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new SVGReportError(
      'Invalid version',
      version,
      'Use only alphanumeric characters, dots, hyphens, and underscores'
    );
  }

  // Create directory structure
  const templateDir = path.join(baseDir, templateId, version);
  await fs.mkdir(templateDir, { recursive: true });

  const files: string[] = [];

  // Generate template.json
  const templateJson = generateTemplateJson(templateId, version, pageTypes);
  const templateJsonPath = path.join(templateDir, 'template.json');
  await fs.writeFile(templateJsonPath, JSON.stringify(templateJson, null, 2), 'utf-8');
  files.push(templateJsonPath);

  // Generate placeholder SVG files
  for (const pageType of pageTypes) {
    const svgFileName = pageType === 'first' ? 'page-1.svg' : 'page-follow.svg';
    const svgPath = path.join(templateDir, svgFileName);
    const svgContent = generatePlaceholderSvg(pageType);
    await fs.writeFile(svgPath, svgContent, 'utf-8');
    files.push(svgPath);
  }

  // Generate README.md
  const readmePath = path.join(templateDir, 'README.md');
  const readmeContent = generateReadme(templateId, version, pageTypes);
  await fs.writeFile(readmePath, readmeContent, 'utf-8');
  files.push(readmePath);

  return {
    templateDir,
    files,
  };
}

/**
 * Generate template.json structure
 */
function generateTemplateJson(
  templateId: string,
  version: string,
  pageTypes: ('first' | 'repeat')[]
): object {
  const pages = pageTypes.map((kind, index) => {
    const id = kind === 'first' ? 'first' : `repeat-${index}`;
    const svg = kind === 'first' ? 'page-1.svg' : 'page-follow.svg';
    
    return {
      id,
      svg,
      kind,
      tables: [
        {
          source: 'items',
          row_group_id: 'row-template',
          row_height_mm: 8.0,
          rows_per_page: kind === 'first' ? 10 : 15,
          cells: [
            { svg_id: 'item_no', value: { type: 'data', source: 'items', key: 'no' }, align: 'center' },
            { svg_id: 'item_name', value: { type: 'data', source: 'items', key: 'name' }, fit: 'shrink' },
            { svg_id: 'item_qty', value: { type: 'data', source: 'items', key: 'qty' }, align: 'right' },
          ],
        },
      ],
      page_number: {
        svg_id: 'page_no',
        format: '{current}/{total}',
      },
    };
  });

  return {
    schema: 'svgreport-template/v0.2',
    template: {
      id: templateId,
      version,
    },
    pages,
    fields: [],
  };
}

/**
 * Generate placeholder SVG
 */
function generatePlaceholderSvg(pageType: 'first' | 'repeat'): string {
  const isFirst = pageType === 'first';
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     width="210mm" height="297mm" 
     viewBox="0 0 793.7007874015749 1122.5196850393702">
  <defs>
    <style>
      .title { font-family: sans-serif; font-size: 24px; font-weight: bold; }
      .label { font-family: sans-serif; font-size: 12px; }
      .value { font-family: sans-serif; font-size: 12px; }
      .header { font-family: sans-serif; font-size: 10px; font-weight: bold; }
      .data { font-family: sans-serif; font-size: 10px; }
    </style>
  </defs>
  
  ${isFirst ? `
  <!-- First Page Header -->
  <text x="396.85" y="80" class="title" text-anchor="middle" id="document_title">
    請求書
  </text>
  
  <!-- Meta Fields -->
  <text x="50" y="150" class="label">請求先</text>
  <text x="50" y="170" class="value" id="customer_name">顧客名</text>
  <text x="50" y="190" class="value" id="customer_address">住所</text>
  
  <text x="550" y="150" class="label">請求書番号</text>
  <text x="550" y="170" class="value" id="invoice_no">INV-0001</text>
  
  <text x="550" y="200" class="label">発行日</text>
  <text x="550" y="220" class="value" id="issue_date">2026-01-01</text>
  ` : `
  <!-- Repeat Page Header (simplified) -->
  <text x="396.85" y="50" class="label" text-anchor="middle">
    請求書（続き）
  </text>
  `}
  
  <!-- Table Headers -->
  <g id="table-header">
    <rect x="50" y="250" width="693.7" height="20" fill="#f0f0f0" stroke="#000" stroke-width="0.5"/>
    <text x="60" y="264" class="header">No</text>
    <text x="100" y="264" class="header">品名</text>
    <text x="450" y="264" class="header">数量</text>
    <text x="520" y="264" class="header">単位</text>
    <text x="580" y="264" class="header">単価</text>
    <text x="670" y="264" class="header">金額</text>
  </g>
  
  <!-- Row Template -->
  <g id="row-template" transform="translate(0, 280)">
    <rect x="50" y="0" width="693.7" height="30" fill="none" stroke="#000" stroke-width="0.5"/>
    <text x="60" y="20" class="data" id="item_no">1</text>
    <text x="100" y="20" class="data" id="item_name">商品名</text>
    <text x="450" y="20" class="data" id="item_qty" text-anchor="end">1</text>
    <text x="520" y="20" class="data" id="item_unit">個</text>
    <text x="580" y="20" class="data" id="item_price" text-anchor="end">¥0</text>
    <text x="670" y="20" class="data" id="item_amount" text-anchor="end">¥0</text>
  </g>
  
  ${isFirst ? `
  <!-- Summary Section -->
  <text x="500" y="600" class="label" text-anchor="end">小計</text>
  <text x="650" y="600" class="value" id="subtotal" text-anchor="end">¥0</text>
  
  <text x="500" y="620" class="label" text-anchor="end">消費税</text>
  <text x="650" y="620" class="value" id="tax" text-anchor="end">¥0</text>
  
  <text x="500" y="650" class="label" text-anchor="end" style="font-weight: bold;">合計</text>
  <text x="650" y="650" class="value" id="total" text-anchor="end" style="font-weight: bold;">¥0</text>
  ` : ''}
  
  <!-- Page Number -->
  <text x="396.85" y="1070" class="label" text-anchor="middle" id="page_no">
    1/1
  </text>
</svg>`;
}

/**
 * Generate README.md content
 */
function generateReadme(
  templateId: string,
  version: string,
  pageTypes: ('first' | 'repeat')[]
): string {
  return `# ${templateId} v${version}

## 概要

このテンプレートは「${templateId}」帳票用のSVGテンプレートです。

## ファイル構成

${pageTypes.map(pt => `- ${pt === 'first' ? 'page-1.svg' : 'page-follow.svg'}: ${pt === 'first' ? '1枚目' : '2枚目以降'}のページ`).join('\n')}
- template.json: テンプレート設定
- README.md: このファイル

## 編集手順

1. SVGファイルを編集（Inkscapeなど）
2. 差し込み対象のテキスト要素にIDを付与
3. template.jsonにフィールドバインディングを定義
4. \`svgreport validate\` で検証
5. \`svgreport preview\` でプレビュー確認

## 仕様

- ページサイズ: A4 (210x297mm)
- 座標系: 左上原点
- 行テンプレートID: row-template
- ページ番号ID: page_no

## 注意事項

- IDにはASCII文字（a-z, A-Z, 0-9, _, -）のみ使用
- 全角文字や空白を含むIDは自動的に変換されます
- row-template内の要素はデータバインディング対象になります
`;
}
