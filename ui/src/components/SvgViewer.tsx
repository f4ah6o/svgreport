import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
import type { TextElement } from '../types/api'
import { rpc } from '../lib/rpc'

interface SvgViewerProps {
  svgPath: string | null
  elements: TextElement[]
  templateDir: string
  bindingSvgIds: string[]
  tableBindingGroups: Array<{ id: string; cellSvgIds: string[] }>
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
  bindingSvgIds,
  tableBindingGroups,
  selectedElementIndex,
  onSelectElement,
  pendingId,
  onPendingIdChange,
  onUseSuggestedId,
  onApplyId,
  isLoading,
}: SvgViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const svgContentRef = useRef<HTMLDivElement | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlayViewBox, setOverlayViewBox] = useState<string | null>(null)
  const [overlayPreserveAspectRatio, setOverlayPreserveAspectRatio] = useState('xMidYMid meet')
  const [measuredBBoxes, setMeasuredBBoxes] = useState<Map<number, { x: number; y: number; w: number; h: number }>>(new Map())
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
      setOverlayPreserveAspectRatio('xMidYMid meet')
      return
    }

    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgContent, 'image/svg+xml')
      const svg = doc.documentElement
      const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')
      setOverlayPreserveAspectRatio(preserveAspectRatio || 'xMidYMid meet')
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
      setOverlayPreserveAspectRatio('xMidYMid meet')
    }
  }, [svgContent])

  const selectedElement = useMemo(() => {
    if (selectedElementIndex === null) return null
    return elements[selectedElementIndex] || null
  }, [elements, selectedElementIndex])

  const bindingSet = useMemo(() => new Set(bindingSvgIds), [bindingSvgIds])

  const overlayElements = useMemo(() => {
    return elements.filter((element) => {
      const isBound = Boolean(element.id && bindingSet.has(element.id))
      if (isBound && !showBindingElements) return false
      if (!isBound && !showNoBindingElements) return false
      return true
    })
  }, [elements, showBindingElements, showNoBindingElements, bindingSet])

  const indexByElementIndex = useMemo(() => {
    const map = new Map<number, number>()
    elements.forEach((element, idx) => map.set(element.index, idx))
    return map
  }, [elements])

  const resolvedBBoxByIndex = useMemo(() => {
    const map = new Map<number, { x: number; y: number; w: number; h: number }>()
    for (const element of elements) {
      map.set(element.index, measuredBBoxes.get(element.index) || element.bbox)
    }
    return map
  }, [elements, measuredBBoxes])

  const overlayItems = useMemo(() => {
    return overlayElements.map((element) => {
      const bbox = resolvedBBoxByIndex.get(element.index) || element.bbox
      const listIndex = indexByElementIndex.get(element.index)
      const isBound = Boolean(element.id && bindingSet.has(element.id))
      return { element, bbox, listIndex, isBound }
    })
  }, [overlayElements, resolvedBBoxByIndex, indexByElementIndex, bindingSet])

  const elementsById = useMemo(() => {
    const map = new Map<string, TextElement[]>()
    for (const element of elements) {
      if (!element.id) continue
      const list = map.get(element.id) || []
      list.push(element)
      map.set(element.id, list)
    }
    return map
  }, [elements])

  const selectedElementBBox = useMemo(() => {
    if (!selectedElement) return null
    return resolvedBBoxByIndex.get(selectedElement.index) || selectedElement.bbox
  }, [selectedElement, resolvedBBoxByIndex])

  const tableOverlays = useMemo(() => {
    const overlays: Array<{
      id: string
      x: number
      y: number
      w: number
      h: number
      cells: Array<{ x: number; y: number; w: number; h: number }>
    }> = []
    for (const group of tableBindingGroups) {
      const candidates: TextElement[] = []
      for (const id of group.cellSvgIds) {
        const matches = elementsById.get(id) || []
        candidates.push(...matches)
      }
      if (candidates.length === 0) continue

      // Keep a cohesive row cluster to avoid far-out duplicate IDs.
      const sorted = [...candidates].sort((a, b) => {
        const ay = (resolvedBBoxByIndex.get(a.index) || a.bbox).y
        const by = (resolvedBBoxByIndex.get(b.index) || b.bbox).y
        return ay - by
      })
      const clusters: TextElement[][] = []
      for (const el of sorted) {
        const bbox = resolvedBBoxByIndex.get(el.index) || el.bbox
        const y = bbox.y
        const current = clusters[clusters.length - 1]
        if (!current) {
          clusters.push([el])
          continue
        }
        const last = current[current.length - 1]
        const lastY = (resolvedBBoxByIndex.get(last.index) || last.bbox).y
        if (Math.abs(y - lastY) <= 36) {
          current.push(el)
        } else {
          clusters.push([el])
        }
      }
      const points = clusters.sort((a, b) => b.length - a.length)[0] || []
      if (points.length === 0) continue

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      const cells: Array<{ x: number; y: number; w: number; h: number }> = []

      for (const el of points) {
        const bbox = resolvedBBoxByIndex.get(el.index) || el.bbox
        cells.push(bbox)
        minX = Math.min(minX, bbox.x)
        minY = Math.min(minY, bbox.y)
        maxX = Math.max(maxX, bbox.x + bbox.w)
        maxY = Math.max(maxY, bbox.y + bbox.h)
      }

      overlays.push({
        id: group.id,
        x: minX - 8,
        y: minY - 8,
        w: Math.max(8, maxX - minX + 16),
        h: Math.max(8, maxY - minY + 16),
        cells,
      })
    }
    return overlays
  }, [tableBindingGroups, elementsById, resolvedBBoxByIndex])

  useEffect(() => {
    if (!svgContent || elements.length === 0) {
      setMeasuredBBoxes(new Map())
      return
    }

    let cancelled = false
    const run = () => {
      if (cancelled) return
      const root = svgContentRef.current
      const svg = root?.querySelector('svg')
      if (!svg) return

      const textNodes = Array.from(svg.querySelectorAll('text'))
      const svgToScreen = svg.getScreenCTM()
      if (!svgToScreen) return
      const screenToSvg = svgToScreen.inverse()
      const byDomIndex = new Map<number, { x: number; y: number; w: number; h: number }>()
      textNodes.forEach((node, idx) => {
        try {
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return
          const bbox = rectToSvgBBox(rect, screenToSvg)
          byDomIndex.set(idx + 1, {
            x: bbox.x,
            y: bbox.y,
            w: Math.max(6, bbox.width),
            h: Math.max(6, bbox.height),
          })
        } catch {
          // ignore
        }
      })

      const map = new Map<number, { x: number; y: number; w: number; h: number }>()
      for (const element of elements) {
        if (element.domIndex && byDomIndex.has(element.domIndex)) {
          const measured = byDomIndex.get(element.domIndex)
          if (measured) map.set(element.index, measured)
        }
      }
      setMeasuredBBoxes(map)
    }

    const raf = requestAnimationFrame(run)
    const timer = setTimeout(run, 200)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [svgContent, elements])

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
            <div className="svg-stage">
              <div
                className="svg-content"
                ref={svgContentRef}
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
              {overlayViewBox && (showElementMap || selectedElement) && (
                <svg
                  className="svg-overlay"
                  viewBox={overlayViewBox}
                  preserveAspectRatio={overlayPreserveAspectRatio}
                >
                  {showElementMap && overlayItems.map(({ element, bbox, listIndex, isBound }) => (
                    <g key={`${element.index}-${element.id || 'noid'}`}>
                      <rect
                        className={isBound ? 'svg-overlay-rect-bound' : 'svg-overlay-rect-dim'}
                        x={bbox.x}
                        y={bbox.y}
                        width={Math.max(bbox.w, 6)}
                        height={Math.max(bbox.h, 6)}
                        onClick={() => {
                          if (listIndex !== undefined) onSelectElement(listIndex)
                        }}
                      />
                      <text
                        className={isBound ? 'svg-overlay-label-bound' : 'svg-overlay-label'}
                        x={bbox.x + 1}
                        y={bbox.y - 1}
                        style={{ fontSize: `${getOverlayLabelSize(element, bbox)}px` }}
                        onClick={() => {
                          if (listIndex !== undefined) onSelectElement(listIndex)
                        }}
                      >
                        {element.index}
                      </text>
                    </g>
                  ))}
                  {showElementMap && showBindingElements && tableOverlays.map((rect) => (
                    <g key={rect.id}>
                      {rect.cells.map((cell, i) => (
                        <rect
                          key={`${rect.id}-cell-${i}`}
                          className="svg-overlay-table-cell"
                          x={cell.x - 2}
                          y={cell.y - 2}
                          width={Math.max(6, cell.w + 4)}
                          height={Math.max(6, cell.h + 4)}
                        />
                      ))}
                      <rect
                        className="svg-overlay-table"
                        x={rect.x}
                        y={rect.y}
                        width={rect.w}
                        height={rect.h}
                      />
                      <text
                        className="svg-overlay-table-label"
                        x={rect.x + 2}
                        y={rect.y - 2}
                      >
                        {rect.id}
                      </text>
                    </g>
                  ))}
                  {selectedElement && (
                    <rect
                      className="svg-overlay-rect"
                      x={selectedElementBBox?.x || selectedElement.bbox.x}
                      y={selectedElementBBox?.y || selectedElement.bbox.y}
                      width={Math.max(selectedElementBBox?.w || selectedElement.bbox.w, 8)}
                      height={Math.max(selectedElementBBox?.h || selectedElement.bbox.h, 8)}
                    />
                  )}
                </svg>
              )}
            </div>
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

function getOverlayLabelSize(
  element: TextElement,
  bbox?: { x: number; y: number; w: number; h: number }
): number {
  const base = element.font.size ?? bbox?.h ?? element.bbox.h ?? 12
  return Math.max(6, Math.min(18, base))
}

function rectToSvgBBox(rect: DOMRect, screenToSvg: DOMMatrix): DOMRect {
  const p1 = new DOMPoint(rect.left, rect.top).matrixTransform(screenToSvg)
  const p2 = new DOMPoint(rect.right, rect.top).matrixTransform(screenToSvg)
  const p3 = new DOMPoint(rect.right, rect.bottom).matrixTransform(screenToSvg)
  const p4 = new DOMPoint(rect.left, rect.bottom).matrixTransform(screenToSvg)

  const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)

  return new DOMRect(minX, minY, maxX - minX, maxY - minY)
}
