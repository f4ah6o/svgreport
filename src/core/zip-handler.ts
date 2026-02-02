// core/zip-handler.ts
// Handle zip file input containing job data

import JSZip from 'jszip';
import type { JobManifest, DataSource } from '../types/index.js';
import { SVGReportError } from '../types/index.js';
import { parseManifest } from './manifest.js';
import { parseCsv } from './datasource.js';

export interface JobPackage {
  manifest: JobManifest;
  sources: Map<string, DataSource>;
}

export async function loadJobFromZip(zipPath: string): Promise<JobPackage> {
  const fs = await import('fs/promises');
  const zipContent = await fs.readFile(zipPath);
  return loadJobFromBuffer(zipContent);
}

export async function loadJobFromBuffer(buffer: Buffer): Promise<JobPackage> {
  const zip = await JSZip.loadAsync(buffer);
  
  // Find manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new SVGReportError(
      'manifest.json not found in zip',
      'zip',
      'Job zip must contain manifest.json'
    );
  }
  
  const manifestContent = await manifestFile.async('text');
  const manifest = parseManifest(manifestContent);
  
  // Load data sources
  const sources = new Map<string, DataSource>();
  
  for (const [name, spec] of Object.entries(manifest.inputs)) {
    const file = zip.file(spec.path);
    if (!file) {
      throw new SVGReportError(
        `Input file not found: ${spec.path}`,
        'zip',
        `Required input "${name}" at path "${spec.path}" not found in zip`
      );
    }
    
    const content = await file.async('nodebuffer');
    const data = parseCsv(content, spec);
    sources.set(name, data);
  }
  
  return { manifest, sources };
}
