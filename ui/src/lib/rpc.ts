import type {
  VersionResponse,
  WorkspaceResponse,
  TemplatesListResponse,
  TemplateConfig,
  InspectTextResponse,
  SvgReadResponse,
  SvgReindexResponse,
  SvgWriteResponse,
  SvgSetAttrsResponse,
  ValidationResponse,
  PreviewResponse,
  SaveResponse,
  TemplateImportPdfResponse,
  KVData,
  TableData,
} from '../types/api'

const RPC_BASE = '/rpc'

class RpcClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${RPC_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `RPC Error: ${response.status}`)
    }

    return data as T
  }

  async getVersion(): Promise<VersionResponse> {
    return this.request<VersionResponse>('/version')
  }

  async getWorkspace(): Promise<WorkspaceResponse> {
    return this.request<WorkspaceResponse>('/workspace')
  }

  async listTemplates(baseDir?: string): Promise<TemplatesListResponse> {
    const query = baseDir ? `?baseDir=${encodeURIComponent(baseDir)}` : ''
    return this.request<TemplatesListResponse>(`/templates/list${query}`)
  }

  async loadTemplate(templateDir: string): Promise<TemplateConfig> {
    const response = await this.request<{ request_id: string; templateJson: TemplateConfig }>('/template/load', {
      method: 'POST',
      body: JSON.stringify({ templateDir }),
    })
    return response.templateJson
  }

  async saveTemplate(templateDir: string, templateJson: TemplateConfig, validate = false): Promise<SaveResponse> {
    return this.request<SaveResponse>('/template/save', {
      method: 'POST',
      body: JSON.stringify({ templateDir, templateJson, validate }),
    })
  }

  async inspectText(path: string, options?: { glyphSplitProfile?: 'balanced' | 'split' | 'merge' }): Promise<InspectTextResponse> {
    return this.request<InspectTextResponse>('/inspect-text', {
      method: 'POST',
      body: JSON.stringify({ path, options }),
    })
  }

  async readSvg(path: string): Promise<SvgReadResponse> {
    return this.request<SvgReadResponse>('/svg/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async reindexSvgTextIds(path: string, prefix = 'text_'): Promise<SvgReindexResponse> {
    return this.request<SvgReindexResponse>('/svg/reindex-text-ids', {
      method: 'POST',
      body: JSON.stringify({ path, prefix }),
    })
  }

  async writeSvg(path: string, svg: string): Promise<SvgWriteResponse> {
    return this.request<SvgWriteResponse>('/svg/write', {
      method: 'POST',
      body: JSON.stringify({ path, svg }),
    })
  }

  async setSvgAttrs(
    path: string,
    updates: Array<{ id: string; attrs?: Record<string, string | null>; text?: string | null }>
  ): Promise<SvgSetAttrsResponse> {
    return this.request<SvgSetAttrsResponse>('/svg/set-attrs', {
      method: 'POST',
      body: JSON.stringify({ path, updates }),
    })
  }

  async validate(templateDir: string): Promise<ValidationResponse> {
    return this.request<ValidationResponse>('/validate', {
      method: 'POST',
      body: JSON.stringify({ templateDir }),
    })
  }

  async preview(
    templateDir: string,
    outputDir: string,
    sampleMode: 'minimal' | 'realistic' | 'multi-page' = 'realistic',
    data?: { meta?: KVData; items?: TableData }
  ): Promise<PreviewResponse> {
    return this.request<PreviewResponse>('/preview', {
      method: 'POST',
      body: JSON.stringify({
        templateDir,
        outputDir,
        sampleMode,
        options: { emitSvgs: true, emitDebug: true },
        data,
      }),
    })
  }

  async setSvgIds(
    path: string,
    assignments: Array<{ selector: { byIndex: number }; id: string }>,
    options?: { glyphSplitProfile?: 'balanced' | 'split' | 'merge' },
  ): Promise<void> {
    await this.request('/svg/set-ids', {
      method: 'POST',
      body: JSON.stringify({ path, assignments, options }),
    })
  }

  async generateTemplate(
    id: string,
    version: string,
    baseDir?: string,
    pageTypes: ('first' | 'repeat')[] = ['first', 'repeat']
  ): Promise<{ request_id: string; created: boolean; templateDir: string; files: string[] }> {
    return this.request('/generate', {
      method: 'POST',
      body: JSON.stringify({ id, version, baseDir, pageTypes }),
    })
  }

  async importTemplateFromPdf(
    templateId: string,
    version: string,
    pdf: { filename: string; contentBase64: string },
    baseDir?: string,
    engine: 'pdf2svg' | 'inkscape' | 'auto' = 'auto'
  ): Promise<TemplateImportPdfResponse> {
    return this.request<TemplateImportPdfResponse>('/template/import-pdf', {
      method: 'POST',
      body: JSON.stringify({
        templateId,
        version,
        baseDir,
        pdf,
        options: { engine },
      }),
    })
  }

  async parseCsvData(content: string, kind: 'kv' | 'table', options?: Record<string, unknown>): Promise<{ data: KVData | TableData }> {
    return this.request('/data/parse-csv', {
      method: 'POST',
      body: JSON.stringify({ content, kind, options }),
    })
  }

  async parseJsonData(content: string): Promise<{ data: KVData }> {
    return this.request('/data/parse-json', {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  async fetchDataFromUrl(
    url: string,
    format: 'json' | 'csv',
    kind?: 'kv' | 'table',
    options?: Record<string, unknown>
  ): Promise<{ data: KVData | TableData }> {
    return this.request('/data/fetch', {
      method: 'POST',
      body: JSON.stringify({ url, format, kind, options }),
    })
  }
}

export const rpc = new RpcClient()
