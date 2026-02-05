import { useState, useCallback, useEffect, useMemo } from 'preact/hooks'
import type { TemplateConfig, FieldBinding, PageConfig, TableBinding, TableCell, FormatterDef, ValueBinding, DataValueBinding, KVData, TableData } from '../types/api'
import type { BindingRef } from '../types/binding'
import { encodeBindingRef, bindingRefEquals, BINDING_MIME } from '../types/binding'
import type { DataKeyRef } from '../types/data-key'
import { encodeDataKeyRef, decodeDataKeyRef, DATA_KEY_MIME } from '../types/data-key'

interface TemplateEditorProps {
  template: TemplateConfig
  onChange: (template: TemplateConfig) => void
  onPageSelect: (pageId: string) => void
  selectedPageId: string | null
  onSelectedPageIdChange: (pageId: string) => void
  focusTarget: { tab: 'pages' | 'fields' | 'formatters'; path: string } | null
  onFocusTargetConsumed: () => void
  selectedPreviewSvgId: string | null
  onSelectBindingSvgId: (svgId: string | null) => void
  selectedBindingRef: BindingRef | null
  onSelectBindingRef: (ref: BindingRef | null) => void
  metaData: KVData | null
  itemsData: TableData | null
  metaFileName: string | null
  itemsFileName: string | null
  dataError: string | null
  dataLoading: boolean
  templateModels: Record<string, { kind: 'kv' | 'table'; fields?: string[]; columns?: string[] }> | null
  onMetaUpload: (file: File) => void
  onItemsUpload: (file: File) => void
  onMetaUrlLoad: (url: string) => void
  onItemsUrlLoad: (url: string) => void
  onClearMeta: () => void
  onClearItems: () => void
  onNotify: (message: string) => void
}

export function TemplateEditor({
  template,
  onChange,
  onPageSelect,
  selectedPageId,
  onSelectedPageIdChange,
  focusTarget,
  onFocusTargetConsumed,
  selectedPreviewSvgId,
  onSelectBindingSvgId,
  selectedBindingRef,
  onSelectBindingRef,
  metaData,
  itemsData,
  metaFileName,
  itemsFileName,
  dataError,
  dataLoading,
  templateModels,
  onMetaUpload,
  onItemsUpload,
  onMetaUrlLoad,
  onItemsUrlLoad,
  onClearMeta,
  onClearItems,
  onNotify,
}: TemplateEditorProps) {
  const [activeSection, setActiveSection] = useState<'info' | 'global-fields' | 'formatters' | 'page' | 'data'>('page')
  const [globalFieldGroupsOpen, setGlobalFieldGroupsOpen] = useState<{ static: boolean; data: boolean }>({
    static: false,
    data: true,
  })
  const [pageFieldGroupsOpen, setPageFieldGroupsOpen] = useState<{ static: boolean; data: boolean }>({
    static: false,
    data: true,
  })
  const [lastFocusPath, setLastFocusPath] = useState<string | null>(null)
  const [metaUrlInput, setMetaUrlInput] = useState('')
  const [itemsUrlInput, setItemsUrlInput] = useState('')
  const metaKeys = useMemo(() => (metaData ? Object.keys(metaData).sort() : []), [metaData])
  const itemColumns = useMemo(() => (itemsData?.headers ? [...itemsData.headers] : []), [itemsData])
  const itemSampleRows = useMemo(() => (itemsData?.rows ? itemsData.rows.slice(0, 3) : []), [itemsData])
  const pageIdCounts = template.pages.reduce<Record<string, number>>((acc, page) => {
    const key = page.id.trim()
    if (!key) return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const formatValueLabel = (binding: FieldBinding | TableCell): string => {
    if (binding.value.type === 'static') {
      return binding.value.text ? `"${binding.value.text}"` : '(static)'
    }
    return `${binding.value.source}.${binding.value.key || '(key)'}`
  }

  const handleDragStart = (ref: BindingRef, label: string) => (event: DragEvent) => {
    const payload = encodeBindingRef(ref)
    event.dataTransfer?.setData(BINDING_MIME, payload)
    event.dataTransfer?.setData('application/json', payload)
    event.dataTransfer?.setData('text/plain', payload)
    event.dataTransfer?.setData('text/x-svgpaper-label', label)
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'copy')
  }

  const handleDataDragStart = (ref: DataKeyRef) => (event: DragEvent) => {
    const payload = encodeDataKeyRef(ref)
    event.dataTransfer?.setData(DATA_KEY_MIME, payload)
    event.dataTransfer?.setData('application/json', payload)
    event.dataTransfer?.setData('text/plain', payload)
    event.dataTransfer && (event.dataTransfer.effectAllowed = 'copy')
  }

  const handleBindingDragOver = (event: DragEvent) => {
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleMetaFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      onMetaUpload(file)
    }
    input.value = ''
  }

  const handleItemsFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) {
      onItemsUpload(file)
    }
    input.value = ''
  }

  const handleCopyModels = async () => {
    if (!templateModels) {
      onNotify('No models to copy')
      return
    }
    try {
      const payload = JSON.stringify(templateModels, null, 2)
      await navigator.clipboard.writeText(payload)
      onNotify('Copied models JSON')
    } catch {
      onNotify('Failed to copy models')
    }
  }

  const renderBindingCard = (args: {
    ref: BindingRef
    binding: FieldBinding | TableCell
    title: string
    subtitle?: string
  }) => {
    const { ref, binding, title, subtitle } = args
    const valueLabel = formatValueLabel(binding)
    const isSelected = bindingRefEquals(selectedBindingRef, ref)
    const isBound = Boolean(binding.svg_id)

    return (
      <div
        className={`binding-card ${isSelected ? 'selected' : ''} ${isBound ? 'bound' : 'unbound'}`}
        draggable
        onDragStart={handleDragStart(ref, valueLabel)}
        onDragOver={handleBindingDragOver}
        onDrop={handleBindingDrop(ref)}
        onClick={() => onSelectBindingRef(ref)}
      >
        <div className="binding-card-header">
          <span className="binding-card-title">{title}</span>
          {subtitle ? <span className="binding-card-subtitle">{subtitle}</span> : null}
          <span className={`binding-card-status ${isBound ? 'bound' : 'unbound'}`}>
            {isBound ? 'bound' : 'unbound'}
          </span>
        </div>
        <div className="binding-card-body">
          <span className="binding-card-value">{valueLabel}</span>
          <span className="binding-card-target">{binding.svg_id || 'Drop on SVG'}</span>
        </div>
      </div>
    )
  }


  const handleTemplateIdChange = useCallback((value: string) => {
    onChange({
      ...template,
      template: { ...template.template, id: value }
    })
  }, [template, onChange])

  const handleVersionChange = useCallback((value: string) => {
    onChange({
      ...template,
      template: { ...template.template, version: value }
    })
  }, [template, onChange])

  const handleFieldChange = useCallback((index: number, field: FieldBinding) => {
    const newFields = [...template.fields]
    newFields[index] = field
    onChange({ ...template, fields: newFields })
  }, [template, onChange])

  const handlePageFieldChange = useCallback((pageId: string, index: number, field: FieldBinding) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const fields = [...(p.fields ?? [])]
      fields[index] = field
      return { ...p, fields }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleAddField = useCallback((kind: 'static' | 'data' = 'data') => {
    const newField: FieldBinding = {
      svg_id: '',
      value: kind === 'static'
        ? makeStaticValue()
        : makeDataValue('meta', ''),
      fit: 'none',
      align: 'left'
    }
    onChange({ ...template, fields: [...template.fields, newField] })
  }, [template, onChange])

  const handleAddPageField = useCallback((pageId: string, kind: 'static' | 'data' = 'data') => {
    const newField: FieldBinding = {
      svg_id: '',
      value: kind === 'static'
        ? makeStaticValue()
        : makeDataValue('meta', ''),
      fit: 'none',
      align: 'left'
    }
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const fields = [...(p.fields ?? []), newField]
      return { ...p, fields }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleRemoveField = useCallback((index: number) => {
    const newFields = template.fields.filter((_, i) => i !== index)
    onChange({ ...template, fields: newFields })
  }, [template, onChange])

  const handleRemovePageField = useCallback((pageId: string, index: number) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const fields = (p.fields ?? []).filter((_, i) => i !== index)
      return { ...p, fields }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleAddPage = useCallback(() => {
    const nextIndex = template.pages.length + 1
    const newPage: PageConfig = {
      id: `page-${nextIndex}`,
      svg: `page-${nextIndex}.svg`,
      kind: template.pages.length === 0 ? 'first' : 'repeat',
      fields: [],
      tables: [],
    }
    onChange({ ...template, pages: [...template.pages, newPage] })
  }, [template, onChange])

  const handleRemovePage = useCallback((pageId: string) => {
    const newPages = template.pages.filter(p => p.id !== pageId)
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handlePageChange = useCallback((pageId: string, patch: Partial<PageConfig>) => {
    const newPages = template.pages.map(p => p.id === pageId ? { ...p, ...patch } : p)
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handlePageNumberChange = useCallback((pageId: string, patch: { svg_id?: string; format?: string }) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const nextPageNumber = { ...(p.page_number || { svg_id: '' }), ...patch }
      if (!nextPageNumber.svg_id) {
        const { page_number: _removed, ...rest } = p
        return rest as PageConfig
      }
      return { ...p, page_number: nextPageNumber }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleAddTable = useCallback((pageId: string) => {
    const newTable: TableBinding = {
      source: 'items',
      row_group_id: 'rows',
      row_height_mm: 6,
      rows_per_page: 10,
      cells: [],
    }
    const newPages = template.pages.map(p => p.id === pageId ? { ...p, tables: [...p.tables, newTable] } : p)
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleRemoveTable = useCallback((pageId: string, tableIndex: number) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.filter((_, i) => i !== tableIndex)
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleTableChange = useCallback((pageId: string, tableIndex: number, patch: Partial<TableBinding>) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => i === tableIndex ? { ...t, ...patch } : t)
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleAddCell = useCallback((pageId: string, tableIndex: number) => {
    const page = template.pages.find(p => p.id === pageId)
    const table = page?.tables[tableIndex]
    const source = table?.source || 'items'
    const newCell: TableCell = {
      svg_id: '',
      value: makeDataValue(source, ''),
      fit: 'none',
      align: 'left',
    }
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => i === tableIndex ? { ...t, cells: [...t.cells, newCell] } : t)
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleAddHeaderCell = useCallback((pageId: string, tableIndex: number) => {
    const newCell: TableCell = {
      svg_id: '',
      value: makeStaticValue(),
      fit: 'none',
      align: 'left',
    }
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => {
        if (i !== tableIndex) return t
        const headerCells = t.header?.cells ? [...t.header.cells, newCell] : [newCell]
        return { ...t, header: { cells: headerCells } }
      })
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleRemoveHeaderCell = useCallback((pageId: string, tableIndex: number, cellIndex: number) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => {
        if (i !== tableIndex) return t
        if (!t.header?.cells) return t
        const cells = t.header.cells.filter((_, ci) => ci !== cellIndex)
        return cells.length > 0 ? { ...t, header: { cells } } : { ...t, header: undefined }
      })
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleHeaderCellChange = useCallback((pageId: string, tableIndex: number, cellIndex: number, patch: Partial<TableCell>) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => {
        if (i !== tableIndex) return t
        const headerCells = (t.header?.cells || []).map((c, ci) => ci === cellIndex ? { ...c, ...patch } : c)
        return { ...t, header: { cells: headerCells } }
      })
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleRemoveCell = useCallback((pageId: string, tableIndex: number, cellIndex: number) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => {
        if (i !== tableIndex) return t
        const cells = t.cells.filter((_, ci) => ci !== cellIndex)
        return { ...t, cells }
      })
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const handleCellChange = useCallback((pageId: string, tableIndex: number, cellIndex: number, patch: Partial<TableCell>) => {
    const newPages = template.pages.map(p => {
      if (p.id !== pageId) return p
      const tables = p.tables.map((t, i) => {
        if (i !== tableIndex) return t
        const cells = t.cells.map((c, ci) => ci === cellIndex ? { ...c, ...patch } : c)
        return { ...t, cells }
      })
      return { ...p, tables }
    })
    onChange({ ...template, pages: newPages })
  }, [template, onChange])

  const formatters = template.formatters || {}
  const formatterEntries = Object.entries(formatters)
  const globalStaticFields = template.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.value.type === 'static')
  const globalDataFields = template.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.value.type === 'data')
  const selectedPage = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : null
  const pageStaticFields = (selectedPage?.fields ?? [])
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.value.type === 'static')
  const pageDataFields = (selectedPage?.fields ?? [])
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.value.type === 'data')

  type SelectedBinding =
    | { kind: 'global-field'; binding: FieldBinding; ref: Extract<BindingRef, { kind: 'global-field' }> }
    | { kind: 'page-field'; binding: FieldBinding; ref: Extract<BindingRef, { kind: 'page-field' }>; pageId: string }
    | { kind: 'table-header'; binding: TableCell; ref: Extract<BindingRef, { kind: 'table-header' }>; pageId: string }
    | { kind: 'table-cell'; binding: TableCell; ref: Extract<BindingRef, { kind: 'table-cell' }>; pageId: string }

  const selectedBinding: SelectedBinding | null = (() => {
    if (!selectedBindingRef) return null
    if (selectedBindingRef.kind === 'global-field') {
      const binding = template.fields[selectedBindingRef.index]
      if (!binding) return null
      return { kind: 'global-field', binding, ref: selectedBindingRef }
    }
    const page = template.pages.find(p => p.id === selectedBindingRef.pageId)
    if (!page) return null
    if (selectedBindingRef.kind === 'page-field') {
      const binding = page.fields?.[selectedBindingRef.index]
      if (!binding) return null
      return { kind: 'page-field', binding, ref: selectedBindingRef, pageId: page.id }
    }
    if (selectedBindingRef.kind === 'table-header') {
      const binding = page.tables[selectedBindingRef.tableIndex]?.header?.cells?.[selectedBindingRef.cellIndex]
      if (!binding) return null
      return { kind: 'table-header', binding, ref: selectedBindingRef, pageId: page.id }
    }
    if (selectedBindingRef.kind === 'table-cell') {
      const binding = page.tables[selectedBindingRef.tableIndex]?.cells?.[selectedBindingRef.cellIndex]
      if (!binding) return null
      return { kind: 'table-cell', binding, ref: selectedBindingRef, pageId: page.id }
    }
    return null
  })()

  const applySelectedBindingUpdate = (updater: (binding: FieldBinding | TableCell) => FieldBinding | TableCell) => {
    if (!selectedBinding) return
    const nextBinding = updater(selectedBinding.binding)
    if (selectedBinding.kind === 'global-field') {
      handleFieldChange(selectedBinding.ref.index, nextBinding as FieldBinding)
      return
    }
    if (selectedBinding.kind === 'page-field') {
      handlePageFieldChange(selectedBinding.pageId!, selectedBinding.ref.index, nextBinding as FieldBinding)
      return
    }
    if (selectedBinding.kind === 'table-header') {
      handleHeaderCellChange(selectedBinding.pageId!, selectedBinding.ref.tableIndex, selectedBinding.ref.cellIndex, nextBinding as TableCell)
      return
    }
    if (selectedBinding.kind === 'table-cell') {
      handleCellChange(selectedBinding.pageId!, selectedBinding.ref.tableIndex, selectedBinding.ref.cellIndex, nextBinding as TableCell)
    }
  }

  const applyBindingUpdateByRef = (ref: BindingRef, updater: (binding: FieldBinding | TableCell) => FieldBinding | TableCell) => {
    if (ref.kind === 'global-field') {
      const binding = template.fields[ref.index]
      if (!binding) return
      handleFieldChange(ref.index, updater(binding) as FieldBinding)
      return
    }
    if (ref.kind === 'page-field') {
      const page = template.pages.find(p => p.id === ref.pageId)
      const binding = page?.fields?.[ref.index]
      if (!binding) return
      handlePageFieldChange(ref.pageId, ref.index, updater(binding) as FieldBinding)
      return
    }
    if (ref.kind === 'table-header') {
      const page = template.pages.find(p => p.id === ref.pageId)
      const binding = page?.tables[ref.tableIndex]?.header?.cells?.[ref.cellIndex]
      if (!binding) return
      handleHeaderCellChange(ref.pageId, ref.tableIndex, ref.cellIndex, updater(binding) as TableCell)
      return
    }
    if (ref.kind === 'table-cell') {
      const page = template.pages.find(p => p.id === ref.pageId)
      const binding = page?.tables[ref.tableIndex]?.cells?.[ref.cellIndex]
      if (!binding) return
      handleCellChange(ref.pageId, ref.tableIndex, ref.cellIndex, updater(binding) as TableCell)
    }
  }

  const handleBindingDrop = (ref: BindingRef) => (event: DragEvent) => {
    event.preventDefault()
    const payload =
      event.dataTransfer?.getData(DATA_KEY_MIME)
      || event.dataTransfer?.getData('application/json')
      || event.dataTransfer?.getData('text/plain')
      || null
    const dataRef = decodeDataKeyRef(payload)
    if (!dataRef) return
    applyBindingUpdateByRef(ref, (binding) => ({
      ...binding,
      value: makeDataValue(dataRef.source, dataRef.key),
    }))
    onSelectBindingRef(ref)
    onSelectBindingSvgId((() => {
      if (ref.kind === 'global-field') return template.fields[ref.index]?.svg_id || null
      if (ref.kind === 'page-field') {
        const page = template.pages.find(p => p.id === ref.pageId)
        return page?.fields?.[ref.index]?.svg_id || null
      }
      if (ref.kind === 'table-header') {
        const page = template.pages.find(p => p.id === ref.pageId)
        return page?.tables[ref.tableIndex]?.header?.cells?.[ref.cellIndex]?.svg_id || null
      }
      if (ref.kind === 'table-cell') {
        const page = template.pages.find(p => p.id === ref.pageId)
        return page?.tables[ref.tableIndex]?.cells?.[ref.cellIndex]?.svg_id || null
      }
      return null
    })())
    onNotify(`Mapped ${dataRef.source}.${dataRef.key}`)
  }

  const removeSelectedBinding = () => {
    if (!selectedBinding) return
    if (selectedBinding.kind === 'global-field') {
      handleRemoveField(selectedBinding.ref.index)
    } else if (selectedBinding.kind === 'page-field') {
      handleRemovePageField(selectedBinding.pageId!, selectedBinding.ref.index)
    } else if (selectedBinding.kind === 'table-header') {
      handleRemoveHeaderCell(selectedBinding.pageId!, selectedBinding.ref.tableIndex, selectedBinding.ref.cellIndex)
    } else if (selectedBinding.kind === 'table-cell') {
      handleRemoveCell(selectedBinding.pageId!, selectedBinding.ref.tableIndex, selectedBinding.ref.cellIndex)
    }
    onSelectBindingRef(null)
  }

  const clearSelectedBindingSvgId = () => {
    if (!selectedBinding) return
    applySelectedBindingUpdate((binding) => ({ ...binding, svg_id: '' }))
    onSelectBindingSvgId(null)
  }

  const handleAddFormatter = useCallback(() => {
    const nextKey = `formatter_${formatterEntries.length + 1}`
    const newFormatters = { ...formatters, [nextKey]: { kind: 'date' as FormatterDef['kind'] } }
    onChange({ ...template, formatters: newFormatters })
  }, [template, onChange, formatters, formatterEntries.length])

  const handleRemoveFormatter = useCallback((key: string) => {
    const { [key]: _removed, ...rest } = formatters
    onChange({ ...template, formatters: rest })
  }, [template, onChange, formatters])

  const handleFormatterChange = useCallback((key: string, patch: FormatterDef) => {
    const newFormatters = { ...formatters, [key]: { ...formatters[key], ...patch } }
    onChange({ ...template, formatters: newFormatters })
  }, [template, onChange, formatters])

  const handleFormatterKeyChange = useCallback((oldKey: string, newKey: string) => {
    if (!newKey || newKey === oldKey) return
    if (formatters[newKey]) return
    const { [oldKey]: value, ...rest } = formatters
    onChange({ ...template, formatters: { ...rest, [newKey]: value } })
  }, [template, onChange, formatters])

  useEffect(() => {
    if (!focusTarget) return
    if (focusTarget.path === lastFocusPath) return

    if (focusTarget.tab === 'pages') {
      setActiveSection('page')
    } else if (focusTarget.tab === 'fields') {
      setActiveSection('global-fields')
    } else if (focusTarget.tab === 'formatters') {
      setActiveSection('formatters')
    }
    setLastFocusPath(focusTarget.path)

    if (focusTarget.tab === 'pages') {
      const match = focusTarget.path.match(/^pages\[(\d+)\]/)
      if (match) {
        const pageIndex = Number(match[1])
        const page = template.pages[pageIndex]
        if (page && page.id !== selectedPageId) {
          onPageSelect(page.id)
        }
      }
    }

    const timer = setTimeout(() => {
      const selector = `[data-focus-key="${cssEscape(focusTarget.path)}"]`
      const target = document.querySelector<HTMLElement>(selector)
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) {
          target.focus()
        }
        target.classList.add('focus-highlight')
        setTimeout(() => target.classList.remove('focus-highlight'), 1200)
      }
      onFocusTargetConsumed()
    }, 50)

    return () => clearTimeout(timer)
  }, [focusTarget, lastFocusPath, onFocusTargetConsumed])

  useEffect(() => {
    if (!selectedPreviewSvgId) return

    const selector = `[data-binding-svg-id="${cssEscape(selectedPreviewSvgId)}"]`
    const target = document.querySelector<HTMLElement>(selector)
    if (!target) return

    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.add('binding-match-flash')
    setTimeout(() => target.classList.remove('binding-match-flash'), 1200)
  }, [selectedPreviewSvgId])

  return (
    <div className="template-editor">
      <aside className="template-editor-nav">
        <div className="nav-section">
          <div className="nav-title">Template</div>
          <button
            className={`nav-button ${activeSection === 'info' ? 'active' : ''}`}
            onClick={() => setActiveSection('info')}
          >
            Info
          </button>
          <button
            className={`nav-button ${activeSection === 'global-fields' ? 'active' : ''}`}
            onClick={() => setActiveSection('global-fields')}
          >
            Global Fields ({template.fields.length})
          </button>
          <button
            className={`nav-button ${activeSection === 'formatters' ? 'active' : ''}`}
            onClick={() => setActiveSection('formatters')}
          >
            Formatters ({formatterEntries.length})
          </button>
          <button
            className={`nav-button ${activeSection === 'data' ? 'active' : ''}`}
            onClick={() => setActiveSection('data')}
          >
            Data
          </button>
        </div>
        <div className="nav-section">
          <div className="nav-title">Pages</div>
          <button
            className="btn-add nav-add"
            onClick={() => {
              handleAddPage()
              setActiveSection('page')
            }}
          >
            + Add Page
          </button>
          <div className="nav-pages">
            {template.pages.map((page) => (
              <button
                key={page.id}
                className={`nav-page ${selectedPageId === page.id ? 'active' : ''}`}
                onClick={() => {
                  onPageSelect(page.id)
                  setActiveSection('page')
                }}
              >
                <span className="nav-page-id">{page.id}</span>
                <span className="nav-page-kind">{page.kind}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="template-editor-content">
      {activeSection === 'info' && (
        <div className="tab-content">
          <h3>Template Information</h3>
          <div className="form-group">
            <label>Template ID:</label>
            <input 
              type="text" 
              value={template.template.id}
              onChange={(e) => handleTemplateIdChange((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="form-group">
            <label>Version:</label>
            <input 
              type="text" 
              value={template.template.version}
              onChange={(e) => handleVersionChange((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="form-group">
            <label>Schema:</label>
            <input type="text" value={template.schema} disabled />
          </div>
        </div>
      )}

      {activeSection === 'page' && (
        <div className="tab-content">
          <h3>Page Editor</h3>
          {!selectedPage && (
            <p className="empty">Select a page from the left to edit.</p>
          )}
          {selectedPage && (
            <div className="page-editor">
              {(() => {
                const page = selectedPage
                const pageIndex = template.pages.findIndex(p => p.id === page.id)
                const pageIdError = !page.id.trim()
                  ? 'Page ID is required.'
                  : pageIdCounts[page.id.trim()] > 1
                    ? 'Page ID must be unique.'
                    : null
                const pageSvgError = !page.svg.trim()
                  ? 'SVG path is required.'
                  : page.svg.endsWith('.svg')
                    ? null
                    : 'SVG path should end with .svg'
                const pageNumberSvgIdError = page.page_number?.svg_id === ''
                  ? 'Page number SVG ID cannot be empty.'
                  : null
                return (
                  <div className="page-form">
                    <h4>Selected Page: {page.id}</h4>
                    <div className="form-row">
                      <label>Page ID:</label>
                      <input
                        type="text"
                        value={page.id}
                        onChange={(e) => {
                          const nextId = (e.target as HTMLInputElement).value
                          handlePageChange(page.id, { id: nextId })
                          if (page.id === selectedPageId) {
                            onSelectedPageIdChange(nextId)
                          }
                        }}
                        className={pageIdError ? 'input-error' : ''}
                        data-focus-key={`pages[${pageIndex}].id`}
                      />
                      {pageIdError && <span className="error-text">{pageIdError}</span>}
                    </div>
                    <div className="form-row">
                      <label>SVG:</label>
                      <input
                        type="text"
                        value={page.svg}
                        onChange={(e) => handlePageChange(page.id, { svg: (e.target as HTMLInputElement).value })}
                        className={pageSvgError ? 'input-error' : ''}
                        data-focus-key={`pages[${pageIndex}].svg`}
                      />
                      {pageSvgError && <span className="error-text">{pageSvgError}</span>}
                    </div>
                    <div className="form-row">
                      <label>Kind:</label>
                      <select
                        value={page.kind}
                        onChange={(e) => handlePageChange(page.id, { kind: (e.target as HTMLSelectElement).value as PageConfig['kind'] })}
                      >
                        <option value="first">first</option>
                        <option value="repeat">repeat</option>
                      </select>
                    </div>
                    <div
                      className={`form-row ${selectedPreviewSvgId && page.page_number?.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                      data-binding-svg-id={page.page_number?.svg_id || undefined}
                    >
                      <label>Page Number SVG ID:</label>
                      <input
                        type="text"
                        value={page.page_number?.svg_id || ''}
                        onChange={(e) => {
                          const nextSvgId = (e.target as HTMLInputElement).value
                          handlePageNumberChange(page.id, { svg_id: nextSvgId })
                          onSelectBindingSvgId(nextSvgId || null)
                        }}
                        onFocus={() => onSelectBindingSvgId(page.page_number?.svg_id || null)}
                        placeholder="(optional)"
                        className={pageNumberSvgIdError ? 'input-error' : ''}
                        data-focus-key={`pages[${pageIndex}].page_number.svg_id`}
                      />
                      {pageNumberSvgIdError && <span className="error-text">{pageNumberSvgIdError}</span>}
                      {!page.page_number?.svg_id && (
                        <span className="warning-text">
                          Set svg_id first. Otherwise format will not be saved.
                        </span>
                      )}
                    </div>
                    <div className="form-row">
                      <label>Page Number Format:</label>
                      <input
                        type="text"
                        value={page.page_number?.format || ''}
                        onChange={(e) => handlePageNumberChange(page.id, { format: (e.target as HTMLInputElement).value })}
                        placeholder={page.page_number?.svg_id ? 'e.g. Page {page} / {pages}' : 'Set svg_id first'}
                        disabled={!page.page_number?.svg_id}
                        data-focus-key={`pages[${pageIndex}].page_number.format`}
                      />
                    </div>

                    <div className="page-fields-section">
                      <h4>Page Fields ({(page.fields ?? []).length})</h4>
                      <div className="field-toolbar">
                        <button className="btn-add" onClick={() => handleAddPageField(page.id, 'data')}>+ Add Data Field</button>
                        <button className="btn-add btn-add-item" onClick={() => handleAddPageField(page.id, 'static')}>+ Add Static Field</button>
                      </div>
                      {(page.fields ?? []).length === 0 ? (
                        <p className="empty">No page fields defined.</p>
                      ) : (
                        <>
                          <div className="field-group">
                            <div className="field-group-header">
                              <h4>Data Fields ({pageDataFields.length})</h4>
                              <button
                                className="field-group-toggle"
                                onClick={() => setPageFieldGroupsOpen((prev) => ({ ...prev, data: !prev.data }))}
                              >
                                {pageFieldGroupsOpen.data ? 'Collapse' : 'Expand'}
                              </button>
                            </div>
                            {pageFieldGroupsOpen.data && (pageDataFields.length === 0 ? (
                              <p className="empty">No data fields.</p>
                            ) : (
                              <div className="binding-list">
                                {pageDataFields.map(({ field, index }) => (
                                  <div key={index} className="binding-row">
                                    {renderBindingCard({
                                      ref: { kind: 'page-field', pageId: page.id, index },
                                      binding: field,
                                      title: `Field #${index + 1}`,
                                      subtitle: field.value.type === 'data' ? field.value.source : undefined,
                                    })}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>

                          <div className="field-group">
                            <div className="field-group-header">
                              <h4>Static Fields ({pageStaticFields.length})</h4>
                              <button
                                className="field-group-toggle"
                                onClick={() => setPageFieldGroupsOpen((prev) => ({ ...prev, static: !prev.static }))}
                              >
                                {pageFieldGroupsOpen.static ? 'Collapse' : 'Expand'}
                              </button>
                            </div>
                            {pageFieldGroupsOpen.static && (pageStaticFields.length === 0 ? (
                              <p className="empty">No static fields.</p>
                            ) : (
                              <div className="binding-list">
                                {pageStaticFields.map(({ field, index }) => (
                                  <div key={index} className="binding-row">
                                    {renderBindingCard({
                                      ref: { kind: 'page-field', pageId: page.id, index },
                                      binding: field,
                                      title: `Field #${index + 1}`,
                                      subtitle: 'static',
                                    })}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <button className="btn-remove" onClick={() => handleRemovePage(page.id)}>
                      Remove Page
                    </button>

                    <div className="tables-section">
                      <h4>Tables ({page.tables.length})</h4>
                      <button className="btn-add" onClick={() => handleAddTable(page.id)}>+ Add Table</button>
                      {page.tables.length === 0 ? (
                        <p className="empty">No tables defined for this page.</p>
                      ) : (
                        <div className="tables-list">
                          {page.tables.map((table, tableIndex) => (
                            <div key={tableIndex} className="table-item">
                              <div className="field-header">
                                <span>Table #{tableIndex + 1}</span>
                                <button className="btn-remove" onClick={() => handleRemoveTable(page.id, tableIndex)}>
                                  Remove
                                </button>
                              </div>
                              <div className="field-form">
                                <div className="form-row">
                                  <label>Source:</label>
                                  <input
                                    type="text"
                                    value={table.source}
                                    onChange={(e) => handleTableChange(page.id, tableIndex, { source: (e.target as HTMLInputElement).value })}
                                  />
                                </div>
                                <div className="form-row">
                                  <label>Row Group ID:</label>
                                  <input
                                    type="text"
                                    value={table.row_group_id}
                                    onChange={(e) => handleTableChange(page.id, tableIndex, { row_group_id: (e.target as HTMLInputElement).value })}
                                    className={!table.row_group_id.trim() ? 'input-error' : ''}
                                    data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].row_group_id`}
                                  />
                                  {!table.row_group_id.trim() && <span className="error-text">Row group ID is required.</span>}
                                </div>
                                <div className="form-row">
                                  <label>Row Height (mm):</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={table.row_height_mm}
                                    onChange={(e) => handleTableChange(page.id, tableIndex, { row_height_mm: parseFloat((e.target as HTMLInputElement).value || '0') })}
                                    className={table.row_height_mm <= 0 ? 'input-error' : ''}
                                    data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].row_height_mm`}
                                  />
                                  {table.row_height_mm <= 0 && <span className="error-text">Row height must be &gt; 0.</span>}
                                </div>
                                <div className="form-row">
                                  <label>Rows Per Page:</label>
                                  <input
                                    type="number"
                                    value={table.rows_per_page}
                                    onChange={(e) => handleTableChange(page.id, tableIndex, { rows_per_page: parseInt((e.target as HTMLInputElement).value || '0', 10) })}
                                    className={table.rows_per_page <= 0 ? 'input-error' : ''}
                                    data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].rows_per_page`}
                                  />
                                  {table.rows_per_page <= 0 && <span className="error-text">Rows per page must be &gt; 0.</span>}
                                </div>
                                <div className="form-row">
                                  <label>Start Y (mm):</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={table.start_y_mm ?? ''}
                                    onChange={(e) => handleTableChange(page.id, tableIndex, {
                                      start_y_mm: (e.target as HTMLInputElement).value === '' ? undefined : parseFloat((e.target as HTMLInputElement).value),
                                    })}
                                    placeholder="optional"
                                    data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].start_y_mm`}
                                  />
                                </div>
                              </div>

                              <div className="table-header-section">
                                <h5>Header Cells ({table.header?.cells?.length ?? 0})</h5>
                                <button className="btn-add" onClick={() => handleAddHeaderCell(page.id, tableIndex)}>+ Add Header Cell</button>
                                {!table.header?.cells?.length ? (
                                  <p className="empty">No header cells defined.</p>
                                ) : (
                                  <div className="binding-list">
                                    {table.header.cells.map((cell, cellIndex) => (
                                      <div key={cellIndex} className="binding-row">
                                        {renderBindingCard({
                                          ref: { kind: 'table-header', pageId: page.id, tableIndex, cellIndex },
                                          binding: cell,
                                          title: `Header Cell #${cellIndex + 1}`,
                                          subtitle: cell.value.type === 'data' ? cell.value.source : 'static',
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="cells-section">
                                <h5>Cells ({table.cells.length})</h5>
                                <button className="btn-add" onClick={() => handleAddCell(page.id, tableIndex)}>+ Add Cell</button>
                                {table.cells.length === 0 ? (
                                  <p className="empty">No cells defined.</p>
                                ) : (
                                  <div className="binding-list">
                                    {table.cells.map((cell, cellIndex) => (
                                      <div key={cellIndex} className="binding-row">
                                        {renderBindingCard({
                                          ref: { kind: 'table-cell', pageId: page.id, tableIndex, cellIndex },
                                          binding: cell,
                                          title: `Cell #${cellIndex + 1}`,
                                          subtitle: cell.value.type === 'data' ? cell.value.source : 'static',
                                        })}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {activeSection === 'data' && (
        <div className="tab-content">
          <h3>Data Sources</h3>
          {dataError && <div className="error">{dataError}</div>}

          <div className="data-section">
            <div className="data-section-header">
              <h4>Meta (JSON)</h4>
              <div className="data-actions">
                <label className="btn-secondary data-upload">
                  Upload JSON
                  <input type="file" accept="application/json,.json" onChange={handleMetaFileChange} />
                </label>
                {metaData && (
                  <button className="btn-secondary" onClick={onClearMeta}>Clear</button>
                )}
              </div>
            </div>
            <div className="data-meta">
              <div className="data-meta-info">
                {metaFileName ? <span>File: {metaFileName}</span> : <span>No file loaded</span>}
                {metaData && <span>{metaKeys.length} keys</span>}
              </div>
              <div className="data-url">
                <input
                  type="text"
                  value={metaUrlInput}
                  onChange={(e) => setMetaUrlInput((e.target as HTMLInputElement).value)}
                  placeholder="https://api.example.com/meta.json"
                  disabled={dataLoading}
                />
                <button
                  className="btn-secondary"
                  onClick={() => onMetaUrlLoad(metaUrlInput)}
                  disabled={dataLoading || !metaUrlInput.trim()}
                >
                  Load URL
                </button>
              </div>
              {metaKeys.length === 0 ? (
                <p className="empty">No meta data loaded.</p>
              ) : (
                <div className="data-chip-list">
                  {metaKeys.map((key) => (
                    <div
                      key={key}
                      className="data-chip data-chip-meta"
                      draggable
                      onDragStart={handleDataDragStart({ source: 'meta', key })}
                    >
                      {key}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="data-section">
            <div className="data-section-header">
              <h4>Items (CSV)</h4>
              <div className="data-actions">
                <label className="btn-secondary data-upload">
                  Upload CSV
                  <input type="file" accept=".csv,text/csv" onChange={handleItemsFileChange} />
                </label>
                {itemsData && (
                  <button className="btn-secondary" onClick={onClearItems}>Clear</button>
                )}
              </div>
            </div>
            <div className="data-meta">
              <div className="data-meta-info">
                {itemsFileName ? <span>File: {itemsFileName}</span> : <span>No file loaded</span>}
                {itemsData && <span>{itemColumns.length} columns · {itemsData.rows.length} rows</span>}
              </div>
              <div className="data-url">
                <input
                  type="text"
                  value={itemsUrlInput}
                  onChange={(e) => setItemsUrlInput((e.target as HTMLInputElement).value)}
                  placeholder="https://api.example.com/items.csv"
                  disabled={dataLoading}
                />
                <button
                  className="btn-secondary"
                  onClick={() => onItemsUrlLoad(itemsUrlInput)}
                  disabled={dataLoading || !itemsUrlInput.trim()}
                >
                  Load URL
                </button>
              </div>
              {itemColumns.length === 0 ? (
                <p className="empty">No items data loaded.</p>
              ) : (
                <div className="data-chip-list">
                  {itemColumns.map((column) => (
                    <div
                      key={column}
                      className="data-chip data-chip-items"
                      draggable
                      onDragStart={handleDataDragStart({ source: 'items', key: column })}
                    >
                      {column}
                    </div>
                  ))}
                </div>
              )}
              {itemSampleRows.length > 0 && (
                <div className="data-preview">
                  <table>
                    <thead>
                      <tr>
                        {itemColumns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {itemSampleRows.map((row, idx) => (
                        <tr key={idx}>
                          {itemColumns.map((column) => (
                            <td key={column}>{row[column] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="data-section">
            <div className="data-section-header">
              <h4>Models (from template)</h4>
              <button className="btn-secondary" onClick={handleCopyModels}>Copy JSON</button>
            </div>
            {!templateModels || Object.keys(templateModels).length === 0 ? (
              <p className="empty">No data bindings found in template.</p>
            ) : (
              <pre className="data-model-preview">{JSON.stringify(templateModels, null, 2)}</pre>
            )}
          </div>
        </div>
      )}

      {activeSection === 'global-fields' && (
        <div className="tab-content">
          <h3>Global Fields</h3>
          <div className="field-toolbar">
            <button className="btn-add" onClick={() => handleAddField('data')}>+ Add Data Field</button>
            <button className="btn-add btn-add-item" onClick={() => handleAddField('static')}>+ Add Static Field</button>
          </div>

          {template.fields.length === 0 ? (
            <p className="empty">No fields defined. Click "Add Field" to create one.</p>
          ) : (
            <>
              <div className="field-group">
                <div className="field-group-header">
                  <h4>Data Fields ({globalDataFields.length})</h4>
                  <button
                    className="field-group-toggle"
                    onClick={() => setGlobalFieldGroupsOpen((prev) => ({ ...prev, data: !prev.data }))}
                  >
                    {globalFieldGroupsOpen.data ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {globalFieldGroupsOpen.data && (globalDataFields.length === 0 ? (
                  <p className="empty">No data fields.</p>
                ) : (
                  <div className="binding-list">
                    {globalDataFields.map(({ field, index }) => (
                      <div key={index} className="binding-row">
                        {renderBindingCard({
                          ref: { kind: 'global-field', index },
                          binding: field,
                          title: `Field #${index + 1}`,
                          subtitle: field.value.type === 'data' ? field.value.source : undefined,
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="field-group">
                <div className="field-group-header">
                  <h4>Static Fields ({globalStaticFields.length})</h4>
                  <button
                    className="field-group-toggle"
                    onClick={() => setGlobalFieldGroupsOpen((prev) => ({ ...prev, static: !prev.static }))}
                  >
                    {globalFieldGroupsOpen.static ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {globalFieldGroupsOpen.static && (globalStaticFields.length === 0 ? (
                  <p className="empty">No static fields.</p>
                ) : (
                  <div className="binding-list">
                    {globalStaticFields.map(({ field, index }) => (
                      <div key={index} className="binding-row">
                        {renderBindingCard({
                          ref: { kind: 'global-field', index },
                          binding: field,
                          title: `Field #${index + 1}`,
                          subtitle: 'static',
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeSection === 'formatters' && (
        <div className="tab-content">
          <h3>Formatters</h3>
          <button className="btn-add" onClick={handleAddFormatter}>+ Add Formatter</button>
          {formatterEntries.length === 0 ? (
            <p className="empty">No formatters defined.</p>
          ) : (
            formatterEntries.map(([key, formatter]) => (
              <div key={key} className="field-item">
                <div className="field-header">
                  <span>{key}</span>
                  <button className="btn-remove" onClick={() => handleRemoveFormatter(key)}>
                    Remove
                  </button>
                </div>
                <div className="field-form">
                  <div className="form-row">
                    <label>Key:</label>
                    <input
                      type="text"
                      defaultValue={key}
                      onBlur={(e) => handleFormatterKeyChange(key, (e.target as HTMLInputElement).value)}
                      data-focus-key={`formatters["${key}"].key`}
                    />
                  </div>
                  <div className="form-row">
                    <label>Kind:</label>
                    <select
                      value={formatter.kind || ''}
                      onChange={(e) => handleFormatterChange(key, { kind: (e.target as HTMLSelectElement).value as FormatterDef['kind'] })}
                      data-focus-key={`formatters["${key}"].kind`}
                    >
                      <option value="">(none)</option>
                      <option value="date">date</option>
                      <option value="number">number</option>
                      <option value="currency">currency</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Pattern:</label>
                    <input
                      type="text"
                      value={formatter.pattern || ''}
                      onChange={(e) => handleFormatterChange(key, { pattern: (e.target as HTMLInputElement).value })}
                      className={(formatter.kind === 'date' || formatter.kind === 'number') && !formatter.pattern ? 'input-error' : ''}
                      data-focus-key={`formatters["${key}"].pattern`}
                    />
                    {(formatter.kind === 'date' || formatter.kind === 'number') && !formatter.pattern && (
                      <span className="error-text">Pattern is required for {formatter.kind}.</span>
                    )}
                  </div>
                  <div className="form-row">
                    <label>Currency:</label>
                    <input
                      type="text"
                      value={formatter.currency || ''}
                      onChange={(e) => handleFormatterChange(key, { currency: (e.target as HTMLInputElement).value })}
                      className={formatter.kind === 'currency' && !formatter.currency ? 'input-error' : ''}
                      data-focus-key={`formatters["${key}"].currency`}
                    />
                    {formatter.kind === 'currency' && !formatter.currency && (
                      <span className="error-text">Currency is required for currency formatter.</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {selectedBinding && (
        <div className="binding-details">
          <div className="binding-details-header">
            <div>
              <h4>Binding Details</h4>
              <div className="binding-details-subtitle">
                {selectedBinding.kind === 'global-field' && 'Global Field'}
                {selectedBinding.kind === 'page-field' && 'Page Field'}
                {selectedBinding.kind === 'table-header' && 'Table Header Cell'}
                {selectedBinding.kind === 'table-cell' && 'Table Cell'}
              </div>
            </div>
            <div className="binding-details-actions">
              <button
                className="btn-secondary"
                onClick={clearSelectedBindingSvgId}
                disabled={!selectedBinding.binding.svg_id}
              >
                Unbind
              </button>
              <button className="btn-remove" onClick={removeSelectedBinding}>Remove</button>
            </div>
          </div>

          <div className="binding-details-body">
            <div className="form-row">
              <label>SVG ID:</label>
              <input
                type="text"
                value={selectedBinding.binding.svg_id}
                onChange={(e) => {
                  const nextSvgId = (e.target as HTMLInputElement).value
                  applySelectedBindingUpdate((binding) => ({ ...binding, svg_id: nextSvgId }))
                  onSelectBindingSvgId(nextSvgId || null)
                }}
              />
            </div>

            <div className="form-row">
              <label>Value Type:</label>
              <select
                value={selectedBinding.binding.value.type}
                onChange={(e) => {
                  const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                  const nextValue = nextType === 'static'
                    ? makeStaticValue()
                    : makeDataValue('meta', '')
                  applySelectedBindingUpdate((binding) => ({ ...binding, value: nextValue }))
                }}
              >
                <option value="data">data</option>
                <option value="static">static</option>
              </select>
            </div>

            {selectedBinding.binding.value.type === 'data' ? (
              <>
                <div className="form-row">
                  <label>Source:</label>
                  <select
                    value={selectedBinding.binding.value.source}
                    onChange={(e) => {
                      const nextSource = (e.target as HTMLSelectElement).value
                      applySelectedBindingUpdate((binding) => ({
                        ...binding,
                        value: makeDataValue(nextSource, (binding.value as DataValueBinding).key),
                      }))
                    }}
                  >
                    <option value="meta">meta</option>
                    <option value="items">items</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Key:</label>
                  <input
                    type="text"
                    value={selectedBinding.binding.value.key}
                    onChange={(e) => {
                      const nextKey = (e.target as HTMLInputElement).value
                      applySelectedBindingUpdate((binding) => ({
                        ...binding,
                        value: makeDataValue((binding.value as DataValueBinding).source, nextKey),
                      }))
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="form-row">
                <label>Text:</label>
                <input
                  type="text"
                  value={selectedBinding.binding.value.text}
                  onChange={(e) => {
                    const nextText = (e.target as HTMLInputElement).value
                    applySelectedBindingUpdate((binding) => ({ ...binding, value: makeStaticValue(nextText) }))
                  }}
                />
              </div>
            )}

            <div className="form-row">
              <label>Align:</label>
              <select
                value={selectedBinding.binding.align || 'left'}
                onChange={(e) => {
                  const next = (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right'
                  applySelectedBindingUpdate((binding) => ({ ...binding, align: next }))
                }}
              >
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </div>

            <div className="form-row">
              <label>Fit:</label>
              <select
                value={selectedBinding.binding.fit || 'none'}
                onChange={(e) => {
                  const next = (e.target as HTMLSelectElement).value as TableCell['fit']
                  applySelectedBindingUpdate((binding) => ({ ...binding, fit: next }))
                }}
              >
                <option value="none">none</option>
                <option value="shrink">shrink</option>
                <option value="wrap">wrap</option>
                <option value="clip">clip</option>
              </select>
            </div>

            <div className="form-row">
              <label>Format:</label>
              <input
                type="text"
                value={selectedBinding.binding.format || ''}
                onChange={(e) => {
                  const next = (e.target as HTMLInputElement).value
                  applySelectedBindingUpdate((binding) => ({ ...binding, format: next }))
                }}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

function makeStaticValue(text = ''): ValueBinding {
  return { type: 'static', text }
}

function makeDataValue(source = 'meta', key = ''): ValueBinding {
  return { type: 'data', source, key }
}

function cssEscape(value: string): string {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value)
  }
  return value.replace(/"/g, '\\"')
}
