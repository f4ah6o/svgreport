import { useMemo, useState, useEffect } from 'preact/hooks'
import type { TemplateConfig, KVData, TableData, TableBinding } from '../types/api'
import type { DataKeyRef } from '../types/data-key'
import { encodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'

interface GraphEditorProps {
  template: TemplateConfig
  selectedPageId: string | null
  onSelectPageId: (pageId: string) => void
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
  editTableIndex: number | null
  onEditTableCells: (tableIndex: number) => void
  onCancelEditTable: () => void
  onDeleteTable: (pageId: string, tableIndex: number) => void
  onAddTable: (pageId: string) => void
  onUpdateTable: (pageId: string, tableIndex: number, patch: Partial<TableBinding>) => void
  selectedSvgId: string | null
  onUnbindSvgId: (svgId: string) => void
  onAutoSetPageNumber: (pageId: string, svgId: string, includeTotal: boolean) => void
}

export function GraphEditor({
  template,
  selectedPageId,
  onSelectPageId,
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
  editTableIndex,
  onEditTableCells,
  onCancelEditTable,
  onDeleteTable,
  onAddTable,
  onUpdateTable,
  selectedSvgId,
  onUnbindSvgId,
  onAutoSetPageNumber,
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

  const handleMetaUrlLoad = () => {
    if (!metaUrlInput.trim()) return
    onMetaUrlLoad(metaUrlInput.trim())
  }

  const handleItemsUrlLoad = () => {
    if (!itemsUrlInput.trim()) return
    onItemsUrlLoad(itemsUrlInput.trim())
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
          <h3>Pages</h3>
          <div className="graph-pages">
            {template.pages.map((p) => (
              <button
                key={p.id}
                className={`graph-page ${page?.id === p.id ? 'active' : ''}`}
                onClick={() => onSelectPageId(p.id)}
              >
                <span>{p.id}</span>
                <span className="graph-page-kind">{p.kind}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="graph-section">
          <h3>Data</h3>
          <div className="graph-data-toolbar">
            <button
              className="btn-secondary graph-demo-button"
              onClick={onLoadDemoData}
              disabled={dataLoading}
            >
              デモデータ読込
            </button>
          </div>

          <div className="graph-data-import">
            <div className="graph-data-import-row">
              <span className="graph-data-label">Meta(JSON)</span>
              <label className="btn-secondary graph-upload-button">
                Upload
                <input type="file" accept="application/json,.json" onChange={handleMetaFileChange} />
              </label>
              <button className="btn-secondary" onClick={onClearMeta} disabled={!metaData}>
                Clear
              </button>
            </div>
            <div className="graph-data-import-row">
              <input
                type="text"
                value={metaUrlInput}
                onChange={(e) => setMetaUrlInput((e.target as HTMLInputElement).value)}
                placeholder="https://.../meta.json"
              />
              <button className="btn-secondary" onClick={handleMetaUrlLoad} disabled={dataLoading || !metaUrlInput.trim()}>
                URL読込
              </button>
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
              <button className="btn-secondary" onClick={onClearItems} disabled={!itemsData}>
                Clear
              </button>
            </div>
            <div className="graph-data-import-row">
              <input
                type="text"
                value={itemsUrlInput}
                onChange={(e) => setItemsUrlInput((e.target as HTMLInputElement).value)}
                placeholder="https://.../items.csv"
              />
              <button className="btn-secondary" onClick={handleItemsUrlLoad} disabled={dataLoading || !itemsUrlInput.trim()}>
                URL読込
              </button>
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
            {metaKeys.length === 0 ? (
              <p className="empty">No meta loaded.</p>
            ) : (
              <div className="graph-node-list">
                {metaKeys.map((key) => (
                  <div
                    key={key}
                    className="graph-node graph-node-meta"
                    draggable
                    onDragStart={handleDataDragStart({ source: 'meta', key })}
                  >
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
            {itemColumns.length === 0 ? (
              <p className="empty">No items loaded.</p>
            ) : (
              <div className="graph-node-list">
                {itemColumns.map((column) => (
                  <div
                    key={column}
                    className="graph-node graph-node-items"
                    draggable
                    onDragStart={handleDataDragStart({ source: 'items', key: column })}
                  >
                    {column}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="graph-subsection">
            <div className="graph-subsection-header">
              <h4>Static</h4>
            </div>
            <div className="graph-static-input">
              <input
                type="text"
                value={staticInput}
                onChange={(e) => setStaticInput((e.target as HTMLInputElement).value)}
                placeholder="Static text"
              />
              <button className="btn-secondary" onClick={handleAddStaticNode} disabled={!staticInput.trim()}>
                Add
              </button>
            </div>
            {staticNodes.length === 0 ? (
              <p className="empty">No static nodes.</p>
            ) : (
              <div className="graph-node-list">
                {staticNodes.map((text) => (
                  <div
                    key={text}
                    className="graph-node graph-node-static"
                    draggable
                    onDragStart={handleDataDragStart({ source: 'static', key: text })}
                  >
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
            <button className="btn-primary" onClick={() => onAddTable(page.id)}>+ Add Table</button>
          ) : (
            <div className="graph-table-config">
              <label>Active Table</label>
              <select
                value={tableIndex}
                onChange={(e) => onActiveTableIndexChange(parseInt((e.target as HTMLSelectElement).value, 10))}
              >
                {page.tables.map((table, idx) => (
                  <option key={idx} value={idx}>
                    Table #{idx + 1} ({table.source})
                  </option>
                ))}
              </select>

              <div className="graph-table-actions">
                <button
                  className="btn-secondary"
                  onClick={() => onEditTableCells(tableIndex)}
                  disabled={editTableIndex === tableIndex}
                >
                  {editTableIndex === tableIndex ? 'Editing…' : 'Edit Cells'}
                </button>
                {editTableIndex !== null && (
                  <button className="btn-secondary" onClick={onCancelEditTable}>
                    Cancel Edit
                  </button>
                )}
                <button
                  className="btn-danger"
                  onClick={() => {
                    if (confirm(`Delete Table #${tableIndex + 1}?`)) {
                      onDeleteTable(page.id, tableIndex)
                    }
                  }}
                >
                  Delete Table
                </button>
                <button className="btn-primary" onClick={() => onAddTable(page.id)}>
                  + Add Table
                </button>
              </div>

              {page.tables[tableIndex] && (
                <div className="graph-table-fields">
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
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={pageNumberIncludeTotal}
                  onChange={(e) => setPageNumberIncludeTotal((e.target as HTMLInputElement).checked)}
                />
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
          <h3>Binding Details</h3>
          {!selectedSvgId ? (
            <p className="empty">帳票上の要素を選択すると、ここに割当情報が表示されます。</p>
          ) : (
            <div className="graph-binding-details">
              <div className="graph-binding-row">
                <span className="label">選択中の要素ID</span>
                <span className="value">{selectedSvgId}</span>
              </div>
              <button
                className="btn-secondary"
                onClick={() => onUnbindSvgId(selectedSvgId)}
              >
                未割当に戻す
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
