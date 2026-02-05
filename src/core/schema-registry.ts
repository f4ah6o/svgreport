// core/schema-registry.ts
// Centralized AJV schema registry for validation

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SVGREPORT_JOB_V0_1_SCHEMA } from '../schemas/svgreport-job-v0_1.js';
import { SVGREPORT_TEMPLATE_V0_2_SCHEMA } from '../schemas/svgreport-template-v0_2.js';

// Create singleton AJV instance
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);

// Add schemas to AJV
ajv.addSchema(SVGREPORT_JOB_V0_1_SCHEMA, SVGREPORT_JOB_V0_1_SCHEMA.$id);
ajv.addSchema(SVGREPORT_TEMPLATE_V0_2_SCHEMA, SVGREPORT_TEMPLATE_V0_2_SCHEMA.$id);

/**
 * Get the singleton AJV instance
 */
export function getAjv(): Ajv {
  return ajv;
}

/**
 * Get compiled validator for job manifest schema
 */
export function getManifestValidator() {
  return ajv.getSchema(SVGREPORT_JOB_V0_1_SCHEMA.$id);
}

/**
 * Get compiled validator for template schema
 */
export function getTemplateValidator() {
  return ajv.getSchema(SVGREPORT_TEMPLATE_V0_2_SCHEMA.$id);
}

export { SVGREPORT_JOB_V0_1_SCHEMA, SVGREPORT_TEMPLATE_V0_2_SCHEMA };
