// core/template-importer.ts
// Import PDF and create a template package for GUI workflow

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { TemplateConfig } from '../types/index.js';
import { SVGReportError } from '../types/index.js';
import type { ConversionResult } from './pdf-converter.js';
import { convertPdfToSvg } from './pdf-converter.js';
import type { NormalizationResult } from './svg-normalizer.js';
import { normalizeSvgBatch } from './svg-normalizer.js';

export interface ImportPdfTemplateOptions {
  templateId: string;
  version: string;
  baseDir: string;
  pdfBuffer: Buffer;
  pdfFileName?: string;
  engine?: 'pdf2svg' | 'inkscape' | 'auto';
}

export interface ImportPdfTemplateResult {
  templateDir: string;
  files: string[];
  warnings: string[];
  conversion: ConversionResult;
  normalization: NormalizationResult[];
  pageSummary: {
    converted: number;
    adopted: number;
    ignored: number;
  };
}

/**
 * Import a PDF into a new template directory.
 * Policy:
 * - first page => first/page-1.svg
 * - second page => repeat/page-follow.svg
 * - third+ pages => ignored with warnings
 */
export async function importPdfTemplate(
  options: ImportPdfTemplateOptions
): Promise<ImportPdfTemplateResult> {
  const {
    templateId,
    version,
    baseDir,
    pdfBuffer,
    pdfFileName = 'source.pdf',
    engine = 'auto',
  } = options;

  validateTemplateId(templateId);
  validateVersion(version);

  if (pdfBuffer.length === 0) {
    throw new SVGReportError('PDF content is empty', pdfFileName);
  }

  const templateDir = path.join(baseDir, templateId, version);
  await fs.mkdir(baseDir, { recursive: true });

  if (await pathExists(templateDir)) {
    throw new SVGReportError('Template already exists', templateDir, 'ID_CONFLICT');
  }

  const workDir = path.join(os.tmpdir(), `svgpaper-import-${Date.now()}-${randomUUID()}`);
  const warnings: string[] = [];

  try {
    await fs.mkdir(workDir, { recursive: true });

    const inputPdfPath = path.join(workDir, sanitizePdfName(pdfFileName));
    await fs.writeFile(inputPdfPath, pdfBuffer);

    const convertedDir = path.join(workDir, 'converted');
    const conversion = await convertPdfToSvg(inputPdfPath, convertedDir, {
      engine,
      prefix: 'page',
    });

    if (!conversion.outputFiles.length) {
      throw new SVGReportError('No SVG files generated from PDF', inputPdfPath);
    }

    const normalizedDir = path.join(workDir, 'normalized');
    const normalization = await normalizeSvgBatch(convertedDir, normalizedDir);
    const normalizedFiles = normalization
      .map(r => r.outputFile)
      .sort(compareSvgPagePath);

    const hasRepeat = normalizedFiles.length >= 2;
    const adopted = hasRepeat ? 2 : 1;
    const ignored = Math.max(0, normalizedFiles.length - adopted);

    if (ignored > 0) {
      warnings.push(`Ignored ${ignored} page(s) from the source PDF (only first/repeat are adopted).`);
    }

    await fs.mkdir(path.dirname(templateDir), { recursive: true });
    await fs.mkdir(templateDir);

    const copiedFiles: string[] = [];
    const firstTarget = path.join(templateDir, 'page-1.svg');
    await fs.copyFile(normalizedFiles[0], firstTarget);
    copiedFiles.push(firstTarget);

    if (hasRepeat) {
      const repeatTarget = path.join(templateDir, 'page-follow.svg');
      await fs.copyFile(normalizedFiles[1], repeatTarget);
      copiedFiles.push(repeatTarget);
    }

    const templateJson: TemplateConfig = {
      schema: 'svgreport-template/v0.2',
      template: {
        id: templateId,
        version,
      },
      pages: hasRepeat
        ? [
            { id: 'first', svg: 'page-1.svg', kind: 'first', tables: [] },
            { id: 'repeat', svg: 'page-follow.svg', kind: 'repeat', tables: [] },
          ]
        : [{ id: 'first', svg: 'page-1.svg', kind: 'first', tables: [] }],
      fields: [],
    };

    const templateJsonPath = path.join(templateDir, 'template.json');
    await atomicWriteUtf8(templateJsonPath, JSON.stringify(templateJson, null, 2));
    copiedFiles.push(templateJsonPath);

    return {
      templateDir,
      files: copiedFiles,
      warnings,
      conversion,
      normalization,
      pageSummary: {
        converted: normalizedFiles.length,
        adopted,
        ignored,
      },
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

function validateTemplateId(templateId: string): void {
  if (!templateId || !/^[a-zA-Z0-9_-]+$/.test(templateId)) {
    throw new SVGReportError(
      'Invalid template ID',
      templateId,
      'Use only alphanumeric characters, hyphens, and underscores'
    );
  }
}

function validateVersion(version: string): void {
  if (!version || !/^[a-zA-Z0-9._-]+$/.test(version)) {
    throw new SVGReportError(
      'Invalid version',
      version,
      'Use only alphanumeric characters, dots, hyphens, and underscores'
    );
  }
}

function sanitizePdfName(name: string): string {
  const cleaned = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned) return 'source.pdf';
  if (cleaned.toLowerCase().endsWith('.pdf')) return cleaned;
  return `${cleaned}.pdf`;
}

function pageIndexFromPath(filePath: string): number {
  const base = path.basename(filePath);
  const match = base.match(/(\d+)(?=\.svg$)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(match[1], 10);
}

function compareSvgPagePath(a: string, b: string): number {
  const ai = pageIndexFromPath(a);
  const bi = pageIndexFromPath(b);
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, filePath);
}
