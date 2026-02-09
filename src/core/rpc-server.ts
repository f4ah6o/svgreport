// core/rpc-server.ts
// HTTP RPC server for UI-Proxy API

import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { TemplateConfig } from '../types/index.js';
import { extractTextElements, analyzeTemplateSvgs } from './text-inspector.js';
import { validateTemplateFull, type ValidationResult } from './template-validator.js';
import { generatePreview } from './preview-generator.js';
import { generateTemplate } from './template-generator.js';
import { SVGREPORT_JOB_V0_1_SCHEMA, SVGREPORT_TEMPLATE_V0_2_SCHEMA } from './schema-registry.js';
import { parseCsv, parseJsonToKv } from './datasource.js';
const PACKAGE_VERSION = '2026.2.0';
const API_VERSION = 'rpc/v0.1';

export interface ServerOptions {
  port?: number;
  host?: string;
  root?: string;
  templatesDir?: string;
  outputDir?: string;
  uiRemoteUrl?: string;
  uiAllowHosts?: string[];
  uiStaticDir?: string;
}

interface RpcError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface RpcResponse {
  error?: RpcError;
  [key: string]: unknown;
}

export class RpcServer {
  private server: http.Server;
  private root: string;
  private templatesDir: string;
  private outputDir: string;

  constructor(private options: ServerOptions = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.templatesDir = options.templatesDir || 'templates';
    this.outputDir = options.outputDir || 'out';
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  start(): Promise<void> {
    const port = this.options.port || 8788;
    const host = this.options.host || '127.0.0.1';

    return new Promise((resolve, reject) => {
      this.server.listen(port, host, () => {
        console.log(`RPC Server started on http://${host}:${port}`);
        console.log(`Workspace root: ${this.root}`);
        if (host !== '127.0.0.1') {
          console.warn('Warning: Server bound to non-localhost address. Ensure proper firewall rules.');
        }
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private validateUiRemoteUrl(): { valid: boolean; targetUrl?: URL; error?: string } {
    const uiRemoteUrl = this.options.uiRemoteUrl;
    if (!uiRemoteUrl) {
      return { valid: false, error: 'UI remote URL not configured' };
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(uiRemoteUrl);
    } catch {
      return { valid: false, error: 'Invalid UI remote URL format' };
    }

    // Only allow http/https protocols
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are supported' };
    }

    // Validate host against allowlist
    const allowHosts = this.options.uiAllowHosts || ['localhost', '127.0.0.1'];
    const targetHost = targetUrl.hostname;

    const isAllowed = allowHosts.some(allowedHost => {
      // Support exact match and wildcard subdomains
      if (allowedHost === targetHost) return true;
      if (allowedHost.startsWith('*.')) {
        const domain = allowedHost.slice(2);
        return targetHost === domain || targetHost.endsWith('.' + domain);
      }
      return false;
    });

    if (!isAllowed) {
      return { valid: false, error: `Host '${targetHost}' is not in the allowlist` };
    }

    return { valid: true, targetUrl };
  }

  private async proxyRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    targetUrl: URL,
    pathname: string
  ): Promise<void> {
    return new Promise((resolve) => {
      // Build the target URL with the original path and query string
      const targetPath = pathname + (req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      const proxyUrl = new URL(targetPath, targetUrl);

      // Filter headers to forward
      const headers: http.OutgoingHttpHeaders = {};
      const skipHeaders = ['host', 'connection', 'content-length', 'transfer-encoding'];

      for (const [key, value] of Object.entries(req.headers)) {
        if (!skipHeaders.includes(key.toLowerCase()) && value !== undefined) {
          headers[key] = value;
        }
      }

      // Set the correct host header
      headers['Host'] = targetUrl.host;

      const requestOptions: http.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
        path: proxyUrl.pathname + proxyUrl.search,
        method: req.method,
        headers,
        timeout: 30000, // 30 second timeout
      };

      const proxyReq = (targetUrl.protocol === 'https:' ? https : http).request(
        requestOptions,
        (proxyRes) => {
          // Copy status code and headers
          res.statusCode = proxyRes.statusCode || 200;

          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (value !== undefined) {
              res.setHeader(key, value);
            }
          }

          // Pipe the response
          proxyRes.pipe(res);
          proxyRes.on('end', () => resolve());
        }
      );

      proxyReq.on('error', (error) => {
        console.error('Proxy error:', error);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'PROXY_ERROR',
            message: 'Failed to proxy request to UI remote',
          },
        }));
        resolve();
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.statusCode = 504;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'PROXY_TIMEOUT',
            message: 'Proxy request timed out',
          },
        }));
        resolve();
      });

      // Pipe request body if present
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.eot': 'application/vnd.ms-fontobject',
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  private async serveStaticFile(
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    if (!this.options.uiStaticDir) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'Static directory not configured',
        },
      }));
      return;
    }

    const staticDir = path.resolve(this.options.uiStaticDir);

    // Map URL path to file path
    let filePath = pathname === '/' ? '/index.html' : pathname;
    const fullPath = path.join(staticDir, filePath);

    // Security: Check for path traversal - ensure resolved path is within staticDir
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(staticDir)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      }));
      return;
    }

    try {
      const stats = await fs.stat(resolvedPath);

      if (!stats.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'File not found',
          },
        }));
        return;
      }

      // Read and serve the file
      const content = await fs.readFile(resolvedPath);
      const contentType = this.getContentType(resolvedPath);

      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(content);
    } catch (error) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'File not found',
        },
      }));
    }
  }

  private async serveOutputFile(
    res: http.ServerResponse,
    pathname: string
  ): Promise<void> {
    // Remove '/out' prefix to get the relative path
    const relativePath = pathname.slice(4); // Remove '/out'
    const fullPath = path.join(this.root, 'out', relativePath);

    // Security: Check for path traversal
    const outDir = path.join(this.root, 'out');
    const resolvedPath = path.resolve(fullPath);
    if (!resolvedPath.startsWith(outDir)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
        },
      }));
      return;
    }

    try {
      const stats = await fs.stat(resolvedPath);

      if (!stats.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'File not found',
          },
        }));
        return;
      }

      // Read and serve the file
      const content = await fs.readFile(resolvedPath);
      const contentType = this.getContentType(resolvedPath);

      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(content);
    } catch (error) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'File not found',
        },
      }));
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = this.generateRequestId();
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Set CORS headers for same-origin (no CORS needed per spec, but helpful for development)
    res.setHeader('Content-Type', 'application/json');

    try {
      let response: RpcResponse;

      if (pathname === '/rpc/version' && req.method === 'GET') {
        response = await this.handleVersion();
      } else if (pathname.startsWith('/rpc/schema/') && req.method === 'GET') {
        const schemaName = pathname.slice('/rpc/schema/'.length);
        response = await this.handleSchema(schemaName);
      } else if (pathname === '/rpc/workspace' && req.method === 'GET') {
        response = await this.handleWorkspace();
      } else if (pathname === '/rpc/templates/list' && req.method === 'GET') {
        const baseDir = url.searchParams.get('baseDir') || this.templatesDir;
        response = await this.handleTemplatesList(baseDir);
      } else if (pathname === '/rpc/inspect-text' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleInspectText(body);
      } else if (pathname === '/rpc/svg/read' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleSvgRead(body);
      } else if (pathname === '/rpc/svg/write' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleSvgWrite(body);
      } else if (pathname === '/rpc/svg/set-ids' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleSvgSetIds(body);
      } else if (pathname === '/rpc/data/parse-csv' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleParseCsv(body);
      } else if (pathname === '/rpc/data/parse-json' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleParseJson(body);
      } else if (pathname === '/rpc/data/fetch' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleFetchData(body);
      } else if (pathname === '/rpc/validate' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleValidate(body);
      } else if (pathname === '/rpc/preview' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handlePreview(body);
      } else if (pathname === '/rpc/template/load' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleTemplateLoad(body);
      } else if (pathname === '/rpc/template/save' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleTemplateSave(body);
      } else if (pathname === '/rpc/generate' && req.method === 'POST') {
        const body = await this.parseBody(req);
        response = await this.handleGenerate(body);
      } else if (pathname.startsWith('/rpc/')) {
        // Unknown RPC endpoint
        res.statusCode = 404;
        response = { error: { code: 'NOT_FOUND', message: `RPC endpoint not found: ${pathname}` } };
      } else if (pathname.startsWith('/out/')) {
        // Serve preview/output files
        await this.serveOutputFile(res, pathname);
        return;
      } else {
        // Not an RPC request - try to serve static files from uiStaticDir
        if (this.options.uiStaticDir) {
          await this.serveStaticFile(res, pathname);
          return;
        }
        
        // Try to proxy to remote UI
        const validation = this.validateUiRemoteUrl();
        if (validation.valid && validation.targetUrl) {
          await this.proxyRequest(req, res, validation.targetUrl, pathname);
          return;
        }
        
        // Neither static dir nor proxy configured
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: {
            code: 'NOT_FOUND',
            message: 'No UI configured. Use --ui-static-dir or --ui-remote-url.',
          },
        }));
        return;
      }

      // Add request_id to all responses
      response.request_id = requestId;

      if (response.error) {
        const statusCode = this.getErrorStatusCode(response.error.code);
        res.statusCode = statusCode;
      } else {
        res.statusCode = 200;
      }

      res.end(JSON.stringify(response));
    } catch (error) {
      console.error(`[${requestId}] Error:`, error);
      res.statusCode = 500;
      const errorResponse: RpcResponse = {
        request_id: requestId,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
      res.end(JSON.stringify(errorResponse));
    }
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON in request body'));
        }
      });
      req.on('error', reject);
    });
  }

  private getErrorStatusCode(code: string): number {
    switch (code) {
      case 'BAD_REQUEST':
      case 'INVALID_JSON':
        return 400;
      case 'PATH_TRAVERSAL':
      case 'NOT_FOUND':
        return 404;
      case 'ID_CONFLICT':
        return 409;
      default:
        return 500;
    }
  }

  private resolvePath(inputPath: string): string {
    const resolved = path.resolve(this.root, inputPath);
    // Security: Check if resolved path is within root
    if (!resolved.startsWith(this.root)) {
      throw new Error('PATH_TRAVERSAL');
    }
    return resolved;
  }

  private validateHttpUrl(url: string): URL {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('INVALID_URL');
    }
    return parsed;
  }

  // ============================================
  // Endpoint Handlers
  // ============================================

  private async handleVersion(): Promise<RpcResponse> {
    return {
      app: {
        name: 'svgpaper',
        version: PACKAGE_VERSION,
      },
      api: {
        version: API_VERSION,
      },
      schemas: {
        job: {
          id: 'svgreport-job/v0.1',
          schema_id: 'svgreport-job/v0.1.schema.json',
        },
        template: {
          id: 'svgreport-template/v0.2',
          schema_id: 'svgreport-template/v0.2.schema.json',
        },
      },
      capabilities: {
        convert: true,
        normalize: true,
        validate: true,
        preview: true,
        inspectText: true,
        generate: true,
        wrap: false,
      },
    };
  }

  private async handleSchema(name: string): Promise<RpcResponse> {
    if (name === 'job') {
      return { schema: SVGREPORT_JOB_V0_1_SCHEMA };
    } else if (name === 'template') {
      return { schema: SVGREPORT_TEMPLATE_V0_2_SCHEMA };
    } else {
      return { error: { code: 'NOT_FOUND', message: `Schema not found: ${name}` } };
    }
  }

  private async handleWorkspace(): Promise<RpcResponse> {
    return {
      root: this.root,
      templatesDirDefault: this.templatesDir,
      outputDirDefault: this.outputDir,
    };
  }

  private async handleTemplatesList(baseDir: string): Promise<RpcResponse> {
    try {
      const templatesPath = this.resolvePath(baseDir);
      const entries = await fs.readdir(templatesPath, { withFileTypes: true });
      const templates: Array<{ id: string; version: string; path: string }> = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const templateId = entry.name;
          const templatePath = path.join(templatesPath, templateId);
          const versions = await fs.readdir(templatePath, { withFileTypes: true });

          for (const versionEntry of versions) {
            if (versionEntry.isDirectory()) {
              const version = versionEntry.name;
              const templateDir = path.join(baseDir, templateId, version);
              templates.push({ id: templateId, version, path: templateDir });
            }
          }
        }
      }

      return { templates };
    } catch (error) {
      return { error: { code: 'NOT_FOUND', message: `Cannot list templates: ${error}` } };
    }
  }

  private async handleInspectText(body: Record<string, unknown>): Promise<RpcResponse> {
    const { path: inputPath, options = {} } = body as { path: string; options?: { includePathTextWarnings?: boolean; suggestIds?: boolean } };

    if (!inputPath) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field: path' } };
    }

    try {
      const resolvedPath = this.resolvePath(inputPath);
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        // Analyze template directory (all SVGs)
        const analyses = await analyzeTemplateSvgs(resolvedPath);
        return {
          directory: inputPath,
          files: analyses.map(a => this.formatInspectTextResponse(a, options)),
        };
      } else {
        // Single file
        const analysis = await extractTextElements(resolvedPath);
        return this.formatInspectTextResponse(analysis, options);
      }
    } catch (error) {
      return { error: { code: 'NOT_FOUND', message: `Cannot inspect text: ${error}` } };
    }
  }

  private async handleSvgRead(body: Record<string, unknown>): Promise<RpcResponse> {
    const { path: inputPath } = body as { path: string };

    if (!inputPath) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field: path' } };
    }

    try {
      const resolvedPath = this.resolvePath(inputPath);
      const content = await fs.readFile(resolvedPath, 'utf-8');

      return {
        contentType: 'image/svg+xml',
        svg: content,
      };
    } catch (error) {
      return { error: { code: 'NOT_FOUND', message: `Cannot read SVG: ${error}` } };
    }
  }

  private async handleSvgWrite(body: Record<string, unknown>): Promise<RpcResponse> {
    const { path: inputPath, svg } = body as { path: string; svg: string };

    if (!inputPath || !svg) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: path, svg' } };
    }

    if (!inputPath.endsWith('.svg')) {
      return { error: { code: 'BAD_REQUEST', message: 'Target path must be an .svg file' } };
    }

    try {
      const resolvedPath = this.resolvePath(inputPath);
      const tempPath = `${resolvedPath}.tmp`;
      await fs.writeFile(tempPath, svg, 'utf-8');
      await fs.rename(tempPath, resolvedPath);
      return { saved: true, writtenPath: inputPath };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Cannot write SVG: ${error}` } };
    }
  }

  private formatInspectTextResponse(analysis: Awaited<ReturnType<typeof extractTextElements>>, options: { includePathTextWarnings?: boolean; suggestIds?: boolean }): RpcResponse {
    const warnings: Array<{ code: string; message: string }> = [];

    if (options.includePathTextWarnings && analysis.statistics.pathText > 0) {
      warnings.push({
        code: 'PATH_TEXT_DETECTED',
        message: `Found ${analysis.statistics.pathText} potential text-as-path elements`,
      });
    }

    return {
      file: path.relative(this.root, analysis.file),
      page: {
        widthMm: analysis.pageSize.unit === 'mm' ? analysis.pageSize.width : analysis.pageSize.width * 0.264583,
        heightMm: analysis.pageSize.unit === 'mm' ? analysis.pageSize.height : analysis.pageSize.height * 0.264583,
      },
      warnings,
      texts: analysis.textElements.map((el, index) => {
        const bbox = estimateTextBBox(el.content, el.x, el.y, el.fontSize, el.textAnchor);
        return {
          index: index + 1,
          domIndex: el.domIndex,
          id: el.id,
          suggestedId: options.suggestIds !== false ? el.suggestedId : undefined,
          text: el.content,
          bbox,
          position: { x: el.x, y: el.y },
          font: { size: el.fontSize },
        };
      }),
    };
  }

  private async handleSvgSetIds(body: Record<string, unknown>): Promise<RpcResponse> {
    const { path: inputPath, assignments } = body as {
      path: string;
      assignments: Array<{ selector: { byIndex?: number }; id: string }>;
    };

    if (!inputPath || !assignments) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: path, assignments' } };
    }

    try {
      const resolvedPath = this.resolvePath(inputPath);

      // Read SVG
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'image/svg+xml');
      const svg = doc.documentElement;

      if (!svg) {
        return { error: { code: 'BAD_REQUEST', message: 'Invalid SVG file' } };
      }

      // Get all elements with IDs
      const allElements = Array.from(svg.getElementsByTagName('*'));
      const existingIds = new Set<string>();
      for (const el of allElements) {
        const id = el.getAttribute('id');
        if (id) existingIds.add(id);
      }

      // Check for conflicts
      const conflicts: string[] = [];
      for (const assignment of assignments) {
        if (existingIds.has(assignment.id)) {
          conflicts.push(assignment.id);
        }
      }

      if (conflicts.length > 0) {
        return {
          error: {
            code: 'ID_CONFLICT',
            message: `ID conflicts detected: ${conflicts.join(', ')}`,
          },
        };
      }

      // Get text elements sorted by position (same as inspect-text)
      const textNodes = Array.from(svg.getElementsByTagName('text'));
      const textElements = textNodes.map((text) => ({
        element: text,
        x: parseFloat(text.getAttribute('x') || '0'),
        y: parseFloat(text.getAttribute('y') || '0'),
      }));

      // Sort by Y, then X
      textElements.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 5) return a.x - b.x;
        return a.y - b.y;
      });

      // Assign sorted index (1-based) to match inspect-text ordering
      const indexedTextElements = textElements.map((item, idx) => ({
        ...item,
        index: idx + 1,
      }));

      // Assign IDs
      let updated = false;
      for (const assignment of assignments) {
        if (assignment.selector.byIndex) {
          const target = indexedTextElements.find(t => t.index === assignment.selector.byIndex);
          if (target) {
            target.element.setAttribute('id', assignment.id);
            updated = true;
          }
        }
      }

      // Write back atomically
      if (updated) {
        const serializer = new XMLSerializer();
        const updatedContent = serializer.serializeToString(doc);
        const tempPath = `${resolvedPath}.tmp`;
        await fs.writeFile(tempPath, updatedContent, 'utf-8');
        await fs.rename(tempPath, resolvedPath);
      }

      return {
        updated,
        conflicts: [],
        writtenPath: inputPath,
      };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Failed to set IDs: ${error}` } };
    }
  }

  private async handleParseCsv(body: Record<string, unknown>): Promise<RpcResponse> {
    const { content, kind, options } = body as { content?: string; kind?: 'kv' | 'table'; options?: Record<string, unknown> };

    if (!content || !kind) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: content, kind' } };
    }

    try {
      const data = parseCsv(Buffer.from(content, 'utf-8'), {
        type: 'csv',
        path: 'inline.csv',
        kind,
        options: options as Record<string, unknown>,
      });
      return { data };
    } catch (error) {
      return { error: { code: 'BAD_REQUEST', message: `Failed to parse CSV: ${error}` } };
    }
  }

  private async handleParseJson(body: Record<string, unknown>): Promise<RpcResponse> {
    const { content } = body as { content?: string };

    if (!content) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field: content' } };
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      const data = parseJsonToKv(parsed);
      return { data };
    } catch (error) {
      return { error: { code: 'BAD_REQUEST', message: `Failed to parse JSON: ${error}` } };
    }
  }

  private async handleFetchData(body: Record<string, unknown>): Promise<RpcResponse> {
    const { url, format, kind, options } = body as {
      url?: string;
      format?: 'json' | 'csv';
      kind?: 'kv' | 'table';
      options?: Record<string, unknown>;
    };

    if (!url || !format) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: url, format' } };
    }

    if (format === 'csv' && !kind) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field for CSV: kind' } };
    }

    try {
      const targetUrl = this.validateHttpUrl(url);
      const response = await fetch(targetUrl.toString(), {
        headers: {
          'Accept': format === 'json' ? 'application/json' : 'text/csv',
        },
      });
      if (!response.ok) {
        return { error: { code: 'BAD_REQUEST', message: `Failed to fetch URL: ${response.status}` } };
      }

      const text = await response.text();

      if (format === 'json') {
        const parsed = JSON.parse(text) as unknown;
        const data = parseJsonToKv(parsed);
        return { data };
      }

      const data = parseCsv(Buffer.from(text, 'utf-8'), {
        type: 'csv',
        path: targetUrl.pathname || 'remote.csv',
        kind: kind as 'kv' | 'table',
        options: options as Record<string, unknown>,
      });
      return { data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message === 'INVALID_URL' ? 'BAD_REQUEST' : 'BAD_REQUEST';
      return { error: { code, message: `Failed to fetch data: ${message}` } };
    }
  }

  private async handleValidate(body: Record<string, unknown>): Promise<RpcResponse> {
    const { templateDir } = body as { templateDir: string };

    if (!templateDir) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field: templateDir' } };
    }

    try {
      const resolvedDir = this.resolvePath(templateDir);
      const templateJsonPath = path.join(resolvedDir, 'template.json');

      const result = await validateTemplateFull(templateJsonPath, resolvedDir);

      return {
        ok: result.valid,
        errors: result.svgErrors.map(e => ({
          code: this.mapValidationErrorType(e.type),
          file: e.svgFile,
          path: e.path || e.elementId,
          message: e.message,
        })),
        warnings: result.warnings,
      };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Validation failed: ${error}` } };
    }
  }

  private mapValidationErrorType(type: ValidationResult['svgErrors'][0]['type']): string {
    switch (type) {
      case 'missing_id':
        return 'SVG_ID_NOT_FOUND';
      case 'missing_row_group':
        return 'ROW_GROUP_NOT_FOUND';
      case 'missing_cell':
        return 'CELL_ID_NOT_FOUND';
      case 'file_not_found':
        return 'SVG_FILE_NOT_FOUND';
      default:
        return 'VALIDATION_ERROR';
    }
  }

  private async handlePreview(body: Record<string, unknown>): Promise<RpcResponse> {
    const { templateDir, outputDir, sampleMode, options = {}, data } = body as {
      templateDir: string;
      outputDir: string;
      sampleMode?: 'minimal' | 'realistic' | 'multi-page';
      options?: { emitSvgs?: boolean; emitDebug?: boolean };
      data?: { meta?: Record<string, string>; items?: { headers: string[]; rows: Record<string, string>[] } };
    };

    if (!templateDir || !outputDir) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: templateDir, outputDir' } };
    }

    try {
      const resolvedTemplateDir = this.resolvePath(templateDir);
      const resolvedOutputDir = this.resolvePath(outputDir);

      const result = await generatePreview(resolvedTemplateDir, {
        sampleData: sampleMode || 'realistic',
        outputDir: resolvedOutputDir,
        includeDebug: options.emitDebug !== false,
        data,
      });

      return {
        ok: true,
        output: {
          dir: outputDir,
          html: path.join(outputDir, 'index.html'),
          pages: result.pageCount > 0
            ? Array.from({ length: result.pageCount }, (_, i) =>
                path.join(outputDir, 'pages', `page-${String(i + 1).padStart(3, '0')}.svg`)
              )
            : [],
          debug: options.emitDebug !== false
            ? [
                path.join(outputDir, 'debug', 'meta.json'),
                path.join(outputDir, 'debug', 'items.json'),
                path.join(outputDir, 'debug', 'render.json'),
              ]
            : [],
        },
      };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Preview generation failed: ${error}` } };
    }
  }

  private async handleTemplateLoad(body: Record<string, unknown>): Promise<RpcResponse> {
    const { templateDir } = body as { templateDir: string };

    if (!templateDir) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required field: templateDir' } };
    }

    try {
      const resolvedDir = this.resolvePath(templateDir);
      const templateJsonPath = path.join(resolvedDir, 'template.json');
      const content = await fs.readFile(templateJsonPath, 'utf-8');
      const templateJson = JSON.parse(content) as TemplateConfig;

      return { templateJson };
    } catch (error) {
      return { error: { code: 'NOT_FOUND', message: `Cannot load template: ${error}` } };
    }
  }

  private async handleTemplateSave(body: Record<string, unknown>): Promise<RpcResponse> {
    const { templateDir, templateJson, validate: shouldValidate } = body as {
      templateDir: string;
      templateJson: TemplateConfig;
      validate?: boolean;
    };

    if (!templateDir || !templateJson) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: templateDir, templateJson' } };
    }

    try {
      const resolvedDir = this.resolvePath(templateDir);

      // Ensure directory exists
      await fs.mkdir(resolvedDir, { recursive: true });

      const templateJsonPath = path.join(resolvedDir, 'template.json');
      const content = JSON.stringify(templateJson, null, 2);

      // Atomic write
      const tempPath = `${templateJsonPath}.tmp`;
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, templateJsonPath);

      // Validate if requested
      if (shouldValidate) {
        const validationResult = await validateTemplateFull(templateJsonPath, resolvedDir);
        if (!validationResult.valid) {
          return {
            saved: true,
            path: path.join(templateDir, 'template.json'),
            validation: {
              ok: false,
              errors: validationResult.svgErrors,
              warnings: validationResult.warnings,
            },
          };
        }
      }

      return {
        saved: true,
        path: path.join(templateDir, 'template.json'),
      };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Failed to save template: ${error}` } };
    }
  }

  private async handleGenerate(body: Record<string, unknown>): Promise<RpcResponse> {
    const { id, version, baseDir, pageTypes } = body as {
      id: string;
      version: string;
      baseDir?: string;
      pageTypes?: ('first' | 'repeat')[];
    };

    if (!id || !version) {
      return { error: { code: 'BAD_REQUEST', message: 'Missing required fields: id, version' } };
    }

    try {
      const resolvedBaseDir = this.resolvePath(baseDir || this.templatesDir);

      const result = await generateTemplate({
        templateId: id,
        version,
        baseDir: resolvedBaseDir,
        pageTypes: pageTypes || ['first', 'repeat'],
      });

      return {
        created: true,
        templateDir: path.relative(this.root, result.templateDir),
        files: result.files.map(f => path.relative(this.root, f)),
      };
    } catch (error) {
      return { error: { code: 'INTERNAL_ERROR', message: `Template generation failed: ${error}` } };
    }
  }
}

function estimateTextBBox(
  text: string,
  x: number,
  y: number,
  fontSize: number | null,
  textAnchor: string | null
): { x: number; y: number; w: number; h: number } {
  const size = fontSize || 12;
  const width = Math.max(6, estimateTextWidth(text, size));
  const height = Math.max(6, size * 1.2);
  const anchor = (textAnchor || 'start').toLowerCase();

  let left = x;
  if (anchor === 'middle' || anchor === 'center') {
    left -= width / 2;
  } else if (anchor === 'end' || anchor === 'right') {
    left -= width;
  }

  return {
    x: left,
    y: y - size,
    w: width,
    h: height,
  };
}

function estimateTextWidth(text: string, fontSize: number): number {
  if (!text) return fontSize;
  let units = 0;
  for (const ch of Array.from(text)) {
    // CJK and full-width forms tend to be close to 1em, ASCII is narrower.
    if (/[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) {
      units += 1.0;
    } else {
      units += 0.56;
    }
  }
  return units * fontSize;
}

export async function startRpcServer(options: ServerOptions = {}): Promise<RpcServer> {
  const server = new RpcServer(options);
  await server.start();
  return server;
}
