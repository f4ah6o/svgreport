import { useEffect, useRef, useCallback } from 'preact/hooks'
import type { DataKeyRef } from '../types/data-key'

export type GraphMapNode = {
  key: string
  ref: DataKeyRef
  label: string
  type: DataKeyRef['source']
  missing: boolean
}

interface GraphMapOverlayProps {
  nodes: GraphMapNode[]
  groups?: Array<{ id: string; title: string; nodes: GraphMapNode[] }>
  onAnchorsChange: (anchors: Map<string, { x: number; y: number }>) => void
}

export function GraphMapOverlay({ nodes, groups, onAnchorsChange }: GraphMapOverlayProps) {
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

  const groupList = groups && groups.length > 0
    ? groups.filter(group => group.nodes.length > 0)
    : [{ id: 'all', title: 'Data', nodes }]

  return (
    <div className="graph-map-overlay" ref={containerRef}>
      <div className="graph-map-title">Graph Map</div>
      {nodes.length === 0 ? (
        <p className="empty">No data nodes.</p>
      ) : (
        <div className="graph-map-groups">
          {groupList.map((group) => (
            <div key={group.id} className={`graph-map-group ${group.id.startsWith('table') ? 'graph-map-group-table' : ''}`}>
              <div className="graph-map-group-title">{group.title}</div>
              <div className="graph-map-list">
                {group.nodes.map((node) => (
                  <div
                    key={node.key}
                    ref={setNodeRef(node.key)}
                    className={`graph-map-node graph-map-node-${node.type} ${node.missing ? 'missing' : ''}`}
                  >
                    <div className="graph-map-node-header">
                      <span className="graph-map-node-label">{node.label}</span>
                      <span className="graph-map-node-type">{node.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
