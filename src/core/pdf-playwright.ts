import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { SVGReportError } from '../types/index.js';

export interface PlaywrightPdfOptions {
  command?: string;
  timeoutMs?: number;
  pageSize?: 'A4' | 'A3';
}

export async function generatePdfWithPlaywrightCli(
  svgPages: string[],
  outputPath: string,
  options: PlaywrightPdfOptions = {}
): Promise<void> {
  const command = options.command ?? 'playwright';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pageSize = options.pageSize ?? 'A4';
  const tempDir = path.join(os.tmpdir(), `svgreport-pdf-${randomUUID()}`);
  const htmlPath = path.join(tempDir, 'index.html');

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(htmlPath, buildPrintHtml(svgPages, pageSize), 'utf-8');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await runCommand(command, ['pdf', `file://${htmlPath}`, outputPath], timeoutMs);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function buildPrintHtml(svgPages: string[], pageSize: 'A4' | 'A3'): string {
  const pages = svgPages
    .map((svg) => `<section class="page">${svg}</section>`)
    .join('\n');
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: ${pageSize}; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { page-break-after: always; width: 100%; }
      .page:last-child { page-break-after: auto; }
      svg { width: 100%; height: auto; display: block; }
    </style>
  </head>
  <body>
    ${pages}
  </body>
</html>`;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new SVGReportError(`Failed to spawn ${command}`, undefined, error.message));
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SVGReportError('Playwright PDF conversion timed out', command, `timeout=${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new SVGReportError('Playwright PDF conversion failed', command, stderr || `exit=${code}`));
    });
  });
}

