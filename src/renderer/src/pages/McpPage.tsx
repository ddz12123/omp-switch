import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type {
  AgentId,
  McpServerConfig,
  McpServerInfo,
  McpTargetError,
  McpTransport
} from '@shared/types'
import { AGENT_IDS } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { cn } from '../lib/utils'
import { AgentIcon } from '../components/AgentIcon'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

const TEXTAREA_CLASS =
  'border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive w-full resize-y rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]'

/** 常用 MCP 预设，选中后自动填名称和配置。 */
const PRESETS: { key: string; name: string; config: McpServerConfig }[] = [
  {
    key: 'fetch',
    name: 'fetch',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] }
  },
  {
    key: 'time',
    name: 'time',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-time'] }
  },
  {
    key: 'memory',
    name: 'memory',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    }
  },
  {
    key: 'sequential-thinking',
    name: 'sequential-thinking',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
    }
  },
  {
    key: 'context7',
    name: 'context7',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
  }
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 展示用：stdio 显示命令行，http/sse 显示 URL。 */
function summarize(config: McpServerConfig): string {
  if (typeof config.url === 'string') return config.url
  const command = typeof config.command === 'string' ? config.command : ''
  const args = Array.isArray(config.args) ? config.args.map(String).join(' ') : ''
  return `${command} ${args}`.trim()
}

function typeOf(config: McpServerConfig): McpTransport {
  return config.type === 'http' || config.type === 'sse' ? config.type : 'stdio'
}

function argsTextOf(config: McpServerConfig): string {
  return Array.isArray(config.args) ? config.args.map(String).join('\n') : ''
}

function objectTextOf(value: unknown): string {
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function parseStringRecord(text: string, label: string): Record<string, string> | undefined {
  if (text.trim() === '') return undefined
  const parsed: unknown = JSON.parse(text)
  if (!isPlainObject(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) {
    throw new Error(`${label} 必须是字符串键值 JSON 对象`)
  }
  return parsed as Record<string, string>
}

interface McpEditDialogProps {
  original: McpServerInfo | null
  onClose: () => void
  onSaved: () => Promise<void>
}

/** 添加/编辑 MCP 服务器：常用字段结构化编辑，高级 JSON 保留未知字段。 */
function McpEditDialog({ original, onClose, onSaved }: McpEditDialogProps): React.JSX.Element {
  const { statuses } = useApp()
  const initialConfig = original?.config ?? { type: 'stdio', command: '', args: [] }
  const [name, setName] = useState(original?.name ?? '')
  const [config, setConfig] = useState<McpServerConfig>(initialConfig)
  const [jsonText, setJsonText] = useState(JSON.stringify(initialConfig, null, 2))
  const [argsText, setArgsText] = useState(argsTextOf(initialConfig))
  const [envText, setEnvText] = useState(objectTextOf(initialConfig.env))
  const [headersText, setHeadersText] = useState(objectTextOf(initialConfig.headers))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  // 新增默认启用到已检测安装的 Agent，编辑保持当前实际启用状态。
  const [agents, setAgents] = useState<Set<AgentId>>(
    () =>
      new Set(
        original
          ? original.agents
          : AGENT_IDS.filter((id) => statuses.find((status) => status.id === id)?.installed)
      )
  )
  const [saving, setSaving] = useState(false)
  const transport = typeOf(config)

  const syncStructuredState = (next: McpServerConfig): void => {
    setConfig(next)
    setArgsText(argsTextOf(next))
    setEnvText(objectTextOf(next.env))
    setHeadersText(objectTextOf(next.headers))
  }

  const replaceConfig = (next: McpServerConfig): void => {
    syncStructuredState(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError(null)
    setFieldErrors({})
    setFormError(null)
  }

  const updateField = (key: string, value: unknown): void => {
    const next = { ...config }
    if (value === undefined || value === '') delete next[key]
    else next[key] = value
    setConfig(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError(null)
    setFormError(null)
  }

  const updateTransport = (value: McpTransport): void => {
    const next = { ...config, type: value }
    if (value === 'stdio') {
      delete next.url
      delete next.headers
    } else {
      delete next.command
      delete next.args
      delete next.cwd
      delete next.env
    }
    replaceConfig(next)
  }

  const updateArgs = (value: string): void => {
    setArgsText(value)
    const args = value === '' ? [] : value.split(/\r?\n/)
    updateField('args', args)
  }

  const updateMapField = (
    key: 'env' | 'headers',
    value: string,
    label: string,
    setText: (text: string) => void
  ): void => {
    setText(value)
    try {
      const parsed = parseStringRecord(value, label)
      setFieldErrors((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      updateField(key, parsed)
    } catch (error) {
      setFieldErrors((current) => ({ ...current, [key]: errorMessage(error) }))
    }
  }

  const applyPreset = (key: string): void => {
    const preset = PRESETS.find((item) => item.key === key)
    if (!preset) return
    setName(preset.name)
    replaceConfig({ ...preset.config })
  }

  const handleAdvancedChange = (value: string): void => {
    setJsonText(value)
    setFormError(null)
    try {
      const parsed: unknown = JSON.parse(value)
      if (!isPlainObject(parsed)) throw new Error('配置必须是 JSON 对象')
      syncStructuredState(parsed as McpServerConfig)
      setJsonError(null)
      setFieldErrors({})
    } catch (error) {
      setJsonError(errorMessage(error))
    }
  }

  const handleFormat = (): void => {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (!isPlainObject(parsed)) throw new Error('配置必须是 JSON 对象')
      replaceConfig(parsed as McpServerConfig)
    } catch (error) {
      setJsonError(errorMessage(error))
    }
  }

  const toggleAgent = (id: AgentId): void => {
    setAgents((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async (): Promise<void> => {
    const trimmedName = name.trim()
    if (!trimmedName || saving) return
    setFormError(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
      if (!isPlainObject(parsed)) throw new Error('配置必须是 JSON 对象')
      if (Object.keys(fieldErrors).length > 0) throw new Error(Object.values(fieldErrors)[0])
    } catch (error) {
      const message = errorMessage(error)
      setJsonError(message)
      setFormError(message)
      return
    }

    setSaving(true)
    try {
      await window.api.saveMcpServer({
        originalName: original?.name ?? null,
        name: trimmedName,
        config: parsed as McpServerConfig,
        agents: AGENT_IDS.filter((id) => agents.has(id))
      })
      await onSaved()
      toast.success(original ? '已保存 MCP 服务器' : '已添加 MCP 服务器')
      onClose()
    } catch (error) {
      setFormError(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{original ? `编辑 ${original.name}` : '添加 MCP 服务器'}</DialogTitle>
          <DialogDescription>
            常用字段可直接编辑；高级 JSON 中未识别的扩展字段会原样保留。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {!original && (
            <div className="flex flex-wrap gap-1.5" aria-label="MCP 预设">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  aria-pressed={name === preset.name}
                  onClick={() => applyPreset(preset.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    name === preset.name
                      ? 'border-primary bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-black/[0.08] dark:border-white/[0.1]'
                  )}
                >
                  {preset.key}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">名称</Label>
              <Input
                id="mcp-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如 context7"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-transport">传输类型</Label>
              <Select
                value={transport}
                onValueChange={(value) => updateTransport(value as McpTransport)}
              >
                <SelectTrigger id="mcp-transport" className="w-full" aria-label="传输类型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio</SelectItem>
                  <SelectItem value="http">http</SelectItem>
                  <SelectItem value="sse">sse</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <Label htmlFor="mcp-enabled">配置内启用</Label>
              <Switch
                id="mcp-enabled"
                checked={config.enabled !== false}
                aria-label="配置内启用 MCP 服务器"
                onCheckedChange={(checked) => updateField('enabled', checked)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-timeout">超时（毫秒）</Label>
              <Input
                id="mcp-timeout"
                type="number"
                min={1}
                value={typeof config.timeout === 'number' ? config.timeout : ''}
                placeholder="30000"
                onChange={(event) =>
                  updateField(
                    'timeout',
                    event.target.value === '' ? undefined : Number(event.target.value)
                  )
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-request-id">Request ID 格式</Label>
              <Select
                value={
                  config.requestIdFormat === 'string' || config.requestIdFormat === 'number'
                    ? config.requestIdFormat
                    : 'default'
                }
                onValueChange={(value) =>
                  updateField('requestIdFormat', value === 'default' ? undefined : value)
                }
              >
                <SelectTrigger id="mcp-request-id" className="w-full" aria-label="Request ID 格式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">默认</SelectItem>
                  <SelectItem value="string">string</SelectItem>
                  <SelectItem value="number">number</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {transport === 'stdio' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-command">命令</Label>
                <Input
                  id="mcp-command"
                  value={typeof config.command === 'string' ? config.command : ''}
                  placeholder="npx"
                  onChange={(event) => updateField('command', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-cwd">工作目录</Label>
                <Input
                  id="mcp-cwd"
                  value={typeof config.cwd === 'string' ? config.cwd : ''}
                  placeholder="可选"
                  onChange={(event) => updateField('cwd', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-args">参数（每行一个）</Label>
                <textarea
                  id="mcp-args"
                  value={argsText}
                  rows={4}
                  spellCheck={false}
                  onChange={(event) => updateArgs(event.target.value)}
                  className={TEXTAREA_CLASS}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-env">环境变量（JSON）</Label>
                <textarea
                  id="mcp-env"
                  value={envText}
                  rows={4}
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.env)}
                  aria-describedby={fieldErrors.env ? 'mcp-env-error' : undefined}
                  onChange={(event) => updateMapField('env', event.target.value, 'env', setEnvText)}
                  className={TEXTAREA_CLASS}
                />
                {fieldErrors.env && (
                  <p id="mcp-env-error" className="text-destructive text-xs" role="alert">
                    {fieldErrors.env}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  type="url"
                  value={typeof config.url === 'string' ? config.url : ''}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => updateField('url', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mcp-headers">请求头（JSON）</Label>
                <textarea
                  id="mcp-headers"
                  value={headersText}
                  rows={4}
                  spellCheck={false}
                  aria-invalid={Boolean(fieldErrors.headers)}
                  aria-describedby={fieldErrors.headers ? 'mcp-headers-error' : undefined}
                  onChange={(event) =>
                    updateMapField('headers', event.target.value, 'headers', setHeadersText)
                  }
                  className={TEXTAREA_CLASS}
                />
                {fieldErrors.headers && (
                  <p id="mcp-headers-error" className="text-destructive text-xs" role="alert">
                    {fieldErrors.headers}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="mcp-json">高级配置（完整 JSON）</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleFormat}
              >
                <Braces className="size-3.5" />
                格式化
              </Button>
            </div>
            <textarea
              id="mcp-json"
              value={jsonText}
              onChange={(event) => handleAdvancedChange(event.target.value)}
              spellCheck={false}
              rows={8}
              aria-invalid={Boolean(jsonError)}
              aria-describedby={jsonError ? 'mcp-json-error' : undefined}
              className={TEXTAREA_CLASS}
            />
            {jsonError && (
              <p id="mcp-json-error" className="text-destructive text-xs" role="alert">
                {jsonError}
              </p>
            )}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">启用到</legend>
            <div className="flex gap-2">
              {AGENT_IDS.map((id) => {
                const status = statuses.find((item) => item.id === id)
                const checked = agents.has(id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={checked}
                    aria-label={`${checked ? '取消启用到' : '启用到'} ${status?.label ?? id}`}
                    onClick={() => toggleAgent(id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                      checked
                        ? 'border-primary bg-accent'
                        : 'text-muted-foreground hover:bg-accent/50 border-black/[0.08] dark:border-white/[0.1]'
                    )}
                  >
                    <AgentIcon agent={id} className="size-4" />
                    {status?.label ?? id}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {formError && (
            <div
              className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm"
              role="alert"
            >
              {formError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim() || Boolean(jsonError)}
          >
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function McpPage({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { statuses, agentOrder } = useApp()
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [targetErrors, setTargetErrors] = useState<McpTargetError[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<McpServerInfo | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [deleting, setDeleting] = useState<McpServerInfo | null>(null)
  /** 正在切换的 "name/agent"，防止连点。 */
  const [toggling, setToggling] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await window.api.listMcpServers()
      setServers(result.servers)
      setTargetErrors(result.targetErrors)
    } catch (error) {
      setLoadError(`读取 MCP 中央库失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = async (
    server: McpServerInfo,
    agentId: AgentId,
    enabled: boolean
  ): Promise<void> => {
    const key = `${server.name}/${agentId}`
    setToggling(key)
    setRowErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      await window.api.toggleMcpServer(server.name, agentId, enabled)
      await load()
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [key]: `${enabled ? '启用' : '停用'}失败：${errorMessage(error)}`
      }))
    } finally {
      setToggling(null)
    }
  }

  const handleDelete = async (server: McpServerInfo): Promise<void> => {
    const key = `${server.name}/delete`
    setRowErrors((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
    try {
      await window.api.deleteMcpServer(server.name)
      toast.success(`已删除 ${server.name}`)
      await load()
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [key]: `删除失败：${errorMessage(error)}`
      }))
    }
  }

  const targetErrorFor = (agentId: AgentId): McpTargetError | undefined =>
    targetErrors.find((error) => error.agentId === agentId)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            title="返回"
            aria-label="返回"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">MCP 管理</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              MCP 服务器统一存中央库；OMP 同步时同时维护 enabledServers / disabledServers。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="在资源管理器中打开中央库"
            onClick={() => void window.api.showMcpInFolder()}
          >
            <FolderOpen />
            打开目录
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="重新读取"
            onClick={() => void load()}
          >
            <RefreshCw />
            刷新
          </Button>
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            添加 MCP
          </Button>
        </div>
      </div>

      {loadError && (
        <div
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p>{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void load()}
            >
              重试
            </Button>
          </div>
        </div>
      )}

      {targetErrors.length > 0 && (
        <div
          className="border-destructive/30 bg-destructive/5 rounded-lg border px-3 py-2 text-sm"
          role="alert"
        >
          <div className="text-destructive flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" />
            部分 Agent 的 mcp.json 已损坏或无法读取；对应开关已禁用，修复前不会覆盖文件。
          </div>
          <ul className="text-muted-foreground mt-2 space-y-1 font-mono text-xs">
            {targetErrors.map((error) => (
              <li key={error.agentId}>
                {error.label} · {error.path}：{error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {loading && <div className="text-muted-foreground py-16 text-center text-sm">加载中…</div>}

        {!loading && !loadError && servers.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
            还没有 MCP 服务器。点击「添加 MCP」新建，把服务器统一管理并同步到各 Agent。
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {servers.map((server) => (
            <div
              key={server.name}
              className="bg-card rounded-xl border border-black/[0.06] px-4 py-3 shadow-xs dark:border-white/[0.08]"
            >
              <div className="flex items-center gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{server.name}</span>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {typeOf(server.config)}
                    </Badge>
                    {server.config.enabled === false && (
                      <Badge variant="outline" className="text-[10px]">
                        config disabled
                      </Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground/80 truncate font-mono text-xs">
                    {summarize(server.config)}
                  </span>
                </div>

                <div
                  className="flex shrink-0 items-center gap-4"
                  aria-label={`${server.name} Agent 启用状态`}
                >
                  {agentOrder.map((agentId) => {
                    const status = statuses.find((item) => item.id === agentId)
                    const enabled = server.agents.includes(agentId)
                    const key = `${server.name}/${agentId}`
                    const busy = toggling === key
                    const targetError = targetErrorFor(agentId)
                    return (
                      <div
                        key={agentId}
                        className="flex items-center gap-1.5"
                        title={
                          targetError
                            ? `${status?.label ?? agentId} 配置读取失败：${targetError.message}`
                            : `${enabled ? '停用' : '启用到'} ${status?.label ?? agentId}`
                        }
                      >
                        <AgentIcon agent={agentId} className="size-4.5" />
                        <Switch
                          checked={enabled}
                          disabled={busy || Boolean(targetError)}
                          aria-label={`${enabled ? '停用' : '启用到'} ${status?.label ?? agentId}`}
                          aria-describedby={rowErrors[key] ? `${key}-error` : undefined}
                          onCheckedChange={(checked) => void handleToggle(server, agentId, checked)}
                        />
                      </div>
                    )
                  })}
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    title="编辑"
                    aria-label={`编辑 ${server.name}`}
                    onClick={() => setEditing(server)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    title="删除（会同时从所有 Agent 移除）"
                    aria-label={`删除 ${server.name}`}
                    onClick={() => setDeleting(server)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {Object.entries(rowErrors)
                .filter(([key]) => key.startsWith(`${server.name}/`))
                .map(([key, message]) => (
                  <p
                    id={`${key}-error`}
                    key={key}
                    className="text-destructive mt-2 text-xs"
                    role="alert"
                  >
                    {message}
                  </p>
                ))}
            </div>
          ))}
        </div>
      </div>

      {addOpen && (
        <McpEditDialog original={null} onClose={() => setAddOpen(false)} onSaved={load} />
      )}
      {editing && (
        <McpEditDialog original={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}
      {deleting && (
        <ConfirmDialog
          title={`删除 MCP 服务器「${deleting.name}」？`}
          description="中央库、所有 Agent 定义和 OMP 启用/停用列表将作为一个事务删除；失败时自动回滚。"
          onConfirm={() => void handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
