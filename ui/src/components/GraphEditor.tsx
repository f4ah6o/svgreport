import { useMemo, useState, useEffect } from 'preact/hooks'
import type {
  TemplateConfig,
  FieldBinding,
  TableCell,
  FormatterDef,
  KVData,
  TableData,
  TableBinding,
} from '../types/api'
import type { BindingRef } from '../types/binding'
import type { DataKeyRef } from '../types/data-key'
import { encodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'

interface GraphEditorProps {
  template: TemplateConfig
  selectedPageId: string | null
  metaData: KVData | null
  itemsData: TableData | null
  metaFileName: string | null
  itemsFileName: string | null
  dataError: string | null
  dataLoading: boolean
  onLoadDemoData: () => void
  onMetaUpload: (file: File) => void
  onItemsUpload: (file: File) => void
  onMetaUrlLoad: (url: string) => void
  onItemsUrlLoad: (url: string) => void
  onClearMeta: () => void
  onClearItems: () => void
  metaScope: 'page' | 'global'
  onMetaScopeChange: (scope: 'page' | 'global') => void
  itemsTarget: 'body' | 'header'
  onItemsTargetChange: (target: 'body' | 'header') => void
  activeTableIndex: number
  onActiveTableIndexChange: (index: number) => void
  onUpdateTable: (pageId: string, tableIndex: number, patch: Partial<TableBinding>) => void
  selectedSvgId: string | null
  onSelectBindingSvgId: (svgId: string | null) => void
  onUnbindSvgId: (svgId: string) => void
  onAutoSetPageNumber: (pageId: string, svgId: string, includeTotal: boolean) => void
  onUpdatePageNumber: (pageId: string, patch: { svg_id?: string; format?: string }) => void
  onRemoveHeaderCell: (pageId: string, tableIndex: number, cellIndex: number) => void
  onUpdateBinding: (ref: BindingRef, patch: Partial<FieldBinding> | Partial<TableCell>) => void
  onRemoveBinding: (ref: BindingRef) => void
  onAddFormatter: () => void
  onUpdateFormatter: (key: string, patch: FormatterDef) => void
  onRemoveFormatter: (key: string) => void
  onRenameFormatter: (oldKey: string, newKey: string) => void
}

type SelectedBinding = {
  ref: BindingRef
  binding: FieldBinding | TableCell
  label: string
}

const makeDataValue = (source: string, key: string) => ({ type: 'data' as const, source, key })
const makeStaticValue = (text: string) => ({ type: 'static' as const, text })

export function GraphEditor({
  template,
  selectedPageId,
  metaData,
  itemsData,
  metaFileName,
  itemsFileName,
  dataError,
  dataLoading,
  onLoadDemoData,
  onMetaUpload,
  onItemsUpload,
  onMetaUrlLoad,
  onItemsUrlLoad,
  onClearMeta,
  onClearItems,
  metaScope,
  onMetaScopeChange,
  itemsTarget,
  onItemsTargetChange,
  activeTableIndex,
  onActiveTableIndexChange,
  onUpdateTable,
  selectedSvgId,
  onSelectBindingSvgId,
  onUnbindSvgId,
  onAutoSetPageNumber,
  onUpdatePageNumber,
  onRemoveHeaderCell,
  onUpdateBinding,
  onRemoveBinding,
  onAddFormatter,
  onUpdateFormatter,
  onRemoveFormatter,
  onRenameFormatter,
}: GraphEditorProps) {
  const [staticInput, setStaticInput] = useState('')
  const [customStaticNodes, setCustomStaticNodes] = useState<string[]>([])
  const [metaUrlInput, setMetaUrlInput] = useState('')
  const [itemsUrlInput, setItemsUrlInput] = useState('')
  const [pageNumberIncludeTotal, setPageNumberIncludeTotal] = useState(true)

  const page = useMemo(() => {
    if (selectedPageId) {
      return template.pages.find(p => p.id === selectedPageId) || template.pages[0]
    }
    return template.pages[0]
  }, [template, selectedPageId])

  const metaKeys = useMemo(() => (metaData ? Object.keys(metaData).sort() : []), [metaData])
  const itemColumns = useMemo(() => (itemsData?.headers ? [...itemsData.headers] : []), [itemsData])
  const formatterEntries = useMemo(() => Object.entries(template.formatters || {}), [template.formatters])

  const staticNodes = useMemo(() => {
    const values = new Set<string>(customStaticNodes)
    for (const field of template.fields) {
      if (field.value.type === 'static' && field.value.text) values.add(field.value.text)
    }
    for (const field of page?.fields ?? []) {
      if (field.value.type === 'static' && field.value.text) values.add(field.value.text)
    }
    for (const table of page?.tables ?? []) {
      for (const cell of table.header?.cells ?? []) {
        if (cell.value.type === 'static' && cell.value.text) values.add(cell.value.text)
      }
      for (const cell of table.cells ?? []) {
        if (cell.value.type === 'static' && cell.value.text) values.add(cell.value.text)
      }
    }
    return Array.from(values)
  }, [customStaticNodes, template, page])

  const selectedBinding = useMemo<SelectedBinding | null>(() => {
    if (!selectedSvgId || !page) return null

    const globalIndex = template.fields.findIndex((field) => field.svg_id === selectedSvgId)
    if (globalIndex >= 0) {
      return {
        ref: { kind: 'global-field', index: globalIndex },
        binding: template.fields[globalIndex],
        label: 'Global Field',
      }
    }

    const pageFieldIndex = (page.fields ?? []).findIndex((field) => field.svg_id === selectedSvgId)
    if (pageFieldIndex >= 0) {
      return {
        ref: { kind: 'page-field', pageId: page.id, index: pageFieldIndex },
        binding: (page.fields ?? [])[pageFieldIndex],
        label: 'Page Field',
      }
    }

    for (const [tableIndex, table] of page.tables.entries()) {
      const headerIndex = table.header?.cells?.findIndex((cell) => cell.svg_id === selectedSvgId) ?? -1
      if (headerIndex >= 0 && table.header?.cells) {
        return {
          ref: { kind: 'table-header', pageId: page.id, tableIndex, cellIndex: headerIndex },
          binding: table.header.cells[headerIndex],
          label: `Table #${tableIndex + 1} Header`,
        }
      }

      const cellIndex = table.cells.findIndex((cell) => cell.svg_id === selectedSvgId)
      if (cellIndex >= 0) {
        return {
          ref: { kind: 'table-cell', pageId: page.id, tableIndex, cellIndex },
          binding: table.cells[cellIndex],
          label: `Table #${tableIndex + 1} Cell`,
        }
      }
    }

    return null
  }, [selectedSvgId, template.fields, page])

  const handleDataDragStart = (ref: DataKeyRef) => (event: DragEvent) => {
    const payload = encodeDataKeyRef(ref)
    event.dataTransfer?.setData(DATA_KEY_MIME, payload)
    event.dataTransfer?.setData('application/json', payload)
    event.dataTransfer?.setData('text/plain', payload)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  const handleAddStaticNode = () => {
    if (!staticInput.trim()) return
    setCustomStaticNodes((prev) => [...prev, staticInput.trim()])
    setStaticInput('')
  }

  const handleMetaFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) onMetaUpload(file)
    input.value = ''
  }

  const handleItemsFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) onItemsUpload(file)
    input.value = ''
  }

  const tableIndex = page && page.tables.length > 0
    ? Math.min(activeTableIndex, page.tables.length - 1)
    : 0

  useEffect(() => {
    if (!page || page.tables.length === 0) return
    if (activeTableIndex >= page.tables.length) {
      onActiveTableIndexChange(0)
    }
  }, [page, activeTableIndex, onActiveTableIndexChange])

  useEffect(() => {
    if (!page?.page_number?.format) return
    setPageNumberIncludeTotal(page.page_number.format.includes('{total}'))
  }, [page?.id, page?.page_number?.format])

  return (
    <div className="graph-editor">
      <div className="graph-sidebar">

        <div className="graph-section">
          <h3>Data</h3>
          <div className="graph-data-toolbar">
            <button className="btn-secondary graph-demo-button" onClick={onLoadDemoData} disabled={dataLoading}>デモデータ読込</button>
          </div>

          <div className="graph-data-import">
            <div className="graph-data-import-row">
              <span className="graph-data-label">Meta(JSON)</span>
              <label className="btn-secondary graph-upload-button">
                Upload
                <input type="file" accept="application/json,.json" onChange={handleMetaFileChange} />
              </label>
              <button className="btn-secondary" onClick={onClearMeta} disabled={!metaData}>Clear</button>
            </div>
            <div className="graph-data-import-row">
              <input type="text" value={metaUrlInput} onChange={(e) => setMetaUrlInput((e.target as HTMLInputElement).value)} placeholder="https://.../meta.json" />
              <button className="btn-secondary" onClick={() => onMetaUrlLoad(metaUrlInput.trim())} disabled={dataLoading || !metaUrlInput.trim()}>URL読込</button>
            </div>
            {metaFileName ? <div className="graph-data-source">source: {metaFileName}</div> : null}
          </div>

          <div className="graph-data-import">
            <div className="graph-data-import-row">
              <span className="graph-data-label">Items(CSV)</span>
              <label className="btn-secondary graph-upload-button">
                Upload
                <input type="file" accept=".csv,text/csv" onChange={handleItemsFileChange} />
              </label>
              <button className="btn-secondary" onClick={onClearItems} disabled={!itemsData}>Clear</button>
            </div>
            <div className="graph-data-import-row">
              <input type="text" value={itemsUrlInput} onChange={(e) => setItemsUrlInput((e.target as HTMLInputElement).value)} placeholder="https://.../items.csv" />
              <button className="btn-secondary" onClick={() => onItemsUrlLoad(itemsUrlInput.trim())} disabled={dataLoading || !itemsUrlInput.trim()}>URL読込</button>
            </div>
            {itemsFileName ? <div className="graph-data-source">source: {itemsFileName}</div> : null}
          </div>

          {dataError ? <p className="graph-data-error">{dataError}</p> : null}
          <div className="graph-subsection">
            <div className="graph-subsection-header">
              <h4>Meta</h4>
              <select value={metaScope} onChange={(e) => onMetaScopeChange((e.target as HTMLSelectElement).value as 'page' | 'global')}>
                <option value="page">Page</option>
                <option value="global">Global</option>
              </select>
            </div>
            {metaKeys.length === 0 ? <p className="empty">No meta loaded.</p> : (
              <div className="graph-node-list">
                {metaKeys.map((key) => (
                  <div key={key} className="graph-node graph-node-meta" draggable onDragStart={handleDataDragStart({ source: 'meta', key })}>
                    {key}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="graph-subsection">
            <div className="graph-subsection-header">
              <h4>Items</h4>
              <select value={itemsTarget} onChange={(e) => onItemsTargetChange((e.target as HTMLSelectElement).value as 'body' | 'header')}>
                <option value="body">Body</option>
                <option value="header">Header</option>
              </select>
            </div>
            {itemColumns.length === 0 ? <p className="empty">No items loaded.</p> : (
              <div className="graph-node-list">
                {itemColumns.map((column) => (
                  <div key={column} className="graph-node graph-node-items" draggable onDragStart={handleDataDragStart({ source: 'items', key: column })}>
                    {column}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="graph-subsection">
            <div className="graph-subsection-header"><h4>Static</h4></div>
            <div className="graph-static-input">
              <input type="text" value={staticInput} onChange={(e) => setStaticInput((e.target as HTMLInputElement).value)} placeholder="Static text" />
              <button className="btn-secondary" onClick={handleAddStaticNode} disabled={!staticInput.trim()}>Add</button>
            </div>
            {staticNodes.length === 0 ? <p className="empty">No static nodes.</p> : (
              <div className="graph-node-list">
                {staticNodes.map((text) => (
                  <div key={text} className="graph-node graph-node-static" draggable onDragStart={handleDataDragStart({ source: 'static', key: text })}>
                    {text}
                  </div>
                ))}
              </div>
            )}
          </div>
          {dataLoading && <div className="graph-loading">Loading data…</div>}
        </div>

        <div className="graph-section">
          <h3>Table Settings</h3>
          {!page ? (
            <p className="empty">Select a page.</p>
          ) : page.tables.length === 0 ? (
            <p className="empty">No tables configured for this page.</p>
          ) : (
            <div className="graph-table-config">
              <label>Active Table</label>
              <select value={tableIndex} onChange={(e) => onActiveTableIndexChange(parseInt((e.target as HTMLSelectElement).value, 10))}>
                {page.tables.map((table, idx) => <option key={idx} value={idx}>Table #{idx + 1} ({table.source})</option>)}
              </select>

              {page.tables[tableIndex] && (
                <div className="graph-table-fields">
                  <label>Source</label>
                  <input
                    type="text"
                    value={page.tables[tableIndex].source}
                    onChange={(e) => onUpdateTable(page.id, tableIndex, { source: (e.target as HTMLInputElement).value })}
                  />
                  <label>Rows Per Page (per page)</label>
                  <input
                    type="number"
                    value={page.tables[tableIndex].rows_per_page}
                    onChange={(e) => onUpdateTable(page.id, tableIndex, { rows_per_page: parseInt((e.target as HTMLInputElement).value || '0', 10) })}
                  />
                  <label>Row Height (mm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={page.tables[tableIndex].row_height_mm}
                    onChange={(e) => onUpdateTable(page.id, tableIndex, { row_height_mm: parseFloat((e.target as HTMLInputElement).value || '0') })}
                  />
                  <label>Row Group ID</label>
                  <input
                    type="text"
                    value={page.tables[tableIndex].row_group_id}
                    onChange={(e) => onUpdateTable(page.id, tableIndex, { row_group_id: (e.target as HTMLInputElement).value })}
                  />
                  <label>Start Y (mm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={page.tables[tableIndex].start_y_mm ?? ''}
                    onChange={(e) => {
                      const raw = (e.target as HTMLInputElement).value
                      onUpdateTable(page.id, tableIndex, { start_y_mm: raw === '' ? undefined : parseFloat(raw) })
                    }}
                  />

                  {(page.tables[tableIndex].header?.cells?.length ?? 0) > 0 && (
                    <div className="graph-binding-details">
                      {page.tables[tableIndex].header!.cells.map((cell, cellIndex) => (
                        <div className="graph-binding-row" key={`header-${cellIndex}`}>
                          <button className="btn-secondary" onClick={() => onSelectBindingSvgId(cell.svg_id || null)}>Header #{cellIndex + 1}</button>
                          <span className="value">{cell.svg_id || '(unbound)'}</span>
                          <button className="btn-danger" onClick={() => onRemoveHeaderCell(page.id, tableIndex, cellIndex)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="graph-section">
          <h3>Page Number</h3>
          {!page ? (
            <p className="empty">ページを選択してください。</p>
          ) : (
            <div className="graph-binding-details">
              <div className="graph-binding-row">
                <span className="label">対象ID</span>
                <span className="value">{selectedSvgId || page.page_number?.svg_id || '(未設定)'}</span>
              </div>
              <label>Page Number SVG ID</label>
              <input
                type="text"
                value={page.page_number?.svg_id || ''}
                onChange={(e) => onUpdatePageNumber(page.id, { svg_id: (e.target as HTMLInputElement).value })}
              />
              <label>Page Number Format</label>
              <input
                type="text"
                value={page.page_number?.format || ''}
                onChange={(e) => onUpdatePageNumber(page.id, { format: (e.target as HTMLInputElement).value })}
                placeholder="{current}/{total}"
              />
              <label className="checkbox">
                <input type="checkbox" checked={pageNumberIncludeTotal} onChange={(e) => setPageNumberIncludeTotal((e.target as HTMLInputElement).checked)} />
                Include total
              </label>
              <button
                className="btn-secondary"
                disabled={!selectedSvgId}
                onClick={() => {
                  if (!selectedSvgId) return
                  onAutoSetPageNumber(page.id, selectedSvgId, pageNumberIncludeTotal)
                }}
              >
                Auto Set
              </button>
            </div>
          )}
        </div>

        <div className="graph-section">
          <h3>Formatters</h3>
          <button className="btn-secondary" onClick={onAddFormatter}>+ Add Formatter</button>
          {formatterEntries.length === 0 ? <p className="empty">No formatters.</p> : (
            <div className="graph-binding-details">
              {formatterEntries.map(([key, formatter]) => (
                <div className="graph-table-fields" key={key}>
                  <label>Key</label>
                  <input type="text" defaultValue={key} onBlur={(e) => onRenameFormatter(key, (e.target as HTMLInputElement).value)} />
                  <label>Kind</label>
                  <select value={formatter.kind || ''} onChange={(e) => onUpdateFormatter(key, { kind: (e.target as HTMLSelectElement).value as FormatterDef['kind'] })}>
                    <option value="">(none)</option>
                    <option value="date">date</option>
                    <option value="number">number</option>
                    <option value="currency">currency</option>
                  </select>
                  <label>Pattern</label>
                  <input type="text" value={formatter.pattern || ''} onChange={(e) => onUpdateFormatter(key, { pattern: (e.target as HTMLInputElement).value })} />
                  <label>Currency</label>
                  <input type="text" value={formatter.currency || ''} onChange={(e) => onUpdateFormatter(key, { currency: (e.target as HTMLInputElement).value })} />
                  <button className="btn-danger" onClick={() => onRemoveFormatter(key)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="graph-section">
          <h3>Binding Details</h3>
          {!selectedSvgId ? (
            <p className="empty">帳票上の要素を選択すると、ここに割当情報が表示されます。</p>
          ) : !selectedBinding ? (
            <div className="graph-binding-details">
              <div className="graph-binding-row"><span className="label">選択中の要素ID</span><span className="value">{selectedSvgId}</span></div>
              <button className="btn-secondary" onClick={() => onUnbindSvgId(selectedSvgId)}>未割当に戻す</button>
            </div>
          ) : (
            <div className="graph-binding-details">
              <div className="graph-binding-row">
                <span className="label">Type</span>
                <span className="value">{selectedBinding.label}</span>
              </div>
              <div className="graph-binding-row">
                <span className="label">SVG ID</span>
                <span className="value">{selectedBinding.binding.svg_id || '(empty)'}</span>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedBinding.binding.enabled !== false}
                  onChange={(e) => onUpdateBinding(selectedBinding.ref, { enabled: (e.target as HTMLInputElement).checked })}
                />
                Enabled
              </label>
              <label>Value Type</label>
              <select
                value={selectedBinding.binding.value.type}
                onChange={(e) => {
                  const next = (e.target as HTMLSelectElement).value
                  if (next === 'static') onUpdateBinding(selectedBinding.ref, { value: makeStaticValue('') })
                  else onUpdateBinding(selectedBinding.ref, { value: makeDataValue('meta', '') })
                }}
              >
                <option value="data">data</option>
                <option value="static">static</option>
              </select>
              {selectedBinding.binding.value.type === 'data' ? (
                <>
                  <label>Source</label>
                  <input
                    type="text"
                    value={selectedBinding.binding.value.source}
                    onChange={(e) => onUpdateBinding(selectedBinding.ref, { value: makeDataValue((e.target as HTMLInputElement).value, selectedBinding.binding.value.type === 'data' ? selectedBinding.binding.value.key : '') })}
                  />
                  <label>Key</label>
                  <input
                    type="text"
                    value={selectedBinding.binding.value.key}
                    onChange={(e) => onUpdateBinding(selectedBinding.ref, { value: makeDataValue(selectedBinding.binding.value.type === 'data' ? selectedBinding.binding.value.source : 'meta', (e.target as HTMLInputElement).value) })}
                  />
                </>
              ) : (
                <>
                  <label>Text</label>
                  <input
                    type="text"
                    value={selectedBinding.binding.value.text}
                    onChange={(e) => onUpdateBinding(selectedBinding.ref, { value: makeStaticValue((e.target as HTMLInputElement).value) })}
                  />
                </>
              )}
              <label>Align</label>
              <select value={selectedBinding.binding.align || 'left'} onChange={(e) => onUpdateBinding(selectedBinding.ref, { align: (e.target as HTMLSelectElement).value as TableCell['align'] })}>
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
              <label>Fit</label>
              <select value={selectedBinding.binding.fit || 'none'} onChange={(e) => onUpdateBinding(selectedBinding.ref, { fit: (e.target as HTMLSelectElement).value as TableCell['fit'] })}>
                <option value="none">none</option>
                <option value="shrink">shrink</option>
                <option value="wrap">wrap</option>
                <option value="clip">clip</option>
              </select>
              <label>Format</label>
              <input type="text" value={selectedBinding.binding.format || ''} onChange={(e) => onUpdateBinding(selectedBinding.ref, { format: (e.target as HTMLInputElement).value })} />
              <div className="graph-table-actions">
                <button className="btn-secondary" onClick={() => onUnbindSvgId(selectedSvgId)}>未割当に戻す</button>
                <button className="btn-danger" onClick={() => onRemoveBinding(selectedBinding.ref)}>Remove Binding</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
