import { useState, useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import type {
  TemplateConfig,
  TextElement,
  ValidationResponse,
  ValidationError,
  PreviewResponse,
  TemplateListItem,
  KVData,
  TableData,
  TableBinding,
  FieldBinding,
  TableCell,
  ValueBinding,
} from './types/api'
import type { BindingRef } from './types/binding'
import { rpc } from './lib/rpc'
import { TemplateEditor } from './components/TemplateEditor'
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
  const [editorMode, setEditorMode] = useState<'graph' | 'legacy'>('graph')
  const [graphMetaScope, setGraphMetaScope] = useState<'page' | 'global'>('page')
  const [graphItemsTarget, setGraphItemsTarget] = useState<'body' | 'header'>('body')
  const [graphTableIndex, setGraphTableIndex] = useState(0)
  const [graphEditTableIndex, setGraphEditTableIndex] = useState<number | null>(null)
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
  const autoFixIdsRef = useRef(false)
  const autoFixTableRef = useRef(false)
  const validationPathLogRef = useRef(new Set<string>())
  const [svgReloadToken, setSvgReloadToken] = useState(0)

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

  const handleLoadDemoData = useCallback(async () => {
    const origin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://127.0.0.1:8788'
    await handleMetaUrlLoad(`${origin}/mock/meta.json`)
    await handleItemsUrlLoad(`${origin}/mock/items.csv`)
  }, [handleMetaUrlLoad, handleItemsUrlLoad])

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
      try {
        const reindex = await rpc.reindexSvgTextIds(svgPath, 'text_')
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
          setNotification(`Duplicate text IDs detected. ${reindex.duplicateOldIds.length} bindings were set to unbound.`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reindex text IDs'
        setNotification(message)
      }
      const inspectResult = await rpc.inspectText(svgPath)
      setSvgElements(inspectResult.texts)
      if (template) {
        const relativePath = svgPath.startsWith(`${templateDir}/`)
          ? svgPath.slice(templateDir.length + 1)
          : svgPath
        const validIds = new Set(inspectResult.texts.map((text) => text.id).filter(Boolean) as string[])
        const suggestedMap = new Map<string, string>()
        for (const text of inspectResult.texts) {
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
              changed = true
              return { ...binding, svg_id: '', enabled: false }
            }
            if (binding.value) {
              const remap = resolveByValue(binding.value)
              if (remap) {
                changed = true
                return { ...binding, svg_id: remap, enabled: true }
              }
            }
            // No svg_id and no auto match: keep unbound to avoid validation errors.
            changed = true
            return { ...binding, svg_id: '', enabled: false }
          }

          const pages = current.pages.map((page) => {
            if (page.svg !== relativePath) return page
            const fields = (page.fields ?? []).map((field) => fixBinding(field))
            const tables = page.tables.map((table) => {
              const header = table.header
                ? { cells: table.header.cells.map((cell) => fixBinding(cell)) }
                : table.header
              const cells = table.cells.map((cell) => fixBinding(cell))
              return { ...table, header, cells }
            })
            let pageNumber = page.page_number
            if (page.page_number?.svg_id) {
              const svgId = page.page_number.svg_id
              if (!validIds.has(svgId)) {
                const remap = resolveSuggested(svgId)
                pageNumber = remap
                  ? { ...page.page_number, svg_id: remap }
                  : { ...page.page_number, svg_id: '' }
                changed = true
              }
            }
            return { ...page, fields, tables, page_number: pageNumber }
          })

          const fields = current.fields.map((field) => fixBinding(field))

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
      setSvgElements([])
    }
  }, [applyReindexedSvgIds, templateDir, template])

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
        await rpc.setSvgIds(svgPath, assignments)
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

      const inspectResult = await rpc.inspectText(svgPath)
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
    setNotification('Binding set to unbound.')
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
        ])
        setSvgReloadToken((value) => value + 1)
        const inspectResult = await rpc.inspectText(svgPath)
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
        ])
        const inspectResult = await rpc.inspectText(svgPath)
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
      ])
      setSvgReloadToken((value) => value + 1)
      const inspectResult = await rpc.inspectText(svgPath)
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
        } else if (firstCell && rowGroup && !rowGroup.contains(firstCell)) {
          const nextId = makeUniqueId(rowGroupId || `table_${tableIndex + 1}_rows`)
          rowGroup = doc.createElementNS('http://www.w3.org/2000/svg', 'g')
          rowGroup.setAttribute('id', nextId)
          targetParent.insertBefore(rowGroup, firstCell)
          rowGroupId = nextId
          rowGroupUpdates.set(tableIndex, rowGroupId)
          updatedSvg = true
        }

        for (const cellId of cellIds) {
          const cellEl = doc.getElementById(cellId)
          if (!cellEl) continue
          if (cellEl.parentNode !== rowGroup) {
            rowGroup?.appendChild(cellEl)
            updatedSvg = true
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
        const inspectResult = await rpc.inspectText(svgPath)
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
    updateBindingSvgId(ref, targetId)
    setSelectedBindingRef(ref)
    setSelectedBindingSvgId(targetId)
    if (ref.kind === 'global-field' || ref.kind === 'page-field') {
      void ensureFitLabelForElement(element, targetId)
    }
  }, [template, ensureSvgIdForElement, updateBindingSvgId, ensureFitLabelForElement])

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
    const desired = pendingId.trim()
    const uniqueId = getUniqueSvgId(desired, selectedText.index)

    try {
      await rpc.setSvgIds(svgPath, [
        { selector: { byIndex: selectedText.index }, id: uniqueId },
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

      if (uniqueId !== desired) {
        setPendingId(uniqueId)
        setNotification(`ID duplicated. Using ${uniqueId}.`)
      }
      setStatus('ID applied successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to apply ID'
      setError(message)
      setStatus('Error applying ID')
    } finally {
      setIsLoading(false)
    }
  }, [pendingId, selectedText, selectedSvg, templateDir, getUniqueSvgId])

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

  const handleAddTableGraph = useCallback((pageId: string) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const page = prev.pages.find(p => p.id === pageId)
      const usedIds = new Set((page?.tables ?? []).map(t => t.row_group_id).filter(Boolean))
      const base = `table_${(page?.tables.length ?? 0) + 1}_rows`
      let rowGroupId = base
      let counter = 2
      while (usedIds.has(rowGroupId)) {
        rowGroupId = `${base}_${counter}`
        counter += 1
      }
      const newTable = {
        source: 'items',
        row_group_id: rowGroupId,
        row_height_mm: 6,
        rows_per_page: 10,
        cells: [],
      }
      const pages = prev.pages.map((page) =>
        page.id === pageId ? { ...page, tables: [...page.tables, newTable] } : page
      )
      return { ...prev, pages }
    })
  }, [])

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

  const handleDeleteTableGraph = useCallback((pageId: string, tableIndex: number) => {
    setTemplate((prev) => {
      if (!prev) return prev
      const pages = prev.pages.map((page) => {
        if (page.id !== pageId) return page
        const tables = page.tables.filter((_, idx) => idx !== tableIndex)
        return { ...page, tables }
      })
      return { ...prev, pages }
    })
    setGraphEditTableIndex((prev) => (prev === tableIndex ? null : prev))
    setGraphTableIndex((prev) => (prev > 0 ? Math.max(0, prev - 1) : 0))
    setNotification(`Deleted Table #${tableIndex + 1}`)
  }, [])

  const handleEditTableCells = useCallback((tableIndex: number) => {
    setGraphEditTableIndex(tableIndex)
    setNotification(`Draw to update Table #${tableIndex + 1}`)
  }, [])

  const handleMapDataToSvg = useCallback(async (dataRef: { source: 'meta' | 'items' | 'static' | 'unbound'; key: string }, element: TextElement) => {
    if (!template || !selectedPageId) return
    if (dataRef.source === 'unbound') {
      const svgId = await ensureSvgIdForElement(element, 'unbound', true)
      if (!svgId) {
        setNotification('Selected element has no id to unbind.')
        return
      }
      clearBindingsBySvgId(svgId)
      setSelectedBindingSvgId(svgId)
      return
    }
    const matchesValue = (
      value: ValueBinding,
      ref: { source: 'meta' | 'items' | 'static'; key: string },
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
    const dedupeFields = (
      fields: FieldBinding[],
      ref: { source: 'meta' | 'static'; key: string },
      svgId: string,
      keepIndex: number
    ) => fields.filter((field, idx) => {
      if (idx === keepIndex) return true
      if (field.svg_id === svgId) return false
      return !matchesValue(field.value, ref)
    })
    const dedupeCells = (
      cells: TableCell[],
      ref: { source: 'items'; key: string },
      tableSource: string | undefined,
      svgId: string,
      keepIndex: number
    ) => cells.filter((cell, idx) => {
      if (idx === keepIndex) return true
      if (cell.svg_id === svgId) return false
      return !matchesValue(cell.value, ref, tableSource)
    })
    const base = dataRef.source === 'static'
      ? `static_${dataRef.key}`
      : `${dataRef.source}_${dataRef.key}`
    const svgId = await ensureSvgIdForElement(element, base)
    if (!svgId) return
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
          const targetRef = { source: 'items' as const, key: dataRef.key }
          if (graphItemsTarget === 'header') {
            const headerCells = table.header?.cells ? [...table.header.cells] : []
            const existing = headerCells.findIndex(cell => cell.svg_id === svgId)
            const byValue = existing >= 0
              ? existing
              : headerCells.findIndex(cell => matchesValue(cell.value, targetRef, table.source))
            const nextCell = byValue >= 0
              ? { ...headerCells[byValue], svg_id: svgId, value, enabled: true }
              : { svg_id: svgId, value, enabled: true }
            if (byValue >= 0) headerCells[byValue] = nextCell
            else headerCells.push(nextCell)
            const keepIndex = byValue >= 0 ? byValue : headerCells.length - 1
            const nextHeaderCells = dedupeCells(headerCells, targetRef, table.source, svgId, keepIndex)
            const nextTable = { ...table, header: { cells: nextHeaderCells } }
            const tables = page.tables.map((t, idx) => idx === tableIndex ? nextTable : t)
            return { ...page, tables }
          }

          const cells = [...table.cells]
          const existing = cells.findIndex(cell => cell.svg_id === svgId)
          const byValue = existing >= 0
            ? existing
            : cells.findIndex(cell => matchesValue(cell.value, targetRef, table.source))
          const nextCell = byValue >= 0
            ? { ...cells[byValue], svg_id: svgId, value, enabled: true }
            : { svg_id: svgId, value, enabled: true }
          if (byValue >= 0) cells[byValue] = nextCell
          else cells.push(nextCell)
          const keepIndex = byValue >= 0 ? byValue : cells.length - 1
          const nextCells = dedupeCells(cells, targetRef, table.source, svgId, keepIndex)
          const nextTable = { ...table, cells: nextCells }
          const tables = page.tables.map((t, idx) => idx === tableIndex ? nextTable : t)
          return { ...page, tables }
        }

        const value = dataRef.source === 'static'
          ? makeStaticValue(dataRef.key)
          : makeDataValue('meta', dataRef.key)
        const targetRef = { source: dataRef.source as 'meta' | 'static', key: dataRef.key }

        if (graphMetaScope === 'global') {
          return page
        }

        const fields = [...(page.fields ?? [])]
        const existing = fields.findIndex(field => field.svg_id === svgId)
        const byValue = existing >= 0
          ? existing
          : fields.findIndex(field => matchesValue(field.value, targetRef))
        const nextField = byValue >= 0
          ? { ...fields[byValue], svg_id: svgId, value, enabled: true }
          : { svg_id: svgId, value, enabled: true }
        if (byValue >= 0) fields[byValue] = nextField
        else fields.push(nextField)
        const keepIndex = byValue >= 0 ? byValue : fields.length - 1
        const nextFields = dedupeFields(fields, targetRef, svgId, keepIndex)
        return { ...page, fields: nextFields }
      })

      if (dataRef.source !== 'items' && graphMetaScope === 'global') {
        const value = dataRef.source === 'static'
          ? makeStaticValue(dataRef.key)
          : makeDataValue('meta', dataRef.key)
        const targetRef = { source: dataRef.source as 'meta' | 'static', key: dataRef.key }
        const fields = [...prev.fields]
        const existing = fields.findIndex(field => field.svg_id === svgId)
        const byValue = existing >= 0
          ? existing
          : fields.findIndex(field => matchesValue(field.value, targetRef))
        const nextField = byValue >= 0
          ? { ...fields[byValue], svg_id: svgId, value, enabled: true }
          : { svg_id: svgId, value, enabled: true }
        if (byValue >= 0) fields[byValue] = nextField
        else fields.push(nextField)
        const keepIndex = byValue >= 0 ? byValue : fields.length - 1
        const nextFields = dedupeFields(fields, targetRef, svgId, keepIndex)
        nextTemplate = { ...prev, fields: nextFields, pages }
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
        const inspectResult = await rpc.inspectText(`${templateDir}/${selectedSvg}`)
        setSvgElements(inspectResult.texts)
      }
    }

    setSelectedBindingSvgId(svgId)
    setNotification(`Mapped ${dataRef.source}.${dataRef.key}`)
  }, [template, selectedPageId, ensureSvgIdForElement, ensureFitLabelForElement, graphItemsTarget, graphMetaScope, graphTableIndex, normalizeRowGroupsForPage, selectedSvg, templateDir, clearBindingsBySvgId])

  const handleUnbindSvgId = useCallback(async (svgId: string) => {
    if (!svgId) return
    const element = (selectedText && (selectedText.id === svgId || selectedText.suggestedId === svgId))
      ? selectedText
      : (svgElements.find((el) => el.id === svgId || el.suggestedId === svgId) || null)
    if (element) {
      const ensured = await ensureSvgIdForElement(element, 'unbound', true)
      if (ensured) {
        clearBindingsBySvgId(ensured)
        setSelectedBindingSvgId(ensured)
        return
      }
    }
    clearBindingsBySvgId(svgId)
  }, [svgElements, selectedText, ensureSvgIdForElement, clearBindingsBySvgId])

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
      cellSvgIds: table.cells
        .filter(cell => cell.enabled !== false)
        .map(cell => cell.svg_id)
        .filter(Boolean),
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
        addConnection({ source: 'unbound', key: 'unbound' }, field.svg_id, undefined, field.svg_id)
        continue
      }
      addConnection(toDataRef(field.value), field.svg_id)
    }

    for (const field of page.fields ?? []) {
      if (field.enabled === false) {
        addConnection({ source: 'unbound', key: 'unbound' }, field.svg_id, undefined, field.svg_id)
        continue
      }
      addConnection(toDataRef(field.value), field.svg_id)
    }

    for (const [tableIndex, table] of page.tables.entries()) {
      for (const cell of table.header?.cells ?? []) {
        if (cell.enabled === false) {
          addConnection({ source: 'unbound', key: 'unbound' }, cell.svg_id, tableIndex, cell.svg_id)
          continue
        }
        addConnection(toDataRef(cell.value, table.source || 'items'), cell.svg_id, tableIndex)
      }
      for (const cell of table.cells) {
        if (cell.enabled === false) {
          addConnection({ source: 'unbound', key: 'unbound' }, cell.svg_id, tableIndex, cell.svg_id)
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

    const typeOrder: Record<DataKeyRef['source'], number> = { meta: 0, items: 1, static: 2, unbound: 3 }
    const unboundRef: DataKeyRef = { source: 'unbound', key: 'unbound' }
    const unboundKey = encodeDataKeyRef(unboundRef)
    if (!nodes.has(unboundKey)) {
      nodes.set(unboundKey, {
        key: unboundKey,
        ref: unboundRef,
        label: 'Unbound',
        type: 'unbound',
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
    const tab = normalized.startsWith('fields')
      ? 'fields'
      : normalized.startsWith('formatters')
        ? 'formatters'
        : 'pages'

    const svgId = resolveSvgIdFromPathForTemplate(template, selectedPageId, path)
    if (svgId) setSelectedBindingSvgId(svgId)
    setFocusTarget({ tab, path: normalized })
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
            <div className="editor-mode-toggle">
              <button
                className={`btn-secondary ${editorMode === 'graph' ? 'active' : ''}`}
                onClick={() => setEditorMode('graph')}
              >
                Graph
              </button>
              <button
                className={`btn-secondary ${editorMode === 'legacy' ? 'active' : ''}`}
                onClick={() => setEditorMode('legacy')}
              >
                Legacy
              </button>
            </div>
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
          editorMode === 'graph' ? (
            <div className="graph-pane">
                <GraphEditor
                  template={template}
                  selectedPageId={selectedPageId}
                  onSelectPageId={handlePageSelect}
                  metaData={metaData}
                  itemsData={itemsData}
                  dataLoading={dataLoading}
                  onLoadDemoData={handleLoadDemoData}
                  metaScope={graphMetaScope}
                  onMetaScopeChange={setGraphMetaScope}
                  itemsTarget={graphItemsTarget}
                  onItemsTargetChange={setGraphItemsTarget}
                  activeTableIndex={graphTableIndex}
                  onActiveTableIndexChange={setGraphTableIndex}
                  editTableIndex={graphEditTableIndex}
                  onEditTableCells={handleEditTableCells}
                  onCancelEditTable={() => setGraphEditTableIndex(null)}
                  onDeleteTable={handleDeleteTableGraph}
                  onAddTable={handleAddTableGraph}
                  onUpdateTable={handleUpdateTableGraph}
                  selectedSvgId={selectedBindingSvgId}
                  onUnbindSvgId={handleUnbindSvgId}
                />
              <div className="graph-preview-pane">
                <SvgViewer
                  svgPath={selectedSvg ? `${templateDir}/${selectedSvg}` : null}
                  svgReloadToken={svgReloadToken}
                  elements={svgElements}
                  templateDir={templateDir}
                  bindingSvgIds={bindingSvgIds}
                  tableBindingGroups={tableBindingGroups}
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

                    const headers = itemsData?.headers || []
                    const guessKey = (el: TextElement) => {
                      const candidates: string[] = []
                      if (el.id) candidates.push(el.id)
                      if (el.suggestedId && el.suggestedId !== el.id) candidates.push(el.suggestedId)
                      if (el.id?.startsWith('item_')) candidates.push(el.id.replace(/^item_/, ''))
                      if (el.suggestedId?.startsWith('item_')) candidates.push(el.suggestedId.replace(/^item_/, ''))
                      const match = headers.find(h => candidates.includes(h))
                      return match || candidates[0] || `col_${el.index}`
                    }

                    const sorted = [...filtered].sort((a, b) => {
                      const ab = (a.bbox.x + a.bbox.w / 2) - (b.bbox.x + b.bbox.w / 2)
                      if (Math.abs(ab) > 1) return ab
                      return (a.bbox.y + a.bbox.h / 2) - (b.bbox.y + b.bbox.h / 2)
                    })

                    const resolved = []
                    for (const el of sorted) {
                      const key = guessKey(el)
                      const svgId = await ensureSvgIdForElement(el, `item_${key}`)
                      if (svgId) {
                        resolved.push({ svgId, key })
                      }
                    }

                    const cells = resolved.map((entry) => ({
                      svg_id: entry.svgId,
                      value: makeDataValue('items', entry.key),
                    }))

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
                        const inspectResult = await rpc.inspectText(`${templateDir}/${selectedSvg}`)
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
                  pendingId={pendingId}
                  onPendingIdChange={setPendingId}
                  onUseSuggestedId={handleUseSuggestedId}
                  onApplyId={handleApplyId}
                  isLoading={isLoading}
                />
              </div>
            </div>
          ) : (
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
                svgReloadToken={svgReloadToken}
                elements={svgElements}
                templateDir={templateDir}
                bindingSvgIds={bindingSvgIds}
                tableBindingGroups={tableBindingGroups}
                selectedElementIndex={selectedTextIndex}
                highlightedBindingSvgId={selectedBindingSvgId}
                validationSvgIds={validationSvgIds}
                validationWarningSvgIds={validationWarningSvgIds}
                onSelectElement={handleSelectTextElement}
                onDropBinding={handleDropBindingOnElement}
                pendingId={pendingId}
                onPendingIdChange={setPendingId}
                onUseSuggestedId={handleUseSuggestedId}
                onApplyId={handleApplyId}
                onSvgEdited={handleSvgEdited}
                isLoading={isLoading}
              />
            </div>
          </>
          )
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
