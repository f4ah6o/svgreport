// core/template-validator.ts
// Template validation: schema validation and SVG reference integrity checks

import { DOMParser } from '@xmldom/xmldom';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { TemplateConfig } from '../types/index.js';
import { getTemplateValidator } from './schema-registry.js';

const validateTemplate = getTemplateValidator();

if (!validateTemplate) {
  throw new Error('Failed to compile template validator');
}

export interface ValidationResult {
  valid: boolean;
  schemaErrors: Array<{
    path: string;
    message: string;
  }>;
  svgErrors: Array<{
    type: 'missing_id' | 'missing_row_group' | 'missing_cell' | 'file_not_found';
    pageId: string;
    svgFile: string;
    elementId: string;
    message: string;
    path?: string;
  }>;
  warnings: string[];
}

/**
 * Validate template.json against schema and check SVG references
 */
export async function validateTemplateFull(
  templatePath: string,
  templateDir: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    schemaErrors: [],
    svgErrors: [],
    warnings: [],
  };

  // Step 1: Schema validation
  const content = await fs.readFile(templatePath, 'utf-8');
  let config: TemplateConfig;

  try {
    config = JSON.parse(content);
  } catch (error) {
    result.valid = false;
    result.schemaErrors.push({
      path: '',
      message: `Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`,
    });
    return result;
  }

  const valid = validateTemplate!(config);

  if (!valid && validateTemplate!.errors) {
    result.valid = false;
    for (const err of validateTemplate!.errors) {
      result.schemaErrors.push({
        path: err.instancePath || 'root',
        message: err.message || 'Validation error',
      });
    }
  }

  // Step 2: Page kind validation (at least one first page)
  const hasFirst = config.pages.some(p => p.kind === 'first');
  if (!hasFirst) {
    result.valid = false;
    result.schemaErrors.push({
      path: 'pages',
      message: 'At least one page with kind="first" is required',
    });
  }

  // Step 3: SVG reference integrity checks
  for (let pageIndex = 0; pageIndex < config.pages.length; pageIndex += 1) {
    const page = config.pages[pageIndex];
    const svgPath = path.join(templateDir, page.svg);

    // Check SVG file exists
    try {
      await fs.access(svgPath);
    } catch {
      result.valid = false;
      result.svgErrors.push({
        type: 'file_not_found',
        pageId: page.id,
        svgFile: page.svg,
        elementId: '',
        path: `pages[${pageIndex}].svg`,
        message: `SVG file not found: ${page.svg}`,
      });
      continue;
    }

    // Parse SVG
    const svgContent = await fs.readFile(svgPath, 'utf-8');
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.documentElement;

    if (!svg) {
      result.valid = false;
      result.svgErrors.push({
        type: 'file_not_found',
        pageId: page.id,
        svgFile: page.svg,
        elementId: '',
        path: `pages[${pageIndex}].svg`,
        message: 'Failed to parse SVG file',
      });
      continue;
    }

    // Collect all IDs in SVG
    const allIds = new Set<string>();
    const allElements = Array.from(svg.getElementsByTagName('*'));
    for (const el of allElements) {
      const id = el.getAttribute('id');
      if (id) {
        allIds.add(id);
      }
    }

    // Check global field bindings (only required on first pages)
    if (page.kind === 'first') {
      for (let fieldIndex = 0; fieldIndex < config.fields.length; fieldIndex += 1) {
        const field = config.fields[fieldIndex];
        if (field.enabled === false) {
          continue;
        }
        if (!field.svg_id) {
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_id',
            pageId: page.id,
            svgFile: page.svg,
            elementId: field.svg_id,
            path: `fields[${fieldIndex}].svg_id`,
            message: `Field binding references missing ID: ${field.svg_id} (value: ${field.value.type === 'data' ? `${field.value.source}:${field.value.key}` : 'static'})`,
          });
          continue;
        }
        if (!allIds.has(field.svg_id)) {
          const valueLabel = field.value.type === 'data'
            ? `${field.value.source}:${field.value.key}`
            : 'static';
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_id',
            pageId: page.id,
            svgFile: page.svg,
            elementId: field.svg_id,
            path: `fields[${fieldIndex}].svg_id`,
            message: `Field binding references missing ID: ${field.svg_id} (value: ${valueLabel})`,
          });
        }
      }
    }

    // Check page field bindings
    for (let fieldIndex = 0; fieldIndex < (page.fields ?? []).length; fieldIndex += 1) {
      const field = page.fields![fieldIndex];
      if (field.enabled === false) {
        continue;
      }
      if (!field.svg_id) {
        result.valid = false;
        result.svgErrors.push({
          type: 'missing_id',
          pageId: page.id,
          svgFile: page.svg,
          elementId: field.svg_id,
          path: `pages[${pageIndex}].fields[${fieldIndex}].svg_id`,
          message: `Page field references missing ID: ${field.svg_id} (value: ${field.value.type === 'data' ? `${field.value.source}:${field.value.key}` : 'static'})`,
        });
        continue;
      }
      if (!allIds.has(field.svg_id)) {
        const valueLabel = field.value.type === 'data'
          ? `${field.value.source}:${field.value.key}`
          : 'static';
        result.valid = false;
        result.svgErrors.push({
          type: 'missing_id',
          pageId: page.id,
          svgFile: page.svg,
          elementId: field.svg_id,
          path: `pages[${pageIndex}].fields[${fieldIndex}].svg_id`,
          message: `Page field references missing ID: ${field.svg_id} (value: ${valueLabel})`,
        });
      }
    }

    // Check table bindings
    for (let tableIndex = 0; tableIndex < page.tables.length; tableIndex += 1) {
      const table = page.tables[tableIndex];
      // Check row_group_id
      if (!allIds.has(table.row_group_id)) {
        result.valid = false;
        result.svgErrors.push({
          type: 'missing_row_group',
          pageId: page.id,
          svgFile: page.svg,
          elementId: table.row_group_id,
          path: `pages[${pageIndex}].tables[${tableIndex}].row_group_id`,
          message: `Table references missing row group ID: ${table.row_group_id}`,
        });
        continue;
      }

      // Get row group element
      const rowGroup = svg.querySelector?.(`#${table.row_group_id}`) || 
                      allElements.find(el => el.getAttribute('id') === table.row_group_id);

      if (!rowGroup) {
        continue; // Already reported above
      }

      // Collect IDs within row group
      const rowGroupIds = new Set<string>();
      const rowChildren = Array.from(rowGroup.getElementsByTagName('*'));
      for (const el of rowChildren) {
        const id = el.getAttribute('id');
        if (id) {
          rowGroupIds.add(id);
        }
      }

      // Check cell bindings
      for (let cellIndex = 0; cellIndex < table.cells.length; cellIndex += 1) {
        const cell = table.cells[cellIndex];
        if (cell.enabled === false) {
          continue;
        }
        if (!cell.svg_id) {
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_cell',
            pageId: page.id,
            svgFile: page.svg,
            elementId: cell.svg_id,
            path: `pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].svg_id`,
            message: `Table cell references missing ID: ${cell.svg_id} (value: ${cell.value.type === 'data' ? `${cell.value.source}:${cell.value.key}` : 'static'}) - should be inside row group ${table.row_group_id}`,
          });
          continue;
        }
        if (!rowGroupIds.has(cell.svg_id) && !allIds.has(cell.svg_id)) {
          const valueLabel = cell.value.type === 'data'
            ? `${cell.value.source}:${cell.value.key}`
            : 'static';
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_cell',
            pageId: page.id,
            svgFile: page.svg,
            elementId: cell.svg_id,
            path: `pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].svg_id`,
            message: `Table cell references missing ID: ${cell.svg_id} (value: ${valueLabel}) - should be inside row group ${table.row_group_id}`,
          });
        }
      }
    }

    // Check table header bindings
    for (let tableIndex = 0; tableIndex < page.tables.length; tableIndex += 1) {
      const table = page.tables[tableIndex];
      if (!table.header?.cells?.length) continue
      for (let cellIndex = 0; cellIndex < table.header.cells.length; cellIndex += 1) {
        const cell = table.header.cells[cellIndex];
        if (cell.enabled === false) {
          continue;
        }
        if (!cell.svg_id) {
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_id',
            pageId: page.id,
            svgFile: page.svg,
            elementId: cell.svg_id,
            path: `pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].svg_id`,
            message: `Table header references missing ID: ${cell.svg_id} (value: ${cell.value.type === 'data' ? `${cell.value.source}:${cell.value.key}` : 'static'})`,
          });
          continue;
        }
        if (!allIds.has(cell.svg_id)) {
          const valueLabel = cell.value.type === 'data'
            ? `${cell.value.source}:${cell.value.key}`
            : 'static';
          result.valid = false;
          result.svgErrors.push({
            type: 'missing_id',
            pageId: page.id,
            svgFile: page.svg,
            elementId: cell.svg_id,
            path: `pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].svg_id`,
            message: `Table header references missing ID: ${cell.svg_id} (value: ${valueLabel})`,
          });
        }
      }
    }

    // Check page number config
    if (page.page_number?.svg_id) {
      if (!allIds.has(page.page_number.svg_id)) {
        result.valid = false;
        result.svgErrors.push({
          type: 'missing_id',
          pageId: page.id,
          svgFile: page.svg,
          elementId: page.page_number.svg_id,
          path: `pages[${pageIndex}].page_number.svg_id`,
          message: `Page number references missing ID: ${page.page_number.svg_id}`,
        });
      }
    }
  }

  // Step 4: Check for duplicate IDs within each page
  for (const page of config.pages) {
    const pageSvgIds = new Set<string>();
    const warnDuplicate = (id: string, context: string) => {
      result.warnings.push(`Duplicate svg_id ${context}: ${id} (page: ${page.id})`);
    };

    if (page.kind === 'first') {
      for (const field of config.fields) {
        if (field.enabled === false) continue;
        if (!field.svg_id) continue;
        if (pageSvgIds.has(field.svg_id)) {
          warnDuplicate(field.svg_id, 'in global fields');
        } else {
          pageSvgIds.add(field.svg_id);
        }
      }
    }

    for (const field of page.fields ?? []) {
      if (field.enabled === false) continue;
      if (!field.svg_id) continue;
      if (pageSvgIds.has(field.svg_id)) {
        warnDuplicate(field.svg_id, 'across fields');
      } else {
        pageSvgIds.add(field.svg_id);
      }
    }

    for (const table of page.tables) {
      if (table.row_group_id) {
        if (pageSvgIds.has(table.row_group_id)) {
          warnDuplicate(table.row_group_id, 'row group');
        } else {
          pageSvgIds.add(table.row_group_id);
        }
      }

      if (table.header?.cells?.length) {
        for (const cell of table.header.cells) {
          if (cell.enabled === false) continue;
          if (!cell.svg_id) continue;
          if (pageSvgIds.has(cell.svg_id)) {
            warnDuplicate(cell.svg_id, 'in table header');
          } else {
            pageSvgIds.add(cell.svg_id);
          }
        }
      }

      for (const cell of table.cells) {
        if (cell.enabled === false) continue;
        if (!cell.svg_id) continue;
        if (pageSvgIds.has(cell.svg_id)) {
          warnDuplicate(cell.svg_id, 'in table cells');
        } else {
          pageSvgIds.add(cell.svg_id);
        }
      }
    }

    if (page.page_number?.svg_id) {
      if (pageSvgIds.has(page.page_number.svg_id)) {
        warnDuplicate(page.page_number.svg_id, 'page number');
      } else {
        pageSvgIds.add(page.page_number.svg_id);
      }
    }
  }

  return result;
}

/**
 * Print validation report to console
 */
export function printValidationReport(result: ValidationResult): void {
  console.log('\n=== Template Validation Report ===');
  console.log(`Overall: ${result.valid ? '✓ VALID' : '✗ INVALID'}`);

  if (result.schemaErrors.length > 0) {
    console.log('\nSchema Errors:');
    for (const err of result.schemaErrors) {
      console.log(`  ✗ ${err.path}: ${err.message}`);
    }
  }

  if (result.svgErrors.length > 0) {
    console.log('\nSVG Reference Errors:');
    for (const err of result.svgErrors) {
      console.log(`  ✗ [${err.type}] Page "${err.pageId}" (${err.svgFile}): ${err.message}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warn of result.warnings) {
      console.log(`  ⚠ ${warn}`);
    }
  }

  if (result.valid && result.schemaErrors.length === 0 && result.svgErrors.length === 0) {
    console.log('\n✓ All checks passed');
  }

  console.log('===================================\n');
}

/**
 * Quick validation - only schema
 */
export function validateTemplateSchema(content: string): {
  valid: boolean;
  errors: string[];
} {
  try {
    const config = JSON.parse(content);
    const valid = validateTemplate!(config);

    if (valid) {
      return { valid: true, errors: [] };
    }

    const errors = (validateTemplate!.errors || []).map(
      e => `${e.instancePath || 'root'}: ${e.message}`
    );

    return { valid: false, errors };
  } catch (error) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : 'Parse error'}`],
    };
  }
}
