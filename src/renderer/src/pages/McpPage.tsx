import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Braces,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { AgentId, McpServerConfig, McpServerInfo } from '@shared/types'
import { AGENT_IDS } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { cn } from '../lib/utils'
import { AgentIcon } from '../components/AgentIcon'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'

/** 常用 MCP 预设（与 cc-switch 对齐），选中后自动填名称和配置 */
const PRESETS: { key: string; name: string; config: McpServerConfig }[] = [
  {
    key: 'fetch',
    name: 'fetch',
    config: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] }
  },
  { key: 'time', name: 'time', config: { command: 'uvx', args: ['mcp-server-time'] } },
  {
    key: 'memory',
    name: 'memory',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
  },
  {
    key: 'sequential-thinking',
    name: 'sequential-thinking',
    config: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] }
  },
  {
    key: 'context7',
    name: 'context7',
    config: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
  }
]

/** 展示用：stdio 显示命令行，http/sse 显示 url */
function summarize(config: McpServerConfig): string {
  if (typeof config.url === 'string') return config.url
  const cmd = typeof config.command === 'string' ? config.command : ''
  const args = Array.isArray(config.args) ? config.args.map(String).join(' ') : ''
  return `${cmd} ${args}`.trim()
}

function typeOf(config: McpServerConfig): string {
  return typeof config.type === 'string' ? config.type : 'stdio'
}

/** 添加/编辑 MCP 服务器弹框：预设模板 + 名称 + JSON 配置 + 启用到哪些 Agent */
function McpEditDialog({
  original,
  onClose,
  onSaved
}: {
  /** 编辑时传现有项，新增为 null */
  original: McpServerInfo | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { statuses } = useApp()
  const [name, setName] = useState(original?.name ?? '')
  const [jsonText, setJsonText] = useState(
    JSON.stringify(original?.config ?? { command: '', args: [] }, null, 2)
  )
  // 新增默认启用到已检测安装的 Agent，编辑保持现状
  const [agents, setAgents] = useState<Set<AgentId>>(
    () =>
      new Set(
        original
          ? original.agents
          : AGENT_IDS.filter((id) => statuses.find((s) => s.id === id)?.installed)
      )
  )
  const [saving, setSaving] = useState(false)

  const applyPreset = (key: string): void => {
    const preset = PRESETS.find((p) => p.key === key)
    if (!preset) return
    setName(preset.name)
    setJsonText(JSON.stringify(preset.config, null, 2))
  }

  const handleFormat = (): void => {
    try {
      setJsonText(`${JSON.stringify(JSON.parse(jsonText), null, 2)}`)
    } catch (error) {
      toast.error(`JSON 格式错误：${errorMessage(error)}`)
    }
  }

  const toggleAgent = (id: AgentId): void => {
    setAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    let config: unknown
    try {
      config = JSON.parse(jsonText)
    } catch (error) {
      toast.error(`JSON 格式错误：${errorMessage(error)}`)
      return
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      toast.error('配置必须是 JSON 对象')
      return
    }
    setSaving(true)
    try {
      await window.api.saveMcpServer(original?.name ?? null, trimmed, config as McpServerConfig)
      // 按弹框里的勾选同步启用状态（saveMcpServer 已保持原有启用项的定义最新）
      for (const id of AGENT_IDS) {
        const want = agents.has(id)
        const had = original?.agents.includes(id) ?? false
        if (want !== had) await window.api.toggleMcpServer(trimmed, id, want)
      }
      toast.success(original ? '已保存 MCP 服务器' : '已添加 MCP 服务器')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{original ? `编辑 ${original.name}` : '添加 MCP 服务器'}</DialogTitle>
          <DialogDescription>stdio 填 command/args，远程服务填 type: http 与 url</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
          {!original && (
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    name === p.name
                      ? 'border-primary bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-black/[0.08] dark:border-white/[0.1]'
                  )}
                >
                  {p.key}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">名称</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如 context7"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">配置（JSON）</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleFormat}>
                <Braces className="size-3.5" />
                格式化
              </Button>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
              rows={9}
              className="border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-md border px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">启用到</span>
            <div className="flex gap-2">
              {AGENT_IDS.map((id) => {
                const status = statuses.find((s) => s.id === id)
                const checked = agents.has(id)
                return (
                  <button
                    key={id}
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
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
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<McpServerInfo | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [deleting, setDeleting] = useState<McpServerInfo | null>(null)
  /** 正在切换的 "name/agent"，防止连点 */
  const [toggling, setToggling] = useState<string | null>(null)

  // promise 链写法：setState 都在回调里，避免 effect 中同步 setState
  const load = useCallback(
    (): Promise<void> =>
      window.api
        .listMcpServers()
        .then(setServers)
        .catch((error: unknown) => {
          toast.error(`读取 MCP 列表失败：${errorMessage(error)}`)
        })
        .finally(() => setLoading(false)),
    []
  )

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
    try {
      await window.api.toggleMcpServer(server.name, agentId, enabled)
      await load()
    } catch (error) {
      toast.error(`${enabled ? '启用' : '停用'}失败：${errorMessage(error)}`)
    } finally {
      setToggling(null)
    }
  }

  const handleDelete = async (server: McpServerInfo): Promise<void> => {
    try {
      await window.api.deleteMcpServer(server.name)
      toast.success(`已删除 ${server.name}`)
      await load()
    } catch (error) {
      toast.error(`删除失败：${errorMessage(error)}`)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            title="返回"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">MCP 管理</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              MCP 服务器统一存中央库，通过开关写入 / 移出各 Agent 的 mcp.json
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            title="打开 MCP 中央库所在目录"
            onClick={() => void window.api.showMcpInFolder()}
          >
            <FolderOpen />
            打开目录
          </Button>
          <Button variant="outline" size="sm" title="重新读取" onClick={() => void load()}>
            <RefreshCw />
            刷新
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            添加 MCP
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {loading && <div className="text-muted-foreground py-16 text-center text-sm">加载中…</div>}

        {!loading && servers.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
            还没有 MCP 服务器。点击「添加 MCP」新建，把服务器统一管理并同步到各 Agent。
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {servers.map((server) => (
            <div
              key={server.name}
              className="bg-card flex items-center gap-4 rounded-xl border border-black/[0.06] px-4 py-3 shadow-xs dark:border-white/[0.08]"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{server.name}</span>
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {typeOf(server.config)}
                  </Badge>
                </div>
                <span className="text-muted-foreground/80 truncate font-mono text-xs">
                  {summarize(server.config)}
                </span>
              </div>

              {/* 各 Agent 启用开关 */}
              <div className="flex shrink-0 items-center gap-4">
                {agentOrder.map((agentId) => {
                  const status = statuses.find((s) => s.id === agentId)
                  const enabled = server.agents.includes(agentId)
                  const busy = toggling === `${server.name}/${agentId}`
                  return (
                    <div
                      key={agentId}
                      className="flex items-center gap-1.5"
                      title={`${enabled ? '停用' : '启用到'} ${status?.label ?? agentId}`}
                    >
                      <AgentIcon agent={agentId} className="size-4.5" />
                      <Switch
                        checked={enabled}
                        disabled={busy}
                        onCheckedChange={(checked) => void handleToggle(server, agentId, checked)}
                      />
                    </div>
                  )
                })}
              </div>

              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  title="编辑"
                  onClick={() => setEditing(server)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  title="删除（会同时从所有 Agent 移除）"
                  onClick={() => setDeleting(server)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {addOpen && (
        <McpEditDialog
          original={null}
          onClose={() => setAddOpen(false)}
          onSaved={() => void load()}
        />
      )}
      {editing && (
        <McpEditDialog
          original={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`删除 MCP 服务器「${deleting.name}」？`}
          description="会先从所有 Agent 的 mcp.json 移除，再从中央库删除。"
          onConfirm={() => void handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
