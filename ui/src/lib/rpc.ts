import type {
  VersionResponse,
  WorkspaceResponse,
  TemplatesListResponse,
  TemplateConfig,
  InspectTextResponse,
  SvgReadResponse,
  ValidationResponse,
  PreviewResponse,
  SaveResponse,
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

  async inspectText(path: string): Promise<InspectTextResponse> {
    return this.request<InspectTextResponse>('/inspect-text', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
  }

  async readSvg(path: string): Promise<SvgReadResponse> {
    return this.request<SvgReadResponse>('/svg/read', {
      method: 'POST',
      body: JSON.stringify({ path }),
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
    sampleMode: 'minimal' | 'realistic' | 'multi-page' = 'realistic'
  ): Promise<PreviewResponse> {
    return this.request<PreviewResponse>('/preview', {
      method: 'POST',
      body: JSON.stringify({
        templateDir,
        outputDir,
        sampleMode,
        options: { emitSvgs: true, emitDebug: true },
      }),
    })
  }

  async setSvgIds(path: string, assignments: Array<{ selector: { byIndex: number }; id: string }>): Promise<void> {
    await this.request('/svg/set-ids', {
      method: 'POST',
      body: JSON.stringify({ path, assignments }),
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
}

export const rpc = new RpcClient()
