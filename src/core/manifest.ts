// core/manifest.ts
// Job manifest validation and loader with AJV

import type { JobManifest, TemplateRef, InputSpec } from '../types/index.js';
import { SVGReportError } from '../types/index.js';
import { getManifestValidator } from './schema-registry.js';

const validateManifest = getManifestValidator();

if (!validateManifest) {
  throw new Error('Failed to compile manifest validator');
}

/**
 * Parse and validate manifest.json
 */
export function parseManifest(content: string | Buffer): JobManifest {
  let json: unknown;

  try {
    json = JSON.parse(content.toString());
  } catch (error) {
    throw new SVGReportError(
      'Invalid JSON in manifest.json',
      'manifest.json',
      error instanceof Error ? error.message : 'Parse error'
    );
  }

  const valid = validateManifest!(json);

  if (!valid) {
    const errors = validateManifest!.errors ?? [];
    const reasons = errors.map(e => `${e.instancePath || 'root'}: ${e.message}`).join('; ');
    throw new SVGReportError(
      'Manifest validation failed',
      'manifest.json',
      reasons
    );
  }

  return json as JobManifest;
}

/**
 * Get template reference from manifest
 */
export function getTemplateRef(manifest: JobManifest): TemplateRef {
  return manifest.template;
}

/**
 * Get all input specifications from manifest
 */
export function getInputSpecs(manifest: JobManifest): Map<string, InputSpec> {
  return new Map(Object.entries(manifest.inputs));
}

/**
 * Get list of required data source names for template
 * (meta is always required, plus any table sources)
 */
export function getRequiredSources(manifest: JobManifest): string[] {
  return Object.keys(manifest.inputs);
}

/**
 * Validate manifest schema version
 */
export function validateSchemaVersion(manifest: JobManifest): void {
  const supported = 'svgreport-job/v0.1';
  if (manifest.schema !== supported) {
    throw new SVGReportError(
      `Unsupported manifest schema: ${manifest.schema}`,
      'manifest.json',
      `Supported: ${supported}`
    );
  }
}
