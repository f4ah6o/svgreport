import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks'
import type { TextElement } from '../types/api'
import { rpc } from '../lib/rpc'
import type { BindingRef } from '../types/binding'
import { decodeBindingRef, BINDING_MIME } from '../types/binding'
import type { DataKeyRef } from '../types/data-key'
import { decodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'
import type { GraphMapNode } from './GraphMapOverlay'
import { GraphMapOverlay } from './GraphMapOverlay'

interface SvgViewerProps {
  svgPath: string | null
  svgReloadToken?: number
  elements: TextElement[]
  templateDir: string
  bindingSvgIds: string[]
  tableBindingGroups: Array<{ id: string; cellSvgIds: string[] }>
  selectedElementIndex: number | null
  highlightedBindingSvgId: string | null
  onSelectElement: (index: number) => void
  onDropBinding: (ref: BindingRef, element: TextElement) => void
  onDropData?: (ref: DataKeyRef, element: TextElement) => void
  graphMapNodes?: GraphMapNode[]
  graphConnections?: Array<{ key: string; svgId: string; tableIndex?: number }>
  tableEditTargetIndex?: number | null
  validationSvgIds?: string[]
  validationWarningSvgIds?: string[]
  onCreateTableFromSelection?: (rect: { x: number; y: number; w: number; h: number }, elements: TextElement[]) => void
  onRemoveGraphBinding?: (connection: { key: string; svgId: string }) => void
  pendingId: string
  onPendingIdChange: (value: string) => void
  onUseSuggestedId: () => void
  onApplyId: () => void
  isLoading: boolean
}

export function SvgViewer({
  svgPath,
  svgReloadToken = 0,
  elements,
  templateDir,
  bindingSvgIds,
  tableBindingGroups,
  selectedElementIndex,
  highlightedBindingSvgId,
  onSelectElement,
  onDropBinding,
  onDropData,
  graphMapNodes,
  graphConnections,
  tableEditTargetIndex = null,
  validationSvgIds,
  validationWarningSvgIds,
  onCreateTableFromSelection,
  onRemoveGraphBinding,
  pendingId,
  onPendingIdChange,
  onUseSuggestedId,
  onApplyId,
  isLoading,
}: SvgViewerProps) {
  const svgContentRef = useRef<HTMLDivElement | null>(null)
  const svgContainerRef = useRef<HTMLDivElement | null>(null)
  const overlaySvgRef = useRef<SVGSVGElement | null>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overlayViewBox, setOverlayViewBox] = useState<string | null>(null)
  const [overlayPreserveAspectRatio, setOverlayPreserveAspectRatio] = useState('xMidYMid meet')
  const [measuredBBoxes, setMeasuredBBoxes] = useState<Map<number, { x: number; y: number; w: number; h: number }>>(new Map())
  const showElementMap = true
  const showBindingElements = true
  const showNoBindingElements = true
  const [lineStyle, setLineStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid')
  const [showGraphLines, setShowGraphLines] = useState(true)
  const [showUnboundLines, setShowUnboundLines] = useState(true)
  const [lineEditMode, setLineEditMode] = useState(false)
  const [bindMode, setBindMode] = useState(false)
  const [tableDrawMode, setTableDrawMode] = useState(false)
  const [tableDragStart, setTableDragStart] = useState<{ x: number; y: number } | null>(null)
  const [tableDragRect, setTableDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [graphDataAnchors, setGraphDataAnchors] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [graphSvgAnchors, setGraphSvgAnchors] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [graphContainerRect, setGraphContainerRect] = useState({ left: 0, top: 0, width: 0, height: 0 })

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
  }, [svgPath, svgReloadToken])

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
  const validationSet = useMemo(() => new Set(validationSvgIds || []), [validationSvgIds])
  const validationWarningSet = useMemo(() => new Set(validationWarningSvgIds || []), [validationWarningSvgIds])

  const overlayElements = useMemo(() => {
    return elements.filter((element) => {
      const isBound = Boolean(element.id && bindingSet.has(element.id))
      if (isBound && !showBindingElements) return false
      if (!isBound && !showNoBindingElements) return false
      return true
    })
  }, [elements, showBindingElements, showNoBindingElements, bindingSet])

  const viewBoxNumbers = useMemo(() => {
    if (!overlayViewBox) return null
    const parts = overlayViewBox.split(/[,\s]+/).filter(Boolean).map((value) => parseFloat(value))
    if (parts.length < 4 || parts.some((value) => Number.isNaN(value))) return null
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
  }, [overlayViewBox])

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

  const anchorCandidates = useMemo(() => {
    return elements.map((element) => ({
      element,
      bbox: resolvedBBoxByIndex.get(element.index) || element.bbox,
    }))
  }, [elements, resolvedBBoxByIndex])

  const bindingTypeBySvgId = useMemo(() => {
    const map = new Map<string, DataKeyRef['source']>()
    if (!graphConnections) return map
    const priority: Record<DataKeyRef['source'], number> = { items: 3, meta: 2, static: 1, unbound: 0 }
    for (const connection of graphConnections) {
      const ref = decodeDataKeyRef(connection.key)
      const type = ref?.source || 'meta'
      const current = map.get(connection.svgId)
      if (!current || priority[type] > priority[current]) {
        map.set(connection.svgId, type)
      }
    }
    return map
  }, [graphConnections])

  const getDropPadding = useCallback((bbox: { w: number; h: number }) => {
    const base = Math.min(bbox.w, bbox.h)
    return Math.max(6, Math.min(16, base * 0.2))
  }, [])

  const overlayItems = useMemo(() => {
    return overlayElements.map((element) => {
      const bbox = resolvedBBoxByIndex.get(element.index) || element.bbox
      const listIndex = indexByElementIndex.get(element.index)
      const isBound = Boolean(element.id && bindingSet.has(element.id))
      const bindingType = element.id ? bindingTypeBySvgId.get(element.id) || null : null
      const isHighlighted = Boolean(highlightedBindingSvgId && element.id === highlightedBindingSvgId)
      const isValidationError = Boolean(element.id && validationSet.has(element.id))
      const isValidationWarning = Boolean(element.id && validationWarningSet.has(element.id))
      return { element, bbox, listIndex, isBound, isHighlighted, bindingType, isValidationError, isValidationWarning }
    })
  }, [overlayElements, resolvedBBoxByIndex, indexByElementIndex, bindingSet, highlightedBindingSvgId, bindingTypeBySvgId, validationSet, validationWarningSet])

  const handleDrop = useCallback((element: TextElement) => (event: DragEvent) => {
    event.preventDefault()
    const dataPayload =
      event.dataTransfer?.getData(DATA_KEY_MIME)
      || event.dataTransfer?.getData('application/json')
      || event.dataTransfer?.getData('text/plain')
      || null
    const dataRef = decodeDataKeyRef(dataPayload)
    if (dataRef && onDropData) {
      onDropData(dataRef, element)
      return
    }

    const payload =
      event.dataTransfer?.getData(BINDING_MIME)
      || event.dataTransfer?.getData('application/json')
      || event.dataTransfer?.getData('text/plain')
      || null
    const ref = decodeBindingRef(payload)
    if (!ref) return
    onDropBinding(ref, element)
  }, [onDropBinding, onDropData])

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const toSvgPoint = useCallback((event: MouseEvent | DragEvent) => {
    if (!overlaySvgRef.current) return null
    const ctm = overlaySvgRef.current.getScreenCTM()
    if (!ctm) return null
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
  }, [])

  const handleTableMouseDown = useCallback((event: MouseEvent) => {
    if (!tableDrawMode) return
    const point = toSvgPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    setTableDragStart({ x: point.x, y: point.y })
    setTableDragRect({ x: point.x, y: point.y, w: 0, h: 0 })
  }, [tableDrawMode, toSvgPoint])

  const handleTableMouseMove = useCallback((event: MouseEvent) => {
    if (!tableDrawMode || !tableDragStart) return
    const point = toSvgPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(tableDragStart.x, point.x)
    const y = Math.min(tableDragStart.y, point.y)
    const w = Math.abs(point.x - tableDragStart.x)
    const h = Math.abs(point.y - tableDragStart.y)
    setTableDragRect({ x, y, w, h })
  }, [tableDrawMode, tableDragStart, toSvgPoint])

  const handleTableMouseUp = useCallback((event: MouseEvent) => {
    if (!tableDrawMode || !tableDragStart || !tableDragRect) return
    const point = toSvgPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(tableDragStart.x, point.x)
    const y = Math.min(tableDragStart.y, point.y)
    const w = Math.abs(point.x - tableDragStart.x)
    const h = Math.abs(point.y - tableDragStart.y)
    const rect = { x, y, w, h }
    const hits = elements.filter((element) => {
      const bbox = resolvedBBoxByIndex.get(element.index) || element.bbox
      const intersects = bbox.x < rect.x + rect.w
        && bbox.x + bbox.w > rect.x
        && bbox.y < rect.y + rect.h
        && bbox.y + bbox.h > rect.y
      return intersects
    })
    if (onCreateTableFromSelection) {
      onCreateTableFromSelection(rect, hits)
    }
    setTableDragStart(null)
    setTableDragRect(null)
    setTableDrawMode(false)
  }, [tableDrawMode, tableDragStart, tableDragRect, toSvgPoint, elements, resolvedBBoxByIndex, onCreateTableFromSelection])

  const handleElementClick = useCallback((_element: TextElement, listIndex?: number) => {
    if (listIndex !== undefined) onSelectElement(listIndex)
  }, [onSelectElement])

  const updateAnchors = useCallback(() => {
    if (!overlaySvgRef.current) return
    const ctm = overlaySvgRef.current.getScreenCTM()
    if (!ctm) return
    const anchors = new Map<string, { x: number; y: number }>()
    for (const { element, bbox } of anchorCandidates) {
      const point = new DOMPoint(bbox.x, bbox.y).matrixTransform(ctm)
      const addAnchor = (key?: string | null) => {
        if (!key) return
        if (!anchors.has(key)) {
          anchors.set(key, { x: point.x, y: point.y })
        }
      }
      addAnchor(element.id)
      addAnchor(element.suggestedId)
    }
    setGraphSvgAnchors(anchors)
  }, [anchorCandidates])

  const highlightedOverlayItems = useMemo(() => {
    if (!highlightedBindingSvgId) return []
    return overlayItems.filter((item) => item.element.id === highlightedBindingSvgId)
  }, [overlayItems, highlightedBindingSvgId])

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

  const orderedGraphNodes = useMemo(() => {
    if (!graphMapNodes || graphMapNodes.length === 0) return graphMapNodes || []
    if (!graphConnections || graphConnections.length === 0) return graphMapNodes
    if (graphSvgAnchors.size === 0) return graphMapNodes

    const indexByKey = new Map<string, number>()
    graphMapNodes.forEach((node, idx) => indexByKey.set(node.key, idx))

    const scores = new Map<string, { sum: number; count: number }>()
    for (const connection of graphConnections) {
      const anchor = graphSvgAnchors.get(connection.svgId)
      if (!anchor) continue
      const score = scores.get(connection.key) || { sum: 0, count: 0 }
      score.sum += anchor.y
      score.count += 1
      scores.set(connection.key, score)
    }

    return [...graphMapNodes].sort((a, b) => {
      const scoreA = scores.get(a.key)
      const scoreB = scores.get(b.key)
      if (!scoreA && !scoreB) return (indexByKey.get(a.key) ?? 0) - (indexByKey.get(b.key) ?? 0)
      if (!scoreA) return 1
      if (!scoreB) return -1
      const avgA = scoreA.sum / scoreA.count
      const avgB = scoreB.sum / scoreB.count
      if (avgA !== avgB) return avgA - avgB
      return (indexByKey.get(a.key) ?? 0) - (indexByKey.get(b.key) ?? 0)
    })
  }, [graphMapNodes, graphConnections, graphSvgAnchors])

  const graphMapSections = useMemo(() => {
    if (!graphMapNodes || graphMapNodes.length === 0) return []
    const byKey = new Map(graphMapNodes.map(node => [node.key, node]))
    const orderIndex = new Map(orderedGraphNodes.map((node, idx) => [node.key, idx]))

    const scoreByKey = new Map<string, number>()
    if (graphConnections && graphSvgAnchors.size > 0) {
      const sums = new Map<string, { sum: number; count: number }>()
      for (const connection of graphConnections) {
        const anchor = graphSvgAnchors.get(connection.svgId)
        if (!anchor) continue
        const current = sums.get(connection.key) || { sum: 0, count: 0 }
        current.sum += anchor.y
        current.count += 1
        sums.set(connection.key, current)
      }
      for (const [key, value] of sums.entries()) {
        if (value.count > 0) scoreByKey.set(key, value.sum / value.count)
      }
    }

    const sortNodes = (a: GraphMapNode, b: GraphMapNode) => {
      const scoreA = scoreByKey.get(a.key)
      const scoreB = scoreByKey.get(b.key)
      if (scoreA !== undefined && scoreB !== undefined && scoreA !== scoreB) return scoreA - scoreB
      if (scoreA !== undefined && scoreB === undefined) return -1
      if (scoreA === undefined && scoreB !== undefined) return 1
      return (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0)
    }

    const itemGroups = new Map<number, Set<string>>()
    const assignedKeys = new Set<string>()

    if (graphConnections) {
      for (const connection of graphConnections) {
        const ref = decodeDataKeyRef(connection.key)
        if (ref?.source !== 'items') continue
        if (connection.tableIndex === undefined || connection.tableIndex === null) continue
        const set = itemGroups.get(connection.tableIndex) || new Set<string>()
        set.add(connection.key)
        itemGroups.set(connection.tableIndex, set)
        assignedKeys.add(connection.key)
      }
    }

    const tableSections: Array<{ id: string; kind: 'group'; title: string; nodes: GraphMapNode[]; score: number | null; fallback: number }> = []
    for (const [tableIndex, keys] of itemGroups.entries()) {
      const nodes = Array.from(keys)
        .map(key => byKey.get(key))
        .filter((node): node is GraphMapNode => Boolean(node))
        .sort(sortNodes)
      if (nodes.length === 0) continue
      const scores = nodes.map(node => scoreByKey.get(node.key)).filter((v): v is number => v !== undefined)
      const score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
      const fallback = Math.min(...nodes.map(node => orderIndex.get(node.key) ?? 0))
      tableSections.push({
        id: `table-${tableIndex}`,
        kind: 'group',
        title: `Table ${tableIndex + 1}`,
        nodes,
        score,
        fallback,
      })
    }

    const looseNodes = graphMapNodes.filter((node) => !(node.type === 'items' && assignedKeys.has(node.key)))
    const looseSections = looseNodes.map((node) => ({
      id: `node-${node.key}`,
      kind: 'node' as const,
      nodes: [node],
      score: scoreByKey.get(node.key) ?? null,
      fallback: orderIndex.get(node.key) ?? 0,
    }))

    const sections = [...tableSections, ...looseSections]
    return sections.sort((a, b) => {
      if (a.score !== null && b.score !== null && a.score !== b.score) return a.score - b.score
      if (a.score !== null && b.score === null) return -1
      if (a.score === null && b.score !== null) return 1
      return a.fallback - b.fallback
    })
  }, [graphMapNodes, graphConnections, graphSvgAnchors, orderedGraphNodes])

  const graphLines = useMemo(() => {
    if (!graphConnections || graphConnections.length === 0) return []
    if (!graphContainerRect.width || !graphContainerRect.height) return []
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; type: DataKeyRef['source']; key: string; svgId: string }> = []
    for (const connection of graphConnections) {
      const start = graphDataAnchors.get(connection.key)
      const end = graphSvgAnchors.get(connection.svgId)
      if (!start || !end) continue
      const ref = decodeDataKeyRef(connection.key)
      const type = ref?.source || 'meta'
      if (type === 'unbound' && !showUnboundLines) continue
      lines.push({
        x1: start.x - graphContainerRect.left,
        y1: start.y - graphContainerRect.top,
        x2: end.x - graphContainerRect.left,
        y2: end.y - graphContainerRect.top,
        type,
        key: connection.key,
        svgId: connection.svgId,
      })
    }
    return lines
  }, [graphConnections, graphDataAnchors, graphSvgAnchors, graphContainerRect, showUnboundLines])



  const updateContainerRect = useCallback(() => {
    const container = svgContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setGraphContainerRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => updateAnchors())
    return () => cancelAnimationFrame(frame)
  }, [updateAnchors, svgContent, overlayViewBox])

  useEffect(() => {
    const frame = requestAnimationFrame(() => updateContainerRect())
    return () => cancelAnimationFrame(frame)
  }, [updateContainerRect, svgContent])

  useEffect(() => {
    const container = svgContainerRef.current
    if (!container) return
    const handle = () => {
      updateAnchors()
      updateContainerRect()
    }
    container.addEventListener('scroll', handle)
    window.addEventListener('resize', handle)
    window.addEventListener('scroll', handle, true)
    const observer = new ResizeObserver(handle)
    observer.observe(container)
    return () => {
      container.removeEventListener('scroll', handle)
      window.removeEventListener('resize', handle)
      window.removeEventListener('scroll', handle, true)
      observer.disconnect()
    }
  }, [updateAnchors, updateContainerRect])

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

  if (!svgPath) {
    return (
      <div className="svg-viewer empty">
        <p>Select a page to view its SVG</p>
      </div>
    )
  }

  return (
    <div className="svg-viewer">
      <div className="svg-preview">
        <h3>SVG Preview</h3>
        <div className="svg-path">{svgPath}</div>
        <div className="svg-preview-actions">
          {graphConnections && graphConnections.length > 0 && (
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowGraphLines((prev) => {
                    const next = !prev
                    if (!next) {
                      setLineEditMode(false)
                      setBindMode(false)
                    }
                    return next
                  })
                }}
              >
                {showGraphLines ? 'Hide Binding Lines' : 'Show Binding Lines'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowUnboundLines((prev) => !prev)}
                disabled={!showGraphLines}
              >
                {showUnboundLines ? 'Hide Unbound Lines' : 'Show Unbound Lines'}
              </button>
              <button
                className={`btn-secondary ${lineEditMode ? 'active' : ''}`}
                onClick={() => {
                  setLineEditMode((prev) => {
                    const next = !prev
                    if (next) {
                      setTableDrawMode(false)
                      setTableDragRect(null)
                      setTableDragStart(null)
                      setBindMode(false)
                    }
                    return next
                  })
                }}
                disabled={!showGraphLines}
              >
                {lineEditMode ? 'Done Editing' : 'Edit Lines'}
              </button>
              <button
                className={`btn-secondary ${bindMode ? 'active' : ''}`}
                onClick={() => {
                  setBindMode((prev) => {
                    const next = !prev
                    if (next) {
                      setLineEditMode(false)
                      setTableDrawMode(false)
                      setTableDragRect(null)
                      setTableDragStart(null)
                    }
                    return next
                  })
                }}
              >
                {bindMode ? 'Done Binding' : 'Bind Mode'}
              </button>
              <label className="svg-preview-select">
                Line Style
                <select value={lineStyle} onChange={(e) => setLineStyle((e.target as HTMLSelectElement).value as typeof lineStyle)}>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                </select>
              </label>
            </>
          )}
          {onCreateTableFromSelection && (
            <button
              className={`btn-secondary ${tableDrawMode ? 'active' : ''}`}
              onClick={() => {
                setTableDrawMode((prev) => !prev)
                setTableDragRect(null)
                setTableDragStart(null)
                setLineEditMode(false)
                setBindMode(false)
              }}
            >
              {tableEditTargetIndex !== null
                ? (tableDrawMode ? 'Cancel Table Update' : `Update Table #${tableEditTargetIndex + 1}`)
                : (tableDrawMode ? 'Cancel Table' : 'Add Table')}
            </button>
          )}
        </div>

        {loading && <div className="loading">Loading SVG...</div>}
        {error && <div className="error">{error}</div>}

        {svgContent && (
          <div className="svg-container" ref={svgContainerRef}>
            <div className="svg-layout">
              {graphMapNodes && (
                <GraphMapOverlay
                  nodes={orderedGraphNodes}
                  sections={graphMapSections}
                  dragEnabled={bindMode}
                  onAnchorsChange={(anchors) => setGraphDataAnchors(new Map(anchors))}
                />
              )}
              <div className="svg-stage">
                <div
                  className="svg-content"
                  ref={svgContentRef}
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />
                {overlayViewBox && (
                  <svg
                    className="svg-overlay"
                    viewBox={overlayViewBox}
                    preserveAspectRatio={overlayPreserveAspectRatio}
                    ref={overlaySvgRef}
                  >
                  {showElementMap && overlayItems.map(({ element, bbox, listIndex, isBound, isHighlighted, bindingType, isValidationError, isValidationWarning }) => (
                    <g key={`${element.index}-${element.id || 'noid'}`}>
                      <rect
                        className="svg-overlay-drop-zone"
                        x={bbox.x - getDropPadding(bbox)}
                        y={bbox.y - getDropPadding(bbox)}
                        width={Math.max(bbox.w, 6) + getDropPadding(bbox) * 2}
                        height={Math.max(bbox.h, 6) + getDropPadding(bbox) * 2}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      />
                      <rect
                        className={[
                          isHighlighted
                            ? 'svg-overlay-rect-linked'
                            : isBound
                              ? 'svg-overlay-rect-bound'
                              : 'svg-overlay-rect-dim',
                          isBound && bindingType ? `svg-overlay-rect-${bindingType}` : '',
                          isValidationError ? 'svg-overlay-rect-error' : '',
                          !isValidationError && isValidationWarning ? 'svg-overlay-rect-warning' : '',
                        ].join(' ')}
                        x={bbox.x}
                        y={bbox.y}
                        width={Math.max(bbox.w, 6)}
                        height={Math.max(bbox.h, 6)}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      />
                      <text
                        className={[
                          isBound ? 'svg-overlay-label-bound' : 'svg-overlay-label',
                          isBound && bindingType ? `svg-overlay-label-${bindingType}` : '',
                        ].join(' ')}
                        x={bbox.x + 1}
                        y={bbox.y - 1}
                        style={{ fontSize: `${getOverlayLabelSize(element, bbox)}px` }}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
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
                  {!showElementMap && highlightedOverlayItems.map(({ element, bbox, listIndex }) => (
                    <g key={`linked-${element.index}`}>
                      <rect
                        className="svg-overlay-drop-zone"
                        x={bbox.x - getDropPadding(bbox)}
                        y={bbox.y - getDropPadding(bbox)}
                        width={Math.max(bbox.w, 6) + getDropPadding(bbox) * 2}
                        height={Math.max(bbox.h, 6) + getDropPadding(bbox) * 2}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      />
                      <rect
                        className="svg-overlay-rect-linked"
                        x={bbox.x}
                        y={bbox.y}
                        width={Math.max(bbox.w, 6)}
                        height={Math.max(bbox.h, 6)}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      />
                      <text
                        className="svg-overlay-label-bound"
                        x={bbox.x + 1}
                        y={bbox.y - 1}
                        style={{ fontSize: `${getOverlayLabelSize(element, bbox)}px` }}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      >
                        {element.index}
                      </text>
                    </g>
                  ))}
                  {/* capture + selection are rendered last to stay on top while drawing */}
                  {tableDrawMode && viewBoxNumbers && (
                    <rect
                      className="svg-overlay-table-capture"
                      x={viewBoxNumbers.x}
                      y={viewBoxNumbers.y}
                      width={viewBoxNumbers.w}
                      height={viewBoxNumbers.h}
                      onMouseDown={handleTableMouseDown}
                      onMouseMove={handleTableMouseMove}
                      onMouseUp={handleTableMouseUp}
                    />
                  )}
                  {tableDragRect && (
                    <rect
                      className="svg-overlay-table-select"
                      x={tableDragRect.x}
                      y={tableDragRect.y}
                      width={tableDragRect.w}
                      height={tableDragRect.h}
                    />
                  )}
                  </svg>
                )}
              </div>
            </div>
            {showGraphLines && graphLines.length > 0 && (
              <svg
                className={`graph-connector-layer ${lineEditMode ? 'editing' : ''}`}
                width={graphContainerRect.width}
                height={graphContainerRect.height}
                aria-hidden="true"
              >
                {graphLines.map((line, idx) => (
                  <g key={`${line.key}-${line.svgId}-${idx}`}>
                    {lineEditMode && (
                      <line
                        className="graph-connector-hit"
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (onRemoveGraphBinding) {
                            onRemoveGraphBinding({ key: line.key, svgId: line.svgId })
                          }
                        }}
                      />
                    )}
                    <line
                      className={`graph-connector-line graph-connector-visible graph-connector-line-${line.type} graph-connector-${lineStyle}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                    />
                  </g>
                ))}
              </svg>
            )}
          </div>
        )}

        <div className="selected-element-panel">
          <div className="selected-element-header">
            <h4>Selected Element</h4>
            {!selectedElement && <span className="empty">Click a label on the SVG to select.</span>}
          </div>

          {selectedElement && (
            <div className="element-details">
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
