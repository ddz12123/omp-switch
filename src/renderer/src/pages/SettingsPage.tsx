import { useEffect, useCallback, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  FolderPen,
  Github,
  GripVertical,
  Info,
  Loader2,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Sun,
  Trash2
} from 'lucide-react'
import type { AgentId, SessionRootInfo, SkillSyncMode, UpdaterEvent } from '@shared/types'
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

export default function SettingsPage(): React.JSX.Element {
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
    removeSessionCustomDir
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

  // 应用版本号 + 自更新状态（版本号一次性获取，更新事件由主进程推送）
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdaterEvent>({ status: 'idle' })
  useEffect(() => {
    void window.api
      .appVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(''))
    return window.api.onUpdaterEvent(setUpdate)
  }, [])

  const updateBusy = update.status === 'checking' || update.status === 'downloading'
  const handleCheckUpdate = (): void => {
    setUpdate({ status: 'checking' })
    void window.api.checkForUpdates()
  }
  const handleDownloadUpdate = (): void => {
    setUpdate({ status: 'downloading', percent: 0 })
    void window.api.downloadUpdate()
  }
  const handleInstallUpdate = (): void => {
    void window.api.quitAndInstallUpdate()
  }
  const updateBanner = updaterBanner(update)

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

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">设置</h2>

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
                <span title={lastVisible ? '至少保留一个 Agent 显示' : visible ? '隐藏' : '显示'}>
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
            <Label className="text-muted-foreground shrink-0 text-sm font-normal">同步方式</Label>
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
              <span className="font-medium">
                {status.label}
                {!status.installed && (
                  <span className="text-muted-foreground ml-2 font-normal">未检测到</span>
                )}
              </span>
              <span className="text-muted-foreground font-mono">{status.mcpPath}</span>
            </div>
          ))}
        </CardContent>
      </Card>

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
              <span className="font-medium">
                {status.label}
                {!status.installed && (
                  <span className="text-muted-foreground ml-2 font-normal">未检测到</span>
                )}
              </span>
              <span className="text-muted-foreground font-mono">{status.providersPath}</span>
              <span className="text-muted-foreground font-mono">{status.switchPath}</span>
            </div>
          ))}
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
              {update.status === 'downloaded' ? (
                <Button size="sm" onClick={handleInstallUpdate}>
                  <RotateCw />
                  重启并安装
                </Button>
              ) : update.status === 'available' ? (
                <Button size="sm" onClick={handleDownloadUpdate}>
                  <Download />
                  更新到 v{update.version}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updateBusy}
                  onClick={handleCheckUpdate}
                >
                  {updateBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {update.status === 'checking'
                    ? '检查中…'
                    : update.status === 'downloading'
                      ? `下载中 ${update.percent ?? 0}%`
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
                {update.status === 'error' ? (
                  <AlertCircle className="size-4 shrink-0" />
                ) : update.status === 'checking' || update.status === 'downloading' ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                ) : update.status === 'available' ? (
                  <Sparkles className="size-4 shrink-0" />
                ) : update.status === 'downloaded' || update.status === 'not-available' ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <Info className="size-4 shrink-0" />
                )}
                <span>{updateBanner.text}</span>
              </div>
              {update.status === 'downloading' && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-500/20">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                    style={{ width: `${update.percent ?? 0}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
