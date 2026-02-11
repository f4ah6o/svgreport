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
  onSvgEdited?: () => void
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
  onSvgEdited,
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
  const [showGraphLines, setShowGraphLines] = useState(true)
  const [showUnboundLines, setShowUnboundLines] = useState(true)
  const [lineEditMode, setLineEditMode] = useState(false)
  const [bindMode, setBindMode] = useState(false)
  const [editLabelsMode, setEditLabelsMode] = useState(false)
  const [svgZoom, setSvgZoom] = useState(1)
  const [tableDrawMode, setTableDrawMode] = useState(false)
  const [tableDragStart, setTableDragStart] = useState<{ x: number; y: number } | null>(null)
  const [tableDragRect, setTableDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [graphDataAnchors, setGraphDataAnchors] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [graphSvgAnchors, setGraphSvgAnchors] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [graphSvgAnchorRects, setGraphSvgAnchorRects] = useState<Map<string, { x1: number; y1: number; x2: number; y2: number }>>(new Map())
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

  const toSvgPoint = useCallback((event: MouseEvent | DragEvent) => {
    if (!overlaySvgRef.current) return null
    const ctm = overlaySvgRef.current.getScreenCTM()
    if (!ctm) return null
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse())
  }, [])

  const svgAttrInfo = useMemo(() => {
    const fitLabelById = new Map<string, string>()
    const labelsInUse = new Set<string>()
    const labelIds = new Set<string>()
    const fitWidthById = new Map<string, number>()
    const anchorById = new Map<string, 'start' | 'middle' | 'end'>()
    if (!svgContent) {
      return {
        fitLabelById,
        labelsInUse,
        labelIds,
        fitWidthById,
        anchorById,
      }
    }
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgContent, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      for (const node of nodes) {
        const id = node.getAttribute('id')
        if (!id) continue
        const className = node.getAttribute('class') || ''
        if (className.split(/\s+/).includes('label')) {
          labelIds.add(id)
        }
        const fitLabel = node.getAttribute('data-fit-label')
        if (fitLabel) {
          fitLabelById.set(id, fitLabel)
          labelsInUse.add(fitLabel)
        }
        const fitWidth = parseFloat(node.getAttribute('data-fit-width') || '')
        if (Number.isFinite(fitWidth) && fitWidth > 0) {
          fitWidthById.set(id, fitWidth)
        }
        const anchor = node.getAttribute('text-anchor')
        if (anchor === 'start' || anchor === 'middle' || anchor === 'end') {
          anchorById.set(id, anchor)
        }
      }
    } catch {
      // ignore parse failures
    }
    return {
      fitLabelById,
      labelsInUse,
      labelIds,
      fitWidthById,
      anchorById,
    }
  }, [svgContent])

  const {
    fitLabelById,
    labelsInUse,
    labelIds,
    fitWidthById,
    anchorById,
  } = svgAttrInfo
  const labelElementsById = useMemo(() => {
    const map = new Map<string, TextElement>()
    for (const element of elements) {
      if (element.id && !map.has(element.id)) {
        map.set(element.id, element)
      }
    }
    return map
  }, [elements])

  const [labelDrag, setLabelDrag] = useState<{
    targetId: string
    labelId: string | null
    mode: 'value' | 'label'
    startX: number
    startWidth: number
    anchor: 'start' | 'middle' | 'end'
    startY: number
    startLines: number
    startHeight: number
    labelStartFontSize?: number
    labelStartWidth?: number
  } | null>(null)
  const [labelDragWidth, setLabelDragWidth] = useState<number | null>(null)
  const [labelDragLines, setLabelDragLines] = useState<number | null>(null)
  const [labelDragLinesTouched, setLabelDragLinesTouched] = useState(false)

  const getDragTarget = useCallback((element: TextElement, isBound: boolean) => {
    if (!element.id) return null
    const directLabel = fitLabelById.get(element.id)
    if (directLabel) {
      return { targetId: element.id, labelId: directLabel, mode: 'value' as const }
    }
    if (labelIds.has(element.id) || labelsInUse.has(element.id)) {
      return { targetId: element.id, labelId: element.id, mode: 'label' as const }
    }
    if (isBound) {
      return { targetId: element.id, labelId: null, mode: 'value' as const }
    }
    return null
  }, [fitLabelById, labelIds, labelsInUse])

  const getAnchorForId = useCallback((id: string | null | undefined) => {
    if (!id) return 'start' as const
    return anchorById.get(id) ?? 'start'
  }, [anchorById])

  const getWidthForId = useCallback((id: string | null | undefined, fallback: number) => {
    if (!id) return fallback
    return fitWidthById.get(id) ?? fallback
  }, [fitWidthById])

  const fitLinesById = useMemo(() => {
    const map = new Map<string, number>()
    if (!svgContent) return map
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgContent, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      for (const node of nodes) {
        const id = node.getAttribute('id')
        if (!id) continue
        const value = parseInt(node.getAttribute('data-fit-lines') || '', 10)
        if (Number.isFinite(value) && value > 0) {
          map.set(id, value)
        }
      }
    } catch {
      // ignore
    }
    return map
  }, [svgContent])

  const getLinesForId = useCallback((id: string | null | undefined, fallback: number) => {
    if (!id) return fallback
    return fitLinesById.get(id) ?? fallback
  }, [fitLinesById])

  const getDisplayRect = useCallback((element: TextElement, width: number, anchor: 'start' | 'middle' | 'end') => {
    const bbox = resolvedBBoxByIndex.get(element.index) || element.bbox
    const anchorX = element.position?.x ?? (
      anchor === 'end'
        ? bbox.x + bbox.w
        : anchor === 'middle'
          ? bbox.x + bbox.w / 2
          : bbox.x
    )
    const x = anchor === 'end'
      ? anchorX - width
      : anchor === 'middle'
        ? anchorX - width / 2
        : anchorX
    return {
      x,
      y: bbox.y,
      w: Math.max(6, width),
      h: Math.max(6, bbox.h),
    }
  }, [resolvedBBoxByIndex])

  const getDisplayRectWithLines = useCallback((
    element: TextElement,
    width: number,
    anchor: 'start' | 'middle' | 'end',
    lines: number
  ) => {
    const base = getDisplayRect(element, width, anchor)
    const fontSize = element.font?.size ?? 12
    const lineHeight = fontSize * 1.2
    return {
      ...base,
      h: Math.max(base.h, lineHeight * Math.max(1, lines)),
    }
  }, [getDisplayRect])

  const handleLabelMouseDown = useCallback((element: TextElement, dragTarget: ReturnType<typeof getDragTarget>) => (event: MouseEvent) => {
    if (!editLabelsMode) return
    if (!dragTarget) return
    const point = toSvgPoint(event)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    const anchor = getAnchorForId(dragTarget.targetId)
    const bbox = resolvedBBoxByIndex.get(element.index) || element.bbox
    const startWidth = getWidthForId(dragTarget.targetId, bbox.w)
    const startLines = getLinesForId(dragTarget.targetId, 1)
    const nextDrag: typeof labelDrag = {
      targetId: dragTarget.targetId,
      labelId: dragTarget.labelId,
      mode: dragTarget.mode,
      startX: point.x,
      startWidth,
      anchor,
      startY: point.y,
      startLines,
      startHeight: bbox.h,
    }
    if (dragTarget.mode === 'label') {
      const labelEl = labelElementsById.get(dragTarget.targetId)
      if (labelEl?.font.size && labelEl.bbox.w) {
        nextDrag.labelStartFontSize = labelEl.font.size
        nextDrag.labelStartWidth = labelEl.bbox.w
      }
    }
    setLabelDrag(nextDrag)
    setLabelDragWidth(startWidth)
    setLabelDragLines(startLines)
    setLabelDragLinesTouched(false)
  }, [editLabelsMode, toSvgPoint, getDragTarget, getAnchorForId, getWidthForId, resolvedBBoxByIndex, labelElementsById])

  useEffect(() => {
    if (!labelDrag) return
    const handleMove = (event: MouseEvent) => {
      const point = toSvgPoint(event)
      if (!point) return
      const dx = point.x - labelDrag.startX
      const dy = point.y - labelDrag.startY
      const direction = labelDrag.anchor === 'end' ? -1 : 1
      const multiplier = labelDrag.anchor === 'middle' ? 2 : 1
      const delta = dx * direction * multiplier
      const next = Math.max(12, Math.min(600, Math.round((labelDrag.startWidth + delta) * 10) / 10))
      if (event.shiftKey) {
        setLabelDragWidth(next)
        return
      }

      const fontSize = labelElementsById.get(labelDrag.targetId)?.font.size ?? 12
      const lineHeight = fontSize * 1.2
      const steps = Math.max(1, Math.round((labelDrag.startHeight + dy) / lineHeight))
      if (Math.abs(dy) > Math.abs(dx)) {
        setLabelDragLines(steps)
        setLabelDragLinesTouched(true)
      } else {
        setLabelDragWidth(next)
      }
    }
    const handleUp = async () => {
      const width = labelDragWidth ?? labelDrag.startWidth
      const lines = labelDragLines ?? labelDrag.startLines
      setLabelDrag(null)
      setLabelDragWidth(null)
      setLabelDragLines(null)
      setLabelDragLinesTouched(false)
      if (!svgPath) return
      try {
        if (labelDrag.mode === 'label') {
          const startFontSize = labelDrag.labelStartFontSize
          const startWidth = labelDrag.labelStartWidth
          if (startFontSize && startWidth) {
            const nextFontSize = Math.max(6, Math.round((startFontSize * (width / startWidth)) * 10) / 10)
            await rpc.setSvgAttrs(svgPath, [
              {
                id: labelDrag.targetId,
                attrs: {
                  'font-size': String(nextFontSize),
                  style: `font-size:${nextFontSize}px`,
                },
              },
            ])
            onSvgEdited?.()
          }
          return
        }

        const attrs: Record<string, string> = {
          'data-fit-width': String(width),
        }
        if (labelDragLinesTouched) {
          attrs['data-fit-lines'] = String(lines)
        }
        await rpc.setSvgAttrs(svgPath, [
          { id: labelDrag.targetId, attrs },
        ])
        onSvgEdited?.()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update label size')
      }
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp, { once: true })
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [labelDrag, labelDragWidth, labelDragLines, labelDragLinesTouched, svgPath, onSvgEdited, toSvgPoint, labelElementsById])

  const overlayElements = useMemo(() => {
    return elements.filter((element) => {
      const isBound = Boolean(element.id && bindingSet.has(element.id))
      if (isBound && !showBindingElements) return false
      if (!isBound && !showNoBindingElements) return false
      const bindingType = element.id ? bindingTypeBySvgId.get(element.id) || null : null
      if (bindingType === 'unbound' && !showUnboundLines) return false
      return true
    })
  }, [elements, showBindingElements, showNoBindingElements, bindingSet, bindingTypeBySvgId, showUnboundLines])

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
      const dragTarget = getDragTarget(element, isBound)
      const isFitLabel = Boolean(dragTarget)
      return {
        element,
        bbox,
        listIndex,
        isBound,
        isHighlighted,
        bindingType,
        isValidationError,
        isValidationWarning,
        isFitLabel,
        dragTarget,
      }
    })
  }, [
    overlayElements,
    resolvedBBoxByIndex,
    indexByElementIndex,
    bindingSet,
    highlightedBindingSvgId,
    bindingTypeBySvgId,
    validationSet,
    validationWarningSet,
    getDragTarget,
  ])

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

  const clampZoom = useCallback((value: number) => Math.min(2.5, Math.max(0.5, value)), [])
  const adjustZoom = useCallback((delta: number) => {
    setSvgZoom((prev) => {
      const next = Math.round((prev + delta) * 100) / 100
      return clampZoom(next)
    })
  }, [clampZoom])


  const updateAnchors = useCallback(() => {
    if (!overlaySvgRef.current) return
    const ctm = overlaySvgRef.current.getScreenCTM()
    if (!ctm) return
    const anchors = new Map<string, { x: number; y: number }>()
    const rects = new Map<string, { x1: number; y1: number; x2: number; y2: number }>()
    for (const { element, bbox } of anchorCandidates) {
      const topLeft = new DOMPoint(bbox.x, bbox.y).matrixTransform(ctm)
      const bottomRight = new DOMPoint(bbox.x + bbox.w, bbox.y + bbox.h).matrixTransform(ctm)
      const rect = {
        x1: Math.min(topLeft.x, bottomRight.x),
        y1: Math.min(topLeft.y, bottomRight.y),
        x2: Math.max(topLeft.x, bottomRight.x),
        y2: Math.max(topLeft.y, bottomRight.y),
      }
      const center = { x: (rect.x1 + rect.x2) / 2, y: (rect.y1 + rect.y2) / 2 }
      const addAnchor = (key?: string | null) => {
        if (!key) return
        if (!anchors.has(key)) {
          anchors.set(key, center)
          rects.set(key, rect)
        }
      }
      addAnchor(element.id)
      addAnchor(element.suggestedId)
    }
    setGraphSvgAnchors(anchors)
    setGraphSvgAnchorRects(rects)
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
    const getStyle = (type: DataKeyRef['source']) => {
      if (type === 'unbound') return 'dotted'
      if (type === 'items') return 'dashed'
      if (type === 'static') return 'longdash'
      return 'solid'
    }
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; type: DataKeyRef['source']; key: string; svgId: string; style: 'solid' | 'dashed' | 'dotted' | 'longdash' }> = []
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    for (const connection of graphConnections) {
      const start = graphDataAnchors.get(connection.key)
      if (!start) continue
      const rect = graphSvgAnchorRects.get(connection.svgId)
      const fallback = graphSvgAnchors.get(connection.svgId)
      if (!rect && !fallback) continue
      const end = rect
        ? {
            x: clamp(start.x, rect.x1, rect.x2),
            y: clamp(start.y, rect.y1, rect.y2),
          }
        : fallback!
      const ref = decodeDataKeyRef(connection.key)
      const type = ref?.source || 'meta'
      if (type === 'unbound' && !showUnboundLines) continue
      lines.push({
        x1: start.x - graphContainerRect.left,
        y1: start.y - graphContainerRect.top,
        x2: end.x - graphContainerRect.left,
        y2: end.y - graphContainerRect.top,
        type,
        style: getStyle(type),
        key: connection.key,
        svgId: connection.svgId,
      })
    }
    return lines
  }, [graphConnections, graphDataAnchors, graphSvgAnchors, graphSvgAnchorRects, graphContainerRect, showUnboundLines])



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
        <p>帳票ページを選択してください</p>
      </div>
    )
  }

  return (
    <div className="svg-viewer">
      <div className="svg-preview">
        <h3>帳票プレビュー</h3>
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
                className={`btn-secondary ${bindMode ? 'active' : ''}`}
                onClick={() => {
                  setBindMode((prev) => {
                    const next = !prev
                    setLineEditMode(next)
                    if (next) {
                      setTableDrawMode(false)
                      setTableDragRect(null)
                      setTableDragStart(null)
                    }
                    return next
                  })
                }}
                disabled={!showGraphLines}
              >
                {bindMode ? 'Done Binding' : 'Bind Mode'}
              </button>
            </>
          )}
          <button
            className={`btn-secondary ${editLabelsMode ? 'active' : ''}`}
            onClick={() => setEditLabelsMode((prev) => !prev)}
            disabled={!graphMapNodes || graphMapNodes.length === 0}
          >
            {editLabelsMode ? 'Done Labels' : 'Edit Labels'}
          </button>
          {editLabelsMode && (
            <span className="edit-labels-hint">Drag horizontally to set width, vertically to set lines (Shift = width only)</span>
          )}
          <div className="svg-preview-zoom">
            <span>A4</span>
            <button className="btn-secondary" onClick={() => adjustZoom(-0.1)}>-</button>
            <button className="btn-secondary" onClick={() => setSvgZoom(1)}>Fit</button>
            <button className="btn-secondary" onClick={() => adjustZoom(0.1)}>+</button>
            <span className="svg-preview-zoom-value">{Math.round(svgZoom * 100)}%</span>
          </div>
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

        {loading && <div className="loading">帳票を読み込み中...</div>}
        {error && <div className="error">{error}</div>}

        {svgContent && (
          <div className="svg-container" ref={svgContainerRef}>
            <div className="svg-layout">
              {graphMapNodes && (
                <div className="graph-map-column">
                  <GraphMapOverlay
                    nodes={orderedGraphNodes}
                    sections={graphMapSections}
                    dragEnabled={bindMode}
                    onAnchorsChange={(anchors) => setGraphDataAnchors(new Map(anchors))}
                  />
                </div>
              )}
              <div className="svg-stage">
                <div className="svg-zoom" style={{ transform: `scale(${svgZoom})` }}>
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
                  {showElementMap && overlayItems.map(({ element, bbox, listIndex, isBound, isHighlighted, bindingType, isValidationError, isValidationWarning, isFitLabel, dragTarget }) => {
                    const dragId = dragTarget?.targetId || null
                    const labelDraggable = editLabelsMode && Boolean(dragTarget) && isFitLabel
                    const labelDragging = Boolean(dragId && labelDrag?.targetId === dragId)
                    const anchor = getAnchorForId(element.id)
                    const baseWidth = getWidthForId(element.id, bbox.w)
                    const baseLines = getLinesForId(element.id, 1)
                    const liveWidth = labelDragging && labelDragWidth
                      ? labelDragWidth
                      : baseWidth
                    const liveLines = labelDragging && labelDragLines
                      ? labelDragLines
                      : baseLines
                    const displayRect = getDisplayRectWithLines(element, liveWidth, anchor, liveLines)
                    const baseRectClasses = [
                      isHighlighted
                        ? 'svg-overlay-rect-linked'
                        : isBound
                          ? 'svg-overlay-rect-bound'
                          : 'svg-overlay-rect-dim',
                      isBound && bindingType ? `svg-overlay-rect-${bindingType}` : '',
                      isValidationError ? 'svg-overlay-rect-error' : '',
                      !isValidationError && isValidationWarning ? 'svg-overlay-rect-warning' : '',
                    ].join(' ')
                    const baseRect = labelDraggable ? displayRect : {
                      x: bbox.x,
                      y: bbox.y,
                      w: Math.max(bbox.w, 6),
                      h: Math.max(bbox.h, 6),
                    }
                    return (
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
                      {labelDraggable && (
                        <rect
                          className={[
                            baseRectClasses,
                            'svg-overlay-rect-fit-label',
                            labelDragging ? 'svg-overlay-rect-fit-label-active' : '',
                          ].join(' ')}
                          x={displayRect.x}
                          y={displayRect.y}
                          width={displayRect.w}
                          height={displayRect.h}
                          onMouseDown={handleLabelMouseDown(element, dragTarget)}
                        />
                      )}
                      <rect
                        className={baseRectClasses}
                        x={baseRect.x}
                        y={baseRect.y}
                        width={baseRect.w}
                        height={baseRect.h}
                        style={labelDraggable ? { cursor: 'ew-resize' } : undefined}
                        onClick={() => {
                          handleElementClick(element, listIndex)
                        }}
                        onMouseDown={labelDraggable ? handleLabelMouseDown(element, dragTarget) : undefined}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop(element)}
                      />
                      <text
                        className={[
                          isBound ? 'svg-overlay-label-bound' : 'svg-overlay-label',
                          isBound && bindingType ? `svg-overlay-label-${bindingType}` : '',
                          labelDragging ? 'svg-overlay-label-dragging' : '',
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
                    )
                  })}
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
                      className={`graph-connector-line graph-connector-visible graph-connector-line-${line.type} graph-connector-${line.style}`}
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
