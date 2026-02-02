// core/template.ts
// Template.json validation and loader with AJV

import type {
  TemplateConfig,
  PageConfig,
  FieldBinding,
  TableBinding,
  TemplateRef,
} from '../types/index.js';
import { SVGReportError } from '../types/index.js';
import { getTemplateValidator } from './schema-registry.js';

const validateTemplate = getTemplateValidator();

if (!validateTemplate) {
  throw new Error('Failed to compile template validator');
}

/**
 * Parse and validate template.json
 */
export function parseTemplate(content: string | Buffer): TemplateConfig {
  let json: unknown;

  try {
    json = JSON.parse(content.toString());
  } catch (error) {
    throw new SVGReportError(
      'Invalid JSON in template.json',
      'template.json',
      error instanceof Error ? error.message : 'Parse error'
    );
  }

  const valid = validateTemplate!(json);

  if (!valid) {
    const errors = validateTemplate!.errors ?? [];
    const reasons = errors.map(e => `${e.instancePath || 'root'}: ${e.message}`).join('; ');
    throw new SVGReportError(
      'Template validation failed',
      'template.json',
      reasons
    );
  }

  return json as TemplateConfig;
}

/**
 * Get first page configuration
 */
export function getFirstPage(config: TemplateConfig): PageConfig {
  const first = config.pages.find(p => p.kind === 'first');
  if (!first) {
    throw new SVGReportError(
      'No first page defined in template',
      'template.json',
      'Expected at least one page with kind="first"'
    );
  }
  return first;
}

/**
 * Get repeat page configuration (for 2nd page and beyond)
 */
export function getRepeatPage(config: TemplateConfig): PageConfig | null {
  return config.pages.find(p => p.kind === 'repeat') ?? null;
}

/**
 * Get all field bindings
 */
export function getFieldBindings(config: TemplateConfig): FieldBinding[] {
  return config.fields;
}

/**
 * Get table bindings for a specific page
 */
export function getTableBindings(page: PageConfig): TableBinding[] {
  return page.tables;
}

/**
 * Get SVG filename for a page
 */
export function getSvgFilename(page: PageConfig): string {
  return page.svg;
}

/**
 * Validate template matches job manifest
 */
export function validateTemplateMatch(
  template: TemplateConfig,
  expectedRef: TemplateRef
): void {
  if (template.template.id !== expectedRef.id) {
    throw new SVGReportError(
      `Template ID mismatch: expected ${expectedRef.id}, got ${template.template.id}`,
      'template.json',
      'Template ID does not match manifest'
    );
  }

  if (template.template.version !== expectedRef.version) {
    throw new SVGReportError(
      `Template version mismatch: expected ${expectedRef.version}, got ${template.template.version}`,
      'template.json',
      'Template version does not match manifest'
    );
  }
}

/**
 * Get all unique data source names referenced by template
 */
export function getReferencedSources(config: TemplateConfig): Set<string> {
  const sources = new Set<string>();

  // Add field sources
  for (const field of config.fields) {
    sources.add(field.source);
  }

  // Add table sources
  for (const page of config.pages) {
    for (const table of page.tables) {
      sources.add(table.source);
    }
  }

  return sources;
}
