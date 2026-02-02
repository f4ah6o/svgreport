// core/pdf-converter.ts
// PDF to SVG conversion with pdf2svg and Inkscape fallback

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SVGReportError } from '../types/index.js';

export interface ConversionEngine {
  name: string;
  command: string;
  args: string[];
}

export interface ConversionResult {
  success: boolean;
  engine: string;
  exitCode: number;
  stderr: string;
  outputFiles: string[];
  quality: ConversionQuality;
}

export interface ConversionQuality {
  status: 'pass' | 'conditional' | 'fail';
  pageCount: number;
  metrics: PageMetrics[];
  issues: string[];
}

export interface PageMetrics {
  pageNumber: number;
  widthMm: number;
  heightMm: number;
  viewBox: string | null;
  textElementCount: number;
  pathElementCount: number;
  hasImages: boolean;
}

const ENGINES: ConversionEngine[] = [
  {
    name: 'pdf2svg',
    command: 'pdf2svg',
    args: ['{input}', '{output}', '{page}'],
  },
  {
    name: 'inkscape',
    command: 'inkscape',
    args: ['{input}', '--export-type=svg', '--export-filename={output}', '--pdf-page={page}'],
  },
];

/**
 * Convert PDF to SVG using available engines with fallback
 */
export async function convertPdfToSvg(
  pdfPath: string,
  outputDir: string,
  options: {
    engine?: 'pdf2svg' | 'inkscape' | 'auto';
    prefix?: string;
  } = {}
): Promise<ConversionResult> {
  const { engine = 'auto', prefix = 'page' } = options;

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Try engines in order
  const enginesToTry = engine === 'auto' 
    ? ENGINES 
    : ENGINES.filter(e => e.name === engine);

  if (enginesToTry.length === 0) {
    throw new SVGReportError(
      `Unknown conversion engine: ${engine}`,
      pdfPath,
      'Supported engines: pdf2svg, inkscape, auto'
    );
  }

  let lastError: Error | null = null;

  for (const eng of enginesToTry) {
    try {
      console.log(`Trying conversion engine: ${eng.name}`);
      const result = await tryConvertWithEngine(eng, pdfPath, outputDir, prefix);
      
      if (result.success) {
        console.log(`✓ Conversion successful with ${eng.name}`);
        return result;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`✗ ${eng.name} failed: ${lastError.message}`);
    }
  }

  throw new SVGReportError(
    'All conversion engines failed',
    pdfPath,
    lastError?.message || 'No error details available'
  );
}

/**
 * Try converting with a specific engine
 */
async function tryConvertWithEngine(
  engine: ConversionEngine,
  pdfPath: string,
  outputDir: string,
  prefix: string
): Promise<ConversionResult> {
  const outputPattern = path.join(outputDir, `${prefix}-%d.svg`);

  // Build command arguments
  const args = engine.args.map(arg => {
    if (arg === '{input}') return pdfPath;
    if (arg === '{output}') return outputPattern;
    if (arg === '{page}') return '1'; // pdf2svg uses page number
    return arg;
  });

  return new Promise((resolve, reject) => {
    const child = spawn(engine.command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', async (exitCode) => {
      if (exitCode !== 0) {
        resolve({
          success: false,
          engine: engine.name,
          exitCode: exitCode ?? -1,
          stderr,
          outputFiles: [],
          quality: {
            status: 'fail',
            pageCount: 0,
            metrics: [],
            issues: [`Engine exited with code ${exitCode}: ${stderr}`],
          },
        });
        return;
      }

      // Find generated files
      const files = await fs.readdir(outputDir);
      const svgFiles = files
        .filter(f => f.startsWith(prefix) && f.endsWith('.svg'))
        .sort()
        .map(f => path.join(outputDir, f));

      // Analyze quality
      const quality = await analyzeQuality(svgFiles);

      resolve({
        success: true,
        engine: engine.name,
        exitCode: 0,
        stderr,
        outputFiles: svgFiles,
        quality,
      });
    });

    child.on('error', (error) => {
      reject(new SVGReportError(
        `Failed to spawn ${engine.command}`,
        pdfPath,
        error.message
      ));
    });
  });
}

/**
 * Analyze SVG quality after conversion
 */
async function analyzeQuality(svgFiles: string[]): Promise<ConversionQuality> {
  const metrics: PageMetrics[] = [];
  const issues: string[] = [];

  for (let i = 0; i < svgFiles.length; i++) {
    const file = svgFiles[i];
    const content = await fs.readFile(file, 'utf-8');
    
    // Extract viewBox and dimensions
    const viewBoxMatch = content.match(/viewBox="([^"]+)"/);
    const widthMatch = content.match(/width="([^"]+)"/);
    const heightMatch = content.match(/height="([^"]+)"/);

    // Convert to mm (approximate, assuming pt or px)
    const widthMm = widthMatch ? parseDimension(widthMatch[1]) : 0;
    const heightMm = heightMatch ? parseDimension(heightMatch[1]) : 0;

    // Count elements
    const textCount = (content.match(/<text/g) || []).length;
    const pathCount = (content.match(/<path/g) || []).length;
    const hasImages = content.includes('<image');

    // Check for text-as-path (common issue)
    const hasTextPaths = content.match(/<path[^>]*id="[^"]*text[^"]*"/i) !== null ||
                        content.match(/<g[^>]*class="[^"]*text[^"]*"/i) !== null;

    if (hasTextPaths && textCount === 0) {
      issues.push(`Page ${i + 1}: Text appears to be converted to paths (no <text> elements found)`);
    }

    metrics.push({
      pageNumber: i + 1,
      widthMm,
      heightMm,
      viewBox: viewBoxMatch ? viewBoxMatch[1] : null,
      textElementCount: textCount,
      pathElementCount: pathCount,
      hasImages,
    });
  }

  // Determine overall status
  let status: 'pass' | 'conditional' | 'fail' = 'pass';
  
  if (issues.length > 0) {
    status = 'conditional';
  }

  // Check for critical issues
  if (metrics.length === 0 || metrics.some(m => m.widthMm === 0 || m.heightMm === 0)) {
    status = 'fail';
    issues.push('Failed to extract page dimensions');
  }

  return {
    status,
    pageCount: svgFiles.length,
    metrics,
    issues,
  };
}

/**
 * Parse dimension string to mm
 */
function parseDimension(value: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;

  // Assume pt if no unit (common in PDF output)
  // 1 pt = 0.352778 mm
  if (value.includes('pt')) {
    return num * 0.352778;
  }
  
  // Assume px (96 DPI default)
  // 1 px = 0.264583 mm
  if (value.includes('px')) {
    return num * 0.264583;
  }

  // Assume mm
  if (value.includes('mm')) {
    return num;
  }

  // No unit - assume pt (most common from PDF tools)
  return num * 0.352778;
}

/**
 * Print quality report to console
 */
export function printQualityReport(result: ConversionResult): void {
  console.log('\n=== Conversion Quality Report ===');
  console.log(`Engine: ${result.engine}`);
  console.log(`Status: ${result.quality.status.toUpperCase()}`);
  console.log(`Pages: ${result.quality.pageCount}`);

  if (result.quality.issues.length > 0) {
    console.log('\nIssues:');
    for (const issue of result.quality.issues) {
      console.log(`  ⚠ ${issue}`);
    }
  }

  console.log('\nPage Metrics:');
  for (const m of result.quality.metrics) {
    console.log(`  Page ${m.pageNumber}: ${m.widthMm.toFixed(1)}x${m.heightMm.toFixed(1)}mm`);
    console.log(`    Text: ${m.textElementCount}, Paths: ${m.pathElementCount}, Images: ${m.hasImages ? 'Yes' : 'No'}`);
  }

  console.log('\nRecommendations:');
  if (result.quality.status === 'pass') {
    console.log('  ✓ SVG conversion quality is good for template use');
  } else if (result.quality.status === 'conditional') {
    console.log('  ⚠ SVG requires review. Text elements may need manual adjustment.');
  } else {
    console.log('  ✗ SVG conversion failed. Please check the PDF file.');
  }
  console.log('==================================\n');
}
