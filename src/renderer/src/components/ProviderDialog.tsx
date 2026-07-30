import { useRef, useState } from 'react'
import { Check, ChevronRight, CloudDownload, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentId, ModelDef, Provider } from '@shared/types'
import { errorMessage } from '../stores/app'
import { getWebsite, renameWebsite, setWebsite } from '../lib/websites'
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

/** omp 官方支持的全部 api 类型（pi 为其子集）；已有配置里的未知值会附加进下拉保留 */
const API_OPTIONS = [
  'openai-responses',
  'openai-completions',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-vertex'
]

interface ProviderDialogProps {
  agent: AgentId
  /** null = 新增 */
  originalName: string | null
  initial?: Provider
  existingNames: string[]
  onSave: (name: string, provider: Provider) => Promise<boolean>
  onClose: () => void
}

/** 深拷贝，编辑过程不污染 store 里的对象；未知字段随拷贝保留 */
function cloneProvider(p?: Provider): Provider {
  return p ? (JSON.parse(JSON.stringify(p)) as Provider) : { api: 'openai-responses', models: [] }
}

/** 模型详细字段表单：展开行编辑与「添加模型」弹框共用 */
function ModelFields({
  model,
  onChange
}: {
  model: ModelDef
  onChange: (next: ModelDef) => void
}): React.JSX.Element {
  const setNumber = (key: string, raw: string): void => {
    const next = { ...model }
    if (raw.trim() === '') {
      delete next[key]
    } else {
      const value = Number(raw)
      if (!Number.isNaN(value)) next[key] = value
    }
    onChange(next)
  }

  const setCost = (key: string, raw: string): void => {
    const next = { ...model }
    const cost = { ...(next.cost ?? {}) }
    if (raw.trim() === '') {
      delete cost[key]
    } else {
      const value = Number(raw)
      if (!Number.isNaN(value)) cost[key] = value
    }
    if (Object.keys(cost).length === 0) {
      delete next.cost
    } else {
      next.cost = cost
    }
    onChange(next)
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label className="text-muted-foreground text-xs">模型 id</Label>
        <Input
          value={model.id}
          onChange={(e) => onChange({ ...model, id: e.target.value })}
          placeholder="如 gpt-5.6-sol"
          className="font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-xs">显示名称</Label>
          <Input
            value={model.name ?? ''}
            onChange={(e) => onChange({ ...model, name: e.target.value || undefined })}
            placeholder="可选"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={model.reasoning === true}
              onCheckedChange={(v) => onChange({ ...model, reasoning: v })}
            />
            reasoning
          </label>
        </div>
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-xs">contextWindow</Label>
          <Input
            type="number"
            value={model.contextWindow ?? ''}
            onChange={(e) => setNumber('contextWindow', e.target.value)}
            placeholder="255000"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-muted-foreground text-xs">maxTokens</Label>
          <Input
            type="number"
            value={model.maxTokens ?? ''}
            onChange={(e) => setNumber('maxTokens', e.target.value)}
            placeholder="32768"
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {(
          [
            ['input', '输入价'],
            ['output', '输出价'],
            ['cacheRead', '缓存读'],
            ['cacheWrite', '缓存写']
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="grid gap-1">
            <Label className="text-muted-foreground text-xs">{label}</Label>
            <Input
              type="number"
              step="0.01"
              value={(model.cost?.[key] as number | undefined) ?? ''}
              onChange={(e) => setCost(key, e.target.value)}
              placeholder="-"
            />
          </div>
        ))}
      </div>
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
  /** 官网地址：CLI 配置里没有这个字段，单独存本应用 localStorage */
  const [website, setWebsiteState] = useState(() =>
    originalName ? getWebsite(agent, originalName) : ''
  )
  const [showKey, setShowKey] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** 待删除的模型下标（非 null 时显示确认弹框） */
  const [removingModel, setRemovingModel] = useState<number | null>(null)
  /** 当前展开编辑的模型下标（手风琴，一次只展开一个） */
  const [expanded, setExpanded] = useState<number | null>(null)
  /** 远程模型列表拉取状态 */
  const [fetching, setFetching] = useState(false)
  /** 拉取到的模型 id（非 null 时显示选择弹框） */
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const nameRef = useRef<HTMLInputElement>(null)

  const models = provider.models ?? []

  const setField = (key: keyof Provider, value: unknown): void => {
    setProvider((p) => {
      const next = { ...p }
      if (value === undefined || value === '') {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  const setModels = (next: ModelDef[]): void => setProvider((p) => ({ ...p, models: next }))

  /** 「添加模型」弹框的草稿（非 null 时显示弹框） */
  const [draft, setDraft] = useState<ModelDef | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)

  const addModel = (): void => {
    setDraft({ id: '', reasoning: true, input: ['text', 'image'] })
    setDraftError(null)
  }

  const confirmAddModel = (): void => {
    if (!draft) return
    const id = draft.id.trim()
    if (!id) {
      setDraftError('模型 id 不能为空')
      return
    }
    if (models.some((m) => m.id.trim() === id)) {
      setDraftError(`模型「${id}」已存在`)
      return
    }
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
    setModels(models.filter((_, i) => i !== index))
    // 删除后修正展开下标：删的是展开项则收起，删的在前面则前移一位
    setExpanded((cur) => (cur === null || cur === index ? null : cur > index ? cur - 1 : cur))
  }

  /** 请求供应商 /models 接口拉取模型列表，成功后弹出勾选框 */
  const fetchModels = async (): Promise<void> => {
    const baseUrl = provider.baseUrl?.trim()
    if (!baseUrl) {
      setFormError('请先填写 Base URL')
      return
    }
    setFormError(null)
    setFetching(true)
    try {
      const ids = await window.api.fetchRemoteModels({
        baseUrl,
        apiKey: provider.apiKey,
        api: provider.api
      })
      setFetched(ids)
      // 默认不勾选，由用户自己挑
      setSelected(new Set())
      toast.success(`获取到 ${ids.length} 个模型`)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setFetching(false)
    }
  }

  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  /** 把勾选的模型追加到列表（默认 reasoning + 文本/图片输入，可再改） */
  const addSelectedModels = (): void => {
    const additions = (fetched ?? [])
      .filter((id) => selected.has(id))
      .map<ModelDef>((id) => ({ id, reasoning: true, input: ['text', 'image'] }))
    setModels([...models, ...additions])
    setFetched(null)
  }

  const validate = (): string | null => {
    const trimmed = name.trim()
    if (!trimmed) return '供应商名称不能为空'
    if (trimmed !== originalName && existingNames.includes(trimmed))
      return `供应商「${trimmed}」已存在`
    if (!provider.baseUrl?.trim()) return 'baseUrl 不能为空'
    if (website.trim() && !/^https?:\/\//i.test(website.trim()))
      return '官网地址需以 http(s):// 开头'
    if (models.some((m) => !m.id.trim())) return '模型 id 不能为空'
    const ids = models.map((m) => m.id.trim())
    if (new Set(ids).size !== ids.length) return '模型 id 不能重复'
    return null
  }

  const handleSave = async (): Promise<void> => {
    const error = validate()
    if (error) {
      // 模型相关错误：自动展开出问题的那一行，收起状态下用户才找得到
      if (error === '模型 id 不能为空') {
        setExpanded(models.findIndex((m) => !m.id.trim()))
      } else if (error === '模型 id 不能重复') {
        const seen = new Set<string>()
        setExpanded(
          models.findIndex((m) => {
            const id = m.id.trim()
            if (seen.has(id)) return true
            seen.add(id)
            return false
          })
        )
      }
      setFormError(error)
      return
    }
    setSaving(true)
    const trimmedName = name.trim()
    const ok = await onSave(trimmedName, provider)
    setSaving(false)
    if (ok) {
      // 官网只存 localStorage，跟随保存成功一起落盘；重命名时迁移旧记录
      if (originalName && originalName !== trimmedName) {
        renameWebsite(agent, originalName, trimmedName)
      }
      setWebsite(agent, trimmedName, website)
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col sm:max-w-2xl"
        // Radix 默认聚焦首个元素且全选输入框文本，改为手动聚焦名称、不选中
        onOpenAutoFocus={(e) => {
          e.preventDefault()
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

        {/* 中间表单区滚动，标题/底部按钮固定；负外边距让滚动条贴弹框边缘 */}
        <div className="-mr-4 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">名称</Label>
              <Input
                id="p-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 YSAPI"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>API 类型</Label>
              <Select value={provider.api ?? ''} onValueChange={(v) => setField('api', v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择 API 类型" />
                </SelectTrigger>
                <SelectContent>
                  {(provider.api && !API_OPTIONS.includes(provider.api)
                    ? [...API_OPTIONS, provider.api]
                    : API_OPTIONS
                  ).map((api) => (
                    <SelectItem key={api} value={api}>
                      {api}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="p-url">Base URL</Label>
            <Input
              id="p-url"
              value={provider.baseUrl ?? ''}
              onChange={(e) => setField('baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
              className="font-mono"
            />
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
              onChange={(e) => setWebsiteState(e.target.value)}
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
                onChange={(e) => setField('apiKey', e.target.value)}
                placeholder="sk-..."
                className="font-mono"
              />
              <Button variant="outline" size="icon" onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </div>

          {agent === 'omp' && (
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={provider.authHeader === true}
                  onCheckedChange={(v) => setField('authHeader', v)}
                />
                authHeader
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={provider.disableStrictTools === true}
                  onCheckedChange={(v) => setField('disableStrictTools', v)}
                />
                disableStrictTools
              </label>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>模型（{models.length}）</Label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={fetching}
                title="请求 Base URL 的 /models 接口"
                onClick={() => void fetchModels()}
              >
                <CloudDownload className={fetching ? 'animate-bounce' : ''} />
                {fetching ? '获取中…' : '获取模型列表'}
              </Button>
              <Button variant="outline" size="sm" onClick={addModel}>
                <Plus />
                添加模型
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {models.map((model, index) => {
              const isOpen = expanded === index
              return (
                <div
                  key={index}
                  className="rounded-lg border border-black/[0.06] shadow-xs dark:border-white/[0.08]"
                >
                  {/* 收起态一行摘要：点击整行展开/收起 */}
                  <div
                    className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-colors select-none"
                    onClick={() => setExpanded(isOpen ? null : index)}
                  >
                    <ChevronRight
                      className={cn(
                        'text-muted-foreground size-4 shrink-0 transition-transform duration-200 [transition-timing-function:var(--ease-fluid)]',
                        isOpen && 'rotate-90'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">
                      {model.id || <span className="text-muted-foreground">未命名模型</span>}
                    </span>
                    {model.name && (
                      <span className="text-muted-foreground max-w-44 shrink-0 truncate text-xs">
                        {model.name}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      title="复制此模型"
                      onClick={(e) => {
                        e.stopPropagation()
                        copyModel(index)
                      }}
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive/80 hover:text-destructive size-8 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemovingModel(index)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  {/* 展开态详细配置 */}
                  {isOpen && (
                    <div className="animate-in fade-in slide-in-from-top-1 border-t border-black/[0.06] p-3 duration-200 dark:border-white/[0.08]">
                      <ModelFields
                        model={model}
                        onChange={(next) =>
                          setModels(models.map((m, i) => (i === index ? next : m)))
                        }
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {formError && <div className="text-destructive text-sm">{formError}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
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
            <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>添加模型</DialogTitle>
                <DialogDescription>
                  添加到列表后，点击底部「保存」才会写入配置文件
                </DialogDescription>
              </DialogHeader>

              <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4">
                <ModelFields model={draft} onChange={setDraft} />
              </div>

              {draftError && <div className="text-destructive text-sm">{draftError}</div>}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button onClick={confirmAddModel}>
                  <Plus />
                  添加
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {fetched && (
          <Dialog open onOpenChange={(open) => !open && setFetched(null)}>
            <DialogContent className="flex max-h-[70vh] flex-col sm:max-w-md">
              <DialogHeader>
                <DialogTitle>选择要添加的模型</DialogTitle>
                <DialogDescription>
                  共 {fetched.length} 个，已添加过的不可重复勾选
                </DialogDescription>
              </DialogHeader>

              <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4">
                <div className="flex flex-col gap-1.5">
                  {fetched.map((id) => {
                    const added = models.some((m) => m.id === id)
                    const checked = selected.has(id)
                    return (
                      <button
                        key={id}
                        type="button"
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

              <DialogFooter>
                <Button variant="outline" onClick={() => setFetched(null)}>
                  取消
                </Button>
                <Button disabled={selected.size === 0} onClick={addSelectedModels}>
                  <Plus />
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
