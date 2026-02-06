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
  dataLoading: boolean
  onLoadDemoData: () => void
  metaScope: 'page' | 'global'
  onMetaScopeChange: (scope: 'page' | 'global') => void
  itemsTarget: 'body' | 'header'
  onItemsTargetChange: (target: 'body' | 'header') => void
  activeTableIndex: number
  onActiveTableIndexChange: (index: number) => void
  onAddTable: (pageId: string) => void
  onUpdateTable: (pageId: string, tableIndex: number, patch: Partial<TableBinding>) => void
}

export function GraphEditor({
  template,
  selectedPageId,
  onSelectPageId,
  metaData,
  itemsData,
  dataLoading,
  onLoadDemoData,
  metaScope,
  onMetaScopeChange,
  itemsTarget,
  onItemsTargetChange,
  activeTableIndex,
  onActiveTableIndexChange,
  onAddTable,
  onUpdateTable,
}: GraphEditorProps) {
  const [staticInput, setStaticInput] = useState('')
  const [customStaticNodes, setCustomStaticNodes] = useState<string[]>([])

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

  const tableIndex = page && page.tables.length > 0
    ? Math.min(activeTableIndex, page.tables.length - 1)
    : 0

  useEffect(() => {
    if (!page || page.tables.length === 0) return
    if (activeTableIndex >= page.tables.length) {
      onActiveTableIndexChange(0)
    }
  }, [page, activeTableIndex, onActiveTableIndexChange])

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
          <button
            className="btn-secondary graph-demo-button"
            onClick={onLoadDemoData}
            disabled={dataLoading}
          >
            Load Demo Data
          </button>
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

              {page.tables[tableIndex] && (
                <div className="graph-table-fields">
                  <label>Rows Per Page</label>
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
      </div>
    </div>
  )
}
