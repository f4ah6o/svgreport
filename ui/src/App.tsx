import { useState, useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import type {
  TemplateConfig,
  PageConfig,
  FieldBinding,
  TableCell,
  FormatterDef,
  TextElement,
  ValidationResponse,
  ValidationError,
  TemplateListItem,
  KVData,
  TableData,
  TableBinding,
} from './types/api'
import type { BindingRef } from './types/binding'
import { rpc } from './lib/rpc'
import { SvgViewer } from './components/SvgViewer'
import { GraphEditor } from './components/GraphEditor'
import { StatusBar } from './components/StatusBar'
import type { DataKeyRef } from './types/data-key'
import { encodeDataKeyRef, decodeDataKeyRef } from './types/data-key'
import './App.css'

const makeDataValue = (source: string, key: string) => ({ type: 'data' as const, source, key })
const makeStaticValue = (text: string) => ({ type: 'static' as const, text })

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
  const [selectedTextIndex, setSelectedTextIndex] = useState<number | null>(null)
  const [selectedText, setSelectedText] = useState<TextElement | null>(null)
  const [selectedBindingSvgId, setSelectedBindingSvgId] = useState<string | null>(null)
  const templatesBaseDir = 'templates'
  const [templatesList, setTemplatesList] = useState<TemplateListItem[]>([])
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [metaData, setMetaData] = useState<KVData | null>(null)
  const [itemsData, setItemsData] = useState<TableData | null>(null)
  const [metaFileName, setMetaFileName] = useState<string | null>(null)
  const [itemsFileName, setItemsFileName] = useState<string | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importTemplateId, setImportTemplateId] = useState('')
  const [importVersion, setImportVersion] = useState('v1')
  const [importTemplateIdTouched, setImportTemplateIdTouched] = useState(false)
  const [importVersionTouched, setImportVersionTouched] = useState(false)
  const [importPdfFile, setImportPdfFile] = useState<File | null>(null)
  const [importEngine, setImportEngine] = useState<'auto' | 'pdf2svg' | 'inkscape'>('auto')
  const [importLoading, setImportLoading] = useState(false)
  const [detectLoading, setDetectLoading] = useState(false)
  const [graphMetaScope, setGraphMetaScope] = useState<'page' | 'global'>('page')
  const [graphItemsTarget, setGraphItemsTarget] = useState<'body' | 'header'>('body')
  const [graphTableIndex, setGraphTableIndex] = useState(0)
  const [graphEditTableIndex, setGraphEditTableIndex] = useState<number | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [validationGroupsOpen, setValidationGroupsOpen] = useState<Record<'pages' | 'fields' | 'formatters' | 'other', boolean>>({
    pages: true,
    fields: true,
    formatters: true,
    other: true,
  })
  const autoFixIdsRef = useRef(false)
  const autoFixTableRef = useRef(false)
  const validationPathLogRef = useRef(new Set<string>())
  const detectedElementsCacheRef = useRef(new Map<string, TextElement[]>())
  const [svgReloadToken, setSvgReloadToken] = useState(0)

  const getDetectCacheKey = useCallback((svgPath: string) => {
    return `balanced:${svgPath}`
  }, [])

  const getSvgIdPrefix = useCallback((svgPath: string) => {
    const fileName = svgPath.split('/').pop() || 'page'
    const base = fileName.replace(/\.svg$/i, '')
    const normalized = base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    return `${normalized || 'page'}_text_`
  }, [])

  const svgElementsById = useMemo(() => {
    const map = new Map<string, TextElement>()
    for (const element of svgElements) {
      if (element.id && !map.has(element.id)) {
        map.set(element.id, element)
      }
    }
    return map
  }, [svgElements])

  // Check connection on mount
  useEffect(() => {
    rpc.getVersion()
      .then(async () => {
        setStatus('Connected to RPC server')
        try {
          await rpc.getWorkspace()
        } catch {
          // Ignore workspace errors
        }
      })
      .catch(() => setStatus('Error: Cannot connect to RPC server'))
  }, [])

  useEffect(() => {
    const saved = loadSession()
    if (saved.templateDir) setTemplateDir(saved.templateDir)
    if (saved.selectedPageId) setSelectedPageId(saved.selectedPageId)
  }, [])




  useEffect(() => {
    if (!template || !selectedPageId) return
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return
    if (graphTableIndex >= page.tables.length) {
      setGraphTableIndex(0)
    }
    if (graphEditTableIndex !== null && graphEditTableIndex >= page.tables.length) {
      setGraphEditTableIndex(null)
    }
  }, [template, selectedPageId, graphTableIndex, graphEditTableIndex])

  const selectDynamicElements = useCallback((texts: TextElement[]): TextElement[] => {
    // Current policy: treat all text nodes as dynamic candidates.
    return texts
  }, [])

  const autoDetectTemplateElements = useCallback(async (
    templatePath: string,
    templateJson: TemplateConfig,
  ): Promise<{ totalDetected: number; pageSummaries: string[]; failedPages: string[] }> => {
    const profile: 'balanced' | 'split' | 'merge' = 'balanced'
    const pageResults = await Promise.all(templateJson.pages.map(async (page) => {
      const svgPath = `${templatePath}/${page.svg}`
      try {
        const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: profile })
        const dynamicElements = selectDynamicElements(inspectResult.texts)
        detectedElementsCacheRef.current.set(getDetectCacheKey(svgPath), dynamicElements)
        return {
          pageId: page.id,
          count: dynamicElements.length,
          failed: false,
        }
      } catch {
        detectedElementsCacheRef.current.delete(getDetectCacheKey(svgPath))
        return {
          pageId: page.id,
          count: 0,
          failed: true,
        }
      }
    }))

    return {
      totalDetected: pageResults.reduce((sum, page) => sum + page.count, 0),
      pageSummaries: pageResults
        .filter(page => !page.failed)
        .map(page => `${page.pageId}:${page.count}`),
      failedPages: pageResults.filter(page => page.failed).map(page => page.pageId),
    }
  }, [selectDynamicElements, getDetectCacheKey])

  const loadTemplateByPath = useCallback(async (path: string): Promise<TemplateConfig | null> => {
    setIsLoading(true)
    setError(null)
    setStatus('Loading template...')
    
    try {
      detectedElementsCacheRef.current.clear()
      const templateJson = await rpc.loadTemplate(path)
      setTemplate(templateJson)
      const firstPage = templateJson.pages[0]
      setSelectedPageId(firstPage?.id ?? null)
      setSelectedSvg(firstPage?.svg || null)
      setSvgElements([])
      setSelectedTextIndex(null)
      setSelectedText(null)
      setSelectedBindingSvgId(null)
      setStatus(`Loaded template: ${templateJson.template.id} v${templateJson.template.version}`)
      return templateJson
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template')
      setStatus('Error loading template')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleLoad = useCallback(async () => {
    await loadTemplateByPath(templateDir)
  }, [loadTemplateByPath, templateDir])

  const resetImportDialog = useCallback(() => {
    setImportTemplateId('')
    setImportVersion('v1')
    setImportTemplateIdTouched(false)
    setImportVersionTouched(false)
    setImportPdfFile(null)
    setImportEngine('auto')
    setImportLoading(false)
  }, [])

  const openImportDialog = useCallback(() => {
    resetImportDialog()
    setImportDialogOpen(true)
  }, [resetImportDialog])

  const closeImportDialog = useCallback(() => {
    setImportDialogOpen(false)
    resetImportDialog()
  }, [resetImportDialog])

  const handleImportPdfFileChange = useCallback((event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0] || null
    setImportPdfFile(file)
    if (file) {
      if (!importTemplateIdTouched || !importTemplateId.trim()) {
        setImportTemplateId(suggestTemplateIdFromFileName(file.name))
      }
      if (!importVersionTouched || !importVersion.trim()) {
        setImportVersion('v1')
      }
    }
    input.value = ''
  }, [importTemplateIdTouched, importTemplateId, importVersionTouched, importVersion])

  const handleImportTemplate = useCallback(async () => {
    if (!importPdfFile) {
      setError('PDFファイルを選択してください。')
      return
    }

    const templateIdValue = importTemplateId.trim()
    const versionValue = importVersion.trim()
    if (!templateIdValue || !versionValue) {
      setError('テンプレートIDとバージョンは必須です。')
      return
    }

    setImportLoading(true)
    setError(null)
    setStatus('PDFから帳票テンプレートを作成中...')

    try {
      const buffer = await importPdfFile.arrayBuffer()
      const contentBase64 = arrayBufferToBase64(buffer)
      const result = await rpc.importTemplateFromPdf(
        templateIdValue,
        versionValue,
        {
          filename: importPdfFile.name,
          contentBase64,
        },
        templatesBaseDir,
        importEngine
      )

      try {
        const templates = await rpc.listTemplates(templatesBaseDir)
        setTemplatesList(templates.templates)
        setTemplatesError(null)
      } catch (listErr) {
        setTemplatesError(listErr instanceof Error ? listErr.message : 'Failed to load templates list')
      }
      setTemplateDir(result.templateDir)
      const loadedTemplate = await loadTemplateByPath(result.templateDir)
      const notifications: string[] = []
      if (loadedTemplate) {
        const detectResult = await autoDetectTemplateElements(result.templateDir, loadedTemplate)
        const detail = detectResult.pageSummaries.length > 0
          ? ` (${detectResult.pageSummaries.join(', ')})`
          : ''
        setStatus(`帳票テンプレートを作成しました: ${result.templateDir} / 要素検出 ${detectResult.totalDetected}件${detail}`)
        if (detectResult.failedPages.length > 0) {
          notifications.push(`要素検出に失敗したページ: ${detectResult.failedPages.join(', ')}`)
        }
      }

      if (result.warnings.length > 0) {
        notifications.push(`作成完了（警告 ${result.warnings.length} 件）: ${result.warnings.join(' / ')}`)
      }
      if (notifications.length > 0) {
        setNotification(notifications.join(' / '))
      }
      closeImportDialog()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF取込に失敗しました'
      setError(message)
      setStatus('PDF取込に失敗しました')
    } finally {
      setImportLoading(false)
    }
  }, [importPdfFile, importTemplateId, importVersion, importEngine, loadTemplateByPath, autoDetectTemplateElements, closeImportDialog])

  const refreshTemplatesList = useCallback(async (baseDir: string) => {
    setTemplatesError(null)

    try {
      // TODO: Template list retrieval should be routed via API-owned source selection
      // instead of client-side base-dir wiring. Keep UI base-dir omitted and migrate
      // this call path to server-configured template discovery.
      const result = await rpc.listTemplates(baseDir)
      setTemplatesList(result.templates)
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : 'Failed to load templates list')
      setTemplatesList([])
    }
  }, [])

  useEffect(() => {
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

  const handleDetect = useCallback(async () => {
    if (!template) return

    setDetectLoading(true)
    setError(null)
    setStatus('要素検出を実行中...')
    try {
      const detectResult = await autoDetectTemplateElements(templateDir, template)
      const detail = detectResult.pageSummaries.length > 0
        ? ` (${detectResult.pageSummaries.join(', ')})`
        : ''
      setStatus(`要素検出が完了しました: ${detectResult.totalDetected}件${detail}`)
      if (selectedSvg) {
        const currentPath = `${templateDir}/${selectedSvg}`
        const cached = detectedElementsCacheRef.current.get(getDetectCacheKey(currentPath))
        if (cached) {
          setSvgElements(cached)
        }
      }
      if (detectResult.failedPages.length > 0) {
        setNotification(`要素検出に失敗したページ: ${detectResult.failedPages.join(', ')}`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '要素検出に失敗しました'
      setError(message)
      setStatus('要素検出に失敗しました')
    } finally {
      setDetectLoading(false)
    }
  }, [template, templateDir, autoDetectTemplateElements, selectedSvg, getDetectCacheKey])

  const handleValidate = useCallback(async () => {
    if (!template) return
    
    setIsLoading(true)
    setError(null)
    setStatus('Validating template...')
    
    try {
      const result = await rpc.validate(templateDir)
      setValidationResult(result)
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
    const previewTab = window.open('', '_blank')
    
    try {
      const outputDir = `out/preview/${template.template.id}-${template.template.version}`
      const data = metaData || itemsData ? { meta: metaData ?? undefined, items: itemsData ?? undefined } : undefined
      const result = await rpc.preview(templateDir, outputDir, 'realistic', data)
      if (result.ok && result.output?.html) {
        if (previewTab) {
          previewTab.location.href = result.output.html
        } else {
          window.open(result.output.html, '_blank')
        }
        setStatus(`Preview generated: ${result.output?.pages.length || 0} pages`)
      } else {
        previewTab?.close()
        setStatus('Preview generation failed')
      }
    } catch (err) {
      previewTab?.close()
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

  const handleLoadDemoData = useCallback(async () => {
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1:8788'
    await handleMetaUrlLoad(`${origin}/mock/meta.json`)
    await handleItemsUrlLoad(`${origin}/mock/items.csv`)
  }, [handleMetaUrlLoad, handleItemsUrlLoad])

  const handleUpdateTemplateMeta = useCallback((patch: Partial<TemplateConfig['template']>) => {
    setTemplate((prev) => {
      if (!prev) return prev
      return { ...prev, template: { ...prev.template, ...patch } }
    })
  }, [])

  const handleUpdatePageGraph = useCallback((pageId: string, patch: Partial<PageConfig>) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => (page.id === pageId ? { ...page, ...patch } : page))
      return { ...prev, pages }
    })
    if (patch.id && selectedPageId === pageId) {
      setSelectedPageId(patch.id)
    }
  }, [selectedPageId])

  const handleUpdatePageNumberGraph = useCallback((pageId: string, patch: Partial<NonNullable<PageConfig['page_number']>>) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== pageId) return page
        const page_number = { ...(page.page_number || { svg_id: '' }), ...patch }
        if (!page_number.svg_id && !page_number.format) {
          const { page_number: _removed, ...rest } = page
          return rest as PageConfig
        }
        return { ...page, page_number }
      })
      return { ...prev, pages }
    })
  }, [])

  const handleRemoveHeaderCellGraph = useCallback((pageId: string, tableIndex: number, cellIndex: number) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== pageId) return page
        const tables = page.tables.map((table, idx) => {
          if (idx !== tableIndex || !table.header?.cells) return table
          const cells = table.header.cells.filter((_, i) => i !== cellIndex)
          return cells.length > 0 ? { ...table, header: { cells } } : { ...table, header: undefined }
        })
        return { ...page, tables }
      })
      return { ...prev, pages }
    })
  }, [])

  const handleUpdateBindingRefGraph = useCallback((
    ref: BindingRef,
    patch: Partial<FieldBinding> | Partial<TableCell>
  ) => {
    setTemplate((prev) => {
      if (!prev) return prev
      if (ref.kind === 'global-field') {
        const fields = prev.fields.map((field, index) =>
          index === ref.index ? { ...field, ...patch } : field
        )
        return { ...prev, fields }
      }
      const pages = prev.pages.map((page) => {
        if (page.id !== ref.pageId) return page
        if (ref.kind === 'page-field') {
          const fields = (page.fields ?? []).map((field, index) =>
            index === ref.index ? { ...field, ...patch } : field
          )
          return { ...page, fields }
        }
        if (ref.kind === 'table-header') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex || !table.header?.cells) return table
            const cells = table.header.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, ...patch } : cell
            )
            return { ...table, header: { cells } }
          })
          return { ...page, tables }
        }
        if (ref.kind === 'table-cell') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex) return table
            const cells = table.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, ...patch } : cell
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

  const handleRemoveBindingRefGraph = useCallback((ref: BindingRef) => {
    setTemplate((prev) => {
      if (!prev) return prev
      if (ref.kind === 'global-field') {
        return { ...prev, fields: prev.fields.filter((_, index) => index !== ref.index) }
      }
      const pages = prev.pages.map((page) => {
        if (page.id !== ref.pageId) return page
        if (ref.kind === 'page-field') {
          return { ...page, fields: (page.fields ?? []).filter((_, index) => index !== ref.index) }
        }
        if (ref.kind === 'table-header') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex || !table.header?.cells) return table
            const cells = table.header.cells.filter((_, cellIndex) => cellIndex !== ref.cellIndex)
            return cells.length > 0 ? { ...table, header: { cells } } : { ...table, header: undefined }
          })
          return { ...page, tables }
        }
        if (ref.kind === 'table-cell') {
          const tables = page.tables.map((table, tableIndex) =>
            tableIndex === ref.tableIndex
              ? { ...table, cells: table.cells.filter((_, cellIndex) => cellIndex !== ref.cellIndex) }
              : table
          )
          return { ...page, tables }
        }
        return page
      })
      return { ...prev, pages }
    })
  }, [])

  const handleAddFormatterGraph = useCallback(() => {
    setTemplate((prev) => {
      if (!prev) return prev
      const formatters = prev.formatters || {}
      const key = `formatter_${Object.keys(formatters).length + 1}`
      return { ...prev, formatters: { ...formatters, [key]: { kind: 'date' } } }
    })
  }, [])

  const handleUpdateFormatterGraph = useCallback((key: string, patch: FormatterDef) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const formatters = prev.formatters || {}
      return { ...prev, formatters: { ...formatters, [key]: { ...formatters[key], ...patch } } }
    })
  }, [])

  const handleRemoveFormatterGraph = useCallback((key: string) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const formatters = { ...(prev.formatters || {}) }
      delete formatters[key]
      return { ...prev, formatters }
    })
  }, [])

  const handleRenameFormatterGraph = useCallback((oldKey: string, newKey: string) => {
    const key = newKey.trim()
    if (!key || oldKey === key) return
    setTemplate((prev) => {
      if (!prev) return prev
      const formatters = prev.formatters || {}
      if (!formatters[oldKey] || formatters[key]) return prev
      const { [oldKey]: target, ...rest } = formatters
      return { ...prev, formatters: { ...rest, [key]: target } }
    })
  }, [])

  const handlePageSelect = useCallback(async (pageId: string) => {
    if (!template) return
    
    const page = template.pages.find(p => p.id === pageId)
    if (page) {
      setSelectedPageId(pageId)
      setSelectedSvg(page.svg)
    }
  }, [template])

  const applyReindexedSvgIds = useCallback((
    svgFile: string,
    mapping: Array<{ oldId: string | null; newId: string }>,
    duplicateOldIds: string[],
  ) => {
    if (!template) return
    const map = new Map<string, string>()
    for (const entry of mapping) {
      if (!entry.oldId) continue
      if (!map.has(entry.oldId)) {
        map.set(entry.oldId, entry.newId)
      }
    }
    const duplicates = new Set(duplicateOldIds)
    const validIds = new Set(mapping.map(entry => entry.newId))
    if (map.size === 0 && duplicates.size === 0 && validIds.size === 0) return

    setTemplate((prev) => {
      if (!prev) return prev
      let changed = false

      const remapSvgId = (svgId: string) => {
        if (duplicates.has(svgId)) {
          return { svgId: '', disabled: true, changed: true }
        }
        const next = map.get(svgId)
        if (next && next !== svgId) {
          return { svgId: next, changed: true }
        }
        if (svgId && !validIds.has(svgId)) {
          return { svgId: '', disabled: true, changed: true }
        }
        return null
      }

      const updateField = <T extends { svg_id: string; enabled?: boolean }>(field: T): T => {
        if (!field.svg_id) return field
        const remap = remapSvgId(field.svg_id)
        if (!remap) return field
        changed = true
        return remap.disabled
          ? { ...field, svg_id: '', enabled: false }
          : { ...field, svg_id: remap.svgId }
      }

      const updatePage = (page: TemplateConfig['pages'][number]) => {
        if (page.svg !== svgFile) return page
        let pageChanged = false
        const fields = (page.fields ?? []).map((field) => {
          const next = updateField(field)
          if (next !== field) pageChanged = true
          return next
        })

        const tables = page.tables.map((table) => {
          let tableChanged = false
          const header = table.header
            ? {
                cells: table.header.cells.map((cell) => {
                  const next = updateField(cell)
                  if (next !== cell) tableChanged = true
                  return next
                }),
              }
            : table.header
          const cells = table.cells.map((cell) => {
            const next = updateField(cell)
            if (next !== cell) tableChanged = true
            return next
          })
          if (!tableChanged) return table
          return { ...table, header, cells }
        })

        let pageNumber = page.page_number
        if (page.page_number?.svg_id) {
          const remap = remapSvgId(page.page_number.svg_id)
          if (remap) {
            pageChanged = true
            pageNumber = remap.disabled
              ? { ...page.page_number, svg_id: '' }
              : { ...page.page_number, svg_id: remap.svgId }
          }
        }

        if (!pageChanged) return page
        changed = true
        return { ...page, fields, tables, page_number: pageNumber }
      }

      const pages = prev.pages.map(updatePage)
      const fields = prev.fields.map((field) => updateField(field))

      if (!changed) return prev
      return { ...prev, pages, fields }
    })
  }, [template])

  const loadInspectText = useCallback(async (svgPath: string) => {
    try {
      const cacheKey = getDetectCacheKey(svgPath)
      const cached = detectedElementsCacheRef.current.get(cacheKey)
      if (cached) {
        setSvgElements(cached)
      }
      try {
        const reindex = await rpc.reindexSvgTextIds(svgPath, getSvgIdPrefix(svgPath))
        if (reindex.updated) {
          setSvgReloadToken((value) => value + 1)
        }
        if (reindex.mapping.length > 0) {
          const relativePath = svgPath.startsWith(`${templateDir}/`)
            ? svgPath.slice(templateDir.length + 1)
            : svgPath
          applyReindexedSvgIds(relativePath, reindex.mapping, reindex.duplicateOldIds)
        }
        if (reindex.duplicateOldIds.length > 0) {
          setNotification(`Duplicate text IDs detected. ${reindex.duplicateOldIds.length} bindings were set to unused.`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reindex text IDs'
        setNotification(message)
      }
      const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
      const dynamicTexts = selectDynamicElements(inspectResult.texts)
      detectedElementsCacheRef.current.set(cacheKey, dynamicTexts)
      setSvgElements(dynamicTexts)
      if (template) {
        const relativePath = svgPath.startsWith(`${templateDir}/`)
          ? svgPath.slice(templateDir.length + 1)
          : svgPath
        const validIds = new Set(dynamicTexts.map((text) => text.id).filter(Boolean) as string[])
        let rowGroupCellIds = new Map<string, string[]>()
        try {
          const svgResult = await rpc.readSvg(svgPath)
          const parser = new DOMParser()
          const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
          const idIndex = new Map<string, number>()
          let domOrder = 0
          for (const node of Array.from(doc.getElementsByTagName('*'))) {
            const id = node.getAttribute('id')
            if (!id) continue
            idIndex.set(id, domOrder)
            domOrder += 1
          }
          rowGroupCellIds = new Map(
            template.pages
              .filter((page) => page.svg === relativePath)
              .flatMap((page) => page.tables.map((table) => table.row_group_id))
              .filter(Boolean)
              .map((rowGroupId) => {
                const rowGroup = doc.querySelector?.(`#${rowGroupId}`) || null
                if (!rowGroup) return [rowGroupId, []] as const
                const ids = Array.from(rowGroup.getElementsByTagName('*'))
                  .map((node) => node.getAttribute('id'))
                  .filter((id): id is string => Boolean(id))
                  .filter((id) => validIds.has(id))
                  .sort((a, b) => (idIndex.get(a) ?? 0) - (idIndex.get(b) ?? 0))
                return [rowGroupId, Array.from(new Set(ids))] as const
              })
          )
        } catch {
          rowGroupCellIds = new Map()
        }
        const suggestedMap = new Map<string, string>()
        for (const text of dynamicTexts) {
          if (text.suggestedId && text.id && !suggestedMap.has(text.suggestedId)) {
            suggestedMap.set(text.suggestedId, text.id)
          }
        }
        const resolveSuggested = (value?: string | null) => {
          if (!value) return null
          const normalized = value.trim()
          if (!normalized) return null
          return suggestedMap.get(normalized) || null
        }
        const resolveByValue = (value?: { type: string; key?: string; text?: string }) => {
          if (!value) return null
          if (value.type === 'data') {
            return resolveSuggested(value.key || '')
          }
          if (value.type === 'static') {
            return resolveSuggested(value.text || '')
          }
          return null
        }

        const healTemplate = (current: TemplateConfig) => {
          let changed = false
          const fixBinding = <T extends { svg_id: string; enabled?: boolean; value?: { type: string; key?: string; text?: string } }>(binding: T): T => {
            if (binding.enabled === false) return binding
            const svgId = binding.svg_id
            if (svgId) {
              if (validIds.has(svgId)) return binding
              const remap = resolveSuggested(svgId)
              if (remap) {
                changed = true
                return { ...binding, svg_id: remap }
              }
              // Keep unresolved ids as-is to avoid destructive remaps while editing.
              return binding
            }
            if (binding.value) {
              const remap = resolveByValue(binding.value)
              if (remap) {
                changed = true
                return { ...binding, svg_id: remap, enabled: true }
              }
            }
            return binding
          }

          const pages = current.pages.map((page) => {
            if (page.svg !== relativePath) return page
            const fields = (page.fields ?? []).map((field) => fixBinding(field))
            const tables = page.tables.map((table) => {
              const rowGroupCandidates = rowGroupCellIds.get(table.row_group_id) || []
              const reserved = new Set<string>()
              for (const cell of table.cells) {
                if (cell.svg_id && validIds.has(cell.svg_id)) {
                  reserved.add(cell.svg_id)
                }
              }
              const assignByRowGroup = (
                binding: { svg_id: string; enabled?: boolean; value?: { type: string; key?: string; text?: string } },
                index: number,
              ) => {
                if (binding.enabled === false) return binding
                if (binding.svg_id && validIds.has(binding.svg_id)) return binding
                const preferred = rowGroupCandidates[index]
                if (preferred && !reserved.has(preferred)) {
                  reserved.add(preferred)
                  changed = true
                  return { ...binding, svg_id: preferred, enabled: true }
                }
                const fallback = rowGroupCandidates.find((id) => !reserved.has(id))
                if (fallback) {
                  reserved.add(fallback)
                  changed = true
                  return { ...binding, svg_id: fallback, enabled: true }
                }
                return fixBinding(binding)
              }
              const header = table.header
                ? { cells: table.header.cells.map((cell) => fixBinding(cell)) }
                : table.header
              const cells = table.cells.map((cell, index) => assignByRowGroup(cell, index))
              return { ...table, header, cells }
            })
            let pageNumber = page.page_number
            if (page.page_number?.svg_id) {
              const svgId = page.page_number.svg_id
              if (!validIds.has(svgId)) {
                const remap = resolveSuggested(svgId)
                if (remap) {
                  pageNumber = { ...page.page_number, svg_id: remap }
                  changed = true
                }
              }
            }
            return { ...page, fields, tables, page_number: pageNumber }
          })
          const fields = current.fields

          if (!changed) return { next: current, changed }
          return { next: { ...current, pages, fields }, changed }
        }

        const healed = healTemplate(template)
        if (healed.changed) {
          setTemplate(healed.next)
          try {
            await rpc.saveTemplate(templateDir, healed.next, false)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to save auto-healed template'
            setNotification(message)
          }
        }
      }
    } catch {
      detectedElementsCacheRef.current.delete(getDetectCacheKey(svgPath))
      setSvgElements([])
    }
  }, [applyReindexedSvgIds, templateDir, template, selectDynamicElements, getDetectCacheKey, getSvgIdPrefix])

  const handleSvgEdited = useCallback(async () => {
    if (!selectedSvg) return
    const svgPath = `${templateDir}/${selectedSvg}`
    setSvgReloadToken((value) => value + 1)
    await loadInspectText(svgPath)
  }, [selectedSvg, templateDir, loadInspectText])

  useEffect(() => {
    if (!selectedSvg) {
      setSvgElements([])
      return
    }

    setSelectedTextIndex(null)
    setSelectedText(null)
    setSelectedBindingSvgId(null)

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
    if (!template || !selectedSvg) return
    if (svgElements.length === 0) return
    if (autoFixIdsRef.current) return

    const svgPath = `${templateDir}/${selectedSvg}`
    const idToElements = new Map<string, TextElement[]>()
    const existingIds = new Set<string>()

    for (const element of svgElements) {
      if (!element.id) continue
      existingIds.add(element.id)
      const list = idToElements.get(element.id) || []
      list.push(element)
      idToElements.set(element.id, list)
    }

    const assignments: Array<{ selector: { byIndex: number }; id: string }> = []
    const usedIds = new Set(existingIds)
    const makeUnique = (base: string) => {
      let counter = 2
      let candidate = `${base}_${counter}`
      while (usedIds.has(candidate)) {
        counter += 1
        candidate = `${base}_${counter}`
      }
      usedIds.add(candidate)
      return candidate
    }

    for (const [id, list] of idToElements.entries()) {
      if (list.length <= 1) continue
      const sorted = [...list].sort((a, b) => {
        const aIndex = a.domIndex ?? a.index
        const bIndex = b.domIndex ?? b.index
        return aIndex - bIndex
      })
      for (let i = 1; i < sorted.length; i += 1) {
        const nextId = makeUnique(id)
        assignments.push({ selector: { byIndex: sorted[i].index }, id: nextId })
      }
    }

    const missingIds = new Set<string>()
    const currentPage = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : null
    const hasId = (value?: string | null) => Boolean(value && existingIds.has(value))

    if (currentPage) {
      if (currentPage.page_number?.svg_id && !hasId(currentPage.page_number.svg_id)) {
        missingIds.add(currentPage.page_number.svg_id)
      }
      for (const field of currentPage.fields ?? []) {
        if (field.svg_id && !hasId(field.svg_id)) missingIds.add(field.svg_id)
      }
      for (const table of currentPage.tables) {
        for (const cell of table.header?.cells ?? []) {
          if (cell.svg_id && !hasId(cell.svg_id)) missingIds.add(cell.svg_id)
        }
        for (const cell of table.cells) {
          if (cell.svg_id && !hasId(cell.svg_id)) missingIds.add(cell.svg_id)
        }
      }
    }

    if (assignments.length === 0 && missingIds.size === 0) return

    autoFixIdsRef.current = true
    const run = async () => {
      if (assignments.length > 0) {
        await rpc.setSvgIds(svgPath, assignments, { glyphSplitProfile: 'balanced' })
      }

      if (missingIds.size > 0) {
        setTemplate((prev) => {
          if (!prev) return prev
          const pageIndex = prev.pages.findIndex(p => p.id === selectedPageId)
          if (pageIndex < 0) return prev
          const pages = prev.pages.map((page, idx) => {
            if (idx !== pageIndex) return page
            const fields = (page.fields ?? []).map((field) =>
              missingIds.has(field.svg_id) ? { ...field, svg_id: '', enabled: false } : field
            )
            const tables = page.tables.map((table) => ({
              ...table,
              header: table.header
                ? {
                    cells: table.header.cells.map((cell) =>
                      missingIds.has(cell.svg_id) ? { ...cell, svg_id: '', enabled: false } : cell
                    ),
                  }
                : table.header,
              cells: table.cells.map((cell) =>
                missingIds.has(cell.svg_id) ? { ...cell, svg_id: '', enabled: false } : cell
              ),
            }))
            const pageNumber = page.page_number
              ? {
                  ...page.page_number,
                  svg_id: missingIds.has(page.page_number.svg_id) ? '' : page.page_number.svg_id,
                }
              : page.page_number
            return { ...page, fields, tables, page_number: pageNumber }
          })
          return { ...prev, pages }
        })
      }

      const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
      setSvgElements(inspectResult.texts)

      const parts: string[] = []
      if (assignments.length > 0) parts.push(`${assignments.length} duplicate IDs renamed`)
      if (missingIds.size > 0) parts.push(`${missingIds.size} missing bindings cleared`)
      if (parts.length > 0) setNotification(`Auto-fixed IDs: ${parts.join(', ')}`)
    }

    run()
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to auto-fix IDs'
        setNotification(message)
      })
      .finally(() => {
        autoFixIdsRef.current = false
      })
  }, [template, selectedSvg, selectedPageId, svgElements, templateDir])

  useEffect(() => {
    if (!template || !selectedPageId) return
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return
    if (page.svg !== selectedSvg) {
      setSelectedSvg(page.svg)
    }
  }, [template, selectedPageId, selectedSvg])

  useEffect(() => {
    saveSession({ templateDir, selectedPageId: selectedPageId || undefined })
  }, [templateDir, selectedPageId])

  const handleSelectTextElement = useCallback((index: number) => {
    const element = svgElements[index]
    if (!element) return
    setSelectedTextIndex(index)
    setSelectedText(element)
    setSelectedBindingSvgId(element.id || element.suggestedId || null)
  }, [svgElements])

  const clearBindingsBySvgId = useCallback((svgId: string) => {
    if (!svgId) return
    let found = false
    setTemplate((prev) => {
      if (!prev) return prev
      const fields = prev.fields.map((field) => {
        if (field.svg_id === svgId) {
          found = true
          return { ...field, enabled: false }
        }
        return field
      })
      const pages = prev.pages.map((page) => {
        let pageFound = false
        const pageFields = (page.fields ?? []).map((field) => {
          if (field.svg_id === svgId) {
            pageFound = true
            found = true
            return { ...field, enabled: false }
          }
          return field
        })
        const tables = page.tables.map((table) => {
          const headerCells = table.header?.cells
            ? table.header.cells.map((cell) => {
              if (cell.svg_id === svgId) {
                found = true
                return { ...cell, enabled: false }
              }
              return cell
            })
            : undefined
          const cells = table.cells.map((cell) => {
            if (cell.svg_id === svgId) {
              found = true
              return { ...cell, enabled: false }
            }
            return cell
          })
          return { ...table, header: headerCells ? { cells: headerCells } : table.header, cells }
        })

        if (!found && selectedPageId && page.id === selectedPageId && !pageFound) {
          if (!pageFields.some((field) => field.svg_id === svgId)) {
            pageFields.push({ svg_id: svgId, value: makeStaticValue(''), enabled: false })
            found = true
          }
        }

        return { ...page, fields: pageFields, tables }
      })
      return { ...prev, fields, pages }
    })
    if (selectedBindingSvgId === svgId) {
      setSelectedBindingSvgId(null)
    }
    setNotification('Binding set to unused.')
  }, [selectedBindingSvgId, selectedPageId])

  const updateBindingSvgId = useCallback((ref: BindingRef, svgId: string) => {
    setTemplate((prev) => {
      if (!prev) return prev
      if (ref.kind === 'global-field') {
        const fields = prev.fields.map((field, index) =>
          index === ref.index ? { ...field, svg_id: svgId, enabled: true } : field
        )
        return { ...prev, fields }
      }
      const pages = prev.pages.map((page) => {
        if (page.id !== ref.pageId) return page
        if (ref.kind === 'page-field') {
          const fields = (page.fields ?? []).map((field, index) =>
            index === ref.index ? { ...field, svg_id: svgId, enabled: true } : field
          )
          return { ...page, fields }
        }
        if (ref.kind === 'table-header') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex) return table
            if (!table.header?.cells) return table
            const cells = table.header.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, svg_id: svgId, enabled: true } : cell
            )
            return { ...table, header: { cells } }
          })
          return { ...page, tables }
        }
        if (ref.kind === 'table-cell') {
          const tables = page.tables.map((table, tableIndex) => {
            if (tableIndex !== ref.tableIndex) return table
            const cells = table.cells.map((cell, cellIndex) =>
              cellIndex === ref.cellIndex ? { ...cell, svg_id: svgId, enabled: true } : cell
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

  const getUniqueSvgId = useCallback((desired: string, excludeIndex?: number | null) => {
    const base = desired.trim()
    if (!base) return ''
    const existing = new Set<string>()
    for (const el of svgElements) {
      if (!el.id) continue
      if (excludeIndex !== undefined && excludeIndex !== null && el.index === excludeIndex) continue
      existing.add(el.id)
    }
    if (!existing.has(base)) return base
    let counter = 2
    let candidate = `${base}_${counter}`
    while (existing.has(candidate)) {
      counter += 1
      candidate = `${base}_${counter}`
    }
    return candidate
  }, [svgElements])

  const ensureSvgIdForElement = useCallback(async (
    element: TextElement,
    preferredBase?: string,
    forceUnique: boolean = false,
  ): Promise<string | null> => {
    if (!selectedSvg) return null
    if (element.id) {
      if (!forceUnique) return element.id
      const duplicated = svgElements.some((el) => el.id === element.id && el.index !== element.index)
      if (!duplicated) return element.id
      const base = preferredBase || element.id
      const candidate = getUniqueSvgId(base, element.index)
      const svgPath = `${templateDir}/${selectedSvg}`
      try {
        await rpc.setSvgIds(svgPath, [
          { selector: { byIndex: element.index }, id: candidate },
        ], { glyphSplitProfile: 'balanced' })
        setSvgReloadToken((value) => value + 1)
        const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
        setSvgElements(inspectResult.texts)
        const nextIndex = inspectResult.texts.findIndex(t => t.index === element.index)
        if (nextIndex >= 0) {
          setSelectedTextIndex(nextIndex)
          setSelectedText(inspectResult.texts[nextIndex])
        }
        setNotification(`ID duplicated. Using ${candidate}.`)
        return candidate
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign ID'
        setNotification(message)
        return null
      }
    }
    if (!element.suggestedId) {
      const sanitize = (value: string) => value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
      const base = sanitize(preferredBase || 'auto') || 'auto'
      const candidate = getUniqueSvgId(`${base}_${element.index}`, element.index)
      const svgPath = `${templateDir}/${selectedSvg}`
      try {
        await rpc.setSvgIds(svgPath, [
          { selector: { byIndex: element.index }, id: candidate },
        ], { glyphSplitProfile: 'balanced' })
        const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
        setSvgElements(inspectResult.texts)
        const nextIndex = inspectResult.texts.findIndex(t => t.index === element.index)
        if (nextIndex >= 0) {
          setSelectedTextIndex(nextIndex)
          setSelectedText(inspectResult.texts[nextIndex])
        }
        return candidate
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to assign ID'
        setNotification(message)
        return null
      }
    }
    const svgPath = `${templateDir}/${selectedSvg}`
    try {
      const uniqueId = getUniqueSvgId(element.suggestedId, element.index)
      await rpc.setSvgIds(svgPath, [
        { selector: { byIndex: element.index }, id: uniqueId },
      ], { glyphSplitProfile: 'balanced' })
      setSvgReloadToken((value) => value + 1)
      const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
      setSvgElements(inspectResult.texts)
      const nextIndex = inspectResult.texts.findIndex(t => t.index === element.index)
      if (nextIndex >= 0) {
        setSelectedTextIndex(nextIndex)
        setSelectedText(inspectResult.texts[nextIndex])
      }
      if (uniqueId !== element.suggestedId) {
        setNotification(`ID duplicated. Using ${uniqueId}.`)
      }
      return uniqueId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign ID'
      setNotification(message)
      return null
    }
  }, [selectedSvg, templateDir, svgElements, getUniqueSvgId])

  const ensureFitLabelForElement = useCallback(async (element: TextElement, svgId?: string | null) => {
    if (!selectedSvg) return
    const targetId = svgId ?? element.id
    if (!targetId) return
    const svgPath = `${templateDir}/${selectedSvg}`
    try {
      const svgResult = await rpc.readSvg(svgPath)
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      const targetNode = nodes.find((node) => node.getAttribute('id') === targetId) || null
      if (!targetNode) return
      if (targetNode.getAttribute('data-fit-label')) return
      const targetClass = targetNode.getAttribute('class') || ''
      if (targetClass.split(/\s+/).includes('label')) return

      const targetElement = svgElementsById.get(targetId) || element
      const targetBBox = targetElement?.bbox
      if (!targetBBox) return

      const targetCenterX = targetBBox.x + targetBBox.w / 2
      const targetCenterY = targetBBox.y + targetBBox.h / 2
      let best: { id: string; score: number } | null = null

      for (const node of nodes) {
        const id = node.getAttribute('id')
        if (!id || id === targetId) continue
        const className = node.getAttribute('class') || ''
        if (!className.split(/\s+/).includes('label')) continue
        const labelElement = svgElementsById.get(id)
        if (!labelElement) continue
        const bbox = labelElement.bbox
        const labelCenterX = bbox.x + bbox.w / 2
        const labelCenterY = bbox.y + bbox.h / 2
        if (labelCenterX > targetCenterX + 4) continue
        const dy = Math.abs(labelCenterY - targetCenterY)
        const dx = Math.abs(targetCenterX - labelCenterX)
        const score = dy * 2 + dx * 0.5
        if (!best || score < best.score) {
          best = { id, score }
        }
      }

      if (!best) return
      await rpc.setSvgAttrs(svgPath, [
        { id: targetId, attrs: { 'data-fit-label': best.id } },
      ])
      setSvgReloadToken((value) => value + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to auto-assign label'
      setNotification(message)
    }
  }, [selectedSvg, templateDir, svgElementsById])

  const ensureFitAttrsForElement = useCallback(async (element: TextElement, svgId?: string | null) => {
    if (!selectedSvg) return
    const targetId = svgId ?? element.id
    if (!targetId) return
    const svgPath = `${templateDir}/${selectedSvg}`
    try {
      const svgResult = await rpc.readSvg(svgPath)
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      const targetNode = nodes.find((node) => node.getAttribute('id') === targetId) || null
      if (!targetNode) return

      const updates: Record<string, string> = {}
      const hasFitWidth = targetNode.hasAttribute('data-fit-width')
      const hasFitLines = targetNode.hasAttribute('data-fit-lines')

      if (!hasFitWidth) {
        const targetElement = svgElementsById.get(targetId) || element
        const width = Math.max(12, Math.round(Math.max(1, targetElement.bbox.w) * 10) / 10)
        updates['data-fit-width'] = String(width)
      }
      if (!hasFitLines) {
        updates['data-fit-lines'] = '1'
      }

      if (Object.keys(updates).length === 0) return
      await rpc.setSvgAttrs(svgPath, [
        { id: targetId, attrs: updates },
      ])
      setSvgReloadToken((value) => value + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to auto-assign fit attrs'
      setNotification(message)
    }
  }, [selectedSvg, templateDir, svgElementsById])

  const normalizeRowGroupsForPage = useCallback(async (templateSnapshot: TemplateConfig, pageId: string) => {
    if (!selectedSvg) return null
    if (autoFixTableRef.current) return null

    const page = templateSnapshot.pages.find(p => p.id === pageId)
    if (!page) return null

    const svgPath = `${templateDir}/${selectedSvg}`
    autoFixTableRef.current = true
    try {
      const svgResult = await rpc.readSvg(svgPath)
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
      const svg = doc.documentElement
      if (!svg) return null

      const existingIds = new Set<string>()
      const allElements = Array.from(svg.getElementsByTagName('*'))
      for (const el of allElements) {
        const id = el.getAttribute('id')
        if (id) existingIds.add(id)
      }

      const makeUniqueId = (base: string) => {
        let candidate = base
        let counter = 2
        while (existingIds.has(candidate)) {
          candidate = `${base}_${counter}`
          counter += 1
        }
        existingIds.add(candidate)
        return candidate
      }

      let updatedSvg = false
      const rowGroupUpdates = new Map<number, string>()

      for (const [tableIndex, table] of page.tables.entries()) {
        const cellIds = table.cells.map(cell => cell.svg_id).filter(Boolean)

        let firstCell: Element | null = null
        if (cellIds.length > 0) {
          const firstCellId = cellIds.find(id => Boolean(id))
          if (firstCellId) {
            const resolved = doc.getElementById(firstCellId)
            if (resolved && resolved.parentNode) {
              firstCell = resolved
            }
          }
        }

        const targetParent = (firstCell?.parentNode as Element) || svg
        let rowGroupId = (table.row_group_id || '').trim()
        if (!rowGroupId) {
          rowGroupId = makeUniqueId(`table_${tableIndex + 1}_rows`)
        }

        let rowGroup = doc.getElementById(rowGroupId) as Element | null
        const validRowGroup = rowGroup && rowGroup.tagName.toLowerCase() === 'g'
        if (!validRowGroup) {
          const nextId = makeUniqueId(rowGroupId || `table_${tableIndex + 1}_rows`)
          rowGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
          rowGroup.setAttribute('id', nextId)
          if (firstCell) {
            targetParent.insertBefore(rowGroup, firstCell)
          } else {
            targetParent.appendChild(rowGroup)
          }
          rowGroupId = nextId
          rowGroupUpdates.set(tableIndex, rowGroupId)
          updatedSvg = true

          // Preserve existing valid row groups to avoid destructive reparenting while binding.
          // Only migrate cells when the row group is missing/invalid and we had to create one.
          for (const cellId of cellIds) {
            const cellEl = doc.getElementById(cellId)
            if (!cellEl) continue
            if (cellEl.parentNode !== rowGroup) {
              rowGroup?.appendChild(cellEl)
              updatedSvg = true
            }
          }
        }
      }

      if (updatedSvg) {
        const serializer = new XMLSerializer()
        const updatedContent = serializer.serializeToString(doc)
        await rpc.writeSvg(svgPath, updatedContent)
        setSvgReloadToken((value) => value + 1)
      }

      return { updatedSvg, rowGroupUpdates }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to normalize table row groups'
      setNotification(message)
      return null
    } finally {
      autoFixTableRef.current = false
    }
  }, [selectedSvg, templateDir])

  useEffect(() => {
    if (!template || !selectedSvg || !selectedPageId) return
    if (svgElements.length === 0) return
    if (autoFixTableRef.current) return

    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page || page.tables.length === 0) return

    const svgPath = `${templateDir}/${selectedSvg}`
    const run = async () => {
      const result = await normalizeRowGroupsForPage(template, selectedPageId)
      if (!result) return
      if (result.rowGroupUpdates.size > 0) {
        setTemplate((prev) => {
          if (!prev) return prev
          const pages = prev.pages.map((p) => {
            if (p.id !== selectedPageId) return p
            const tables = p.tables.map((table, index) => {
              const nextId = result.rowGroupUpdates.get(index)
              if (!nextId || nextId === table.row_group_id) return table
              return { ...table, row_group_id: nextId }
            })
            return { ...p, tables }
          })
          return { ...prev, pages }
        })
      }
      if (result.updatedSvg) {
        const inspectResult = await rpc.inspectText(svgPath, { glyphSplitProfile: 'balanced' })
        setSvgElements(inspectResult.texts)
        setNotification('Auto-fixed table row groups.')
      }
    }

    run().catch((err) => {
      const message = err instanceof Error ? err.message : 'Failed to auto-fix table groups'
      setNotification(message)
    })
  }, [template, selectedSvg, selectedPageId, svgElements, templateDir, normalizeRowGroupsForPage])

  const handleDropBindingOnElement = useCallback(async (ref: BindingRef, element: TextElement) => {
    if (!template) return
    const targetId = await ensureSvgIdForElement(element)
    if (!targetId) return
    void ensureFitAttrsForElement(element, targetId)
    updateBindingSvgId(ref, targetId)
    setSelectedBindingSvgId(targetId)
    if (ref.kind === 'global-field' || ref.kind === 'page-field') {
      void ensureFitLabelForElement(element, targetId)
    }
  }, [template, ensureSvgIdForElement, ensureFitAttrsForElement, updateBindingSvgId, ensureFitLabelForElement])


  const bindingSvgIds = useMemo(() => {
    if (!template) return []
    const ids = new Set<string>()

    // Global fields
    for (const field of template.fields) {
      if (field.enabled === false) continue
      if (field.svg_id) ids.add(field.svg_id)
    }

    // Current page bindings (tables/cells/page_number)
    const page = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : undefined
    if (page?.page_number?.svg_id) ids.add(page.page_number.svg_id)
    if (page?.fields) {
      for (const field of page.fields) {
        if (field.enabled === false) continue
        if (field.svg_id) ids.add(field.svg_id)
      }
    }
    if (page) {
      for (const table of page.tables) {
        if (table.header?.cells) {
          for (const cell of table.header.cells) {
            if (cell.enabled === false) continue
            if (cell.svg_id) ids.add(cell.svg_id)
          }
        }
        for (const cell of table.cells) {
          if (cell.enabled === false) continue
          if (cell.svg_id) ids.add(cell.svg_id)
        }
      }
    }

    return Array.from(ids)
  }, [template, selectedPageId])

  useEffect(() => {
    if (!template || !selectedSvg) return
    if (bindingSvgIds.length === 0) return
    if (svgElements.length === 0) return

    const page = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : undefined
    const tableSvgIds = new Set<string>()
    if (page) {
      for (const table of page.tables) {
        if (table.header?.cells) {
          for (const cell of table.header.cells) {
            if (cell.svg_id) tableSvgIds.add(cell.svg_id)
          }
        }
        for (const cell of table.cells) {
          if (cell.svg_id) tableSvgIds.add(cell.svg_id)
        }
      }
    }

    const run = async () => {
      const svgPath = `${templateDir}/${selectedSvg}`
      const svgResult = await rpc.readSvg(svgPath)
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      const nodeById = new Map<string, Element>()
      const labelCandidates: Array<{ id: string; bbox: TextElement['bbox'] }> = []

      for (const node of nodes) {
        const id = node.getAttribute('id')
        if (!id) continue
        nodeById.set(id, node)
        const className = node.getAttribute('class') || ''
        if (className.split(/\s+/).includes('label')) {
          const labelEl = svgElementsById.get(id)
          if (labelEl) {
            labelCandidates.push({ id, bbox: labelEl.bbox })
          }
        }
      }

      if (labelCandidates.length === 0) return

      const assignments: Array<{ id: string; attrs: Record<string, string> }> = []

      for (const svgId of bindingSvgIds) {
        if (tableSvgIds.has(svgId)) continue
        const node = nodeById.get(svgId)
        if (!node) continue
        if (node.getAttribute('data-fit-label')) continue
        const className = node.getAttribute('class') || ''
        if (className.split(/\s+/).includes('label')) continue

        const element = svgElementsById.get(svgId)
        if (!element) continue
        const bbox = element.bbox
        const targetCenterX = bbox.x + bbox.w / 2
        const targetCenterY = bbox.y + bbox.h / 2
        let best: { id: string; score: number } | null = null

        for (const label of labelCandidates) {
          const labelCenterX = label.bbox.x + label.bbox.w / 2
          const labelCenterY = label.bbox.y + label.bbox.h / 2
          if (labelCenterX > targetCenterX + 4) continue
          const dy = Math.abs(labelCenterY - targetCenterY)
          const dx = Math.abs(targetCenterX - labelCenterX)
          const score = dy * 2 + dx * 0.5
          if (!best || score < best.score) {
            best = { id: label.id, score }
          }
        }

        if (best) {
          assignments.push({ id: svgId, attrs: { 'data-fit-label': best.id } })
        }
      }

      if (assignments.length === 0) return
      await rpc.setSvgAttrs(svgPath, assignments)
      setSvgReloadToken((value) => value + 1)
    }

    run().catch((err) => {
      const message = err instanceof Error ? err.message : 'Failed to auto-assign labels'
      setNotification(message)
    })
  }, [template, selectedSvg, selectedPageId, bindingSvgIds, svgElements, svgElementsById, templateDir])

  useEffect(() => {
    if (!template || !selectedSvg) return
    if (bindingSvgIds.length === 0) return

    const run = async () => {
      const svgPath = `${templateDir}/${selectedSvg}`
      const svgResult = await rpc.readSvg(svgPath)
      const parser = new DOMParser()
      const doc = parser.parseFromString(svgResult.svg, 'image/svg+xml')
      const nodes = Array.from(doc.getElementsByTagName('*'))
      const nodeById = new Map<string, Element>()
      for (const node of nodes) {
        const id = node.getAttribute('id')
        if (!id) continue
        nodeById.set(id, node)
      }

      const assignments: Array<{ id: string; attrs: Record<string, string> }> = []
      for (const svgId of bindingSvgIds) {
        const node = nodeById.get(svgId)
        if (!node) continue
        const attrs: Record<string, string> = {}
        if (!node.hasAttribute('data-fit-width')) {
          const el = svgElementsById.get(svgId)
          if (el?.bbox?.w) {
            const width = Math.max(12, Math.round(Math.max(1, el.bbox.w) * 10) / 10)
            attrs['data-fit-width'] = String(width)
          }
        }
        if (!node.hasAttribute('data-fit-lines')) {
          attrs['data-fit-lines'] = '1'
        }
        if (Object.keys(attrs).length > 0) {
          assignments.push({ id: svgId, attrs })
        }
      }
      if (assignments.length === 0) return
      await rpc.setSvgAttrs(svgPath, assignments)
      setSvgReloadToken((value) => value + 1)
    }

    run().catch((err) => {
      const message = err instanceof Error ? err.message : 'Failed to auto-assign fit attrs'
      setNotification(message)
    })
  }, [template, selectedSvg, bindingSvgIds, svgElementsById, templateDir])

  const handleUpdateTableGraph = useCallback((pageId: string, tableIndex: number, patch: Partial<TableBinding>) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== pageId) return page
        const tables = page.tables.map((table, idx) => idx === tableIndex ? { ...table, ...patch } : table)
        return { ...page, tables }
      })
      return { ...prev, pages }
    })
  }, [])

  const handleMapDataToSvg = useCallback(async (dataRef: DataKeyRef, element: TextElement) => {
    if (!template || !selectedPageId) return
    if (dataRef.source === 'unused') {
      const svgId = await ensureSvgIdForElement(element, 'unused', true)
      if (!svgId) {
        setNotification('Selected element has no id to unbind.')
        return
      }
      clearBindingsBySvgId(svgId)
      setSelectedBindingSvgId(svgId)
      return
    }
    const base = dataRef.source === 'static'
      ? `static_${dataRef.key}`
      : `${dataRef.source}_${dataRef.key}`
    const svgId = await ensureSvgIdForElement(element, base)
    if (!svgId) return
    void ensureFitAttrsForElement(element, svgId)
    if (dataRef.source !== 'items') {
      void ensureFitLabelForElement(element, svgId)
    }
    let nextTemplate: TemplateConfig | null = null
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== selectedPageId) return page
        if (dataRef.source === 'items') {
          const tableIndex = graphTableIndex
          if (!page.tables[tableIndex]) return page
          const table = page.tables[tableIndex]
          const value = makeDataValue(table.source || 'items', dataRef.key)
          if (graphItemsTarget === 'header') {
            const headerCells = table.header?.cells ? [...table.header.cells] : []
            const existing = headerCells.findIndex(cell => cell.svg_id === svgId)
            const nextCell = existing >= 0
              ? { ...headerCells[existing], svg_id: svgId, value, enabled: true }
              : { svg_id: svgId, value, enabled: true }
            if (existing >= 0) headerCells[existing] = nextCell
            else headerCells.push(nextCell)
            const nextTable = { ...table, header: { cells: headerCells } }
            const tables = page.tables.map((t, idx) => idx === tableIndex ? nextTable : t)
            return { ...page, tables }
          }

          const cells = [...table.cells]
          const existing = cells.findIndex(cell => cell.svg_id === svgId)
          const nextCell = existing >= 0
            ? { ...cells[existing], svg_id: svgId, value, enabled: true }
            : { svg_id: svgId, value, enabled: true }
          if (existing >= 0) cells[existing] = nextCell
          else cells.push(nextCell)
          const nextTable = { ...table, cells }
          const tables = page.tables.map((t, idx) => idx === tableIndex ? nextTable : t)
          return { ...page, tables }
        }

        const value = dataRef.source === 'static'
          ? makeStaticValue(dataRef.key)
          : makeDataValue('meta', dataRef.key)

        if (graphMetaScope === 'global') {
          return page
        }

        const fields = [...(page.fields ?? [])]
        const existing = fields.findIndex(field => field.svg_id === svgId)
        const nextField = existing >= 0
          ? { ...fields[existing], svg_id: svgId, value, enabled: true }
          : { svg_id: svgId, value, enabled: true }
        if (existing >= 0) fields[existing] = nextField
        else fields.push(nextField)
        return { ...page, fields }
      })

      if (dataRef.source !== 'items' && graphMetaScope === 'global') {
        const value = dataRef.source === 'static'
          ? makeStaticValue(dataRef.key)
          : makeDataValue('meta', dataRef.key)
        const fields = [...prev.fields]
        const existing = fields.findIndex(field => field.svg_id === svgId)
        const nextField = existing >= 0
          ? { ...fields[existing], svg_id: svgId, value, enabled: true }
          : { svg_id: svgId, value, enabled: true }
        if (existing >= 0) fields[existing] = nextField
        else fields.push(nextField)
        nextTemplate = { ...prev, fields, pages }
        return nextTemplate
      }

      nextTemplate = { ...prev, pages }
      return nextTemplate
    })

    if (dataRef.source === 'items' && graphItemsTarget !== 'header' && nextTemplate) {
      const result = await normalizeRowGroupsForPage(nextTemplate, selectedPageId)
      if (result?.rowGroupUpdates.size) {
        setTemplate((prev) => {
          if (!prev) return prev
          const pages = prev.pages.map((page) => {
            if (page.id !== selectedPageId) return page
            const tables = page.tables.map((table, index) => {
              const nextId = result.rowGroupUpdates.get(index)
              if (!nextId || nextId === table.row_group_id) return table
              return { ...table, row_group_id: nextId }
            })
            return { ...page, tables }
          })
          return { ...prev, pages }
        })
      }
      if (result?.updatedSvg) {
        const inspectResult = await rpc.inspectText(`${templateDir}/${selectedSvg}`, { glyphSplitProfile: 'balanced' })
        setSvgElements(inspectResult.texts)
      }
    }

    setSelectedBindingSvgId(svgId)
    setNotification(`Mapped ${dataRef.source}.${dataRef.key}`)
  }, [template, selectedPageId, ensureSvgIdForElement, ensureFitAttrsForElement, ensureFitLabelForElement, graphItemsTarget, graphMetaScope, graphTableIndex, normalizeRowGroupsForPage, selectedSvg, templateDir, clearBindingsBySvgId])

  const handleUnbindSvgId = useCallback(async (svgId: string) => {
    if (!svgId) return
    const element = (selectedText && (selectedText.id === svgId || selectedText.suggestedId === svgId))
      ? selectedText
      : (svgElements.find((el) => el.id === svgId || el.suggestedId === svgId) || null)
    if (element) {
      const ensured = await ensureSvgIdForElement(element, 'unused', true)
      if (ensured) {
        clearBindingsBySvgId(ensured)
        setSelectedBindingSvgId(ensured)
        return
      }
    }
    clearBindingsBySvgId(svgId)
  }, [svgElements, selectedText, ensureSvgIdForElement, clearBindingsBySvgId])

  const handleUnuseElements = useCallback(async (elementsToUnuse: TextElement[]) => {
    if (elementsToUnuse.length === 0) return
    let lastSvgId: string | null = null
    let updated = 0
    for (const element of elementsToUnuse) {
      const ensured = await ensureSvgIdForElement(element, 'unused', true)
      if (!ensured) continue
      clearBindingsBySvgId(ensured)
      lastSvgId = ensured
      updated += 1
    }
    if (lastSvgId) {
      setSelectedBindingSvgId(lastSvgId)
    }
    if (updated === 0) {
      setNotification('Selected elements have no id to unbind.')
      return
    }
    setNotification(`Set ${updated} element(s) to unused.`)
  }, [ensureSvgIdForElement, clearBindingsBySvgId])

  const handleRemoveGraphBinding = useCallback((connection: { key: string; svgId: string }) => {
    const ref = decodeDataKeyRef(connection.key)
    if (!ref || !template || !selectedPageId) return

    const matchesValue = (
      value: { type: string; source?: string; key?: string; text?: string },
      tableSource?: string
    ) => {
      if (ref.source === 'static') {
        return value.type === 'static' && value.text === ref.key
      }
      if (value.type !== 'data') return false
      if (ref.source === 'items') {
        if (tableSource) {
          return value.key === ref.key && value.source === tableSource
        }
        return value.key === ref.key && value.source === 'items'
      }
      return value.key === ref.key && value.source !== 'items'
    }

    setTemplate((prev) => {
      if (!prev) return prev
      const svgId = connection.svgId

    const fields = prev.fields.map((field) => {
      if (field.svg_id === svgId && matchesValue(field.value)) {
        return { ...field, svg_id: '', enabled: false }
      }
      return field
    })

      const pages = prev.pages.map((page) => {
        if (page.id !== selectedPageId) return page
        const pageFields = (page.fields ?? []).map((field) => {
          if (field.svg_id === svgId && matchesValue(field.value)) {
            return { ...field, svg_id: '', enabled: false }
          }
          return field
        })

        const tables = page.tables.map((table) => {
          const headerCells = table.header?.cells
            ? table.header.cells.map((cell) => {
              if (cell.svg_id === svgId && matchesValue(cell.value, table.source)) {
                return { ...cell, svg_id: '', enabled: false }
              }
              return cell
            })
            : undefined
          const cells = table.cells.map((cell) => {
            if (cell.svg_id === svgId && matchesValue(cell.value, table.source)) {
              return { ...cell, svg_id: '', enabled: false }
            }
            return cell
          })
          return {
            ...table,
            header: headerCells ? { cells: headerCells } : table.header,
            cells,
          }
        })
        return { ...page, fields: pageFields, tables }
      })

      return { ...prev, fields, pages }
    })

    if (selectedBindingSvgId === connection.svgId) {
      setSelectedBindingSvgId(null)
    }
    setNotification('Binding removed.')
  }, [template, selectedPageId, selectedBindingSvgId])

  const handleAutoSetPageNumber = useCallback((pageId: string, svgId: string, includeTotal: boolean) => {
    if (!template || !svgId) return
    const format = includeTotal ? '{current}/{total}' : '{current}'
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== pageId) return page
        return {
          ...page,
          page_number: {
            ...(page.page_number || { svg_id: '' }),
            svg_id: svgId,
            format,
          },
        }
      })
      return { ...prev, pages }
    })
    setSelectedBindingSvgId(svgId)
    setNotification(`Page number auto-set (${includeTotal ? 'with total' : 'current only'}).`)
  }, [template])

  const tableBindingGroups = useMemo(() => {
    if (!template || !selectedPageId) return []
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return []
    return page.tables.map((table, index) => ({
      id: `table-${index + 1}`,
      cellSvgIds: table.cells
        .filter(cell => cell.enabled !== false)
        .map(cell => cell.svg_id)
        .filter(Boolean),
    }))
  }, [template, selectedPageId])

  const tableOverlayConfigs = useMemo(() => {
    if (!template || !selectedPageId) return []
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return []
    return page.tables.map((table) => ({
      rowsPerPage: Number.isFinite(table.rows_per_page) ? table.rows_per_page : 1,
      rowHeightMm: Number.isFinite(table.row_height_mm) ? table.row_height_mm : 6,
    }))
  }, [template, selectedPageId])

  const graphConnections = useMemo(() => {
    if (!template || !selectedPageId) return []
    const page = template.pages.find(p => p.id === selectedPageId)
    if (!page) return []
    const svgIdSet = new Set<string>()
    for (const el of svgElements) {
      if (el.id) svgIdSet.add(el.id)
      if (el.suggestedId) svgIdSet.add(el.suggestedId)
    }
    const includeSvgId = (svgId?: string) => {
      if (!svgId) return false
      if (svgIdSet.size === 0) return true
      return svgIdSet.has(svgId)
    }

    const connections: Array<{ key: string; svgId: string; tableIndex?: number }> = []

    const addConnection = (
      ref: DataKeyRef | null,
      svgId?: string,
      tableIndex?: number,
      overrideSvgId?: string
    ) => {
      const targetId = overrideSvgId ?? svgId
      if (!ref || !includeSvgId(targetId)) return
      connections.push({ key: encodeDataKeyRef(ref), svgId: targetId!, tableIndex })
    }

    const toDataRef = (
      value: { type: string; source?: string; key?: string; text?: string },
      fallbackSource?: string
    ): DataKeyRef | null => {
      if (value.type === 'data') {
        if (!value.key) return null
        const source = value.source || fallbackSource || 'meta'
        const normalized: DataKeyRef['source'] = source === 'items' ? 'items' : 'meta'
        return { source: normalized, key: value.key }
      }
      if (value.type === 'static') {
        if (!value.text) return null
        return { source: 'static', key: value.text }
      }
      return null
    }

    for (const field of template.fields) {
      if (field.enabled === false) {
        addConnection({ source: 'unused', key: 'unused' }, field.svg_id, undefined, field.svg_id)
        continue
      }
      addConnection(toDataRef(field.value), field.svg_id)
    }

    for (const field of page.fields ?? []) {
      if (field.enabled === false) {
        addConnection({ source: 'unused', key: 'unused' }, field.svg_id, undefined, field.svg_id)
        continue
      }
      addConnection(toDataRef(field.value), field.svg_id)
    }

    for (const [tableIndex, table] of page.tables.entries()) {
      for (const cell of table.header?.cells ?? []) {
        if (cell.enabled === false) {
          addConnection({ source: 'unused', key: 'unused' }, cell.svg_id, tableIndex, cell.svg_id)
          continue
        }
        addConnection(toDataRef(cell.value, table.source || 'items'), cell.svg_id, tableIndex)
      }
      for (const cell of table.cells) {
        if (cell.enabled === false) {
          addConnection({ source: 'unused', key: 'unused' }, cell.svg_id, tableIndex, cell.svg_id)
          continue
        }
        addConnection(toDataRef(cell.value, table.source || 'items'), cell.svg_id, tableIndex)
      }
    }

    return connections
  }, [template, selectedPageId, svgElements])

  const graphNodes = useMemo(() => {
    type Node = { key: string; ref: DataKeyRef; label: string; type: DataKeyRef['source']; missing: boolean; status?: 'error' | 'warning' }
    const nodes = new Map<string, Node>()
    const hasLoadedData = Boolean(metaData || itemsData)

    const addNode = (ref: DataKeyRef, label: string, missing: boolean, status?: 'error' | 'warning') => {
      const key = encodeDataKeyRef(ref)
      if (!nodes.has(key)) {
        nodes.set(key, { key, ref, label, type: ref.source, missing, status })
      } else if (status && nodes.get(key)?.status !== 'error') {
        nodes.set(key, { ...nodes.get(key)!, status })
      }
    }

    const hasMetaData = Boolean(metaData)
    const hasItemsData = Boolean(itemsData?.headers && itemsData.headers.length > 0)
    const missingFor = (ref: DataKeyRef) => {
      if (ref.source === 'meta') {
        if (!hasMetaData) return false
        return !(metaData && ref.key in metaData)
      }
      if (ref.source === 'items') {
        if (!hasItemsData) return false
        return !(itemsData?.headers ?? []).includes(ref.key)
      }
      return false
    }

    if (hasLoadedData) {
      if (metaData) {
        for (const key of Object.keys(metaData)) {
          addNode({ source: 'meta', key }, key, false)
        }
      }

      if (itemsData?.headers) {
        for (const key of itemsData.headers) {
          addNode({ source: 'items', key }, key, false)
        }
      }

      if (template) {
        const toDataRef = (value: { type: string; source?: string; key?: string }, fallbackSource?: string): DataKeyRef | null => {
          if (value.type !== 'data' || !value.key) return null
          const source = value.source || fallbackSource || 'meta'
          const normalized: DataKeyRef['source'] = source === 'items' ? 'items' : 'meta'
          return { source: normalized, key: value.key }
        }

        for (const field of template.fields) {
          if (field.enabled === false) continue
          const ref = toDataRef(field.value)
          if (ref) addNode(ref, ref.key, missingFor(ref))
        }

        const page = template.pages.find(p => p.id === selectedPageId)
        if (page) {
          for (const field of page.fields ?? []) {
            if (field.enabled === false) continue
            const ref = toDataRef(field.value)
            if (ref) addNode(ref, ref.key, missingFor(ref))
          }
          for (const table of page.tables ?? []) {
            for (const cell of table.header?.cells ?? []) {
              if (cell.enabled === false) continue
              const ref = toDataRef(cell.value, table.source || 'items')
              if (ref) addNode(ref, ref.key, missingFor(ref))
            }
            for (const cell of table.cells ?? []) {
              if (cell.enabled === false) continue
              const ref = toDataRef(cell.value, table.source || 'items')
              if (ref) addNode(ref, ref.key, missingFor(ref))
            }
          }
        }
      }

      const staticValues = new Set<string>()
      if (template) {
        for (const field of template.fields) {
          if (field.enabled === false) continue
          if (field.value.type === 'static' && field.value.text) staticValues.add(field.value.text)
        }
        const page = template.pages.find(p => p.id === selectedPageId)
        if (page) {
          for (const field of page.fields ?? []) {
            if (field.enabled === false) continue
            if (field.value.type === 'static' && field.value.text) staticValues.add(field.value.text)
          }
          for (const table of page.tables ?? []) {
            for (const cell of table.header?.cells ?? []) {
              if (cell.enabled === false) continue
              if (cell.value.type === 'static' && cell.value.text) staticValues.add(cell.value.text)
            }
            for (const cell of table.cells ?? []) {
              if (cell.enabled === false) continue
              if (cell.value.type === 'static' && cell.value.text) staticValues.add(cell.value.text)
            }
          }
        }
      }
      for (const text of staticValues) {
        addNode({ source: 'static', key: text }, text, false)
      }
    }

    const errorKeys = new Set<string>()
    const warningKeys = new Set<string>()
    if (validationResult) {
      for (const err of validationResult.errors) {
        if (selectedSvg && err.file && err.file !== selectedSvg) continue
        const ref = resolveDataKeyFromValidationError(template, selectedPageId, err)
        if (ref) errorKeys.add(encodeDataKeyRef(ref))
      }
      for (const warn of validationResult.warnings) {
        if (typeof warn !== 'string') continue
        const ref = resolveDataKeyFromPathForTemplate(template, selectedPageId, warn)
        if (ref) warningKeys.add(encodeDataKeyRef(ref))
      }
    }

    if (hasLoadedData) {
      for (const connection of graphConnections) {
        if (nodes.has(connection.key)) continue
        const ref = decodeDataKeyRef(connection.key) || { source: 'meta', key: connection.key }
        if (ref.source === 'meta' && !metaData) continue
        if (ref.source === 'items' && !itemsData?.headers) continue
        const status = errorKeys.has(encodeDataKeyRef(ref))
          ? 'error'
          : warningKeys.has(encodeDataKeyRef(ref))
            ? 'warning'
            : undefined
        addNode(ref, ref.key, true, status)
      }
    }

    for (const [key, node] of nodes.entries()) {
      const status = errorKeys.has(key) ? 'error' : warningKeys.has(key) ? 'warning' : node.status
      if (status && node.status !== 'error') {
        nodes.set(key, { ...node, status })
      }
    }

    const typeOrder: Record<DataKeyRef['source'], number> = { meta: 0, items: 1, static: 2, unused: 3 }
    const unusedRef: DataKeyRef = { source: 'unused', key: 'unused' }
    const unusedKey = encodeDataKeyRef(unusedRef)
    if (!nodes.has(unusedKey)) {
      nodes.set(unusedKey, {
        key: unusedKey,
        ref: unusedRef,
        label: 'Unused',
        type: 'unused',
        missing: false,
      })
    }

    return Array.from(nodes.values()).sort((a, b) => {
      const typeDelta = typeOrder[a.type] - typeOrder[b.type]
      if (typeDelta !== 0) return typeDelta
      return a.label.localeCompare(b.label)
    })
  }, [metaData, itemsData, template, selectedPageId, graphConnections, validationResult, selectedSvg])



  const focusFromValidationPath = useCallback((path: string) => {
    if (!path) {
      setNotification('This validation error does not include a jump path. Please read the message.')
      return
    }

    const normalized = normalizeValidationPath(path)
    if (!normalized) {
      const svgId = path.trim()
      if (svgId) {
        const ref = resolveDataKeyFromSvgId(template, selectedPageId, svgId)
        if (ref) {
          setSelectedBindingSvgId(svgId)
          return
        }
      }
      const suffix = path ? ` (path: ${path})` : ''
      setNotification(`This validation error is not auto-jumpable. Please read the message.${suffix}`)
      return
    }
    const svgId = resolveSvgIdFromPathForTemplate(template, selectedPageId, path)
    if (svgId) setSelectedBindingSvgId(svgId)
  }, [template, selectedPageId])

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

  const unmappedValidationErrors = useMemo(() => {
    if (!validationResult || !template) return []
    return validationResult.errors.filter((err) => {
      const path = err.path || ''
      const normalized = path ? normalizeValidationPath(path) : ''
      const hasMapping =
        Boolean(path && resolveSvgIdFromPathForTemplate(template, null, path))
        || Boolean(path && resolveDataKeyFromPathForTemplate(template, null, path))
        || Boolean(path && resolveDataKeyFromSvgId(template, null, path))
        || Boolean(resolveDataKeyFromValidationError(template, selectedPageId, err))
      if (hasMapping) return false
      return !normalized
    })
  }, [validationResult, template, selectedPageId])

  const validationSvgIds = useMemo(() => {
    if (!validationResult || !template) return []
    const ids = new Set<string>()
    for (const err of validationResult.errors) {
      if (selectedSvg && err.file && err.file !== selectedSvg) continue
      let svgId = resolveSvgIdFromPathForTemplate(template, selectedPageId, err.path || '')
      if (!svgId && err.path) svgId = err.path
      if (svgId) ids.add(svgId)
    }
    return Array.from(ids)
  }, [validationResult, template, selectedPageId, selectedSvg])

  const validationWarningSvgIds = useMemo(() => {
    if (!validationResult || !template) return []
    const ids = new Set<string>()
    for (const warn of validationResult.warnings) {
      if (typeof warn !== 'string') continue
      const svgId = resolveSvgIdFromPathForTemplate(template, selectedPageId, warn)
      if (svgId) ids.add(svgId)
    }
    return Array.from(ids)
  }, [validationResult, template, selectedPageId])

  useEffect(() => {
    if (!validationResult) return
    setValidationGroupsOpen({
      pages: groupedValidationErrors.pages.length > 0,
      fields: groupedValidationErrors.fields.length > 0,
      formatters: groupedValidationErrors.formatters.length > 0,
      other: groupedValidationErrors.other.length > 0,
    })
  }, [validationResult, groupedValidationErrors])

  useEffect(() => {
    if (!validationResult || !template) return
    for (const err of unmappedValidationErrors) {
      const path = err.path || '(missing path)'
      const logKey = `${err.code}:${path}`
      if (validationPathLogRef.current.has(logKey)) continue
      validationPathLogRef.current.add(logKey)
      console.warn('[validation] Unmapped path', {
        code: err.code,
        path,
        file: err.file,
        message: err.message,
      })
    }
  }, [validationResult, template, unmappedValidationErrors])

  const templatesBarPage = useMemo(() => {
    if (!template) return null
    if (selectedPageId) {
      return template.pages.find((p) => p.id === selectedPageId) || template.pages[0] || null
    }
    return template.pages[0] || null
  }, [template, selectedPageId])

  return (
    <div className="app">
      <header className="app-header">
        <h1>SVG Paper - 帳票テンプレートエディタ</h1>
        <div className="template-path">
          <input
            type="text"
            value={templateDir}
            onChange={(e) => setTemplateDir((e.target as HTMLInputElement).value)}
            placeholder="テンプレートディレクトリ"
          />
          <button onClick={handleLoad} disabled={isLoading}>読込</button>
          <button className="btn-reset" onClick={handleResetSession}>セッション初期化</button>
        </div>
      </header>

      <div className="templates-bar">
        {template ? (
          <div className="templates-bar-left">
            <div className="templates-bar-meta-fields">
              <label>Template ID</label>
              <input
                type="text"
                value={template.template.id}
                onChange={(e) => handleUpdateTemplateMeta({ id: (e.target as HTMLInputElement).value })}
              />
              <label>Version</label>
              <input
                type="text"
                value={template.template.version}
                onChange={(e) => handleUpdateTemplateMeta({ version: (e.target as HTMLInputElement).value })}
              />
              <label>Schema</label>
              <input type="text" value={template.schema} disabled />

              {templatesBarPage ? (
                <>
                  <label>Page ID</label>
                  <input
                    type="text"
                    value={templatesBarPage.id}
                    onChange={(e) => handleUpdatePageGraph(templatesBarPage.id, { id: (e.target as HTMLInputElement).value })}
                  />
                  <label>SVG</label>
                  <input
                    type="text"
                    value={templatesBarPage.svg}
                    onChange={(e) => handleUpdatePageGraph(templatesBarPage.id, { svg: (e.target as HTMLInputElement).value })}
                  />
                  <label>Kind</label>
                  <select
                    value={templatesBarPage.kind}
                    onChange={(e) => handleUpdatePageGraph(templatesBarPage.id, { kind: (e.target as HTMLSelectElement).value as PageConfig['kind'] })}
                  >
                    <option value="first">first</option>
                    <option value="repeat">repeat</option>
                  </select>
                </>
              ) : null}
            </div>

          </div>
        ) : null}

        <div className="templates-bar-right">
          <div className="templates-actions">
            <button
              onClick={openImportDialog}
              disabled={isLoading || importLoading || detectLoading}
              className="btn-primary"
            >
              PDF取込
            </button>
            <button
              onClick={handleDetect}
              disabled={!template || isLoading || detectLoading || importLoading}
              className="btn-primary"
            >
              {detectLoading ? '検出中...' : '検出'}
            </button>
            <button
              onClick={handleSave}
              disabled={!template || isLoading || detectLoading}
              className="btn-primary"
            >
              {isLoading ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleValidate}
              disabled={!template || isLoading || detectLoading}
              className="btn-secondary"
            >
              検証
            </button>
            <button
              onClick={handlePreview}
              disabled={!template || isLoading || detectLoading}
              className="btn-secondary"
            >
              プレビュー
            </button>
          </div>
          {templatesError ? <span className="templates-error">{templatesError}</span> : null}
        </div>
      </div>

      <main className="app-main">
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {template ? (
          <div className="graph-pane">
            <GraphEditor
              template={template}
              selectedPageId={selectedPageId}
              metaData={metaData}
              itemsData={itemsData}
              metaFileName={metaFileName}
              itemsFileName={itemsFileName}
              dataError={dataError}
              dataLoading={dataLoading}
              onLoadDemoData={handleLoadDemoData}
              onMetaUpload={handleMetaUpload}
              onItemsUpload={handleItemsUpload}
              onMetaUrlLoad={handleMetaUrlLoad}
              onItemsUrlLoad={handleItemsUrlLoad}
              onClearMeta={clearMetaData}
              onClearItems={clearItemsData}
              metaScope={graphMetaScope}
              onMetaScopeChange={setGraphMetaScope}
              itemsTarget={graphItemsTarget}
              onItemsTargetChange={setGraphItemsTarget}
              activeTableIndex={graphTableIndex}
              onActiveTableIndexChange={setGraphTableIndex}
              onUpdateTable={handleUpdateTableGraph}
              selectedSvgId={selectedBindingSvgId}
              onSelectBindingSvgId={setSelectedBindingSvgId}
              onUnbindSvgId={handleUnbindSvgId}
              onAutoSetPageNumber={handleAutoSetPageNumber}
              onUpdatePageNumber={handleUpdatePageNumberGraph}
              onRemoveHeaderCell={handleRemoveHeaderCellGraph}
              onUpdateBinding={handleUpdateBindingRefGraph}
              onRemoveBinding={handleRemoveBindingRefGraph}
              onAddFormatter={handleAddFormatterGraph}
              onUpdateFormatter={handleUpdateFormatterGraph}
              onRemoveFormatter={handleRemoveFormatterGraph}
              onRenameFormatter={handleRenameFormatterGraph}
            />
            <div className="graph-preview-pane">
              <SvgViewer
                pageTabs={(
                  <div className="templates-bar-page-tabs" role="tablist" aria-label="Pages">
                    {template.pages.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`templates-page-tab ${templatesBarPage?.id === p.id ? 'active' : ''}`}
                        onClick={() => handlePageSelect(p.id)}
                      >
                        <span>{p.id}</span>
                        <span className="templates-page-kind">{p.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
                svgPath={selectedSvg ? `${templateDir}/${selectedSvg}` : null}
                svgReloadToken={svgReloadToken}
                elements={svgElements}
                templateDir={templateDir}
                bindingSvgIds={bindingSvgIds}
                tableBindingGroups={tableBindingGroups}
                tableConfigs={tableOverlayConfigs}
                selectedElementIndex={selectedTextIndex}
                highlightedBindingSvgId={selectedBindingSvgId}
                onSelectElement={handleSelectTextElement}
                onDropBinding={handleDropBindingOnElement}
                onDropData={handleMapDataToSvg}
                graphMapNodes={graphNodes}
                graphConnections={graphConnections}
                tableEditTargetIndex={graphEditTableIndex}
                validationSvgIds={validationSvgIds}
                validationWarningSvgIds={validationWarningSvgIds}
                onRemoveGraphBinding={handleRemoveGraphBinding}
                onUnuseElements={handleUnuseElements}
                onSvgEdited={handleSvgEdited}
                onCreateTableFromSelection={async (_rect, hitElements) => {
                    if (!template || !selectedPageId) return
                    const page = template.pages.find(p => p.id === selectedPageId)
                    if (!page) return
                    const filtered = hitElements.filter(el => el)
                    if (filtered.length === 0) {
                      setNotification('No elements found inside selection.')
                      return
                    }

                    const sorted = [...filtered].sort((a, b) => {
                      const ab = (a.bbox.x + a.bbox.w / 2) - (b.bbox.x + b.bbox.w / 2)
                      if (Math.abs(ab) > 1) return ab
                      return (a.bbox.y + a.bbox.h / 2) - (b.bbox.y + b.bbox.h / 2)
                    })

                    const cells: Array<{ svg_id: string; enabled: boolean; value: { type: 'static'; text: string } }> = []
                    for (const [index, el] of sorted.entries()) {
                      const svgId = await ensureSvgIdForElement(el, `cell_${index + 1}`)
                      if (!svgId) continue
                      void ensureFitAttrsForElement(el, svgId)
                      cells.push({
                        svg_id: svgId,
                        enabled: true,
                        value: makeStaticValue(''),
                      })
                    }

                    if (cells.length === 0) {
                      setNotification('No SVG IDs resolved for table selection.')
                      return
                    }

                    const usedIds = new Set(page.tables.map(t => t.row_group_id).filter(Boolean))
                    const base = `table_${page.tables.length + 1}_rows`
                    let rowGroupId = base
                    let counter = 2
                    while (usedIds.has(rowGroupId)) {
                      rowGroupId = `${base}_${counter}`
                      counter += 1
                    }

                    let nextTemplate: TemplateConfig | null = null
                    setTemplate((prev) => {
                      if (!prev) return prev
                      const pages = prev.pages.map((p) => {
                        if (p.id !== selectedPageId) return p
                        if (graphEditTableIndex !== null && p.tables[graphEditTableIndex]) {
                          const tables = p.tables.map((table, idx) =>
                            idx === graphEditTableIndex
                              ? { ...table, cells, row_group_id: table.row_group_id || rowGroupId }
                              : table
                          )
                          return { ...p, tables }
                        }
                        const nextTable = {
                          source: 'items',
                          row_group_id: rowGroupId,
                          row_height_mm: 6,
                          rows_per_page: 10,
                          cells,
                        }
                        return { ...p, tables: [...p.tables, nextTable] }
                      })
                      nextTemplate = { ...prev, pages }
                      return nextTemplate
                    })

                    if (nextTemplate) {
                      const result = await normalizeRowGroupsForPage(nextTemplate, selectedPageId)
                      if (result?.rowGroupUpdates.size) {
                        setTemplate((prev) => {
                          if (!prev) return prev
                          const pages = prev.pages.map((p) => {
                            if (p.id !== selectedPageId) return p
                            const tables = p.tables.map((table, index) => {
                              const nextId = result.rowGroupUpdates.get(index)
                              if (!nextId || nextId === table.row_group_id) return table
                              return { ...table, row_group_id: nextId }
                            })
                            return { ...p, tables }
                          })
                          return { ...prev, pages }
                        })
                      }
                      if (result?.updatedSvg) {
                        const inspectResult = await rpc.inspectText(`${templateDir}/${selectedSvg}`, { glyphSplitProfile: 'balanced' })
                        setSvgElements(inspectResult.texts)
                      }
                    }

                    if (graphEditTableIndex !== null) {
                      setNotification(`Updated Table #${graphEditTableIndex + 1} with ${cells.length} cells.`)
                      setGraphEditTableIndex(null)
                    } else {
                      setNotification(`Added table from ${cells.length} elements.`)
                    }
                  }}
                />
            </div>
          </div>
        ) : (
          <div className="welcome">
            <h2>帳票テンプレートエディタ</h2>
            <p>テンプレートディレクトリを入力して「読込」を押してください。</p>
            <p>例: <code>test-templates/delivery-slip/v1</code></p>
            <div className="templates-panel">
              <h3>テンプレート一覧</h3>
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
              {unmappedValidationErrors.length > 0 && (
                <div className="validation-unmapped">
                  <p className="warning">
                    ⚠ {unmappedValidationErrors.length} unmapped paths (see console)
                  </p>
                  <ul>
                    {unmappedValidationErrors.map((err, i) => (
                      <li key={`unmapped-${i}`}>
                        <code>{err.path || '(missing path)'}</code> — {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

      {importDialogOpen && (
        <div className="modal-backdrop" onClick={closeImportDialog}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>PDFから帳票テンプレートを作成</h3>
            <div className="modal-row">
              <label>テンプレートID</label>
              <input
                type="text"
                value={importTemplateId}
                onChange={(e) => {
                  setImportTemplateId((e.target as HTMLInputElement).value)
                  setImportTemplateIdTouched(true)
                }}
                placeholder="invoice"
              />
            </div>
            <div className="modal-row">
              <label>バージョン</label>
              <input
                type="text"
                value={importVersion}
                onChange={(e) => {
                  setImportVersion((e.target as HTMLInputElement).value)
                  setImportVersionTouched(true)
                }}
                placeholder="v1"
              />
            </div>
            <div className="modal-row">
              <label>変換エンジン</label>
              <select
                value={importEngine}
                onChange={(e) => setImportEngine((e.target as HTMLSelectElement).value as 'auto' | 'pdf2svg' | 'inkscape')}
              >
                <option value="auto">auto</option>
                <option value="pdf2svg">pdf2svg</option>
                <option value="inkscape">inkscape</option>
              </select>
            </div>
            <div className="modal-row">
              <label>PDFファイル</label>
              <label className="btn-secondary graph-upload-button">
                ファイル選択
                <input type="file" accept="application/pdf,.pdf" onChange={handleImportPdfFileChange} />
              </label>
              {importPdfFile ? <span className="modal-file-name">{importPdfFile.name}</span> : null}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={closeImportDialog} disabled={importLoading}>
                キャンセル
              </button>
              <button className="btn-primary" onClick={handleImportTemplate} disabled={importLoading}>
                {importLoading ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
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

function resolveSvgIdFromPathForTemplate(
  template: TemplateConfig | null,
  selectedPageId: string | null,
  path: string
): string | null {
  if (!template) return null
  const normalized = normalizeValidationPath(path)
  if (!normalized) return null
  const tokens = parsePathTokens(normalized)
  if (!tokens || tokens.length === 0) return null

  const token0 = tokens[0]
  if (token0.type !== 'key') return null

  const getPageByIndex = (index: number) => template.pages[index]

  if (token0.value === 'fields') {
    const indexToken = tokens[1]
    if (!indexToken || indexToken.type !== 'index') return null
    const field = template.fields[indexToken.value]
    return field?.svg_id ?? null
  }

  if (token0.value !== 'pages') return null
  const pageIndexToken = tokens[1]
  if (!pageIndexToken || pageIndexToken.type !== 'index') return null
  const page = getPageByIndex(pageIndexToken.value)
  if (!page) return null
  if (selectedPageId && page.id !== selectedPageId) return null

  const section = tokens[2]
  if (!section || section.type !== 'key') return null

  if (section.value === 'page_number') {
    return page.page_number?.svg_id ?? null
  }

  if (section.value === 'fields') {
    const fieldIndex = tokens[3]
    if (!fieldIndex || fieldIndex.type !== 'index') return null
    return page.fields?.[fieldIndex.value]?.svg_id ?? null
  }

  if (section.value !== 'tables') return null
  const tableIndex = tokens[3]
  if (!tableIndex || tableIndex.type !== 'index') return null
  const table = page.tables[tableIndex.value]
  if (!table) return null

  const next = tokens[4]
  if (!next || next.type !== 'key') return null

  if (next.value === 'cells') {
    const cellIndex = tokens[5]
    if (!cellIndex || cellIndex.type !== 'index') return null
    return table.cells[cellIndex.value]?.svg_id ?? null
  }

  if (next.value === 'header') {
    const headerCellsKey = tokens[5]
    const cellIndex = tokens[6]
    if (!headerCellsKey || headerCellsKey.type !== 'key' || headerCellsKey.value !== 'cells') return null
    if (!cellIndex || cellIndex.type !== 'index') return null
    return table.header?.cells?.[cellIndex.value]?.svg_id ?? null
  }

  return null
}

function resolveDataKeyFromPathForTemplate(
  template: TemplateConfig | null,
  selectedPageId: string | null,
  path: string
): { source: 'meta' | 'items' | 'static'; key: string } | null {
  if (!template) return null
  const normalized = normalizeValidationPath(path)
  if (!normalized) return null
  const tokens = parsePathTokens(normalized)
  if (!tokens || tokens.length === 0) return null

  const token0 = tokens[0]
  if (token0.type !== 'key') return null

  const getValueBinding = (
    value?: { type: string; source?: string; key?: string; text?: string }
  ): { source: 'meta' | 'items' | 'static'; key: string } | null => {
    if (!value) return null
    if (value.type === 'data' && value.key) {
      const source: 'meta' | 'items' = value.source === 'items' ? 'items' : 'meta'
      return { source, key: value.key }
    }
    if (value.type === 'static' && value.text) {
      return { source: 'static', key: value.text }
    }
    return null
  }

  const getPageByIndex = (index: number) => template.pages[index]

  if (token0.value === 'fields') {
    const indexToken = tokens[1]
    if (!indexToken || indexToken.type !== 'index') return null
    const field = template.fields[indexToken.value]
    return getValueBinding(field?.value)
  }

  if (token0.value !== 'pages') return null
  const pageIndexToken = tokens[1]
  if (!pageIndexToken || pageIndexToken.type !== 'index') return null
  const page = getPageByIndex(pageIndexToken.value)
  if (!page) return null
  if (selectedPageId && page.id !== selectedPageId) return null

  const section = tokens[2]
  if (!section || section.type !== 'key') return null

  if (section.value === 'page_number') {
    return null
  }

  if (section.value === 'fields') {
    const fieldIndex = tokens[3]
    if (!fieldIndex || fieldIndex.type !== 'index') return null
    return getValueBinding(page.fields?.[fieldIndex.value]?.value)
  }

  if (section.value !== 'tables') return null
  const tableIndex = tokens[3]
  if (!tableIndex || tableIndex.type !== 'index') return null
  const table = page.tables[tableIndex.value]
  if (!table) return null

  const next = tokens[4]
  if (!next || next.type !== 'key') return null

  if (next.value === 'cells') {
    const cellIndex = tokens[5]
    if (!cellIndex || cellIndex.type !== 'index') return null
    return getValueBinding(table.cells[cellIndex.value]?.value)
  }

  if (next.value === 'header') {
    const headerCellsKey = tokens[5]
    const cellIndex = tokens[6]
    if (!headerCellsKey || headerCellsKey.type !== 'key' || headerCellsKey.value !== 'cells') return null
    if (!cellIndex || cellIndex.type !== 'index') return null
    return getValueBinding(table.header?.cells?.[cellIndex.value]?.value)
  }

  return null
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

function resolveDataKeyFromSvgId(
  template: TemplateConfig | null,
  selectedPageId: string | null,
  svgId: string
): DataKeyRef | null {
  if (!template) return null
  const id = svgId?.trim()
  if (!id) return null

  const toDataRef = (value: { type: string; source?: string; key?: string; text?: string }, fallbackSource?: string): DataKeyRef | null => {
    if (value.type === 'data') {
      if (!value.key) return null
      const source = value.source || fallbackSource || 'meta'
      const normalized: DataKeyRef['source'] = source === 'items' ? 'items' : 'meta'
      return { source: normalized, key: value.key }
    }
    if (value.type === 'static') {
      if (!value.text) return null
      return { source: 'static', key: value.text }
    }
    return null
  }

  for (const field of template.fields) {
    if (field.svg_id === id) {
      return toDataRef(field.value)
    }
  }

  const page = selectedPageId ? template.pages.find(p => p.id === selectedPageId) : null
  if (!page) return null

  for (const field of page.fields ?? []) {
    if (field.svg_id === id) {
      return toDataRef(field.value)
    }
  }

  for (const table of page.tables) {
    for (const cell of table.header?.cells ?? []) {
      if (cell.svg_id === id) {
        return toDataRef(cell.value, table.source || 'items')
      }
    }
    for (const cell of table.cells) {
      if (cell.svg_id === id) {
        return toDataRef(cell.value, table.source || 'items')
      }
    }
  }

  return null
}

function resolveDataKeyFromValidationError(
  template: TemplateConfig | null,
  selectedPageId: string | null,
  err: ValidationError
): DataKeyRef | null {
  if (!err) return null
  const fromPath = resolveDataKeyFromPathForTemplate(template, selectedPageId, err.path || '')
  if (fromPath) return fromPath
  const fromSvgId = resolveDataKeyFromSvgId(template, selectedPageId, err.path || '')
  if (fromSvgId) return fromSvgId

  const message = err.message || ''
  const match = message.match(/value:\s*([a-zA-Z_]+)\s*:\s*([^)\\s]+)/)
  if (!match) return null
  const source = match[1].toLowerCase()
  const key = match[2]
  if (source === 'meta' || source === 'items') {
    return { source: source as DataKeyRef['source'], key }
  }
  if (source === 'static') {
    return { source: 'static', key }
  }
  return null
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

function suggestTemplateIdFromFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim().toLowerCase()
  const normalized = base
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return normalized || 'template'
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function loadSession(): { templateDir?: string; selectedPageId?: string } {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem('svgpaper.session')
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { templateDir?: string; selectedPageId?: string }
    return parsed || {}
  } catch {
    return {}
  }
}

function saveSession(data: { templateDir?: string; selectedPageId?: string }) {
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
