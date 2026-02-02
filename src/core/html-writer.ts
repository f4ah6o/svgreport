// core/html-writer.ts
// Assemble final HTML with embedded SVG pages

import type { RenderResult, RenderedPage } from '../types/index.js';

export interface HtmlOptions {
  title?: string;
  css?: string;
  includePrintStyles?: boolean;
}

const DEFAULT_CSS = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  
  body {
    font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    background: #f0f0f0;
    padding: 20px;
  }
  
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto 20px;
    background: white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    page-break-after: always;
    page-break-inside: avoid;
  }
  
  .page:last-child {
    page-break-after: auto;
  }
  
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  
  @media print {
    body {
      background: white;
      padding: 0;
    }
    
    .page {
      width: 100%;
      margin: 0;
      box-shadow: none;
      page-break-after: always;
    }
    
    .no-print {
      display: none !important;
    }
  }
  
  @page {
    size: A4;
    margin: 0;
  }
`;

const PRINT_BUTTON_HTML = `
  <div class="no-print" style="text-align: center; margin: 20px;">
    <button onclick="window.print()" style="
      padding: 12px 24px;
      font-size: 16px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    ">
      印刷
    </button>
    <span style="margin-left: 10px; color: #666;">
      Ctrl+P (Windows) / ⌘+P (Mac)
    </span>
  </div>
`;

export function generateHtml(result: RenderResult, options?: HtmlOptions): string {
  const title = options?.title ?? `Report: ${result.jobId}`;
  const css = options?.css ?? DEFAULT_CSS;
  const includePrintStyles = options?.includePrintStyles ?? true;
  
  const pagesHtml = result.pages.map((page, index) => 
    renderPage(page, index + 1, result.totalPages)
  ).join('\n');
  
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
${css}
  </style>
</head>
<body>
${includePrintStyles ? PRINT_BUTTON_HTML : ''}
${pagesHtml}
</body>
</html>`;
}

function renderPage(page: RenderedPage, pageNum: number, totalPages: number): string {
  return `  <div class="page" data-page="${pageNum}" data-total-pages="${totalPages}">
    ${page.svgString}
  </div>`;
}

export function generateDebugJson(result: RenderResult): string {
  const debug = {
    jobId: result.jobId,
    templateId: result.templateId,
    templateVersion: result.templateVersion,
    totalPages: result.totalPages,
    pages: result.pages.map(p => ({
      pageNumber: p.pageNumber,
      svgLength: p.svgString.length,
    })),
  };
  
  return JSON.stringify(debug, null, 2);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
