#!/usr/bin/env node
// cli.ts
// CLI entry point for svgreport

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadJobFromZip } from './core/zip-handler.js';
import { parseTemplate, validateTemplateMatch } from './core/template.js';
import { parseSvg } from './core/svg-engine.js';
import { createRenderer } from './core/renderer.js';
import { generateHtml, generateDebugJson } from './core/html-writer.js';
import { SVGReportError } from './types/index.js';
import { convertPdfToSvg, printQualityReport } from './core/pdf-converter.js';
import { normalizeSvg, normalizeSvgBatch } from './core/svg-normalizer.js';
import { validateTemplateFull, printValidationReport } from './core/template-validator.js';
import { generatePreview } from './core/preview-generator.js';
import { extractTextElements, analyzeTemplateSvgs, printTextReport, exportTextElementsJson } from './core/text-inspector.js';
import { generateTemplate } from './core/template-generator.js';
import { startRpcServer } from './core/rpc-server.js';
import { startReportApiServer } from './core/report-api-server.js';
import { startReportWorker } from './core/report-worker.js';

const program = new Command();

program
  .name('svgreport')
  .description('SVG report generator - Generate printable reports using SVG templates')
  .version('2026.2.0');

program
  .command('render')
  .description('Render a job zip to HTML')
  .argument('<job-zip>', 'Path to job zip file')
  .option('-t, --templates <path>', 'Templates directory', './templates')
  .option('-o, --output <path>', 'Output directory', './out')
  .option('--no-debug', 'Skip debug output')
  .action(async (jobZipPath: string, options) => {
    try {
      console.log(`Processing job: ${jobZipPath}`);
      
      // Load job
      const { manifest, sources } = await loadJobFromZip(jobZipPath);
      console.log(`Loaded job: ${manifest.job_id}`);
      console.log(`Template: ${manifest.template.id} v${manifest.template.version}`);
      
      // Load template
      const templateDir = path.join(
        options.templates,
        manifest.template.id,
        manifest.template.version
      );
      
      const templateJsonPath = path.join(templateDir, 'template.json');
      const templateJson = await fs.readFile(templateJsonPath, 'utf-8');
      const templateConfig = parseTemplate(templateJson);
      
      validateTemplateMatch(templateConfig, manifest.template);
      console.log('Template validated');
      
      // Load SVGs
      const pageSvgs = new Map<string, Document>();
      
      for (const page of templateConfig.pages) {
        const svgPath = path.join(templateDir, page.svg);
        const svgContent = await fs.readFile(svgPath, 'utf-8');
        const svgDoc = parseSvg(svgContent);
        pageSvgs.set(page.id, svgDoc);
      }
      console.log(`Loaded ${pageSvgs.size} page SVGs`);
      
      // Render
      const renderer = createRenderer(manifest, templateConfig, sources, pageSvgs);
      const result = renderer.render({ debug: options.debug });
      
      console.log(`Rendered ${result.totalPages} pages`);
      
      // Create output directory
      const outputDir = path.join(options.output, manifest.job_id.replace(/[:/]/g, '_'));
      await fs.mkdir(outputDir, { recursive: true });
      
      // Write HTML
      const htmlPath = path.join(outputDir, 'index.html');
      const html = generateHtml(result, {
        title: `Job: ${manifest.job_id}`,
        includePrintStyles: true,
      });
      await fs.writeFile(htmlPath, html, 'utf-8');
      console.log(`Written: ${htmlPath}`);
      
      // Write individual SVGs
      const pagesDir = path.join(outputDir, 'pages');
      await fs.mkdir(pagesDir, { recursive: true });
      
      for (const page of result.pages) {
        const pagePath = path.join(pagesDir, `page-${String(page.pageNumber).padStart(3, '0')}.svg`);
        await fs.writeFile(pagePath, page.svgString, 'utf-8');
      }
      console.log(`Written: ${pagesDir}/page-XXX.svg (${result.pages.length} files)`);
      
      // Write debug info
      if (options.debug) {
        const debugDir = path.join(outputDir, 'debug');
        await fs.mkdir(debugDir, { recursive: true });
        
        await fs.writeFile(
          path.join(debugDir, 'job.json'),
          JSON.stringify(manifest, null, 2),
          'utf-8'
        );
        await fs.writeFile(
          path.join(debugDir, 'template.json'),
          JSON.stringify(templateConfig, null, 2),
          'utf-8'
        );
        await fs.writeFile(
          path.join(debugDir, 'render.json'),
          generateDebugJson(result),
          'utf-8'
        );
        console.log(`Written: ${debugDir}/*`);
      }
      
      console.log('\nDone! Open the HTML in a browser:');
      console.log(`  ${htmlPath}`);
      
    } catch (error) {
      handleError(error);
    }
  });

// convert command: PDF to SVG
program
  .command('convert')
  .description('Convert PDF pages to SVG files (pdf2svg/inkscape)')
  .argument('<pdf>', 'Input PDF file')
  .argument('<output>', 'Output directory')
  .option('-e, --engine <engine>', 'Conversion engine (pdf2svg, inkscape, auto)', 'auto')
  .option('-p, --prefix <prefix>', 'Output file prefix', 'page')
  .action(async (pdfPath, outputDir, options) => {
    try {
      console.log(`Converting PDF: ${pdfPath}`);
      console.log(`Output directory: ${outputDir}`);
      console.log(`Engine: ${options.engine}`);

      const result = await convertPdfToSvg(pdfPath, outputDir, {
        engine: options.engine,
        prefix: options.prefix,
      });

      printQualityReport(result);

      if (result.quality.status === 'fail') {
        process.exit(1);
      }

      console.log(`\n✓ Generated ${result.outputFiles.length} SVG files`);
      for (const file of result.outputFiles) {
        console.log(`  - ${file}`);
      }
    } catch (error) {
      handleError(error);
    }
  });

// normalize command: SVG normalization
program
  .command('normalize')
  .description('Normalize SVG files (page size, transforms, cleanup)')
  .argument('<input>', 'Input SVG file or directory')
  .argument('<output>', 'Output file or directory')
  .option('-s, --size <size>', 'Target page size (a4, a3)')
  .option('--no-flatten', 'Skip transform flattening')
  .option('--no-cleanup', 'Skip empty group/def removal')
  .action(async (inputPath, outputPath, options) => {
    try {
      console.log(`Normalizing: ${inputPath}`);
      console.log(`Output: ${outputPath}`);

      const stats = await fs.stat(inputPath);

      if (stats.isDirectory()) {
        // Batch normalization
        const results = await normalizeSvgBatch(inputPath, outputPath, {
          pageSize: options.size,
          flattenTransforms: options.flatten,
          removeEmptyGroups: options.cleanup,
          removeUnusedDefs: options.cleanup,
        });

        console.log(`\n✓ Normalized ${results.length} files`);
        for (const result of results) {
          console.log(`\n${path.basename(result.inputFile)}:`);
          console.log(`  Changes: ${result.changes.length > 0 ? result.changes.join(', ') : 'None'}`);
          if (result.warnings.length > 0) {
            console.log(`  Warnings: ${result.warnings.join(', ')}`);
          }
          console.log(`  Metrics: ${result.metrics.widthMm.toFixed(1)}x${result.metrics.heightMm.toFixed(1)}mm, ${result.metrics.textElementCount} text elements`);
        }
      } else {
        // Single file normalization
        const result = await normalizeSvg(inputPath, outputPath, {
          pageSize: options.size,
          flattenTransforms: options.flatten,
          removeEmptyGroups: options.cleanup,
          removeUnusedDefs: options.cleanup,
        });

        console.log(`\n✓ Normalized: ${path.basename(result.inputFile)}`);
        console.log(`  Changes: ${result.changes.length > 0 ? result.changes.join(', ') : 'None'}`);
        if (result.warnings.length > 0) {
          console.log(`  Warnings: ${result.warnings.join(', ')}`);
        }
        console.log(`  Output: ${result.outputFile}`);
        console.log(`  Metrics: ${result.metrics.widthMm.toFixed(1)}x${result.metrics.heightMm.toFixed(1)}mm, ${result.metrics.textElementCount} text elements`);
      }
    } catch (error) {
      handleError(error);
    }
  });

// validate command: Template validation
program
  .command('validate')
  .description('Validate template.json against schema and SVG references')
  .argument('<template>', 'Template directory (contains template.json)')
  .action(async (templateDir) => {
    try {
      const templateJsonPath = path.join(templateDir, 'template.json');
      
      console.log(`Validating template: ${templateJsonPath}`);

      const result = await validateTemplateFull(templateJsonPath, templateDir);
      printValidationReport(result);

      process.exit(result.valid ? 0 : 1);
    } catch (error) {
      handleError(error);
    }
  });

// preview command: Generate preview with dummy data
program
  .command('preview')
  .description('Generate preview HTML/SVG from template with sample data')
  .argument('<template>', 'Template directory (contains template.json)')
  .option('-o, --output <path>', 'Output directory', './preview-out')
  .option('-s, --sample <type>', 'Sample data type (minimal, realistic, multi-page)', 'realistic')
  .option('--no-debug', 'Skip debug output')
  .action(async (templateDir, options) => {
    try {
      console.log(`Generating preview for template: ${templateDir}`);
      console.log(`Sample data: ${options.sample}`);

      const result = await generatePreview(templateDir, {
        sampleData: options.sample,
        outputDir: options.output,
        includeDebug: options.debug,
      });

      console.log('\n=== Preview Generation Complete ===');
      console.log(`Template: ${result.templateId} ${result.templateVersion}`);
      console.log(`Pages: ${result.pageCount}`);
      console.log(`Data: ${result.dataSummary.metaFields} meta fields, ${result.dataSummary.itemCount} items`);
      console.log(`\n✓ HTML: ${result.htmlPath}`);
      console.log(`✓ SVG Pages: ${path.join(result.outputDir, 'pages')}/`);
      if (options.debug) {
        console.log(`✓ Debug: ${path.join(result.outputDir, 'debug')}/`);
      }
      console.log('\nOpen the HTML in a browser:');
      console.log(`  ${result.htmlPath}`);
      console.log('====================================\n');
    } catch (error) {
      handleError(error);
    }
  });

// inspect-text command: Extract and analyze text elements
program
  .command('inspect-text')
  .description('Extract and analyze text elements from SVG for template editing')
  .argument('<path>', 'SVG file or template directory')
  .option('-j, --json <path>', 'Export to JSON file')
  .action(async (inputPath, options) => {
    try {
      const stats = await fs.stat(inputPath);

      if (stats.isDirectory()) {
        // Analyze all SVG files in directory
        console.log(`Analyzing SVG files in: ${inputPath}`);
        const analyses = await analyzeTemplateSvgs(inputPath);
        
        for (const analysis of analyses) {
          printTextReport(analysis);
        }

        console.log(`\n✓ Analyzed ${analyses.length} SVG files`);
      } else {
        // Analyze single SVG file
        console.log(`Analyzing SVG: ${inputPath}`);
        const analysis = await extractTextElements(inputPath);
        printTextReport(analysis);

        // Export to JSON if requested
        if (options.json) {
          await exportTextElementsJson(inputPath, options.json);
          console.log(`✓ Exported to JSON: ${options.json}`);
        }
      }
    } catch (error) {
      handleError(error);
    }
  });

// generate command: Create new template package
program
  .command('generate')
  .description('Generate new template package structure')
  .argument('<id>', 'Template ID (alphanumeric, hyphens, underscores)')
  .argument('<version>', 'Template version (e.g., v1, v2.0)')
  .option('-d, --dir <path>', 'Base templates directory', './templates')
  .option('-p, --pages <types>', 'Page types (first,repeat)', 'first,repeat')
  .action(async (templateId, version, options) => {
    try {
      const pageTypes = options.pages.split(',') as ('first' | 'repeat')[];
      
      console.log(`Generating template: ${templateId} v${version}`);
      console.log(`Location: ${options.dir}`);
      console.log(`Pages: ${pageTypes.join(', ')}`);

      const result = await generateTemplate({
        templateId,
        version,
        baseDir: options.dir,
        pageTypes,
      });

      console.log('\n=== Template Generated ===');
      console.log(`Directory: ${result.templateDir}`);
      console.log('\nFiles created:');
      for (const file of result.files) {
        console.log(`  ✓ ${path.basename(file)}`);
      }
      console.log('\nNext steps:');
      console.log(`  1. Edit SVG files: ${path.join(result.templateDir, '*.svg')}`);
      console.log(`  2. Add field bindings to: ${path.join(result.templateDir, 'template.json')}`);
      console.log(`  3. Validate: svgreport validate ${result.templateDir}`);
      console.log(`  4. Preview: svgreport preview ${result.templateDir}`);
      console.log('=========================\n');
    } catch (error) {
      handleError(error);
    }
  });

// server command: Start RPC server
program
  .command('server')
  .description('Start UI-Proxy RPC server')
  .option('-p, --port <number>', 'Server port', '8788')
  .option('-h, --host <address>', 'Bind address', '127.0.0.1')
  .option('-r, --root <path>', 'Workspace root directory', '.')
  .option('--templates <path>', 'Default templates directory', 'templates')
  .option('--output <path>', 'Default output directory', 'out')
  .option('--ui-remote-url <url>', 'UI remote URL for reverse proxy (e.g., https://intra-ui.example/svgpaper-ui/v0.1/)')
  .option('--ui-allow-host <hosts>', 'Comma-separated list of allowed UI hosts (default: localhost,127.0.0.1)', 'localhost,127.0.0.1')
  .option('--ui-static-dir <path>', 'Serve UI from local directory (e.g., ./ui/dist)')
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      const uiAllowHosts = options.uiAllowHost.split(',').map((h: string) => h.trim());
      const serverOptions = {
        port,
        host: options.host,
        root: options.root,
        templatesDir: options.templates,
        outputDir: options.output,
        uiRemoteUrl: options.uiRemoteUrl,
        uiAllowHosts,
        uiStaticDir: options.uiStaticDir,
      };

      await startRpcServer(serverOptions);
      // Keep process alive
      await new Promise(() => {});
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('report-api')
  .description('Start kintone report API server')
  .option('-p, --port <number>', 'Server port', process.env.REPORT_API_PORT ?? '8790')
  .option('-h, --host <address>', 'Bind address', process.env.REPORT_API_HOST ?? '127.0.0.1')
  .option('--auth-token <token>', 'Bearer token for plugin/API caller', process.env.REPORT_API_AUTH_TOKEN)
  .option('--kintone-base-url <url>', 'kintone base URL', process.env.KINTONE_BASE_URL)
  .option('--kintone-api-token <token>', 'kintone API token (comma-separated)', process.env.KINTONE_API_TOKEN)
  .option('--queue-app <id>', 'kintone app id for job queue', process.env.REPORT_JOB_APP_ID)
  .option('--template-app <id>', 'kintone app id for template store', process.env.REPORT_TEMPLATE_APP_ID)
  .action(async (options) => {
    try {
      const config = resolveKintoneConfig(options.kintoneBaseUrl, options.kintoneApiToken);
      const queueApp = requiredAppId(options.queueApp, 'REPORT_JOB_APP_ID');
      const templateApp = requiredAppId(options.templateApp, 'REPORT_TEMPLATE_APP_ID');
      await startReportApiServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
        authToken: options.authToken,
        kintone: config,
        queue: {
          app: queueApp,
          fields: getQueueFieldMap(),
        },
        templates: {
          app: templateApp,
          fields: getTemplateFieldMap(),
        },
      });
      await new Promise(() => {});
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('report-worker')
  .description('Start kintone report async worker')
  .option('--kintone-base-url <url>', 'kintone base URL', process.env.KINTONE_BASE_URL)
  .option('--kintone-api-token <token>', 'kintone API token (comma-separated)', process.env.KINTONE_API_TOKEN)
  .option('--queue-app <id>', 'kintone app id for job queue', process.env.REPORT_JOB_APP_ID)
  .option('--template-app <id>', 'kintone app id for template store', process.env.REPORT_TEMPLATE_APP_ID)
  .option('--poll-ms <number>', 'Poll interval milliseconds', process.env.REPORT_WORKER_POLL_MS ?? '5000')
  .option('--retry-backoff-ms <number>', 'Base retry backoff milliseconds', process.env.REPORT_WORKER_RETRY_BACKOFF_MS ?? '10000')
  .option('--playwright-command <cmd>', 'Playwright CLI command', process.env.REPORT_PLAYWRIGHT_CMD ?? 'playwright')
  .action(async (options) => {
    try {
      const config = resolveKintoneConfig(options.kintoneBaseUrl, options.kintoneApiToken);
      const queueApp = requiredAppId(options.queueApp, 'REPORT_JOB_APP_ID');
      const templateApp = requiredAppId(options.templateApp, 'REPORT_TEMPLATE_APP_ID');
      await startReportWorker({
        kintone: config,
        queue: {
          app: queueApp,
          fields: getQueueFieldMap(),
        },
        templates: {
          app: templateApp,
          fields: getTemplateFieldMap(),
        },
        pollIntervalMs: Number.parseInt(options.pollMs, 10),
        retryBackoffMs: Number.parseInt(options.retryBackoffMs, 10),
        playwrightCommand: options.playwrightCommand,
      });
    } catch (error) {
      handleError(error);
    }
  });

function resolveKintoneConfig(baseUrl?: string, apiTokenRaw?: string): { baseUrl: string; apiToken: string | string[] } {
  if (!baseUrl) {
    throw new SVGReportError('Missing kintone base URL', 'KINTONE_BASE_URL');
  }
  if (!apiTokenRaw) {
    throw new SVGReportError('Missing kintone API token', 'KINTONE_API_TOKEN');
  }
  const tokens = apiTokenRaw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!tokens.length) {
    throw new SVGReportError('No valid kintone API token provided', 'KINTONE_API_TOKEN');
  }
  return {
    baseUrl,
    apiToken: tokens.length === 1 ? tokens[0] : tokens,
  };
}

function requiredAppId(raw: string | undefined, envName: string): number {
  if (!raw) {
    throw new SVGReportError(`Missing app id: ${envName}`);
  }
  const appId = Number.parseInt(raw, 10);
  if (!Number.isFinite(appId) || appId <= 0) {
    throw new SVGReportError(`Invalid app id: ${raw}`, envName);
  }
  return appId;
}

function getQueueFieldMap() {
  return {
    jobId: process.env.REPORT_JOB_FIELD_JOB_ID ?? 'job_id',
    idempotencyKey: process.env.REPORT_JOB_FIELD_IDEMPOTENCY_KEY ?? 'idempotency_key',
    status: process.env.REPORT_JOB_FIELD_STATUS ?? 'status',
    appId: process.env.REPORT_JOB_FIELD_APP_ID ?? 'source_app_id',
    recordId: process.env.REPORT_JOB_FIELD_RECORD_ID ?? 'source_record_id',
    templateActionCode: process.env.REPORT_JOB_FIELD_TEMPLATE_ACTION_CODE ?? 'template_action_code',
    templateCode: process.env.REPORT_JOB_FIELD_TEMPLATE_CODE ?? 'template_code',
    templateVersion: process.env.REPORT_JOB_FIELD_TEMPLATE_VERSION ?? 'template_version',
    requestedBy: process.env.REPORT_JOB_FIELD_REQUESTED_BY ?? 'requested_by',
    attempts: process.env.REPORT_JOB_FIELD_ATTEMPTS ?? 'attempts',
    maxAttempts: process.env.REPORT_JOB_FIELD_MAX_ATTEMPTS ?? 'max_attempts',
    nextRunAt: process.env.REPORT_JOB_FIELD_NEXT_RUN_AT ?? 'next_run_at',
    startedAt: process.env.REPORT_JOB_FIELD_STARTED_AT ?? 'started_at',
    finishedAt: process.env.REPORT_JOB_FIELD_FINISHED_AT ?? 'finished_at',
    inputSnapshotJson: process.env.REPORT_JOB_FIELD_INPUT_SNAPSHOT_JSON ?? 'input_snapshot_json',
    renderDebugJson: process.env.REPORT_JOB_FIELD_RENDER_DEBUG_JSON ?? 'render_debug_json',
    outputPdf: process.env.REPORT_JOB_FIELD_OUTPUT_PDF ?? 'output_pdf',
    outputSvgZip: process.env.REPORT_JOB_FIELD_OUTPUT_SVG_ZIP ?? 'rendered_svgs_zip',
    errorCode: process.env.REPORT_JOB_FIELD_ERROR_CODE ?? 'error_code',
    errorMessage: process.env.REPORT_JOB_FIELD_ERROR_MESSAGE ?? 'error_message',
  };
}

function getTemplateFieldMap() {
  return {
    templateCode: process.env.REPORT_TEMPLATE_FIELD_TEMPLATE_CODE ?? 'template_code',
    version: process.env.REPORT_TEMPLATE_FIELD_VERSION ?? 'version',
    sourceAppId: process.env.REPORT_TEMPLATE_FIELD_SOURCE_APP_ID ?? 'source_app_id',
    status: process.env.REPORT_TEMPLATE_FIELD_STATUS ?? 'status',
    publishedSeq: process.env.REPORT_TEMPLATE_FIELD_PUBLISHED_SEQ ?? 'published_seq',
    actionCode: process.env.REPORT_TEMPLATE_FIELD_ACTION_CODE ?? 'action_code',
    templateJson: process.env.REPORT_TEMPLATE_FIELD_TEMPLATE_JSON ?? 'template_json',
    page1Svg: process.env.REPORT_TEMPLATE_FIELD_PAGE1_SVG ?? 'page_1_svg',
    pageFollowSvg: process.env.REPORT_TEMPLATE_FIELD_PAGE_FOLLOW_SVG ?? 'page_follow_svg',
  };
}

function handleError(error: unknown): void {
  if (error instanceof SVGReportError) {
    console.error(`\nError: ${error.message}`);
    if (error.path) console.error(`  Path: ${error.path}`);
    if (error.reason) console.error(`  Reason: ${error.reason}`);
  } else if (error instanceof Error) {
    console.error(`\nError: ${error.message}`);
    console.error(error.stack);
  } else {
    console.error('\nUnknown error:', error);
  }
  process.exit(1);
}

program.parse();
