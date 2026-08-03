import { useEffect, useCallback, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPen,
  Github,
  GripVertical,
  Info,
  Loader2,
  MessagesSquare,
  Monitor,
  Moon,
  Plug,
  Plus,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Trash2,
  Wrench
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentId,
  CliVersionInfo,
  SessionRootInfo,
  SkillSyncMode,
  UpdaterEvent
} from '@shared/types'
import type { Theme } from '../lib/theme'
import type { CloseBehavior } from '../lib/closeBehavior'
import { useApp } from '../stores/app'
import { cn } from '../lib/utils'
import { AgentIcon } from '../components/AgentIcon'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import appIcon from '../assets/app-icon.png'

/** 开源仓库地址（关于卡片的 GitHub / 更新日志入口） */
const REPO_URL = 'https://github.com/ddz12123/omp-switch'
const RELEASES_URL = `${REPO_URL}/releases`

const THEME_OPTIONS: {
  value: Theme
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor }
]

const CLOSE_OPTIONS: { value: CloseBehavior; label: string }[] = [
  { value: 'ask', label: '每次询问' },
  { value: 'minimize', label: '最小化到托盘' },
  { value: 'quit', label: '直接退出' }
]

const SYNC_OPTIONS: { value: SkillSyncMode; label: string; hint: string }[] = [
  { value: 'symlink', label: '软链接', hint: '推荐：不占空间，技能更新实时生效' },
  { value: 'copy', label: '文件复制', hint: '独立副本，兼容性最好' }
]

/** 设置页顶部分区标签（本地环境检查归在「关于」内，与 cc-switch 一致） */
type SettingsTab = 'general' | 'skills' | 'mcp' | 'sessions' | 'about'

const SETTINGS_TABS: {
  value: SettingsTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { value: 'general', label: '通用', icon: SlidersHorizontal },
  { value: 'skills', label: 'Skills', icon: Wrench },
  { value: 'mcp', label: 'MCP', icon: Plug },
  { value: 'sessions', label: '会话', icon: MessagesSquare },
  { value: 'about', label: '关于', icon: Info }
]

/** 单个 CLI 的环境状态（卡片右上角图标 + 底部状态文案） */
type CliState = 'loading' | 'missing' | 'update' | 'ready' | 'unknown'

function cliState(cli: CliVersionInfo, loading: boolean): CliState {
  if (loading) return 'loading'
  if (!cli.installed) return 'missing'
  if (cli.hasUpdate) return 'update'
  if (cli.latest) return 'ready'
  return 'unknown'
}

const CLI_STATE_TEXT: Record<CliState, string> = {
  loading: '检测中…',
  missing: '未安装',
  update: '可升级',
  ready: '已就绪',
  unknown: '无法获取最新版'
}

/** 会话根目录来源徽章文案 */
function sessionRootBadge(root: SessionRootInfo): string {
  switch (root.kind) {
    case 'omp-default':
      return 'OMP · 默认'
    case 'pi-default':
      return 'Pi · 默认'
    case 'env-agent-dir':
      return 'env · AGENT_DIR'
    case 'env-session-dir':
      return 'env · SESSION_DIR'
    case 'config-session-dir':
      return '配置 · sessionDir'
    default:
      return '手动'
  }
}

/** 自更新提示条的语气 */
type BannerTone = 'info' | 'error' | 'muted'

const BANNER_TONE: Record<BannerTone, string> = {
  info: 'border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground'
}

/** 根据更新状态生成提示条内容；idle 时不显示提示条 */
function updaterBanner(event: UpdaterEvent): { tone: BannerTone; text: string } | null {
  switch (event.status) {
    case 'checking':
      return { tone: 'muted', text: '正在检查更新…' }
    case 'available':
      return { tone: 'info', text: `检测到新版本 v${event.version}` }
    case 'not-available':
      return { tone: 'muted', text: '已是最新版本' }
    case 'downloading':
      return { tone: 'info', text: `正在下载更新 ${event.percent ?? 0}%` }
    case 'downloaded':
      return { tone: 'info', text: `新版本 v${event.version} 已下载，重启后完成安装` }
    case 'dev':
      return { tone: 'muted', text: '当前为开发版本，暂不检查更新' }
    case 'error':
      return { tone: 'error', text: `检查失败：${event.message ?? '未知错误'}` }
    default:
      return null
  }
}

export default function SettingsPage({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const {
    theme,
    setTheme,
    closeBehavior,
    setCloseBehavior,
    statuses,
    agentOrder,
    hiddenAgents,
    setAgentOrder,
    setAgentHidden,
    appConfigPath,
    changeAppConfigDir,
    skillsDir,
    skillsSyncMode,
    setSkillsSyncMode,
    changeSkillsDir,
    addSessionCustomDir,
    removeSessionCustomDir,
    updater,
    checkUpdate,
    downloadUpdate,
    installUpdate
  } = useApp()

  // MCP 中央库路径异步获取（仅设置页展示）
  const [mcpStorePath, setMcpStorePath] = useState('')
  useEffect(() => {
    void window.api
      .mcpStorePath()
      .then(setMcpStorePath)
      .catch(() => setMcpStorePath(''))
  }, [])

  // 会话根目录列表（默认 home + env + 手动），随手动目录增删刷新
  const [sessionRoots, setSessionRoots] = useState<SessionRootInfo[]>([])
  const loadSessionRoots = useCallback(
    (): Promise<void> =>
      window.api
        .sessionRoots()
        .then(setSessionRoots)
        .catch(() => setSessionRoots([])),
    []
  )
  useEffect(() => {
    void loadSessionRoots()
  }, [loadSessionRoots])

  const handleAddSessionDir = async (): Promise<void> => {
    await addSessionCustomDir()
    await loadSessionRoots()
  }
  const handleRemoveSessionDir = async (path: string): Promise<void> => {
    await removeSessionCustomDir(path)
    await loadSessionRoots()
  }

  // 应用版本号一次性获取；自更新状态与首页角标共用 store（主进程事件推送，双端同步）
  const [appVersion, setAppVersion] = useState('')
  useEffect(() => {
    void window.api
      .appVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(''))
  }, [])

  const updateBusy = updater.status === 'checking' || updater.status === 'downloading'
  const updateBanner = updaterBanner(updater)

  // 拖拽排序：拖动中用本地预览顺序实时换位，松手才提交持久化
  const [dragging, setDragging] = useState<AgentId | null>(null)
  const [previewOrder, setPreviewOrder] = useState<AgentId[] | null>(null)
  const displayOrder = previewOrder ?? agentOrder
  const visibleCount = agentOrder.filter((id) => !hiddenAgents.includes(id)).length

  const handleDragOver = (target: AgentId): void => {
    if (!dragging || dragging === target) return
    const order = [...(previewOrder ?? agentOrder)]
    const from = order.indexOf(dragging)
    const to = order.indexOf(target)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, dragging)
    setPreviewOrder(order)
  }

  const handleDragEnd = (): void => {
    if (previewOrder && previewOrder.join() !== agentOrder.join()) {
      setAgentOrder(previewOrder)
    }
    setDragging(null)
    setPreviewOrder(null)
  }

  // 顶部分区：默认通用；本地环境检查在「关于」内，首次进入才懒加载（避免每次开设置都跑 CLI）
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [cliVersions, setCliVersions] = useState<CliVersionInfo[]>([])
  const [cliLoading, setCliLoading] = useState(false)
  const [cliLoaded, setCliLoaded] = useState(false)
  const loadCliVersions = useCallback((): Promise<void> => {
    setCliLoading(true)
    setCliLoaded(true)
    return window.api
      .cliVersions()
      .then(setCliVersions)
      .catch(() => setCliVersions([]))
      .finally(() => setCliLoading(false))
  }, [])
  const handleTabChange = (tab: SettingsTab): void => {
    setActiveTab(tab)
    // 首次切到关于（含环境检查）才触发 CLI 检测，之后靠「刷新」按钮手动重查
    if (tab === 'about' && !cliLoaded) void loadCliVersions()
    // 进入关于页自动检查一次应用更新（仅尚未检查过/上次失败时；已有结果不重复触发，避免闪烁）
    if (tab === 'about' && (updater.status === 'idle' || updater.status === 'error')) {
      checkUpdate()
    }
  }

  // 命令对话框：install 模式展示所有 CLI 的安装命令；upgrade 模式展示指定 CLI 的升级命令
  const [cmdDialog, setCmdDialog] = useState<{
    mode: 'install' | 'upgrade'
    cli: CliVersionInfo | null
  } | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const handleCopyCommand = async (cmd: string): Promise<void> => {
    if (!cmd) return
    await navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    toast.success('已复制命令')
    setTimeout(() => setCopiedCmd(null), 1500)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
          title="返回"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <h2 className="text-lg font-semibold">设置</h2>

        <div className="bg-muted/60 ml-1 flex w-fit items-center gap-1 rounded-xl p-1">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => handleTabChange(t.value)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm transition-all duration-200 [transition-timing-function:var(--ease-fluid)]',
                activeTab === t.value
                  ? 'bg-card text-foreground font-medium shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {activeTab === 'general' && (
          <div className="flex flex-col gap-5">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>外观</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        'flex w-28 flex-col items-center gap-2 rounded-lg border py-4 text-sm transition-colors',
                        theme === option.value
                          ? 'border-primary bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <option.icon className="size-5" />
                      {option.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Agent</CardTitle>
                <CardDescription>调整主界面顶部 Agent 的显示与顺序</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {displayOrder.map((id) => {
                  const status = statuses.find((s) => s.id === id)
                  const visible = !hiddenAgents.includes(id)
                  const lastVisible = visible && visibleCount === 1
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragging(id)
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        handleDragOver(id)
                      }}
                      onDrop={(e) => e.preventDefault()}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'bg-card flex cursor-grab items-center gap-3 rounded-lg border border-black/[0.06] px-3 py-2.5 shadow-xs transition-all duration-200 select-none active:cursor-grabbing dark:border-white/[0.08]',
                        dragging === id && 'scale-[0.99] opacity-40 shadow-md',
                        !visible && dragging !== id && 'opacity-50'
                      )}
                    >
                      <GripVertical className="text-muted-foreground/60 size-4 shrink-0" />
                      <AgentIcon agent={id} className="size-6" />
                      <div className="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
                        <span className="font-medium">{status?.label ?? id}</span>
                        {status && !status.installed && (
                          <span className="text-muted-foreground text-xs">未检测到配置</span>
                        )}
                      </div>
                      <span
                        title={lastVisible ? '至少保留一个 Agent 显示' : visible ? '隐藏' : '显示'}
                      >
                        <Switch
                          checked={visible}
                          disabled={lastVisible}
                          onCheckedChange={(checked) => setAgentHidden(id, !checked)}
                        />
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <Card className="gap-3">
              <CardHeader>
                <CardTitle>窗口</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Label className="text-muted-foreground shrink-0 text-sm font-normal">
                    点击关闭按钮时
                  </Label>
                  <Select
                    value={closeBehavior}
                    onValueChange={(v) => setCloseBehavior(v as CloseBehavior)}
                  >
                    <SelectTrigger className="w-44" size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CLOSE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="flex flex-col gap-5">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>Skills</CardTitle>
                <CardDescription>技能统一存在中央目录，按下方方式同步到各 Agent</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="font-medium">存储位置</span>
                    <span className="text-muted-foreground truncate font-mono">
                      {skillsDir || '加载中…'}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      title="在资源管理器中打开技能目录"
                      onClick={() => void window.api.showSkillsDirInFolder()}
                    >
                      <FolderOpen />
                      打开目录
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="选择新目录，技能会自动迁移并重建同步"
                      onClick={() => void changeSkillsDir()}
                    >
                      <FolderPen />
                      更改位置
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-muted-foreground shrink-0 text-sm font-normal">
                    同步方式
                  </Label>
                  <div className="bg-muted flex rounded-lg p-0.5">
                    {SYNC_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        title={option.hint}
                        onClick={() => void setSkillsSyncMode(option.value)}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-sm transition-colors',
                          skillsSyncMode === option.value
                            ? 'bg-background text-foreground font-medium shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {SYNC_OPTIONS.find((o) => o.value === skillsSyncMode)?.hint}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="flex flex-col gap-5">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>MCP</CardTitle>
                <CardDescription>
                  MCP 服务器统一存在中央库，启用时写入各 Agent 的 mcp.json（无软链接/复制之分）
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="font-medium">中央库</span>
                    <span className="text-muted-foreground truncate font-mono">
                      {mcpStorePath || '加载中…'}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      title="在资源管理器中显示 MCP 中央库文件"
                      onClick={() => void window.api.showMcpInFolder()}
                    >
                      <FolderOpen />
                      打开目录
                    </Button>
                  </div>
                </div>
                {statuses.map((status) => (
                  <div key={status.id} className="flex flex-col gap-1 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <AgentIcon agent={status.id} className="size-4 shrink-0" />
                      {status.label}
                      {!status.installed && (
                        <span className="text-muted-foreground font-normal">未检测到</span>
                      )}
                    </span>
                    <span className="text-muted-foreground font-mono">{status.mcpPath}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="flex flex-col gap-5">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle>会话目录</CardTitle>
                <CardDescription>
                  pi / omp 共用 PI_CODING_AGENT_DIR 与 PI_CODING_AGENT_SESSION_DIR
                  环境变量；下列目录会在「会话」页按目录分组展示
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {sessionRoots.map((root) => (
                  <div key={root.id} className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="flex items-center gap-2 font-medium">
                        {root.kind === 'omp-default' && (
                          <AgentIcon agent="omp" className="size-4 shrink-0" />
                        )}
                        {root.kind === 'pi-default' && (
                          <AgentIcon agent="pi" className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{root.label}</span>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {sessionRootBadge(root)}
                        </Badge>
                        {!root.exists && (
                          <span className="text-muted-foreground shrink-0 text-xs font-normal">
                            不存在
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground truncate font-mono">{root.path}</span>
                    </div>
                    {root.kind === 'custom' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        title="移除该会话目录（不删除磁盘文件）"
                        onClick={() => void handleRemoveSessionDir(root.path)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    title="选择一个目录加入会话扫描范围"
                    onClick={() => void handleAddSessionDir()}
                  >
                    <Plus />
                    添加会话目录
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="flex flex-col gap-5">
            <Card className="gap-3">
              <CardHeader className="flex-row items-center justify-between gap-4">
                <div className="flex flex-col gap-1.5">
                  <CardTitle>本地环境检查</CardTitle>
                  <CardDescription>
                    查看 pi / omp 命令行的版本状态，可复制安装或升级命令自行执行
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCmdDialog({ mode: 'install', cli: null })}
                  >
                    <Terminal />
                    安装命令
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cliLoading}
                    onClick={() => void loadCliVersions()}
                  >
                    {cliLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    刷新
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {cliLoading && cliVersions.length === 0 ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    正在检测本地版本…
                  </div>
                ) : cliVersions.length === 0 ? (
                  <div className="text-muted-foreground py-6 text-sm">暂无可检测的命令行工具</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {cliVersions.map((cli) => {
                      const state = cliState(cli, cliLoading)
                      return (
                        <div
                          key={cli.id}
                          className="bg-card flex flex-col gap-3 rounded-lg border border-black/[0.06] p-3 shadow-xs dark:border-white/[0.08]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <AgentIcon agent={cli.id} className="size-8 shrink-0" />
                              <span className="text-sm font-medium">{cli.label}</span>
                            </div>
                            {state === 'loading' ? (
                              <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
                            ) : state === 'ready' ? (
                              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                            ) : state === 'update' ? (
                              <Sparkles className="size-4 shrink-0 text-amber-500" />
                            ) : (
                              <AlertCircle className="size-4 shrink-0 text-amber-500" />
                            )}
                          </div>
                          <div className="flex flex-col gap-1 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">当前版本</span>
                              <span className="font-mono">{cli.current || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">最新版本</span>
                              <span className="font-mono">{cli.latest || '—'}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'text-xs',
                                state === 'ready'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : state === 'update'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-muted-foreground'
                              )}
                            >
                              {CLI_STATE_TEXT[state]}
                            </span>
                            {!cli.installed ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCmdDialog({ mode: 'install', cli })}
                              >
                                <Terminal />
                                安装
                              </Button>
                            ) : cli.hasUpdate ? (
                              <Button
                                size="sm"
                                onClick={() => setCmdDialog({ mode: 'upgrade', cli })}
                              >
                                <Download />
                                升级
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="gap-3">
              <CardHeader>
                <CardTitle>关于</CardTitle>
                <CardDescription>查看版本信息与检查更新</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={appIcon}
                      alt="OMP Switch"
                      className="size-12 rounded-xl shadow-sm"
                      draggable={false}
                    />
                    <div className="flex flex-col gap-1.5">
                      <span className="text-base leading-none font-semibold">OMP Switch</span>
                      <Badge variant="secondary" className="w-fit font-normal">
                        版本 v{appVersion || '…'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      title="在浏览器中打开 GitHub 仓库"
                      onClick={() => void window.api.openExternal(REPO_URL)}
                    >
                      <Github />
                      GitHub
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="查看历史版本与更新日志"
                      onClick={() => void window.api.openExternal(RELEASES_URL)}
                    >
                      <ExternalLink />
                      更新日志
                    </Button>
                    {updater.status === 'downloaded' ? (
                      <Button size="sm" onClick={installUpdate}>
                        <RotateCw />
                        重启并安装
                      </Button>
                    ) : updater.status === 'available' ? (
                      <Button size="sm" onClick={downloadUpdate}>
                        <Download />
                        更新到 v{updater.version}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={updateBusy}
                        onClick={checkUpdate}
                      >
                        {updateBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        {updater.status === 'checking'
                          ? '检查中…'
                          : updater.status === 'downloading'
                            ? `下载中 ${updater.percent ?? 0}%`
                            : '检查更新'}
                      </Button>
                    )}
                  </div>
                </div>

                {updateBanner && (
                  <div
                    className={cn(
                      'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm',
                      BANNER_TONE[updateBanner.tone]
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {updater.status === 'error' ? (
                        <AlertCircle className="size-4 shrink-0" />
                      ) : updater.status === 'checking' || updater.status === 'downloading' ? (
                        <Loader2 className="size-4 shrink-0 animate-spin" />
                      ) : updater.status === 'available' ? (
                        <Sparkles className="size-4 shrink-0" />
                      ) : updater.status === 'downloaded' || updater.status === 'not-available' ? (
                        <CheckCircle2 className="size-4 shrink-0" />
                      ) : (
                        <Info className="size-4 shrink-0" />
                      )}
                      <span>{updateBanner.text}</span>
                    </div>
                    {updater.status === 'downloading' && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-500/20">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                          style={{ width: `${updater.percent ?? 0}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="gap-3">
              <CardHeader>
                <CardTitle>配置文件路径</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="font-medium">OMP Switch（本应用：主题、官网映射等）</span>
                    <span className="text-muted-foreground truncate font-mono">
                      {appConfigPath || '加载中…'}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      title="在资源管理器中显示配置文件"
                      onClick={() => void window.api.showAppConfigInFolder()}
                    >
                      <FolderOpen />
                      打开目录
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="选择新目录，配置会自动迁移过去"
                      onClick={() => void changeAppConfigDir()}
                    >
                      <FolderPen />
                      更改位置
                    </Button>
                  </div>
                </div>
                {statuses.map((status) => (
                  <div key={status.id} className="flex flex-col gap-1 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <AgentIcon agent={status.id} className="size-4 shrink-0" />
                      {status.label}
                      {!status.installed && (
                        <span className="text-muted-foreground font-normal">未检测到</span>
                      )}
                    </span>
                    <span className="text-muted-foreground font-mono">{status.providersPath}</span>
                    <span className="text-muted-foreground font-mono">{status.switchPath}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={cmdDialog !== null} onOpenChange={(open) => !open && setCmdDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cmdDialog?.mode === 'install'
                ? cmdDialog.cli
                  ? `安装 ${cmdDialog.cli.label}`
                  : '安装命令'
                : `升级 ${cmdDialog?.cli?.label ?? ''}`}
            </DialogTitle>
            <DialogDescription>
              {cmdDialog?.mode === 'install'
                ? '复制对应命令行工具的命令，在终端中执行即可安装（已安装则为重装到最新）。'
                : cmdDialog?.cli
                  ? `当前 v${cmdDialog.cli.current || '—'} → 最新 v${cmdDialog.cli.latest || '—'}，${
                      cmdDialog.cli.upgradeCommands.length > 1
                        ? '任选下面一条命令在终端中执行即可。'
                        : '复制下面的命令在终端中执行即可。'
                    }`
                  : ''}
            </DialogDescription>
          </DialogHeader>
          {cmdDialog?.mode === 'install' ? (
            <div className="flex flex-col gap-4">
              {(cmdDialog.cli ? [cmdDialog.cli] : cliVersions).map((cli) => (
                <div key={cli.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <AgentIcon agent={cli.id} className="size-5 shrink-0" />
                    <span className="text-sm font-medium">{cli.label}</span>
                  </div>
                  {cli.installCommands.map((cmd) => (
                    <div
                      key={cmd}
                      className="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2.5"
                    >
                      <code className="flex-1 font-mono text-sm break-all">{cmd}</code>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="复制命令"
                        onClick={() => void handleCopyCommand(cmd)}
                      >
                        {copiedCmd === cmd ? <Check /> : <Copy />}
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(cmdDialog?.cli?.upgradeCommands ?? []).map((cmd) => (
                <div
                  key={cmd}
                  className="bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2.5"
                >
                  <code className="flex-1 font-mono text-sm break-all">{cmd}</code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    title="复制命令"
                    onClick={() => void handleCopyCommand(cmd)}
                  >
                    {copiedCmd === cmd ? <Check /> : <Copy />}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCmdDialog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
