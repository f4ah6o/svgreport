export type DataKeyRef = {
  source: 'meta' | 'items' | 'static' | 'unused';
  key: string;
};

export const DATA_KEY_MIME = 'application/x-svgpaper-data-key';

export function encodeDataKeyRef(ref: DataKeyRef): string {
  return JSON.stringify(ref);
}

export function decodeDataKeyRef(payload: string | null): DataKeyRef | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { source?: string; key?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.key !== 'string') return null;
    if (parsed.source === 'unbound') {
      return { source: 'unused', key: parsed.key };
    }
    if (
      parsed.source === 'meta'
      || parsed.source === 'items'
      || parsed.source === 'static'
      || parsed.source === 'unused'
    ) {
      return { source: parsed.source, key: parsed.key };
    }
    return null;
  } catch {
    return null;
  }
}
