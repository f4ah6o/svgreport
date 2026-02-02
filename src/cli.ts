#!/usr/bin/env node
// cli.ts
// CLI entry point for svgpaper

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadJobFromZip } from './core/zip-handler.js';
import { parseTemplate, validateTemplateMatch } from './core/template.js';
import { parseSvg } from './core/svg-engine.js';
import { createRenderer } from './core/renderer.js';
import { generateHtml, generateDebugJson } from './core/html-writer.js';
import { SVGReportError } from './types/index.js';

const program = new Command();

program
  .name('svgpaper')
  .description('SVG帳票生成ツール - PDFベースのSVGテンプレートにCSVデータを流し込み印刷')
  .version('0.1.0');

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
      const outputDir = path.join(options.output, manifest.job_id.replace(/[:\/]/g, '_'));
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
  });

program.parse();
