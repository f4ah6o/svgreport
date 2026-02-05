export type BindingRef =
  | { kind: 'global-field'; index: number }
  | { kind: 'page-field'; pageId: string; index: number }
  | { kind: 'table-header'; pageId: string; tableIndex: number; cellIndex: number }
  | { kind: 'table-cell'; pageId: string; tableIndex: number; cellIndex: number }

export const BINDING_MIME = 'application/x-svgpaper-binding'

export function encodeBindingRef(ref: BindingRef): string {
  return JSON.stringify(ref)
}

export function decodeBindingRef(payload: string | null): BindingRef | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as BindingRef
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.kind === 'global-field' && typeof parsed.index === 'number') return parsed
    if (parsed.kind === 'page-field' && typeof parsed.pageId === 'string' && typeof parsed.index === 'number') return parsed
    if (parsed.kind === 'table-header' && typeof parsed.pageId === 'string' && typeof parsed.tableIndex === 'number' && typeof parsed.cellIndex === 'number') return parsed
    if (parsed.kind === 'table-cell' && typeof parsed.pageId === 'string' && typeof parsed.tableIndex === 'number' && typeof parsed.cellIndex === 'number') return parsed
    return null
  } catch {
    return null
  }
}

export function bindingRefEquals(a: BindingRef | null, b: BindingRef | null): boolean {
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'global-field' && b.kind === 'global-field') return a.index === b.index
  if (a.kind === 'page-field' && b.kind === 'page-field') return a.pageId === b.pageId && a.index === b.index
  if (a.kind === 'table-header' && b.kind === 'table-header') {
    return a.pageId === b.pageId && a.tableIndex === b.tableIndex && a.cellIndex === b.cellIndex
  }
  if (a.kind === 'table-cell' && b.kind === 'table-cell') {
    return a.pageId === b.pageId && a.tableIndex === b.tableIndex && a.cellIndex === b.cellIndex
  }
  return false
}
