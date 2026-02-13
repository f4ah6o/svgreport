import { useMemo, useState } from 'preact/hooks'
import type { KVData, TableData } from '../types/api'
import type { DataKeyRef } from '../types/data-key'
import { encodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'

interface ConfigPanelProps {
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
}

export function ConfigPanel({
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
}: ConfigPanelProps) {
  const [metaUrlInput, setMetaUrlInput] = useState('')
  const [itemsUrlInput, setItemsUrlInput] = useState('')
  const [staticInput, setStaticInput] = useState('')
  const [customStaticNodes, setCustomStaticNodes] = useState<string[]>([])

  const metaKeys = useMemo(() => (metaData ? Object.keys(metaData).sort() : []), [metaData])
  const itemColumns = useMemo(() => (itemsData?.headers ? [...itemsData.headers] : []), [itemsData])

  const staticNodes = useMemo(() => {
    const values = new Set<string>(customStaticNodes)
    return Array.from(values)
  }, [customStaticNodes])

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

  return (
    <div className="config-pane">
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
    </div>
  )
}
