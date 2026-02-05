import { useState, useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import type {
  TemplateConfig,
  TextElement,
  ValidationResponse,
  PreviewResponse,
  TemplateListItem,
  KVData,
  TableData,
} from './types/api'
import type { BindingRef } from './types/binding'
import { rpc } from './lib/rpc'
import { TemplateEditor } from './components/TemplateEditor'
import { SvgViewer } from './components/SvgViewer'
import { StatusBar } from './components/StatusBar'
import './App.css'

export function App() {
  const [templateDir, setTemplateDir] = useState('test-templates/delivery-slip/v1')
  const [template, setTemplate] = useState<TemplateConfig | null>(null)
  const [selectedSvg, setSelectedSvg] = useState<string | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [svgElements, setSvgElements] = useState<TextElement[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<string>('Ready')
  const [error, setError] = useState<string | null>(null)
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null)
  const [previewResult, setPreviewResult] = useState<PreviewResponse | null>(null)
  const [selectedTextIndex, setSelectedTextIndex] = useState<number | null>(null)
  const [selectedText, setSelectedText] = useState<TextElement | null>(null)
  const [selectedBindingSvgId, setSelectedBindingSvgId] = useState<string | null>(null)
  const [selectedBindingRef, setSelectedBindingRef] = useState<BindingRef | null>(null)
  const [pendingId, setPendingId] = useState<string>('')
  const [templatesBaseDir, setTemplatesBaseDir] = useState('templates')
  const [templatesList, setTemplatesList] = useState<TemplateListItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [metaData, setMetaData] = useState<KVData | null>(null)
  const [itemsData, setItemsData] = useState<TableData | null>(null)
  const [metaFileName, setMetaFileName] = useState<string | null>(null)
  const [itemsFileName, setItemsFileName] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ tab: 'pages' | 'fields' | 'formatters'; path: string } | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [validationGroupsOpen, setValidationGroupsOpen] = useState<Record<'pages' | 'fields' | 'formatters' | 'other', boolean>>({
    pages: true,
    fields: true,
    formatters: true,
    other: true,
  })
  const [editorPaneWidth, setEditorPaneWidth] = useState(44)
  const mainSplitRef = useRef<HTMLDivElement | null>(null)

  // Check connection on mount
  useEffect(() => {
    rpc.getVersion()
      .then(async () => {
        setStatus('Connected to RPC server')
        try {
          const workspace = await rpc.getWorkspace()
          if (workspace.templatesDirDefault) {
            setTemplatesBaseDir(workspace.templatesDirDefault)
          }
        } catch {
          // Ignore workspace errors, allow manual base dir input
        }
      })
      .catch(() => setStatus('Error: Cannot connect to RPC server'))
  }, [])

  useEffect(() => {
    const saved = loadSession()
    if (saved.templateDir) setTemplateDir(saved.templateDir)
    if (saved.templatesBaseDir) setTemplatesBaseDir(saved.templatesBaseDir)
    if (saved.selectedPageId) setSelectedPageId(saved.selectedPageId)
  }, [])

  const loadTemplateByPath = useCallback(async (path: string) => {
    setIsLoading(true)
    setError(null)
    setStatus('Loading template...')
    
    try {
      const templateJson = await rpc.loadTemplate(path)
      setTemplate(templateJson)
      const firstPage = templateJson.pages[0]
      setSelectedPageId(firstPage?.id ?? null)
      setSelectedSvg(firstPage?.svg || null)
      setSelectedTextIndex(null)
      setSelectedText(null)
      setSelectedBindingSvgId(null)
      setPendingId('')
      setStatus(`Loaded template: ${templateJson.template.id} v${templateJson.template.version}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template')
      setStatus('Error loading template')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleLoad = useCallback(async () => {
    await loadTemplateByPath(templateDir)
  }, [loadTemplateByPath, templateDir])

  const refreshTemplatesList = useCallback(async (baseDir: string) => {
    setTemplatesLoading(true)
    setTemplatesError(null)

    try {
      const result = await rpc.listTemplates(baseDir)
      setTemplatesList(result.templates)
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'Failed to load templates list')
      setTemplatesList([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!templatesBaseDir) return
    refreshTemplatesList(templatesBaseDir)
  }, [templatesBaseDir, refreshTemplatesList])

  const handleSave = useCallback(async () => {
    if (!template) return
    
    setIsLoading(true)
    setError(null)
    setStatus('Saving template...')
    
    try {
      const result = await rpc.saveTemplate(templateDir, template, true)
      if (result.validation && !result.validation.ok) {
        setStatus(`Saved with ${result.validation.errors.length} validation errors`)
      } else {
        setStatus('Template saved successfully')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
      setStatus('Error saving template')
    } finally {
      setIsLoading(false)
    }
  }, [templateDir, template])

  const handleValidate = useCallback(async () => {
    if (!template) return
    
    setIsLoading(true)
    setError(null)
    setStatus('Validating template...')
    
    try {
      const result = await rpc.validate(templateDir)
      setValidationResult(result)
      setFocusTarget(null)
      setStatus(result.ok ? 'Validation passed' : `Validation failed: ${result.errors.length} errors`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed')
      setStatus('Error during validation')
    } finally {
      setIsLoading(false)
    }
  }, [templateDir, template])

  const handlePreview = useCallback(async () => {
    if (!template) return
    
    setIsLoading(true)
    setError(null)
    setStatus('Generating preview...')
    
    try {
      const outputDir = `out/preview/${template.template.id}-${template.template.version}`
      const data = metaData || itemsData ? { meta: metaData ?? undefined, items: itemsData ?? undefined } : undefined
      const result = await rpc.preview(templateDir, outputDir, 'realistic', data)
      setPreviewResult(result)
      setStatus(result.ok ? `Preview generated: ${result.output?.pages.length || 0} pages` : 'Preview generation failed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview generation failed')
      setStatus('Error generating preview')
    } finally {
      setIsLoading(false)
    }
  }, [templateDir, template, metaData, itemsData])

  const handleMetaUpload = useCallback(async (file: File) => {
    setDataError(null)
    try {
      const content = await file.text()
      const result = await rpc.parseJsonData(content)
      setMetaData(result.data)
      setMetaFileName(file.name)
      setNotification(`Loaded meta data (${Object.keys(result.data).length} keys)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse meta JSON'
      setDataError(message)
    }
  }, [])

  const handleItemsUpload = useCallback(async (file: File) => {
    setDataError(null)
    try {
      const content = await file.text()
      const result = await rpc.parseCsvData(content, 'table')
      setItemsData(result.data as TableData)
      setItemsFileName(file.name)
      const headers = (result.data as TableData).headers
      setNotification(`Loaded items (${headers.length} columns)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse items CSV'
      setDataError(message)
    }
  }, [])

  const handleMetaUrlLoad = useCallback(async (url: string) => {
    if (!url.trim()) return
    setDataError(null)
    setDataLoading(true)
    try {
      const result = await rpc.fetchDataFromUrl(url.trim(), 'json')
      setMetaData(result.data as KVData)
      setMetaFileName(url.trim())
      setNotification(`Loaded meta data (${Object.keys(result.data as KVData).length} keys)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch meta JSON'
      setDataError(message)
    } finally {
      setDataLoading(false)
    }
  }, [])

  const handleItemsUrlLoad = useCallback(async (url: string) => {
    if (!url.trim()) return
    setDataError(null)
    setDataLoading(true)
    try {
      const result = await rpc.fetchDataFromUrl(url.trim(), 'csv', 'table')
      setItemsData(result.data as TableData)
      setItemsFileName(url.trim())
      const headers = (result.data as TableData).headers
      setNotification(`Loaded items (${headers.length} columns)`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch items CSV'
      setDataError(message)
    } finally {
      setDataLoading(false)
    }
  }, [])

  const clearMetaData = useCallback(() => {
    setMetaData(null)
    setMetaFileName(null)
  }, [])

  const clearItemsData = useCallback(() => {
    setItemsData(null)
    setItemsFileName(null)
  }, [])

  const handleTemplateChange = useCallback((newTemplate: TemplateConfig) => {
    setTemplate(newTemplate)
  }, [])

  const handlePageSelect = useCallback(async (pageId: string) => {
    if (!template) return
    
    const page = template.pages.find(p => p.id === pageId)
    if (page) {
      setSelectedPageId(pageId)
      setSelectedSvg(page.svg)
    }
  }, [template])

  const handleSelectedPageIdChange = useCallback((pageId: string) => {
    setSelectedPageId(pageId)
  }, [])

  const loadInspectText = useCallback(async (svgPath: string) => {
    try {
      const inspectResult = await rpc.inspectText(svgPath)
      setSvgElements(inspectResult.texts)
    } catch {
      setSvgElements([])
    }
  }, [])

  useEffect(() => {
    if (!selectedSvg) {
      setSvgElements([])
      return
    }

    setSelectedTextIndex(null)
    setSelectedText(null)
    setSelectedBindingSvgId(null)
    setPendingId('')

    const svgPath = `${templateDir}/${selectedSvg}`
    const timer = setTimeout(() => {
      void loadInspectText(svgPath)
    }, 200)

    return () => clearTimeout(timer)
  }, [selectedSvg, templateDir, loadInspectText])

  useEffect(() => {
    if (!template) return
    if (selectedPageId && template.pages.some(p => p.id === selectedPageId)) {
      return
    }
    if (selectedSvg) {
      const match = template.pages.find(p => p.svg === selectedSvg)
      if (match) {
        setSelectedPageId(match.id)
        return
      }
    }
    setSelectedPageId(template.pages[0]?.id ?? null)
  }, [template, selectedPageId, selectedSvg])

  useEffect(() => {
    if (!template || !selectedPageId) return
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return
    if (page.svg !== selectedSvg) {
      setSelectedSvg(page.svg)
    }
  }, [template, selectedPageId, selectedSvg])

  useEffect(() => {
    saveSession({ templateDir, templatesBaseDir, selectedPageId: selectedPageId || undefined })
  }, [templateDir, templatesBaseDir, selectedPageId])

  const handleSelectTextElement = useCallback((index: number) => {
    const element = svgElements[index]
    if (!element) return
    setSelectedTextIndex(index)
    setSelectedText(element)
    setSelectedBindingSvgId(element.id || element.suggestedId || null)
    setPendingId(element.suggestedId || element.id || '')
  }, [svgElements])

  const resolveBindingSvgId = useCallback((ref: BindingRef | null, templateRef: TemplateConfig | null): string | null => {
    if (!ref || !templateRef) return null
    if (ref.kind === 'global-field') {
      return templateRef.fields[ref.index]?.svg_id ?? null
    }
    const page = templateRef.pages.find(p => p.id === ref.pageId)
    if (!page) return null
    if (ref.kind === 'page-field') {
      return page.fields?.[ref.index]?.svg_id ?? null
    }
    if (ref.kind === 'table-header') {
      return page.tables[ref.tableIndex]?.header?.cells?.[ref.cellIndex]?.svg_id ?? null
    }
    if (ref.kind === 'table-cell') {
      return page.tables[ref.tableIndex]?.cells?.[ref.cellIndex]?.svg_id ?? null
    }
    return null
  }, [])

  const handleSelectBindingRef = useCallback((ref: BindingRef | null) => {
    setSelectedBindingRef(ref)
    setSelectedBindingSvgId(resolveBindingSvgId(ref, template))
  }, [resolveBindingSvgId, template])

  const updateBindingSvgId = useCallback((ref: BindingRef, svgId: string) => {
    setTemplate((prev) => {
      if (!prev) return prev
      if (ref.kind === 'global-field') {
        const fields = prev.fields.map((field, index) =>
          index === ref.index ? { ...field, svg_id: svgId } : field
        )
        return { ...prev, fields }
      }
      const pages = prev.pages.map((page) => {
        if (page.id !== ref.pageId) return page
        if (ref.kind === 'page-field') {
          const fields = (page.fields ?? []).map((field, index) =>
            index === ref.index ? { ...field, svg_id: svgId } : field
          )
          return { ...page, fields }
        }
        if (ref.kind === 'table-header') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex) return table
            if (!table.header?.cells) return table
            const cells = table.header.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, svg_id: svgId } : cell
            )
            return { ...table, header: { cells } }
          })
          return { ...page, tables }
        }
        if (ref.kind === 'table-cell') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex) return table
            const cells = table.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, svg_id: svgId } : cell
            )
            return { ...table, cells }
          })
          return { ...page, tables }
        }
        return page
      })
      return { ...prev, pages }
    })
  }, [])

  const handleDropBindingOnElement = useCallback(async (ref: BindingRef, element: TextElement) => {
    if (!template || !selectedSvg) return
    let targetId = element.id || ''
    const svgPath = `${templateDir}/${selectedSvg}`

    if (!targetId) {
      if (!element.suggestedId) {
        setNotification('Target element has no ID. Assign an ID first.')
        return
      }
      try {
        await rpc.setSvgIds(svgPath, [
          { selector: { byIndex: element.index }, id: element.suggestedId },
        ])
        const inspectResult = await rpc.inspectText(svgPath)
        setSvgElements(inspectResult.texts)
        targetId = element.suggestedId
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign ID'
        setNotification(message)
        return
      }
    }

    updateBindingSvgId(ref, targetId)
    setSelectedBindingRef(ref)
    setSelectedBindingSvgId(targetId)
  }, [template, selectedSvg, templateDir, updateBindingSvgId])

  const handleUseSuggestedId = useCallback(() => {
    if (!selectedText) return
    setPendingId(selectedText.suggestedId || '')
  }, [selectedText])

  const handleApplyId = useCallback(async () => {
    if (!selectedText || !selectedSvg || !pendingId.trim()) return

    setIsLoading(true)
    setError(null)
    setStatus('Applying ID...')

    const svgPath = `${templateDir}/${selectedSvg}`

    try {
      await rpc.setSvgIds(svgPath, [
        { selector: { byIndex: selectedText.index }, id: pendingId.trim() },
      ])

      const inspectResult = await rpc.inspectText(svgPath)
      setSvgElements(inspectResult.texts)

      const nextIndex = inspectResult.texts.findIndex(t => t.index === selectedText.index)
      if (nextIndex >= 0) {
        setSelectedTextIndex(nextIndex)
        setSelectedText(inspectResult.texts[nextIndex])
      } else {
        setSelectedTextIndex(null)
        setSelectedText(null)
      }

      setStatus('ID applied successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply ID'
      setError(message)
      setStatus('Error applying ID')
    } finally {
      setIsLoading(false)
    }
  }, [pendingId, selectedText, selectedSvg, templateDir])

  const bindingSvgIds = useMemo(() => {
    if (!template) return []
    const ids = new Set<string>()

    // Global fields
    for (const field of template.fields) {
      if (field.svg_id) ids.add(field.svg_id)
    }

    // Current page bindings (tables/cells/page_number)
    const page = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : undefined
    if (page?.page_number?.svg_id) ids.add(page.page_number.svg_id)
    if (page?.fields) {
      for (const field of page.fields) {
        if (field.svg_id) ids.add(field.svg_id)
      }
    }
    if (page) {
      for (const table of page.tables) {
        if (table.header?.cells) {
          for (const cell of table.header.cells) {
            if (cell.svg_id) ids.add(cell.svg_id)
          }
        }
        for (const cell of table.cells) {
          if (cell.svg_id) ids.add(cell.svg_id)
        }
      }
    }

    return Array.from(ids)
  }, [template, selectedPageId])

  const templateModels = useMemo(() => {
    if (!template) return null

    const tableSources = new Set<string>()
    for (const page of template.pages) {
      for (const table of page.tables) {
        if (table.source) tableSources.add(table.source)
      }
    }

    type ModelBucket = { kind: 'kv' | 'table'; fields: Set<string>; columns: Set<string> }
    const buckets = new Map<string, ModelBucket>()

    const ensureBucket = (source: string, kind: 'kv' | 'table') => {
      if (!buckets.has(source)) {
        buckets.set(source, { kind, fields: new Set<string>(), columns: new Set<string>() })
      }
      const bucket = buckets.get(source)!
      if (bucket.kind !== kind && kind === 'table') {
        bucket.kind = 'table'
      }
      return bucket
    }

    const addKey = (source: string, key: string, kindHint?: 'kv' | 'table') => {
      if (!source || !key) return
      const inferred = kindHint || (tableSources.has(source) || source === 'items' ? 'table' : 'kv')
      const bucket = ensureBucket(source, inferred)
      if (bucket.kind === 'table') {
        bucket.columns.add(key)
      } else {
        bucket.fields.add(key)
      }
    }

    const visitBinding = (binding: { value: { type: string; source?: string; key?: string } }) => {
      if (binding.value.type !== 'data') return
      addKey(binding.value.source || '', binding.value.key || '')
    }

    for (const field of template.fields) {
      visitBinding(field)
    }

    for (const page of template.pages) {
      for (const field of page.fields ?? []) {
        visitBinding(field)
      }
      for (const table of page.tables) {
        for (const cell of table.header?.cells ?? []) {
          if (cell.value.type !== 'data') continue
          const kind = cell.value.source === table.source ? 'table' : undefined
          addKey(cell.value.source || '', cell.value.key || '', kind)
        }
        for (const cell of table.cells) {
          if (cell.value.type !== 'data') continue
          const kind = cell.value.source === table.source ? 'table' : undefined
          addKey(cell.value.source || '', cell.value.key || '', kind)
        }
      }
    }

    const result: Record<string, { kind: 'kv' | 'table'; fields?: string[]; columns?: string[] }> = {}
    for (const [source, bucket] of buckets.entries()) {
      if (bucket.kind === 'table') {
        result[source] = { kind: 'table', columns: Array.from(bucket.columns).sort() }
      } else {
        result[source] = { kind: 'kv', fields: Array.from(bucket.fields).sort() }
      }
    }

    return result
  }, [template])

  const tableBindingGroups = useMemo(() => {
    if (!template || !selectedPageId) return []
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return []
    return page.tables.map((table, index) => ({
      id: `table-${index + 1}`,
      cellSvgIds: table.cells.map(cell => cell.svg_id).filter(Boolean),
    }))
  }, [template, selectedPageId])

  const focusFromValidationPath = useCallback((path: string) => {
    if (!path) {
      setNotification('This validation error does not include a jump path. Please read the message.')
      return
    }

    const normalized = normalizeValidationPath(path)
    if (!normalized) {
      const suffix = path ? ` (path: ${path})` : ''
      setNotification(`This validation error is not auto-jumpable. Please read the message.${suffix}`)
      return
    }
    const tab = normalized.startsWith('fields')
      ? 'fields'
      : normalized.startsWith('formatters')
        ? 'formatters'
        : 'pages'

    setFocusTarget({ tab, path: normalized })
  }, [])

  const handleCopyValidation = useCallback(async (payload: { code: string; path: string; file: string; message: string }) => {
    const lines = [
      `code: ${payload.code}`,
      `path: ${payload.path || '(none)'}`,
      `file: ${payload.file || '(none)'}`,
      `message: ${payload.message}`,
    ]
    const text = lines.join('\n')

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setNotification('Copied validation error to clipboard.')
    } catch {
      setNotification('Failed to copy validation error.')
    }
  }, [])

  const handleResetSession = useCallback(() => {
    if (!confirm('Reset saved session?')) return
    clearSession()
    setNotification('Session reset.')
  }, [])

  const handleCopyPreviewPath = useCallback(async (path: string | undefined) => {
    if (!path) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(path)
      } else {
        const area = document.createElement('textarea')
        area.value = path
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setNotification('Copied preview path to clipboard.')
    } catch {
      setNotification('Failed to copy preview path.')
    }
  }, [])

  const startResizeMain = useCallback((event: MouseEvent) => {
    event.preventDefault()
    const container = mainSplitRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const startX = event.clientX
    const startWidth = editorPaneWidth

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX
      const ratio = (dx / rect.width) * 100
      const next = Math.min(65, Math.max(28, startWidth + ratio))
      setEditorPaneWidth(next)
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [editorPaneWidth])

  const clearFocusTarget = useCallback(() => {
    setFocusTarget(null)
  }, [])

  useEffect(() => {
    if (!notification) return
    const timer = setTimeout(() => setNotification(null), 4000)
    return () => clearTimeout(timer)
  }, [notification])

  const groupedValidationErrors = useMemo(() => {
    if (!validationResult) {
      return {
        pages: [],
        fields: [],
        formatters: [],
        other: [],
      }
    }

    const groups: Record<'pages' | 'fields' | 'formatters' | 'other', typeof validationResult.errors> = {
      pages: [],
      fields: [],
      formatters: [],
      other: [],
    }

    for (const err of validationResult.errors) {
      const normalized = normalizeValidationPath(err.path || '')
      if (normalized.startsWith('pages')) {
        groups.pages.push(err)
      } else if (normalized.startsWith('fields')) {
        groups.fields.push(err)
      } else if (normalized.startsWith('formatters')) {
        groups.formatters.push(err)
      } else {
        groups.other.push(err)
      }
    }

    return groups
  }, [validationResult])

  useEffect(() => {
    if (!validationResult) return
    setValidationGroupsOpen({
      pages: groupedValidationErrors.pages.length > 0,
      fields: groupedValidationErrors.fields.length > 0,
      formatters: groupedValidationErrors.formatters.length > 0,
      other: groupedValidationErrors.other.length > 0,
    })
  }, [validationResult, groupedValidationErrors])

  return (
    <div className="app">
      <header className="app-header">
        <h1>SVG Paper - Template Editor</h1>
        <div className="template-path">
          <input
            type="text"
            value={templateDir}
            onChange={(e) => setTemplateDir((e.target as HTMLInputElement).value)}
            placeholder="Template directory path"
          />
          <button onClick={handleLoad} disabled={isLoading}>Load</button>
          <button className="btn-reset" onClick={handleResetSession}>Reset session</button>
        </div>
      </header>

      <div className="templates-bar">
        <div className="templates-bar-left">
          <label>Templates Base Dir</label>
          <input
            type="text"
            value={templatesBaseDir}
            onChange={(e) => setTemplatesBaseDir((e.target as HTMLInputElement).value)}
            placeholder="templates"
          />
          <button onClick={() => refreshTemplatesList(templatesBaseDir)} disabled={templatesLoading}>
            {templatesLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="templates-bar-right">
          <div className="templates-actions">
            <button
              onClick={handleSave}
              disabled={!template || isLoading}
              className="btn-primary"
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleValidate}
              disabled={!template || isLoading}
              className="btn-secondary"
            >
              Validate
            </button>
            <button
              onClick={handlePreview}
              disabled={!template || isLoading}
              className="btn-secondary"
            >
              Preview
            </button>
          </div>
          {templatesError ? <span className="templates-error">{templatesError}</span> : null}
        </div>
      </div>

      <main className="app-main" ref={mainSplitRef}>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {template ? (
          <>
            <div className="editor-pane" style={{ width: `${editorPaneWidth}%` }}>
              <div className="templates-panel">
                <h3>Templates</h3>
                {templatesList.length === 0 ? (
                  <p className="empty">No templates found under {templatesBaseDir}</p>
                ) : (
                  <ul className="templates-list">
                    {templatesList.map((item) => (
                      <li key={`${item.id}-${item.version}`}>
                        <button
                          className="templates-item"
                          onClick={() => {
                            setTemplateDir(item.path)
                            void loadTemplateByPath(item.path)
                          }}
                        >
                          <span className="templates-item-id">{item.id}</span>
                          <span className="templates-item-version">v{item.version}</span>
                          <span className="templates-item-path">{item.path}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <TemplateEditor
                template={template}
                onChange={handleTemplateChange}
                onPageSelect={handlePageSelect}
                selectedPageId={selectedPageId}
                onSelectedPageIdChange={handleSelectedPageIdChange}
                focusTarget={focusTarget}
                onFocusTargetConsumed={clearFocusTarget}
                selectedPreviewSvgId={selectedText?.id || null}
                onSelectBindingSvgId={setSelectedBindingSvgId}
                selectedBindingRef={selectedBindingRef}
                onSelectBindingRef={handleSelectBindingRef}
                metaData={metaData}
                itemsData={itemsData}
                metaFileName={metaFileName}
                itemsFileName={itemsFileName}
                dataError={dataError}
                dataLoading={dataLoading}
                templateModels={templateModels}
                onMetaUpload={handleMetaUpload}
                onItemsUpload={handleItemsUpload}
                onMetaUrlLoad={handleMetaUrlLoad}
                onItemsUrlLoad={handleItemsUrlLoad}
                onClearMeta={clearMetaData}
                onClearItems={clearItemsData}
                onNotify={setNotification}
              />
            </div>
            <div
              className="main-divider"
              onMouseDown={(e) => startResizeMain(e as unknown as MouseEvent)}
              role="separator"
              aria-orientation="vertical"
            />
            <div className="preview-pane" style={{ width: `${100 - editorPaneWidth}%` }}>
              <SvgViewer
                svgPath={selectedSvg ? `${templateDir}/${selectedSvg}` : null}
                elements={svgElements}
                templateDir={templateDir}
                bindingSvgIds={bindingSvgIds}
                tableBindingGroups={tableBindingGroups}
                selectedElementIndex={selectedTextIndex}
                highlightedBindingSvgId={selectedBindingSvgId}
                onSelectElement={handleSelectTextElement}
                onDropBinding={handleDropBindingOnElement}
                pendingId={pendingId}
                onPendingIdChange={setPendingId}
                onUseSuggestedId={handleUseSuggestedId}
                onApplyId={handleApplyId}
                isLoading={isLoading}
              />
            </div>
          </>
        ) : (
          <div className="welcome">
            <h2>Welcome to SVG Paper Template Editor</h2>
            <p>Enter a template directory path and click Load to start editing.</p>
            <p>Example: <code>test-templates/delivery-slip/v1</code></p>
            <div className="templates-panel">
              <h3>Templates</h3>
              {templatesList.length === 0 ? (
                <p className="empty">No templates found under {templatesBaseDir}</p>
              ) : (
                <ul className="templates-list">
                  {templatesList.map((item) => (
                    <li key={`${item.id}-${item.version}`}>
                      <button
                        className="templates-item"
                        onClick={() => {
                          setTemplateDir(item.path)
                          void loadTemplateByPath(item.path)
                        }}
                      >
                        <span className="templates-item-id">{item.id}</span>
                        <span className="templates-item-version">v{item.version}</span>
                        <span className="templates-item-path">{item.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>

      {validationResult && (
        <div className="validation-panel">
          <h3>Validation Results</h3>
          {validationResult.ok ? (
            <p className="success">✓ All checks passed</p>
          ) : (
            <>
              <p className="error">✗ {validationResult.errors.length} errors found</p>
              <div className="validation-groups">
                {renderValidationGroup({
                  key: 'pages',
                  title: 'Pages',
                  errors: groupedValidationErrors.pages,
                  isOpen: validationGroupsOpen.pages,
                  onToggle: () => setValidationGroupsOpen(prev => ({ ...prev, pages: !prev.pages })),
                  onJump: focusFromValidationPath,
                  onCopy: handleCopyValidation,
                })}
                {renderValidationGroup({
                  key: 'fields',
                  title: 'Fields',
                  errors: groupedValidationErrors.fields,
                  isOpen: validationGroupsOpen.fields,
                  onToggle: () => setValidationGroupsOpen(prev => ({ ...prev, fields: !prev.fields })),
                  onJump: focusFromValidationPath,
                  onCopy: handleCopyValidation,
                })}
                {renderValidationGroup({
                  key: 'formatters',
                  title: 'Formatters',
                  errors: groupedValidationErrors.formatters,
                  isOpen: validationGroupsOpen.formatters,
                  onToggle: () => setValidationGroupsOpen(prev => ({ ...prev, formatters: !prev.formatters })),
                  onJump: focusFromValidationPath,
                  onCopy: handleCopyValidation,
                })}
                {renderValidationGroup({
                  key: 'other',
                  title: 'Other',
                  errors: groupedValidationErrors.other,
                  isOpen: validationGroupsOpen.other,
                  onToggle: () => setValidationGroupsOpen(prev => ({ ...prev, other: !prev.other })),
                  onJump: focusFromValidationPath,
                  onCopy: handleCopyValidation,
                })}
              </div>
            </>
          )}
          {validationResult.warnings.length > 0 && (
            <>
              <p className="warning">⚠ {validationResult.warnings.length} warnings</p>
              <ul>
                {validationResult.warnings.map((warn, i) => (
                  <li key={i}>{warn}</li>
                ))}
              </ul>
            </>
          )}
          <button onClick={() => setValidationResult(null)}>Close</button>
        </div>
      )}

      {previewResult?.ok && previewResult.output && (
        <div className="preview-panel">
          <h3>Preview Generated</h3>
          <p>Pages: {previewResult.output.pages.length}</p>
          <p>HTML: {previewResult.output.html}</p>
          <button onClick={() => handleCopyPreviewPath(previewResult.output?.html)}>
            Copy path
          </button>
          <button onClick={() => window.open(previewResult.output?.html, '_blank')}>
            Open Preview
          </button>
          <button onClick={() => setPreviewResult(null)}>Close</button>
        </div>
      )}

      <StatusBar status={notification || status} />
    </div>
  )
}

function renderValidationGroup(args: {
  key: string
  title: string
  errors: Array<{ code: string; file: string; message: string; path: string }>
  isOpen: boolean
  onToggle: () => void
  onJump: (path: string) => void
  onCopy: (payload: { code: string; path: string; file: string; message: string }) => void
}) {
  const { key, title, errors, isOpen, onToggle, onJump, onCopy } = args
  return (
    <div className="validation-group" key={key}>
      <button className="validation-group-header" onClick={onToggle}>
        <span>{title}</span>
        <span className="validation-count">{errors.length}</span>
        <span className="validation-toggle">{isOpen ? '▾' : '▸'}</span>
      </button>
      {isOpen && errors.length > 0 && (
        <ul className="validation-list">
          {errors.map((err, i) => (
            <li key={`${key}-${i}`} className="validation-item">
              <button className="validation-link" onClick={() => onJump(err.path)}>
                [{err.code}] {err.file}: {err.message}
              </button>
              <button
                className="validation-copy"
                onClick={() => onCopy({
                  code: err.code,
                  path: err.path,
                  file: err.file,
                  message: err.message,
                })}
              >
                Copy
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function normalizeValidationPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''

  const withoutPrefix = trimmed
    .replace(/^templateJson\./, '')
    .replace(/^template\./, '')
    .replace(/^\$\./, '')

  const tokens = parsePathTokens(withoutPrefix)
  if (!tokens || tokens.length === 0) return ''

  const root = tokens[0]
  if (root.type !== 'key') return ''
  if (root.value !== 'pages' && root.value !== 'fields' && root.value !== 'formatters') return ''

  if (root.value === 'formatters') {
    const next = tokens[1]
    if (!next || next.type !== 'key') return ''
    let out = `formatters["${next.value}"]`
    for (let i = 2; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (token.type === 'index') {
        out += `[${token.value}]`
      } else {
        out += `.${token.value}`
      }
    }
    return out
  }

  let out = root.value
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.type === 'index') {
      out += `[${token.value}]`
    } else {
      out += `.${token.value}`
    }
  }
  return out
}

type PathToken = { type: 'key'; value: string } | { type: 'index'; value: number }

function parsePathTokens(input: string): PathToken[] | null {
  const tokens: PathToken[] = []
  let i = 0

  const eatWhitespace = () => {
    while (i < input.length && /\s/.test(input[i])) i += 1
  }

  const readIdentifier = () => {
    const start = i
    while (i < input.length && /[A-Za-z0-9_$]/.test(input[i])) i += 1
    if (start === i) return null
    return input.slice(start, i)
  }

  const readNumber = () => {
    const start = i
    while (i < input.length && /[0-9]/.test(input[i])) i += 1
    if (start === i) return null
    return Number(input.slice(start, i))
  }

  while (i < input.length) {
    eatWhitespace()

    if (input[i] === '.') {
      i += 1
      eatWhitespace()
    }

    if (input[i] === '[') {
      i += 1
      eatWhitespace()
      const quote = input[i] === '"' || input[i] === '\'' ? input[i] : null
      if (quote) {
        i += 1
        const start = i
        while (i < input.length && input[i] !== quote) i += 1
        if (i >= input.length) return null
        const key = input.slice(start, i)
        i += 1
        eatWhitespace()
        if (input[i] !== ']') return null
        i += 1
        tokens.push({ type: 'key', value: key })
        continue
      }

      const num = readNumber()
      if (num === null || Number.isNaN(num)) return null
      eatWhitespace()
      if (input[i] !== ']') return null
      i += 1
      tokens.push({ type: 'index', value: num })
      continue
    }

    const ident = readIdentifier()
    if (ident) {
      tokens.push({ type: 'key', value: ident })
      continue
    }

    const num = readNumber()
    if (num !== null) {
      tokens.push({ type: 'index', value: num })
      continue
    }

    return null
  }

  return tokens
}

function loadSession(): { templateDir?: string; templatesBaseDir?: string; selectedPageId?: string } {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('svgpaper.session')
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { templateDir?: string; templatesBaseDir?: string; selectedPageId?: string }
    return parsed || {}
  } catch {
    return {}
  }
}

function saveSession(data: { templateDir?: string; templatesBaseDir?: string; selectedPageId?: string }) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem('svgpaper.session', JSON.stringify(data))
  } catch {
    // ignore storage errors
  }
}

function clearSession() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem('svgpaper.session')
  } catch {
    // ignore storage errors
  }
}
