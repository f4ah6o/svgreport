import { useEffect, useRef, useCallback, useMemo } from 'preact/hooks'
import type { DataKeyRef } from '../types/data-key'
import { encodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'

export type GraphMapNode = {
  key: string
  ref: DataKeyRef
  label: string
  type: DataKeyRef['source']
  missing: boolean
}

export type GraphMapSection = {
  id: string
  kind: 'group' | 'node'
  title?: string
  nodes: GraphMapNode[]
}

interface GraphMapOverlayProps {
  nodes: GraphMapNode[]
  groups?: Array<{ id: string; title: string; nodes: GraphMapNode[] }>
  sections?: GraphMapSection[]
  dragEnabled?: boolean
  onAnchorsChange: (anchors: Map<string, { x: number; y: number }>) => void
}

export function GraphMapOverlay({
  nodes,
  groups,
  sections,
  dragEnabled = false,
  onAnchorsChange,
}: GraphMapOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef(new Map<string, HTMLElement>())

  const setNodeRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) {
      nodeRefs.current.set(id, el)
    } else {
      nodeRefs.current.delete(id)
    }
  }, [])

  const updateAnchors = useCallback(() => {
    const anchors = new Map<string, { x: number; y: number }>()
    for (const [key, el] of nodeRefs.current.entries()) {
      const rect = el.getBoundingClientRect()
      anchors.set(key, {
        x: rect.right,
        y: rect.top + rect.height / 2,
      })
    }
    onAnchorsChange(anchors)
  }, [onAnchorsChange])

  useEffect(() => {
    const frame = requestAnimationFrame(() => updateAnchors())
    return () => cancelAnimationFrame(frame)
  }, [nodes, updateAnchors])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handle = () => updateAnchors()
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
  }, [updateAnchors])

  const sectionList: GraphMapSection[] = useMemo(() => {
    if (sections && sections.length > 0) {
      return sections.filter(section => section.nodes.length > 0)
    }
    if (groups && groups.length > 0) {
      return groups.filter(group => group.nodes.length > 0).map(group => ({
        id: group.id,
        kind: 'group' as const,
        title: group.title,
        nodes: group.nodes,
      }))
    }
    return [{ id: 'all', kind: 'group', title: 'Data', nodes }]
  }, [sections, groups, nodes])

  const renderNode = (node: GraphMapNode) => {
    const canDrag = dragEnabled
    return (
    <div
      key={node.key}
      ref={setNodeRef(node.key)}
      className={[
        'graph-map-node',
        `graph-map-node-${node.type}`,
        node.missing ? 'missing' : '',
        canDrag ? 'graph-map-node-draggable' : '',
      ].join(' ')}
      draggable={canDrag}
      onMouseDown={(event) => {
        if (!canDrag) return
        event.stopPropagation()
      }}
      onMouseUp={(event) => {
        if (!canDrag) return
        event.stopPropagation()
      }}
      onDragStart={(event) => {
        if (!canDrag) return
        const payload = encodeDataKeyRef(node.ref)
        event.dataTransfer?.setData(DATA_KEY_MIME, payload)
        event.dataTransfer?.setData('application/json', payload)
        event.dataTransfer?.setData('text/plain', payload)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
      }}
      onDragEnd={(event) => {
        event.stopPropagation()
      }}
    >
      <div className="graph-map-node-header">
        <span className="graph-map-node-label">{node.label}</span>
        <span className="graph-map-node-type">{node.type}</span>
      </div>
    </div>
    )
  }

  return (
    <div className="graph-map-overlay" ref={containerRef}>
      <div className="graph-map-title">Graph Map</div>
      {nodes.length === 0 ? (
        <p className="empty">No data nodes.</p>
      ) : (
        <div className="graph-map-groups">
          {sectionList.map((section) => (
            section.kind === 'group' ? (
              <div key={section.id} className={`graph-map-group ${section.id.startsWith('table') ? 'graph-map-group-table' : ''}`}>
                {section.title && <div className="graph-map-group-title">{section.title}</div>}
                <div className="graph-map-list">
                  {section.nodes.map((node) => renderNode(node))}
                </div>
              </div>
            ) : (
              <div key={section.id} className="graph-map-node-row">
                {section.nodes.map((node) => renderNode(node))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}
