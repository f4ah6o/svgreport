export type DataKeyRef = {
  source: 'meta' | 'items';
  key: string;
};

export const DATA_KEY_MIME = 'application/x-svgpaper-data-key';

export function encodeDataKeyRef(ref: DataKeyRef): string {
  return JSON.stringify(ref);
}

export function decodeDataKeyRef(payload: string | null): DataKeyRef | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as DataKeyRef;
    if (!parsed || typeof parsed !== 'object') return null;
    if ((parsed.source === 'meta' || parsed.source === 'items') && typeof parsed.key === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
