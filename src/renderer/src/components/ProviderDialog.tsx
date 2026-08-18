import { useId, useRef, useState } from 'react'
import { Check, ChevronRight, CloudDownload, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentId, ModelDef, Provider } from '@shared/types'
import { errorMessage } from '../stores/app'
import { getWebsite, renameWebsite, setWebsite } from '../lib/websites'
import { renameUsageEndpoint } from '../lib/usageEndpoints'
import { renameUsageQuery } from '../lib/usageQueries'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import ConfirmDialog from './ConfirmDialog'

/** Pi models.json 当前支持的 API 类型。 */
const PI_API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
]

/** OMP models.yml 当前支持的 API 类型。 */
const OMP_API_OPTIONS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'google-generative-ai',
  'google-vertex',
  'bedrock-converse-stream',
  'google-gemini-cli'
]

const OMP_OPTIONAL_BASE_URL_APIS = new Set(['bedrock-converse-stream', 'google-gemini-cli'])
const DISCOVERY_TYPES = ['ollama', 'llamacpp', 'lmstudio', 'vllm', 'sglang', 'kilo']
const TRANSPORT_TYPES = ['pi-native']

interface ProviderDialogProps {
  agent: AgentId
  originalName: string | null
  initial?: Provider
  existingNames: string[]
  onSave: (name: string, provider: Provider) => Promise<boolean>
  onClose: () => void
}

interface ParsedProvider {
  provider?: Provider
  error?: string
}

/** 深拷贝，编辑过程不污染 store 里的对象；未知字段随拷贝保留。 */
function cloneProvider(p?: Provider): Provider {
  return p ? (JSON.parse(JSON.stringify(p)) as Provider) : { api: 'openai-responses', models: [] }
}

function apiOptionsFor(agent: AgentId): string[] {
  return agent === 'omp' ? OMP_API_OPTIONS : PI_API_OPTIONS
}

function withUnknownOption(options: string[], current: unknown): string[] {
  return typeof current === 'string' && current && !options.includes(current)
    ? [...options, current]
    : options
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | '' {
  return typeof value === 'number' && Number.isFinite(value) ? value : ''
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function jsonFieldValue(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function parseObjectField(
  raw: string,
  label: string
): { value?: Record<string, unknown>; error?: string } {
  if (!raw.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: `${label} 必须是 JSON 对象` }
    }
    return { value: value as Record<string, unknown> }
  } catch (error) {
    return { error: `${label} JSON 格式错误：${errorMessage(error)}` }
  }
}

function requiresBaseUrl(agent: AgentId, provider: Provider): boolean {
  if ((provider.models?.length ?? 0) === 0) return false
  return !(
    agent === 'omp' &&
    typeof provider.api === 'string' &&
    OMP_OPTIONAL_BASE_URL_APIS.has(provider.api)
  )
}

function setUnknownField<T extends Record<string, unknown>>(
  source: T,
  key: string,
  value: unknown
): T {
  const next: Record<string, unknown> = { ...source }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next as T
}

function ModelFields({
  agent,
  model,
  onChange,
  autoFocus = false
}: {
  agent: AgentId
  model: ModelDef
  onChange: (next: ModelDef) => void
  autoFocus?: boolean
}): React.JSX.Element {
  const fieldId = useId()
  const apiOptions = apiOptionsFor(agent)

  const setNumber = (key: string, raw: string): void => {
    const next = { ...model }
    if (raw.trim() === '') delete next[key]
    else {
      const value = Number(raw)
      if (!Number.isNaN(value)) next[key] = value
    }
    onChange(next)
  }

  const setString = (key: string, raw: string): void => onChange(setUnknownField(model, key, raw))
  const setBoolean = (key: string, value: boolean): void => onChange({ ...model, [key]: value })

  const setCost = (key: string, raw: string): void => {
    const next = { ...model }
    const cost = { ...(next.cost ?? {}) }
    if (raw.trim() === '') delete cost[key]
    else {
      const value = Number(raw)
      if (!Number.isNaN(value)) cost[key] = value
    }
    if (Object.keys(cost).length === 0) delete next.cost
    else next.cost = cost
    onChange(next)
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor={`${fieldId}-id`} className="text-muted-foreground text-xs">
          模型 id
        </Label>
        <Input
          id={`${fieldId}-id`}
          autoFocus={autoFocus}
          value={model.id}
          onChange={(event) => onChange({ ...model, id: event.target.value })}
          placeholder="如 gpt-5.6-sol"
          className="font-mono"
        />
      </div>
      <div className={cn('grid gap-3', agent === 'omp' ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className="grid gap-1">
          <Label htmlFor={`${fieldId}-name`} className="text-muted-foreground text-xs">
            显示名称
          </Label>
          <Input
            id={`${fieldId}-name`}
            value={model.name ?? ''}
            onChange={(event) => onChange({ ...model, name: event.target.value || undefined })}
            placeholder="可选"
          />
        </div>
        {agent === 'omp' && (
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-api`} className="text-muted-foreground text-xs">
              模型 API 覆盖
            </Label>
            <Select
              value={stringValue(model.api) || '__inherit__'}
              onValueChange={(value) => setString('api', value === '__inherit__' ? '' : value)}
            >
              <SelectTrigger id={`${fieldId}-api`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit__">继承供应商</SelectItem>
                {withUnknownOption(apiOptions, model.api).map((api) => (
                  <SelectItem key={api} value={api}>
                    {api}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              aria-label="启用 reasoning"
              checked={model.reasoning === true}
              onCheckedChange={(value) => setBoolean('reasoning', value)}
            />
            reasoning
          </label>
          {agent === 'omp' && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="支持工具调用"
                checked={model.supportsTools === true}
                onCheckedChange={(value) => setBoolean('supportsTools', value)}
              />
              supportsTools
            </label>
          )}
        </div>
      </div>
      <div className={cn('grid gap-3', agent === 'omp' ? 'grid-cols-3' : 'grid-cols-2')}>
        <div className="grid gap-1">
          <Label htmlFor={`${fieldId}-context`} className="text-muted-foreground text-xs">
            contextWindow
          </Label>
          <Input
            id={`${fieldId}-context`}
            type="number"
            value={model.contextWindow ?? ''}
            onChange={(e) => setNumber('contextWindow', e.target.value)}
            placeholder="255000"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${fieldId}-tokens`} className="text-muted-foreground text-xs">
            maxTokens
          </Label>
          <Input
            id={`${fieldId}-tokens`}
            type="number"
            value={model.maxTokens ?? ''}
            onChange={(e) => setNumber('maxTokens', e.target.value)}
            placeholder="32768"
          />
        </div>
        {agent === 'omp' && (
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-premium`} className="text-muted-foreground text-xs">
              premiumMultiplier
            </Label>
            <Input
              id={`${fieldId}-premium`}
              type="number"
              min="0"
              step="0.01"
              value={numberValue(model.premiumMultiplier)}
              onChange={(e) => setNumber('premiumMultiplier', e.target.value)}
              placeholder="可选"
            />
          </div>
        )}
      </div>
      {agent === 'omp' && (
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-promotion`} className="text-muted-foreground text-xs">
              contextPromotionTarget
            </Label>
            <Input
              id={`${fieldId}-promotion`}
              value={stringValue(model.contextPromotionTarget)}
              onChange={(e) => setString('contextPromotionTarget', e.target.value)}
              placeholder="可选"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-compaction`} className="text-muted-foreground text-xs">
              compactionModel
            </Label>
            <Input
              id={`${fieldId}-compaction`}
              value={stringValue(model.compactionModel)}
              onChange={(e) => setString('compactionModel', e.target.value)}
              placeholder="provider/model 或模型 id"
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Switch
              aria-label="省略最大输出 token 参数"
              checked={model.omitMaxOutputTokens === true}
              onCheckedChange={(value) => setBoolean('omitMaxOutputTokens', value)}
            />
            omitMaxOutputTokens
          </label>
        </div>
      )}
      <fieldset className="grid gap-1">
        <legend className="text-muted-foreground text-xs">输入类型</legend>
        <div className="flex gap-2">
          {(['text', 'image'] as const).map((type) => {
            const current = model.input ?? ['text']
            const active = current.includes(type)
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const remaining = current.filter((item) => item !== type)
                  const next = active
                    ? remaining.length > 0
                      ? remaining
                      : ['text']
                    : [...current, type]
                  onChange({ ...model, input: next })
                }}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/40'
                )}
              >
                {type}
              </button>
            )
          })}
        </div>
      </fieldset>
      <fieldset className="grid grid-cols-4 gap-2">
        <legend className="sr-only">模型成本</legend>
        {(
          [
            ['input', '输入价'],
            ['output', '输出价'],
            ['cacheRead', '缓存读'],
            ['cacheWrite', '缓存写']
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="grid gap-1">
            <Label htmlFor={`${fieldId}-cost-${key}`} className="text-muted-foreground text-xs">
              {label}
            </Label>
            <Input
              id={`${fieldId}-cost-${key}`}
              type="number"
              step="0.01"
              value={(model.cost?.[key] as number | undefined) ?? ''}
              onChange={(event) => setCost(key, event.target.value)}
              placeholder="-"
            />
          </div>
        ))}
      </fieldset>
    </div>
  )
}

export default function ProviderDialog({
  agent,
  originalName,
  initial,
  existingNames,
  onSave,
  onClose
}: ProviderDialogProps): React.JSX.Element {
  const [name, setName] = useState(originalName ?? '')
  const [provider, setProvider] = useState<Provider>(() => cloneProvider(initial))
  const [website, setWebsiteState] = useState(() =>
    originalName ? getWebsite(agent, originalName) : ''
  )
  const [headersText, setHeadersText] = useState(() => jsonFieldValue(initial?.headers))
  const [compatText, setCompatText] = useState(() => jsonFieldValue(initial?.compat))
  const [modelOverridesText, setModelOverridesText] = useState(() =>
    jsonFieldValue(initial?.modelOverrides)
  )
  const [showKey, setShowKey] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [removingModel, setRemovingModel] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<ModelDef | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const models = provider.models ?? []
  const apiOptions = apiOptionsFor(agent)
  const baseUrlRequired = requiresBaseUrl(agent, provider)
  const discovery = objectValue(provider.discovery)

  const setField = (key: string, value: unknown): void => {
    setProvider((current) => setUnknownField(current, key, value))
    setFormError(null)
  }

  const setNestedField = (containerKey: string, key: string, value: unknown): void => {
    setProvider((current) => {
      const nested = setUnknownField(objectValue(current[containerKey]), key, value)
      return setUnknownField(
        current,
        containerKey,
        Object.keys(nested).length > 0 ? nested : undefined
      )
    })
    setFormError(null)
  }

  const setModels = (next: ModelDef[]): void => {
    setProvider((current) => ({ ...current, models: next }))
    setFormError(null)
  }

  const addModel = (): void => {
    setDraft({ id: '' })
    setDraftError(null)
  }

  const confirmAddModel = (): void => {
    if (!draft) return
    const id = draft.id.trim()
    if (!id) return setDraftError('模型 id 不能为空')
    if (models.some((model) => model.id.trim() === id)) return setDraftError(`模型「${id}」已存在`)
    setModels([...models, { ...draft, id }])
    setDraft(null)
    toast.success(`已添加模型「${id}」，点击底部「保存」后写入配置`)
  }

  const copyModel = (index: number): void => {
    const clone = JSON.parse(JSON.stringify(models[index])) as ModelDef
    clone.id = `${clone.id}-copy`
    setModels([...models.slice(0, index + 1), clone, ...models.slice(index + 1)])
    setExpanded(index + 1)
  }

  const removeModel = (index: number): void => {
    setModels(models.filter((_, itemIndex) => itemIndex !== index))
    setExpanded((current) =>
      current === null || current === index ? null : current > index ? current - 1 : current
    )
  }

  const fetchModels = async (): Promise<void> => {
    const baseUrl = provider.baseUrl?.trim()
    if (!baseUrl) return setFetchError('模型发现需要先填写 Base URL')
    setFetchError(null)
    setFetching(true)
    try {
      const ids = await window.api.fetchRemoteModels({
        baseUrl,
        apiKey: provider.apiKey,
        api: provider.api
      })
      if (ids.length === 0) {
        setFetched(null)
        setFetchError('接口返回成功，但没有发现模型')
      } else {
        setFetched(ids)
        setSelected(new Set())
      }
    } catch (error) {
      setFetchError(`获取模型列表失败：${errorMessage(error)}`)
    } finally {
      setFetching(false)
    }
  }

  const toggleSelected = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 远程发现只追加 id，不猜测 reasoning/input 等能力。 */
  const addSelectedModels = (): void => {
    const additions = (fetched ?? [])
      .filter((id) => selected.has(id))
      .map<ModelDef>((id) => ({ id }))
    setModels([...models, ...additions])
    setFetched(null)
  }

  const buildProvider = (): ParsedProvider => {
    const next = cloneProvider(provider)
    if (agent !== 'omp') return { provider: next }
    for (const [key, raw, label] of [
      ['headers', headersText, 'headers'],
      ['compat', compatText, 'compat'],
      ['modelOverrides', modelOverridesText, 'modelOverrides']
    ] as const) {
      const parsed = parseObjectField(raw, label)
      if (parsed.error) return { error: parsed.error }
      if (parsed.value === undefined) delete next[key]
      else next[key] = parsed.value
    }
    return { provider: next }
  }

  const validate = (): ParsedProvider => {
    const trimmed = name.trim()
    if (!trimmed) return { error: '供应商名称不能为空' }
    if (trimmed !== originalName && existingNames.includes(trimmed))
      return { error: `供应商「${trimmed}」已存在` }
    if (baseUrlRequired && !provider.baseUrl?.trim())
      return { error: '当前 API/模型配置需要填写 Base URL' }
    if (website.trim() && !/^https?:\/\//i.test(website.trim()))
      return { error: '官网地址需以 http(s):// 开头' }
    if (models.some((model) => !model.id.trim())) return { error: '模型 id 不能为空' }
    const ids = models.map((model) => model.id.trim())
    if (new Set(ids).size !== ids.length) return { error: '模型 id 不能重复' }
    return buildProvider()
  }

  const handleSave = async (): Promise<void> => {
    const result = validate()
    if (result.error || !result.provider) {
      const validationError = result.error ?? '配置校验失败'
      if (validationError === '供应商名称不能为空') nameRef.current?.focus()
      if (validationError === '模型 id 不能为空')
        setExpanded(models.findIndex((model) => !model.id.trim()))
      else if (validationError === '模型 id 不能重复') {
        const seen = new Set<string>()
        setExpanded(
          models.findIndex((model) => {
            const id = model.id.trim()
            if (seen.has(id)) return true
            seen.add(id)
            return false
          })
        )
      }
      setFormError(validationError)
      return
    }
    setSaving(true)
    setFormError(null)
    const trimmedName = name.trim()
    try {
      const ok = await onSave(trimmedName, result.provider)
      if (!ok) return setFormError('保存失败，请检查上方错误或应用日志后重试')
      if (originalName && originalName !== trimmedName) {
        renameWebsite(agent, originalName, trimmedName)
        renameUsageEndpoint(agent, originalName, trimmedName)
        renameUsageQuery(agent, originalName, trimmedName)
      }
      setWebsite(agent, trimmedName, website)
    } catch (error) {
      setFormError(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader>
          <DialogTitle>{originalName ? `编辑供应商 · ${originalName}` : '添加供应商'}</DialogTitle>
          <DialogDescription>
            保存后写入 {agent === 'omp' ? '~/.omp/agent/models.yml' : '~/.pi/agent/models.json'}
            （写入前自动备份 .bak）
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-4 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                ref={nameRef}
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
                placeholder="如 openai"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-api">API 类型</Label>
              <Select value={provider.api ?? ''} onValueChange={(value) => setField('api', value)}>
                <SelectTrigger id="p-api" className="w-full">
                  <SelectValue placeholder="选择 API 类型" />
                </SelectTrigger>
                <SelectContent>
                  {withUnknownOption(apiOptions, provider.api).map((api) => (
                    <SelectItem key={api} value={api}>
                      {api}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {agent === 'omp' ? 'OMP 支持 9 类 API' : 'Pi models.json 支持 4 类 API'}
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="p-url">
              Base URL
              {!baseUrlRequired && (
                <span className="text-muted-foreground font-normal">（当前配置可选）</span>
              )}
            </Label>
            <Input
              id="p-url"
              value={provider.baseUrl ?? ''}
              onChange={(event) => setField('baseUrl', event.target.value)}
              placeholder="https://api.example.com/v1"
              className="font-mono"
              aria-describedby="p-url-help"
            />
            <p id="p-url-help" className="text-muted-foreground text-xs">
              有自定义模型时通常必填；仅覆盖内置供应商，或使用 Bedrock / Gemini CLI 时可留空。
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="p-website">
              官网
              <span className="text-muted-foreground font-normal">
                （可选，仅本应用展示，不写入 CLI 配置）
              </span>
            </Label>
            <Input
              id="p-website"
              value={website}
              onChange={(event) => setWebsiteState(event.target.value)}
              placeholder="https://example.com"
              className="font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="p-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="p-key"
                type={showKey ? 'text' : 'password'}
                value={provider.apiKey ?? ''}
                onChange={(event) => setField('apiKey', event.target.value)}
                placeholder="sk-... 或环境变量命令"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowKey((value) => !value)}
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                title={showKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showKey ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </Button>
            </div>
          </div>

          {agent === 'omp' && (
            <details className="rounded-lg border border-black/[0.06] p-3 dark:border-white/[0.08]">
              <summary className="cursor-pointer text-sm font-medium">OMP 高级供应商字段</summary>
              <div className="mt-4 grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="p-auth">auth</Label>
                    <Select
                      value={stringValue(provider.auth) || '__default__'}
                      onValueChange={(value) =>
                        setField('auth', value === '__default__' ? undefined : value)
                      }
                    >
                      <SelectTrigger id="p-auth" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">默认认证</SelectItem>
                        {withUnknownOption(['none'], provider.auth).map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="p-transport">transport</Label>
                    <Select
                      value={stringValue(provider.transport) || '__default__'}
                      onValueChange={(value) =>
                        setField('transport', value === '__default__' ? undefined : value)
                      }
                    >
                      <SelectTrigger id="p-transport" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">默认</SelectItem>
                        {withUnknownOption(TRANSPORT_TYPES, provider.transport).map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      aria-label="使用 Authorization 请求头"
                      checked={provider.authHeader === true}
                      onCheckedChange={(value) => setField('authHeader', value)}
                    />
                    authHeader
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      aria-label="禁用严格工具模式"
                      checked={provider.disableStrictTools === true}
                      onCheckedChange={(value) => setField('disableStrictTools', value)}
                    />
                    disableStrictTools
                  </label>
                </div>

                <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-dashed p-3">
                  <legend className="px-1 text-sm font-medium">discovery</legend>
                  <div className="grid gap-1.5">
                    <Label htmlFor="p-discovery-type">type</Label>
                    <Select
                      value={stringValue(discovery.type) || '__disabled__'}
                      onValueChange={(value) =>
                        setNestedField(
                          'discovery',
                          'type',
                          value === '__disabled__' ? undefined : value
                        )
                      }
                    >
                      <SelectTrigger id="p-discovery-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__disabled__">不配置</SelectItem>
                        {withUnknownOption(DISCOVERY_TYPES, discovery.type).map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="p-discovery-timeout">timeoutMs（毫秒）</Label>
                    <Input
                      id="p-discovery-timeout"
                      type="number"
                      min="0"
                      value={numberValue(discovery.timeoutMs)}
                      onChange={(event) =>
                        setNestedField(
                          'discovery',
                          'timeoutMs',
                          event.target.value.trim() ? Number(event.target.value) : undefined
                        )
                      }
                      placeholder="可选"
                    />
                  </div>
                </fieldset>

                {(
                  [
                    [
                      'p-headers',
                      'headers',
                      headersText,
                      setHeadersText,
                      '{\n  "X-Header": "value"\n}'
                    ],
                    ['p-compat', 'compat', compatText, setCompatText, '{}'],
                    [
                      'p-model-overrides',
                      'modelOverrides',
                      modelOverridesText,
                      setModelOverridesText,
                      '{\n  "model-id": { "name": "显示名" }\n}'
                    ]
                  ] as const
                ).map(([id, label, value, setter, placeholder]) => (
                  <div key={id} className="grid gap-1.5">
                    <Label htmlFor={id}>{label}（JSON 对象）</Label>
                    <textarea
                      id={id}
                      value={value}
                      onChange={(event) => {
                        setter(event.target.value)
                        setFormError(null)
                      }}
                      placeholder={placeholder}
                      spellCheck={false}
                      rows={label === 'modelOverrides' ? 5 : 3}
                      className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus-visible:ring-[3px]"
                    />
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between gap-3">
            <Label>模型（{models.length}）</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fetching}
                title="请求 Base URL 的 /models 接口"
                onClick={() => void fetchModels()}
              >
                <CloudDownload className={fetching ? 'animate-bounce' : ''} aria-hidden="true" />
                {fetching ? '获取中…' : '获取模型列表'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addModel}>
                <Plus aria-hidden="true" />
                添加模型
              </Button>
            </div>
          </div>
          {fetchError && (
            <p className="text-destructive text-sm" role="alert">
              {fetchError}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {models.map((model, index) => {
              const isOpen = expanded === index
              const panelId = `provider-model-${index}`
              return (
                <div
                  key={`${model.id}-${index}`}
                  className="rounded-lg border border-black/[0.06] shadow-xs dark:border-white/[0.08]"
                >
                  <div className="hover:bg-muted/40 flex items-center gap-2 rounded-lg px-2 py-1 transition-colors">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setExpanded(isOpen ? null : index)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          'text-muted-foreground size-4 shrink-0 transition-transform duration-200 [transition-timing-function:var(--ease-fluid)]',
                          isOpen && 'rotate-90'
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">
                        {model.id || <span className="text-muted-foreground">未命名模型</span>}
                      </span>
                      {model.name && (
                        <span className="text-muted-foreground max-w-44 shrink-0 truncate text-xs">
                          {model.name}
                        </span>
                      )}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      title={`复制模型 ${model.id || '未命名模型'}`}
                      aria-label={`复制模型 ${model.id || '未命名模型'}`}
                      onClick={() => copyModel(index)}
                    >
                      <Copy aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive/80 hover:text-destructive size-8 shrink-0"
                      title={`删除模型 ${model.id || '未命名模型'}`}
                      aria-label={`删除模型 ${model.id || '未命名模型'}`}
                      onClick={() => setRemovingModel(index)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {isOpen && (
                    <div
                      id={panelId}
                      className="animate-in fade-in slide-in-from-top-1 border-t border-black/[0.06] p-3 duration-200 dark:border-white/[0.08]"
                    >
                      <ModelFields
                        agent={agent}
                        model={model}
                        onChange={(next) =>
                          setModels(
                            models.map((item, itemIndex) => (itemIndex === index ? next : item))
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {formError && (
          <p className="text-destructive text-sm" role="alert">
            {formError}
          </p>
        )}
        <DialogFooter className="shrink-0 pt-2 pb-1">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>

        {removingModel !== null && (
          <ConfirmDialog
            title={`删除模型「${models[removingModel]?.id || '未命名'}」？`}
            description="点击底部「保存」后才会写入配置文件。"
            onConfirm={() => removeModel(removingModel)}
            onClose={() => setRemovingModel(null)}
          />
        )}

        {draft && (
          <Dialog open onOpenChange={(open) => !open && setDraft(null)}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>添加模型</DialogTitle>
                <DialogDescription>
                  添加到列表后，点击底部「保存」才会写入配置文件
                </DialogDescription>
              </DialogHeader>
              <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4 pb-4">
                <ModelFields agent={agent} model={draft} onChange={setDraft} autoFocus />
              </div>
              {draftError && (
                <p className="text-destructive text-sm" role="alert">
                  {draftError}
                </p>
              )}
              <DialogFooter className="shrink-0 pt-2 pb-1">
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button type="button" onClick={confirmAddModel}>
                  <Plus aria-hidden="true" />
                  添加
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {fetched && (
          <Dialog open onOpenChange={(open) => !open && setFetched(null)}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-md">
              <DialogHeader>
                <DialogTitle>选择要添加的模型</DialogTitle>
                <DialogDescription>
                  共 {fetched.length} 个，已添加过的不可重复勾选
                </DialogDescription>
              </DialogHeader>
              <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4 pb-4">
                <div className="flex flex-col gap-1.5" role="listbox" aria-multiselectable="true">
                  {fetched.map((id) => {
                    const added = models.some((model) => model.id === id)
                    const checked = selected.has(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        disabled={added}
                        onClick={() => toggleSelected(id)}
                        className={cn(
                          'flex items-center gap-2.5 rounded-md border px-3 py-2 text-left font-mono text-sm transition-colors',
                          added
                            ? 'text-muted-foreground/60 cursor-not-allowed border-dashed'
                            : checked
                              ? 'border-primary/50 bg-muted/60'
                              : 'hover:bg-muted/40'
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border',
                            checked && !added && 'bg-primary border-primary text-primary-foreground'
                          )}
                          aria-hidden="true"
                        >
                          {checked && !added && <Check className="size-3" />}
                        </span>
                        <span className="truncate">{id}</span>
                        {added && (
                          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                            已添加
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
              <DialogFooter className="shrink-0 pt-2 pb-1">
                <Button type="button" variant="outline" onClick={() => setFetched(null)}>
                  取消
                </Button>
                <Button type="button" disabled={selected.size === 0} onClick={addSelectedModels}>
                  <Plus aria-hidden="true" />
                  添加 {selected.size} 个模型
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
