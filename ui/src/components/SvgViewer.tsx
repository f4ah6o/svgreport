import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
import type { TextElement } from '../types/api'
import { rpc } from '../lib/rpc'

interface SvgViewerProps {
  svgPath: string | null
  elements: TextElement[]
  templateDir: string
  selectedElementIndex: number | null
  onSelectElement: (index: number) => void
  pendingId: string
  onPendingIdChange: (value: string) => void
  onUseSuggestedId: () => void
  onApplyId: () => void
  isLoading: boolean
}

export function SvgViewer({
  svgPath,
  elements,
  templateDir,
  selectedElementIndex,
  onSelectElement,
  pendingId,
  onPendingIdChange,
  onUseSuggestedId,
  onApplyId,
  isLoading,
}: SvgViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlayViewBox, setOverlayViewBox] = useState<string | null>(null)
  const [svgPaneWidth, setSvgPaneWidth] = useState(62)
  const [showElementMap, setShowElementMap] = useState(true)
  const [showBindingElements, setShowBindingElements] = useState(true)
  const [showNoBindingElements, setShowNoBindingElements] = useState(true)

  useEffect(() => {
    if (!svgPath) {
      setSvgContent(null)
      setOverlayViewBox(null)
      return
    }

    const loadSvg = async () => {
      setLoading(true)
      setError(null)
      try {
        void templateDir
        const result = await rpc.readSvg(svgPath)
        setSvgContent(result.svg)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load SVG')
      } finally {
        setLoading(false)
      }
    }

    loadSvg()
  }, [svgPath])

  useEffect(() => {
    if (!svgContent) {
      setOverlayViewBox(null)
      return
    }

    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgContent, 'image/svg+xml')
      const svg = doc.documentElement
      const viewBox = svg.getAttribute('viewBox')
      if (viewBox) {
        setOverlayViewBox(viewBox)
        return
      }

      const widthAttr = svg.getAttribute('width') || ''
      const heightAttr = svg.getAttribute('height') || ''
      const width = parseFloat(widthAttr)
      const height = parseFloat(heightAttr)
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        setOverlayViewBox(`0 0 ${width} ${height}`)
      } else {
        setOverlayViewBox(null)
      }
    } catch {
      setOverlayViewBox(null)
    }
  }, [svgContent])

  const selectedElement = useMemo(() => {
    if (selectedElementIndex === null) return null
    return elements[selectedElementIndex] || null
  }, [elements, selectedElementIndex])

  const overlayElements = useMemo(() => {
    return elements.filter((element) => {
      const hasBinding = Boolean(element.id)
      if (hasBinding && !showBindingElements) return false
      if (!hasBinding && !showNoBindingElements) return false
      return true
    })
  }, [elements, showBindingElements, showNoBindingElements])

  const indexByElementIndex = useMemo(() => {
    const map = new Map<number, number>()
    elements.forEach((element, idx) => map.set(element.index, idx))
    return map
  }, [elements])

  const startResize = useCallback((event: MouseEvent) => {
    event.preventDefault()
    const container = viewerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const startX = event.clientX
    const startWidth = svgPaneWidth

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const ratio = (dx / rect.width) * 100
      const next = Math.min(80, Math.max(35, startWidth + ratio))
      setSvgPaneWidth(next)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [svgPaneWidth])

  if (!svgPath) {
    return (
      <div className="svg-viewer empty">
        <p>Select a page to view its SVG</p>
      </div>
    )
  }

  return (
    <div className="svg-viewer" ref={viewerRef}>
      <div className="svg-preview" style={{ width: `${svgPaneWidth}%` }}>
        <h3>SVG Preview</h3>
        <div className="svg-path">{svgPath}</div>
        <div className="svg-preview-actions">
          <button className="btn-secondary" onClick={() => setShowElementMap(v => !v)}>
            Show/Hide Element Map
          </button>
          <button className="btn-secondary" onClick={() => setShowBindingElements(v => !v)}>
            Show/Hide Binding elements only
          </button>
          <button className="btn-secondary" onClick={() => setShowNoBindingElements(v => !v)}>
            Show/Hide no-Bindding elements only
          </button>
        </div>
        
        {loading && <div className="loading">Loading SVG...</div>}
        {error && <div className="error">{error}</div>}
        
        {svgContent && (
          <div className="svg-container">
            <div
              className="svg-content"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            {overlayViewBox && (showElementMap || selectedElement) && (
              <svg
                className="svg-overlay"
                viewBox={overlayViewBox}
                preserveAspectRatio="xMinYMin meet"
              >
                {showElementMap && overlayElements.map((element) => (
                  <g key={`${element.index}-${element.id || 'noid'}`}>
                    <rect
                      className="svg-overlay-rect-dim"
                      x={element.bbox.x}
                      y={element.bbox.y}
                      width={Math.max(element.bbox.w, 6)}
                      height={Math.max(element.bbox.h, 6)}
                      onClick={() => {
                        const idx = indexByElementIndex.get(element.index)
                        if (idx !== undefined) onSelectElement(idx)
                      }}
                    />
                    <text
                      className="svg-overlay-label"
                      x={element.bbox.x + 1}
                      y={element.bbox.y - 1}
                      style={{ fontSize: `${getOverlayLabelSize(element)}` }}
                      onClick={() => {
                        const idx = indexByElementIndex.get(element.index)
                        if (idx !== undefined) onSelectElement(idx)
                      }}
                    >
                      {element.index}
                    </text>
                  </g>
                ))}
                {selectedElement && (
                  <rect
                    className="svg-overlay-rect"
                    x={selectedElement.bbox.x}
                    y={selectedElement.bbox.y}
                    width={Math.max(selectedElement.bbox.w, 8)}
                    height={Math.max(selectedElement.bbox.h, 8)}
                  />
                )}
              </svg>
            )}
          </div>
        )}
      </div>

      <div
        className="svg-inner-divider"
        onMouseDown={(e) => startResize(e as unknown as MouseEvent)}
        role="separator"
        aria-orientation="vertical"
      />

      <div className="elements-list" style={{ width: `${100 - svgPaneWidth}%` }}>
        <h3>Text Elements ({elements.length})</h3>
        
        {elements.length === 0 ? (
          <p className="empty">No text elements found in this SVG</p>
        ) : (
          <ul>
            {elements.map((element, index) => (
              <li 
                key={index}
                className={`element-item ${selectedElementIndex === index ? 'selected' : ''}`}
                onClick={() => onSelectElement(index)}
              >
                <div className="element-header">
                  <span className="element-index">#{element.index}</span>
                  <span className="element-id">
                    {element.id || element.suggestedId || '(no id)'}
                  </span>
                </div>
                <div className="element-text">{element.text}</div>
                <div className="element-position">
                  pos: ({element.position.x.toFixed(1)}, {element.position.y.toFixed(1)})
                </div>
              </li>
            ))}
          </ul>
        )}

        {selectedElement && (
          <div className="element-details">
            <h4>Element Details</h4>
            <dl>
              <dt>Index</dt>
              <dd>{selectedElement.index}</dd>
              
              <dt>ID</dt>
              <dd>{selectedElement.id || '(none)'}</dd>
              
              <dt>Suggested ID</dt>
              <dd>{selectedElement.suggestedId || '(none)'}</dd>
              
              <dt>Text</dt>
              <dd>{selectedElement.text}</dd>
              
              <dt>Position</dt>
              <dd>
                x: {selectedElement.position.x.toFixed(2)}<br />
                y: {selectedElement.position.y.toFixed(2)}
              </dd>
              
              <dt>Bounding Box</dt>
              <dd>
                x: {selectedElement.bbox.x.toFixed(2)}<br />
                y: {selectedElement.bbox.y.toFixed(2)}<br />
                w: {selectedElement.bbox.w.toFixed(2)}<br />
                h: {selectedElement.bbox.h.toFixed(2)}
              </dd>
              
              <dt>Font Size</dt>
              <dd>{selectedElement.font.size?.toFixed(2) || 'unknown'}</dd>
            </dl>
          </div>
        )}

        <div className="id-assign">
          <h4>ID Assignment</h4>
          <div className="form-row">
            <label>Pending ID</label>
            <input
              type="text"
              value={pendingId}
              onChange={(e) => onPendingIdChange((e.target as HTMLInputElement).value)}
              placeholder="e.g. customer_name"
              disabled={!selectedElement || isLoading}
            />
          </div>
          <div className="id-assign-actions">
            <button
              className="btn-secondary"
              onClick={onUseSuggestedId}
              disabled={!selectedElement?.suggestedId || isLoading}
            >
              Use Suggested
            </button>
            <button
              className="btn-primary"
              onClick={onApplyId}
              disabled={!selectedElement || !pendingId.trim() || isLoading}
            >
              {isLoading ? 'Applying...' : 'Apply ID'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getOverlayLabelSize(element: TextElement): number {
  const base = element.font.size ?? element.bbox.h ?? 12
  return Math.max(6, Math.min(18, base))
}
