// core/pdf-converter.ts
// PDF to SVG conversion with pdf2svg and Inkscape fallback

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SVGReportError } from '../types/index.js';

export interface ConversionEngine {
  name: string;
  command: string;
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
  },
  {
    name: 'inkscape',
    command: 'inkscape',
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
  await removeGeneratedSvgFiles(outputDir, prefix);

  if (engine.name === 'pdf2svg') {
    return convertWithPdf2Svg(pdfPath, outputDir, prefix);
  }

  if (engine.name === 'inkscape') {
    return convertWithInkscape(pdfPath, outputDir, prefix);
  }

  return {
    success: false,
    engine: engine.name,
    exitCode: -1,
    stderr: `Unsupported engine: ${engine.name}`,
    outputFiles: [],
    quality: {
      status: 'fail',
      pageCount: 0,
      metrics: [],
      issues: [`Unsupported engine: ${engine.name}`],
    },
  };
}

async function convertWithPdf2Svg(
  pdfPath: string,
  outputDir: string,
  prefix: string
): Promise<ConversionResult> {
  const outputPattern = path.join(outputDir, `${prefix}-%d.svg`);
  const execResult = await runCommand('pdf2svg', [pdfPath, outputPattern, 'all'], pdfPath);

  if (execResult.exitCode !== 0) {
    return toFailedResult('pdf2svg', execResult.exitCode, execResult.stderr);
  }

  const svgFiles = await findGeneratedSvgFiles(outputDir, prefix);
  if (svgFiles.length === 0) {
    return toFailedResult('pdf2svg', execResult.exitCode, 'No SVG files were generated');
  }

  return {
    success: true,
    engine: 'pdf2svg',
    exitCode: execResult.exitCode,
    stderr: execResult.stderr,
    outputFiles: svgFiles,
    quality: await analyzeQuality(svgFiles),
  };
}

async function convertWithInkscape(
  pdfPath: string,
  outputDir: string,
  prefix: string
): Promise<ConversionResult> {
  const pageCount = await getPdfPageCount(pdfPath);
  if (pageCount <= 0) {
    return toFailedResult('inkscape', 1, 'Failed to detect PDF page count');
  }

  const stderrLines: string[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const outputFile = path.join(outputDir, `${prefix}-${page}.svg`);
    const args = [
      pdfPath,
      '--export-type=svg',
      `--export-filename=${outputFile}`,
      `--pdf-page=${page}`,
    ];
    const execResult = await runCommand('inkscape', args, pdfPath);
    if (execResult.stderr) {
      stderrLines.push(execResult.stderr.trim());
    }
    if (execResult.exitCode !== 0) {
      return toFailedResult('inkscape', execResult.exitCode, execResult.stderr);
    }
  }

  const svgFiles = await findGeneratedSvgFiles(outputDir, prefix);
  if (svgFiles.length === 0) {
    return toFailedResult('inkscape', 0, 'No SVG files were generated');
  }

  return {
    success: true,
    engine: 'inkscape',
    exitCode: 0,
    stderr: stderrLines.filter(Boolean).join('\n'),
    outputFiles: svgFiles,
    quality: await analyzeQuality(svgFiles),
  };
}

async function getPdfPageCount(pdfPath: string): Promise<number> {
  const info = await runCommand('pdfinfo', [pdfPath], pdfPath);
  if (info.exitCode !== 0) {
    throw new SVGReportError(
      'Failed to inspect PDF page count',
      pdfPath,
      info.stderr || info.stdout || `pdfinfo exit code ${info.exitCode}`
    );
  }
  const match = info.stdout.match(/^Pages:\s+(\d+)/m);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function removeGeneratedSvgFiles(outputDir: string, prefix: string): Promise<void> {
  const files = await fs.readdir(outputDir);
  const targets = files.filter(f => f.startsWith(`${prefix}-`) && f.endsWith('.svg'));
  await Promise.all(targets.map(file => fs.rm(path.join(outputDir, file), { force: true })));
}

async function findGeneratedSvgFiles(outputDir: string, prefix: string): Promise<string[]> {
  const files = await fs.readdir(outputDir);
  return files
    .filter(f => f.startsWith(`${prefix}-`) && f.endsWith('.svg'))
    .sort((a, b) => compareSvgFilenames(a, b, prefix))
    .map(f => path.join(outputDir, f));
}

function compareSvgFilenames(a: string, b: string, prefix: string): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}-(\\d+)\\.svg$`);
  const am = a.match(pattern);
  const bm = b.match(pattern);
  const an = am ? Number.parseInt(am[1], 10) : Number.MAX_SAFE_INTEGER;
  const bn = bm ? Number.parseInt(bm[1], 10) : Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return a.localeCompare(b);
}

function toFailedResult(engine: string, exitCode: number, stderr: string): ConversionResult {
  return {
    success: false,
    engine,
    exitCode,
    stderr,
    outputFiles: [],
    quality: {
      status: 'fail',
      pageCount: 0,
      metrics: [],
      issues: [`Engine exited with code ${exitCode}: ${stderr || 'Unknown error'}`],
    },
  };
}

function runCommand(
  command: string,
  args: string[],
  targetPath: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
      });
    });

    child.on('error', (error) => {
      reject(new SVGReportError(
        `Failed to spawn ${command}`,
        targetPath,
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
