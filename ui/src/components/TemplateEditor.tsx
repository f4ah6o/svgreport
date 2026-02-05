import { useState, useCallback, useEffect } from 'preact/hooks'
import type { TemplateConfig, FieldBinding, PageConfig, TableBinding, TableCell, FormatterDef, ValueBinding, DataValueBinding } from '../types/api'

interface TemplateEditorProps {
  template: TemplateConfig
  onChange: (template: TemplateConfig) => void
  onPageSelect: (pageId: string) => void
  selectedPageId: string | null
  onSelectedPageIdChange: (pageId: string) => void
  focusTarget: { tab: 'pages' | 'fields' | 'formatters'; path: string } | null
  onFocusTargetConsumed: () => void
  suggestedSvgIds: string[]
  selectedPreviewSvgId: string | null
  onSelectBindingSvgId: (svgId: string | null) => void
}

export function TemplateEditor({
  template,
  onChange,
  onPageSelect,
  selectedPageId,
  onSelectedPageIdChange,
  focusTarget,
  onFocusTargetConsumed,
  suggestedSvgIds,
  selectedPreviewSvgId,
  onSelectBindingSvgId,
}: TemplateEditorProps) {
  const [activeSection, setActiveSection] = useState<'info' | 'global-fields' | 'formatters' | 'page'>('page')
  const [globalFieldGroupsOpen, setGlobalFieldGroupsOpen] = useState<{ static: boolean; data: boolean }>({
    static: false,
    data: true,
  })
  const [pageFieldGroupsOpen, setPageFieldGroupsOpen] = useState<{ static: boolean; data: boolean }>({
    static: false,
    data: true,
  })
  const [lastFocusPath, setLastFocusPath] = useState<string | null>(null)
  const pageIdCounts = template.pages.reduce<Record<string, number>>((acc, page) => {
    const key = page.id.trim()
    if (!key) return acc
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})


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
                            ) : pageDataFields.map(({ field, index }) => (
                              <div
                                key={index}
                                className={`field-item field-item-data ${selectedPreviewSvgId && field.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                                data-binding-svg-id={field.svg_id || undefined}
                                onClick={() => onSelectBindingSvgId(field.svg_id || null)}
                              >
                                <div className="field-header">
                                  <span>
                                    Field #{index + 1}{' '}
                                    <span className="field-source-badge field-source-data">DATA</span>
                                    {field.value.type === 'data' ? (
                                      <span
                                        className={`field-source-badge ${field.value.source === 'meta' ? 'field-source-meta' : 'field-source-item'}`}
                                      >
                                        {field.value.source}
                                      </span>
                                    ) : null}
                                  </span>
                                  <button
                                    className="btn-remove"
                                    onClick={() => handleRemovePageField(page.id, index)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="field-form">
                                  <div className="form-row">
                                    <label>Value Type:</label>
                                    <select
                                      value={field.value.type}
                                      onChange={(e) => {
                                        const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                                        const nextValue = nextType === 'static'
                                          ? makeStaticValue()
                                          : makeDataValue('meta', '')
                                        handlePageFieldChange(page.id, index, { ...field, value: nextValue })
                                      }}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].value.type`}
                                    >
                                      <option value="data">data</option>
                                      <option value="static">static</option>
                                    </select>
                                  </div>
                                  <div className="form-row">
                                    <label>SVG ID:</label>
                                    <input
                                      type="text"
                                      value={field.svg_id}
                                      onChange={(e) => {
                                        const nextSvgId = (e.target as HTMLInputElement).value
                                        handlePageFieldChange(page.id, index, { ...field, svg_id: nextSvgId })
                                        onSelectBindingSvgId(nextSvgId || null)
                                      }}
                                      onFocus={() => onSelectBindingSvgId(field.svg_id || null)}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].svg_id`}
                                    />
                                    {!field.svg_id && (
                                      <div className="suggested-row">
                                        <select
                                          className="suggested-select"
                                          defaultValue=""
                                          disabled={suggestedSvgIds.length === 0}
                                          onChange={(e) => {
                                            const value = (e.target as HTMLSelectElement).value
                                            if (value) {
                                              handlePageFieldChange(page.id, index, { ...field, svg_id: value })
                                              ;(e.target as HTMLSelectElement).value = ''
                                            }
                                          }}
                                        >
                                          <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                                          {suggestedSvgIds.map((id) => (
                                            <option key={id} value={id}>{id}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                  {field.value.type === 'data' ? (
                                    <>
                                      <div className="form-row">
                                        <label>Source:</label>
                                        <select
                                          value={field.value.source}
                                          onChange={(e) => handlePageFieldChange(page.id, index, {
                                            ...field,
                                            value: makeDataValue((e.target as HTMLSelectElement).value, (field.value as DataValueBinding).key)
                                          })}
                                          data-focus-key={`pages[${pageIndex}].fields[${index}].value.source`}
                                        >
                                          <option value="meta">meta</option>
                                          <option value="items">items</option>
                                        </select>
                                      </div>
                                      <div className="form-row">
                                        <label>Key:</label>
                                        <input
                                          type="text"
                                          value={field.value.key}
                                          onChange={(e) => handlePageFieldChange(page.id, index, {
                                            ...field,
                                            value: makeDataValue((field.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                                          })}
                                          className={!field.value.key.trim() ? 'input-error' : ''}
                                          data-focus-key={`pages[${pageIndex}].fields[${index}].value.key`}
                                        />
                                        {!field.value.key.trim() && <span className="error-text">Key is required.</span>}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="form-row">
                                      <label>Text:</label>
                                      <input
                                        type="text"
                                        value={field.value.text}
                                        onChange={(e) => handlePageFieldChange(page.id, index, {
                                          ...field,
                                          value: makeStaticValue((e.target as HTMLInputElement).value)
                                        })}
                                        className={!field.value.text.trim() ? 'input-error' : ''}
                                        data-focus-key={`pages[${pageIndex}].fields[${index}].value.text`}
                                      />
                                      {!field.value.text.trim() && <span className="error-text">Text is required.</span>}
                                    </div>
                                  )}
                                  <div className="form-row">
                                    <label>Align:</label>
                                    <select
                                      value={field.align || 'left'}
                                      onChange={(e) => handlePageFieldChange(page.id, index, {
                                        ...field,
                                        align: (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right'
                                      })}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].align`}
                                    >
                                      <option value="left">Left</option>
                                      <option value="center">Center</option>
                                      <option value="right">Right</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            )))}
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
                            ) : pageStaticFields.map(({ field, index }) => (
                              <div
                                key={index}
                                className={`field-item field-item-static ${selectedPreviewSvgId && field.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                                data-binding-svg-id={field.svg_id || undefined}
                                onClick={() => onSelectBindingSvgId(field.svg_id || null)}
                              >
                                <div className="field-header">
                                  <span>
                                    Field #{index + 1}{' '}
                                    <span className="field-source-badge field-source-static">STATIC</span>
                                  </span>
                                  <button
                                    className="btn-remove"
                                    onClick={() => handleRemovePageField(page.id, index)}
                                  >
                                    Remove
                                  </button>
                                </div>
                                <div className="field-form">
                                  <div className="form-row">
                                    <label>Value Type:</label>
                                    <select
                                      value={field.value.type}
                                      onChange={(e) => {
                                        const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                                        const nextValue = nextType === 'static'
                                          ? makeStaticValue()
                                          : makeDataValue('meta', '')
                                        handlePageFieldChange(page.id, index, { ...field, value: nextValue })
                                      }}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].value.type`}
                                    >
                                      <option value="static">static</option>
                                      <option value="data">data</option>
                                    </select>
                                  </div>
                                  <div className="form-row">
                                    <label>SVG ID:</label>
                                    <input
                                      type="text"
                                      value={field.svg_id}
                                      onChange={(e) => {
                                        const nextSvgId = (e.target as HTMLInputElement).value
                                        handlePageFieldChange(page.id, index, { ...field, svg_id: nextSvgId })
                                        onSelectBindingSvgId(nextSvgId || null)
                                      }}
                                      onFocus={() => onSelectBindingSvgId(field.svg_id || null)}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].svg_id`}
                                    />
                                    {!field.svg_id && (
                                      <div className="suggested-row">
                                        <select
                                          className="suggested-select"
                                          defaultValue=""
                                          disabled={suggestedSvgIds.length === 0}
                                          onChange={(e) => {
                                            const value = (e.target as HTMLSelectElement).value
                                            if (value) {
                                              handlePageFieldChange(page.id, index, { ...field, svg_id: value })
                                              ;(e.target as HTMLSelectElement).value = ''
                                            }
                                          }}
                                        >
                                          <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                                          {suggestedSvgIds.map((id) => (
                                            <option key={id} value={id}>{id}</option>
                                          ))}
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                  {field.value.type === 'data' ? (
                                    <>
                                      <div className="form-row">
                                        <label>Source:</label>
                                        <select
                                          value={field.value.source}
                                          onChange={(e) => handlePageFieldChange(page.id, index, {
                                            ...field,
                                            value: makeDataValue((e.target as HTMLSelectElement).value, (field.value as DataValueBinding).key)
                                          })}
                                          data-focus-key={`pages[${pageIndex}].fields[${index}].value.source`}
                                        >
                                          <option value="meta">meta</option>
                                          <option value="items">items</option>
                                        </select>
                                      </div>
                                      <div className="form-row">
                                        <label>Key:</label>
                                        <input
                                          type="text"
                                          value={field.value.key}
                                          onChange={(e) => handlePageFieldChange(page.id, index, {
                                            ...field,
                                            value: makeDataValue((field.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                                          })}
                                          className={!field.value.key.trim() ? 'input-error' : ''}
                                          data-focus-key={`pages[${pageIndex}].fields[${index}].value.key`}
                                        />
                                        {!field.value.key.trim() && <span className="error-text">Key is required.</span>}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="form-row">
                                      <label>Text:</label>
                                      <input
                                        type="text"
                                        value={field.value.text}
                                        onChange={(e) => handlePageFieldChange(page.id, index, {
                                          ...field,
                                          value: makeStaticValue((e.target as HTMLInputElement).value)
                                        })}
                                        className={!field.value.text.trim() ? 'input-error' : ''}
                                        data-focus-key={`pages[${pageIndex}].fields[${index}].value.text`}
                                      />
                                      {!field.value.text.trim() && <span className="error-text">Text is required.</span>}
                                    </div>
                                  )}
                                  <div className="form-row">
                                    <label>Align:</label>
                                    <select
                                      value={field.align || 'left'}
                                      onChange={(e) => handlePageFieldChange(page.id, index, {
                                        ...field,
                                        align: (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right'
                                      })}
                                      data-focus-key={`pages[${pageIndex}].fields[${index}].align`}
                                    >
                                      <option value="left">Left</option>
                                      <option value="center">Center</option>
                                      <option value="right">Right</option>
                                    </select>
                                  </div>
                                </div>
                              </div>
                            )))}
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
                                  <div className="cells-list">
                                    {table.header.cells.map((cell, cellIndex) => (
                                      <div
                                        key={cellIndex}
                                        className={`cell-item header-cell-item ${selectedPreviewSvgId && cell.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                                        data-binding-svg-id={cell.svg_id || undefined}
                                        onClick={() => onSelectBindingSvgId(cell.svg_id || null)}
                                      >
                                        <div className="field-header">
                                          <span>Header Cell #{cellIndex + 1}</span>
                                          <button className="btn-remove" onClick={() => handleRemoveHeaderCell(page.id, tableIndex, cellIndex)}>
                                            Remove
                                          </button>
                                        </div>
                                        <div className="field-form">
                                          <div className="form-row">
                                            <label>SVG ID:</label>
                                            <input
                                              type="text"
                                              value={cell.svg_id}
                                              onChange={(e) => {
                                                const nextSvgId = (e.target as HTMLInputElement).value
                                                handleHeaderCellChange(page.id, tableIndex, cellIndex, { svg_id: nextSvgId })
                                                onSelectBindingSvgId(nextSvgId || null)
                                              }}
                                              onFocus={() => onSelectBindingSvgId(cell.svg_id || null)}
                                              className={!cell.svg_id.trim() ? 'input-error' : ''}
                                              data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].svg_id`}
                                            />
                                            {!cell.svg_id.trim() && <span className="error-text">SVG ID is required.</span>}
                                            {!cell.svg_id && (
                                              <div className="suggested-row">
                                                <select
                                                  className="suggested-select"
                                                  defaultValue=""
                                                  disabled={suggestedSvgIds.length === 0}
                                                  onChange={(e) => {
                                                    const value = (e.target as HTMLSelectElement).value
                                                    if (value) {
                                                      handleHeaderCellChange(page.id, tableIndex, cellIndex, { svg_id: value })
                                                      ;(e.target as HTMLSelectElement).value = ''
                                                    }
                                                  }}
                                                >
                                                  <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                                                  {suggestedSvgIds.map((id) => (
                                                    <option key={id} value={id}>{id}</option>
                                                  ))}
                                                </select>
                                              </div>
                                            )}
                                          </div>
                                          <div className="form-row">
                                            <label>Value Type:</label>
                                            <select
                                              value={cell.value.type}
                                              onChange={(e) => {
                                                const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                                                const nextValue = nextType === 'static'
                                                  ? makeStaticValue()
                                                  : makeDataValue('meta', '')
                                                handleHeaderCellChange(page.id, tableIndex, cellIndex, { value: nextValue })
                                              }}
                                              data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].value.type`}
                                            >
                                              <option value="static">static</option>
                                              <option value="data">data</option>
                                            </select>
                                          </div>
                                          {cell.value.type === 'data' ? (
                                            <>
                                              <div className="form-row">
                                                <label>Source:</label>
                                                <select
                                                  value={cell.value.source}
                                                  onChange={(e) => handleHeaderCellChange(page.id, tableIndex, cellIndex, {
                                                    value: makeDataValue((e.target as HTMLSelectElement).value, (cell.value as DataValueBinding).key)
                                                  })}
                                                  data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].value.source`}
                                                >
                                                  <option value="meta">meta</option>
                                                  <option value={table.source}>{table.source}</option>
                                                </select>
                                              </div>
                                              <div className="form-row">
                                                <label>Key:</label>
                                                <input
                                                  type="text"
                                                  value={cell.value.key}
                                                  onChange={(e) => handleHeaderCellChange(page.id, tableIndex, cellIndex, {
                                                    value: makeDataValue((cell.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                                                  })}
                                                  className={!cell.value.key.trim() ? 'input-error' : ''}
                                                  data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].value.key`}
                                                />
                                                {!cell.value.key.trim() && <span className="error-text">Key is required.</span>}
                                              </div>
                                            </>
                                          ) : (
                                            <div className="form-row">
                                              <label>Text:</label>
                                              <input
                                                type="text"
                                                value={cell.value.text}
                                                onChange={(e) => handleHeaderCellChange(page.id, tableIndex, cellIndex, {
                                                  value: makeStaticValue((e.target as HTMLInputElement).value)
                                                })}
                                                className={!cell.value.text.trim() ? 'input-error' : ''}
                                                data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].header.cells[${cellIndex}].value.text`}
                                              />
                                              {!cell.value.text.trim() && <span className="error-text">Text is required.</span>}
                                            </div>
                                          )}
                                          <div className="form-row">
                                            <label>Align:</label>
                                            <select
                                              value={cell.align || 'left'}
                                              onChange={(e) => handleHeaderCellChange(page.id, tableIndex, cellIndex, {
                                                align: (e.target as HTMLSelectElement).value as TableCell['align']
                                              })}
                                            >
                                              <option value="left">left</option>
                                              <option value="center">center</option>
                                              <option value="right">right</option>
                                            </select>
                                          </div>
                                          <div className="form-row">
                                            <label>Format:</label>
                                            <input
                                              type="text"
                                              value={cell.format || ''}
                                              onChange={(e) => handleHeaderCellChange(page.id, tableIndex, cellIndex, { format: (e.target as HTMLInputElement).value })}
                                              placeholder="optional"
                                            />
                                          </div>
                                        </div>
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
                                  <div className="cells-list">
                                    {table.cells.map((cell, cellIndex) => (
                                  <div
                                    key={cellIndex}
                                    className={`cell-item ${selectedPreviewSvgId && cell.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                                    data-binding-svg-id={cell.svg_id || undefined}
                                    onClick={() => onSelectBindingSvgId(cell.svg_id || null)}
                                  >
                                        <div className="field-header">
                                          <span>Cell #{cellIndex + 1}</span>
                                          <button className="btn-remove" onClick={() => handleRemoveCell(page.id, tableIndex, cellIndex)}>
                                            Remove
                                          </button>
                                        </div>
                                        <div className="field-form">
                                          <div className="form-row">
                                            <label>SVG ID:</label>
                                            <input
                                              type="text"
                                              value={cell.svg_id}
                                              onChange={(e) => {
                                                const nextSvgId = (e.target as HTMLInputElement).value
                                                handleCellChange(page.id, tableIndex, cellIndex, { svg_id: nextSvgId })
                                                onSelectBindingSvgId(nextSvgId || null)
                                              }}
                                              onFocus={() => onSelectBindingSvgId(cell.svg_id || null)}
                                              className={!cell.svg_id.trim() ? 'input-error' : ''}
                                              data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].svg_id`}
                                            />
                                            {!cell.svg_id.trim() && <span className="error-text">SVG ID is required.</span>}
                                            {!cell.svg_id && (
                                              <div className="suggested-row">
                                                <select
                                                  className="suggested-select"
                                                  defaultValue=""
                                                  disabled={suggestedSvgIds.length === 0}
                                                  onChange={(e) => {
                                                    const value = (e.target as HTMLSelectElement).value
                                                    if (value) {
                                                      handleCellChange(page.id, tableIndex, cellIndex, { svg_id: value })
                                                      ;(e.target as HTMLSelectElement).value = ''
                                                    }
                                                  }}
                                                >
                                                  <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                                                  {suggestedSvgIds.map((id) => (
                                                    <option key={id} value={id}>{id}</option>
                                                  ))}
                                                </select>
                                              </div>
                                            )}
                                          </div>
                                          <div className="form-row">
                                            <label>Value Type:</label>
                                            <select
                                              value={cell.value.type}
                                              onChange={(e) => {
                                                const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                                                const nextValue = nextType === 'static'
                                                  ? makeStaticValue()
                                                  : makeDataValue(table.source, '')
                                                handleCellChange(page.id, tableIndex, cellIndex, { value: nextValue })
                                              }}
                                              data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].value.type`}
                                            >
                                              <option value="data">data</option>
                                              <option value="static">static</option>
                                            </select>
                                          </div>
                                          {cell.value.type === 'data' ? (
                                            <>
                                              <div className="form-row">
                                                <label>Source:</label>
                                                <select
                                                  value={cell.value.source}
                                                  onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, {
                                                    value: makeDataValue((e.target as HTMLSelectElement).value, (cell.value as DataValueBinding).key)
                                                  })}
                                                  data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].value.source`}
                                                >
                                                  <option value={table.source}>{table.source}</option>
                                                  <option value="meta">meta</option>
                                                </select>
                                              </div>
                                              <div className="form-row">
                                                <label>Key:</label>
                                                <input
                                                  type="text"
                                                  value={cell.value.key}
                                                  onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, {
                                                    value: makeDataValue((cell.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                                                  })}
                                                  className={!cell.value.key.trim() ? 'input-error' : ''}
                                                  data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].value.key`}
                                                />
                                                {!cell.value.key.trim() && <span className="error-text">Key is required.</span>}
                                              </div>
                                            </>
                                          ) : (
                                            <div className="form-row">
                                              <label>Text:</label>
                                              <input
                                                type="text"
                                                value={cell.value.text}
                                                onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, {
                                                  value: makeStaticValue((e.target as HTMLInputElement).value)
                                                })}
                                                className={!cell.value.text.trim() ? 'input-error' : ''}
                                                data-focus-key={`pages[${pageIndex}].tables[${tableIndex}].cells[${cellIndex}].value.text`}
                                              />
                                              {!cell.value.text.trim() && <span className="error-text">Text is required.</span>}
                                            </div>
                                          )}
                                          <div className="form-row">
                                            <label>Fit:</label>
                                            <select
                                              value={cell.fit || 'none'}
                                              onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, { fit: (e.target as HTMLSelectElement).value as TableCell['fit'] })}
                                            >
                                              <option value="none">none</option>
                                              <option value="shrink">shrink</option>
                                              <option value="wrap">wrap</option>
                                              <option value="clip">clip</option>
                                            </select>
                                          </div>
                                          <div className="form-row">
                                            <label>Align:</label>
                                            <select
                                              value={cell.align || 'left'}
                                              onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, { align: (e.target as HTMLSelectElement).value as TableCell['align'] })}
                                            >
                                              <option value="left">left</option>
                                              <option value="center">center</option>
                                              <option value="right">right</option>
                                            </select>
                                          </div>
                                          <div className="form-row">
                                            <label>Format:</label>
                                            <input
                                              type="text"
                                              value={cell.format || ''}
                                              onChange={(e) => handleCellChange(page.id, tableIndex, cellIndex, { format: (e.target as HTMLInputElement).value })}
                                              placeholder="optional"
                                            />
                                          </div>
                                        </div>
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
                ) : globalDataFields.map(({ field, index }) => (
                  <div
                    key={index}
                    className={`field-item field-item-data ${selectedPreviewSvgId && field.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                    data-binding-svg-id={field.svg_id || undefined}
                    onClick={() => onSelectBindingSvgId(field.svg_id || null)}
                  >
                    <div className="field-header">
                      <span>
                        Field #{index + 1}{' '}
                        <span className="field-source-badge field-source-data">DATA</span>
                        {field.value.type === 'data' ? (
                          <span
                            className={`field-source-badge ${field.value.source === 'meta' ? 'field-source-meta' : 'field-source-item'}`}
                          >
                            {field.value.source}
                          </span>
                        ) : null}
                      </span>
                      <button
                        className="btn-remove"
                        onClick={() => handleRemoveField(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="field-form">
                      <div className="form-row">
                        <label>Value Type:</label>
                        <select
                          value={field.value.type}
                          onChange={(e) => {
                            const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                            const nextValue = nextType === 'static'
                              ? makeStaticValue()
                              : makeDataValue('meta', '')
                            handleFieldChange(index, { ...field, value: nextValue })
                          }}
                          data-focus-key={`fields[${index}].value.type`}
                        >
                          <option value="data">data</option>
                          <option value="static">static</option>
                        </select>
                      </div>
                      <div className="form-row">
                        <label>SVG ID:</label>
                        <input
                          type="text"
                          value={field.svg_id}
                          onChange={(e) => {
                            const nextSvgId = (e.target as HTMLInputElement).value
                            handleFieldChange(index, {
                              ...field,
                              svg_id: nextSvgId
                            })
                            onSelectBindingSvgId(nextSvgId || null)
                          }}
                          onFocus={() => onSelectBindingSvgId(field.svg_id || null)}
                          data-focus-key={`fields[${index}].svg_id`}
                        />
                        {!field.svg_id && (
                          <div className="suggested-row">
                            <select
                              className="suggested-select"
                              defaultValue=""
                              disabled={suggestedSvgIds.length === 0}
                              onChange={(e) => {
                                const value = (e.target as HTMLSelectElement).value
                                if (value) {
                                  handleFieldChange(index, { ...field, svg_id: value })
                                  ;(e.target as HTMLSelectElement).value = ''
                                }
                              }}
                            >
                              <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                              {suggestedSvgIds.map((id) => (
                                <option key={id} value={id}>{id}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      {field.value.type === 'data' ? (
                        <>
                          <div className="form-row">
                            <label>Source:</label>
                            <select
                              value={field.value.source}
                              onChange={(e) => handleFieldChange(index, {
                                ...field,
                                value: makeDataValue((e.target as HTMLSelectElement).value, (field.value as DataValueBinding).key)
                              })}
                              data-focus-key={`fields[${index}].value.source`}
                            >
                              <option value="meta">meta</option>
                              <option value="items">items</option>
                            </select>
                          </div>
                          <div className="form-row">
                            <label>Key:</label>
                            <input
                              type="text"
                              value={field.value.key}
                              onChange={(e) => handleFieldChange(index, {
                                ...field,
                                value: makeDataValue((field.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                              })}
                              className={!field.value.key.trim() ? 'input-error' : ''}
                              data-focus-key={`fields[${index}].value.key`}
                            />
                            {!field.value.key.trim() && <span className="error-text">Key is required.</span>}
                          </div>
                        </>
                      ) : (
                        <div className="form-row">
                          <label>Text:</label>
                          <input
                            type="text"
                            value={field.value.text}
                            onChange={(e) => handleFieldChange(index, {
                              ...field,
                              value: makeStaticValue((e.target as HTMLInputElement).value)
                            })}
                            className={!field.value.text.trim() ? 'input-error' : ''}
                            data-focus-key={`fields[${index}].value.text`}
                          />
                          {!field.value.text.trim() && <span className="error-text">Text is required.</span>}
                        </div>
                      )}
                      <div className="form-row">
                        <label>Align:</label>
                        <select
                          value={field.align || 'left'}
                          onChange={(e) => handleFieldChange(index, {
                            ...field,
                            align: (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right'
                          })}
                          data-focus-key={`fields[${index}].align`}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )))}
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
                ) : globalStaticFields.map(({ field, index }) => (
                  <div
                    key={index}
                    className={`field-item field-item-static ${selectedPreviewSvgId && field.svg_id === selectedPreviewSvgId ? 'binding-match' : ''}`}
                    data-binding-svg-id={field.svg_id || undefined}
                    onClick={() => onSelectBindingSvgId(field.svg_id || null)}
                  >
                    <div className="field-header">
                      <span>
                        Field #{index + 1}{' '}
                        <span className="field-source-badge field-source-static">STATIC</span>
                      </span>
                      <button
                        className="btn-remove"
                        onClick={() => handleRemoveField(index)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="field-form">
                      <div className="form-row">
                        <label>Value Type:</label>
                        <select
                          value={field.value.type}
                          onChange={(e) => {
                            const nextType = (e.target as HTMLSelectElement).value as 'static' | 'data'
                            const nextValue = nextType === 'static'
                              ? makeStaticValue()
                              : makeDataValue('meta', '')
                            handleFieldChange(index, { ...field, value: nextValue })
                          }}
                          data-focus-key={`fields[${index}].value.type`}
                        >
                          <option value="static">static</option>
                          <option value="data">data</option>
                        </select>
                      </div>
                      <div className="form-row">
                        <label>SVG ID:</label>
                        <input
                          type="text"
                          value={field.svg_id}
                          onChange={(e) => {
                            const nextSvgId = (e.target as HTMLInputElement).value
                            handleFieldChange(index, {
                              ...field,
                              svg_id: nextSvgId
                            })
                            onSelectBindingSvgId(nextSvgId || null)
                          }}
                          onFocus={() => onSelectBindingSvgId(field.svg_id || null)}
                          data-focus-key={`fields[${index}].svg_id`}
                        />
                        {!field.svg_id && (
                          <div className="suggested-row">
                            <select
                              className="suggested-select"
                              defaultValue=""
                              disabled={suggestedSvgIds.length === 0}
                              onChange={(e) => {
                                const value = (e.target as HTMLSelectElement).value
                                if (value) {
                                  handleFieldChange(index, { ...field, svg_id: value })
                                  ;(e.target as HTMLSelectElement).value = ''
                                }
                              }}
                            >
                              <option value="">{suggestedSvgIds.length > 0 ? 'Use suggested…' : 'Select a page first'}</option>
                              {suggestedSvgIds.map((id) => (
                                <option key={id} value={id}>{id}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      {field.value.type === 'data' ? (
                        <>
                          <div className="form-row">
                            <label>Source:</label>
                            <select
                              value={field.value.source}
                              onChange={(e) => handleFieldChange(index, {
                                ...field,
                                value: makeDataValue((e.target as HTMLSelectElement).value, (field.value as DataValueBinding).key)
                              })}
                              data-focus-key={`fields[${index}].value.source`}
                            >
                              <option value="meta">meta</option>
                              <option value="items">items</option>
                            </select>
                          </div>
                          <div className="form-row">
                            <label>Key:</label>
                            <input
                              type="text"
                              value={field.value.key}
                              onChange={(e) => handleFieldChange(index, {
                                ...field,
                                value: makeDataValue((field.value as DataValueBinding).source, (e.target as HTMLInputElement).value)
                              })}
                              className={!field.value.key.trim() ? 'input-error' : ''}
                              data-focus-key={`fields[${index}].value.key`}
                            />
                            {!field.value.key.trim() && <span className="error-text">Key is required.</span>}
                          </div>
                        </>
                      ) : (
                        <div className="form-row">
                          <label>Text:</label>
                          <input
                            type="text"
                            value={field.value.text}
                            onChange={(e) => handleFieldChange(index, {
                              ...field,
                              value: makeStaticValue((e.target as HTMLInputElement).value)
                            })}
                            className={!field.value.text.trim() ? 'input-error' : ''}
                            data-focus-key={`fields[${index}].value.text`}
                          />
                          {!field.value.text.trim() && <span className="error-text">Text is required.</span>}
                        </div>
                      )}
                      <div className="form-row">
                        <label>Align:</label>
                        <select
                          value={field.align || 'left'}
                          onChange={(e) => handleFieldChange(index, {
                            ...field,
                            align: (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right'
                          })}
                          data-focus-key={`fields[${index}].align`}
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )))}
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
