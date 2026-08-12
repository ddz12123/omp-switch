import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Blocks,
  CircleAlert,
  CloudDownload,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  ListFilter,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  Terminal,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  PiLocalExtensionInfo,
  PiPluginInfo,
  PiPluginOperationKind,
  PiPluginResources,
  PiPluginSearchItem,
  PiPluginsListResult,
  PiPluginSourceKind
} from '@shared/types'
import ConfirmDialog from '../components/ConfirmDialog'
import ConfigFileDialog from '../components/ConfigFileDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Switch } from '../components/ui/switch'
import { cn } from '../lib/utils'
import { errorMessage } from '../stores/app'

const RESOURCE_TYPES: (keyof PiPluginResources)[] = ['extensions', 'skills', 'prompts', 'themes']

const RESOURCE_LABEL: Record<keyof PiPluginResources, string> = {
  extensions: 'Extension',
  skills: 'Skill',
  prompts: 'Prompt',
  themes: 'Theme'
}

const SOURCE_LABEL: Record<PiPluginSourceKind, string> = {
  npm: 'npm',
  git: 'Git',
  local: '本地'
}

const OPERATION_LABEL: Record<PiPluginOperationKind, string> = {
  install: '安装',
  update: '更新',
  'update-all': '更新全部',
  remove: '卸载',
  toggle: '切换状态'
}

type TabId = 'installed' | 'local'
type InstallMode = 'search' | 'source'

interface BusyOperation {
  kind: PiPluginOperationKind
  source?: string
}

interface PluginCardProps {
  plugin: PiPluginInfo
  busy: BusyOperation | null
  onToggle: (plugin: PiPluginInfo, enabled: boolean) => void
  onUpdate: (plugin: PiPluginInfo) => void
  onRemove: (plugin: PiPluginInfo) => void
}

function PluginCard({
  plugin,
  busy,
  onToggle,
  onUpdate,
  onRemove
}: PluginCardProps): React.JSX.Element {
  const active = busy?.source === plugin.source
  const sourceUrl =
    plugin.homepage ??
    plugin.repository ??
    (plugin.sourceKind === 'npm'
      ? `https://www.npmjs.com/package/${encodeURIComponent(plugin.name)}`
      : undefined)
  const resources = RESOURCE_TYPES.filter((type) => plugin.resources[type].length > 0)
  const canUpdate = plugin.installed && plugin.updateState === 'available'

  let updateLabel: string | null = null
  let updateClass = ''
  if (plugin.updateState === 'available') {
    updateLabel = plugin.latestVersion ? `可更新 ${plugin.latestVersion}` : '有更新'
    updateClass = 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300'
  } else if (plugin.updateState === 'current') {
    updateLabel = '已是最新'
    updateClass = 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  } else if (plugin.updateState === 'pinned') {
    updateLabel = '版本固定'
    updateClass = 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300'
  } else if (plugin.updateState === 'error') {
    updateLabel = '检查失败'
    updateClass = 'border-transparent bg-destructive/10 text-destructive'
  }

  return (
    <Card
      className={cn(
        'group supports-[backdrop-filter]:bg-card/85 supports-[backdrop-filter]:backdrop-blur-sm gap-0 overflow-hidden py-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0'
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="from-primary/15 to-primary/5 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-primary/10">
          <Blocks className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{plugin.name}</h3>
            {plugin.version && (
              <span className="text-muted-foreground font-mono text-[11px]">v{plugin.version}</span>
            )}
            <Badge variant="secondary" className="font-mono text-[10px]">
              {SOURCE_LABEL[plugin.sourceKind]}
            </Badge>
            {!plugin.installed && (
              <Badge variant="destructive" className="text-[10px]">
                安装缺失
              </Badge>
            )}
            {updateLabel && (
              <Badge
                variant="outline"
                className={cn('text-[10px]', updateClass)}
                title={plugin.updateError}
              >
                {updateLabel}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 min-h-8 line-clamp-2 text-xs leading-relaxed">
            {plugin.description || '该 Package 没有提供描述。'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="打开安装位置"
            disabled={!plugin.installedPath || busy !== null}
            onClick={() =>
              void window.api
                .showPiPluginInFolder(plugin.source)
                .catch((error) => toast.error(`打开失败：${errorMessage(error)}`))
            }
          >
            <FolderOpen />
          </Button>
          {sourceUrl && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="查看插件主页"
              disabled={busy !== null}
              onClick={() => void window.api.openExternal(sourceUrl)}
            >
              <ExternalLink />
            </Button>
          )}
          {canUpdate && (
            <Button
              variant="outline"
              size="sm"
              className="ml-1"
              disabled={busy !== null}
              onClick={() => onUpdate(plugin)}
            >
              {active && busy?.kind === 'update' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CloudDownload />
              )}
              更新
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-8"
            title="卸载插件"
            disabled={busy !== null}
            onClick={() => onRemove(plugin)}
          >
            {active && busy?.kind === 'remove' ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      </div>

      <div className="bg-muted/35 border-border/50 mx-4 mt-4 flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
        <Terminal className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <code className="text-muted-foreground min-w-0 flex-1 truncate text-[11px]">
          {plugin.source}
        </code>
      </div>

      <div className="mt-4 flex min-h-12 items-center gap-2 border-t px-4 py-3">
        {resources.length > 0 ? (
          resources.map((type) => (
            <Badge
              key={type}
              variant="outline"
              className="text-muted-foreground text-[10px]"
              title={plugin.resources[type].join('\n')}
            >
              {RESOURCE_LABEL[type]}
              <span className="opacity-60">{plugin.resources[type].length}</span>
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground/70 text-[11px]">未声明资源清单</span>
        )}
        <div className="flex-1" />
        {plugin.loadState === 'custom' ? (
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
            title="该 Package 配置了精细资源过滤，请在 settings.json 中调整"
          >
            自定义加载
          </Badge>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <span
              className={
                plugin.loadState === 'enabled' ? 'text-foreground' : 'text-muted-foreground'
              }
            >
              {plugin.loadState === 'enabled' ? '已启用' : '已停用'}
            </span>
            <Switch
              checked={plugin.loadState === 'enabled'}
              disabled={busy !== null}
              aria-label={`${plugin.loadState === 'enabled' ? '停用' : '启用'} ${plugin.name}`}
              onCheckedChange={(enabled) => onToggle(plugin, enabled)}
            />
          </label>
        )}
      </div>
    </Card>
  )
}

function LocalExtensionCard({ extension }: { extension: PiLocalExtensionInfo }): React.JSX.Element {
  return (
    <Card className="group supports-[backdrop-filter]:bg-card/85 supports-[backdrop-filter]:backdrop-blur-sm gap-3 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-start gap-3 px-4">
        <div
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl',
            extension.valid
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}
        >
          <FileCode2 className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{extension.name}</h3>
            <Badge variant="secondary" className="text-[10px]">
              {extension.origin === 'auto' ? '自动发现' : '配置路径'}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                extension.valid
                  ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-500/30 text-amber-700 dark:text-amber-300'
              )}
            >
              {extension.valid ? '入口有效' : '需要检查'}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
            {extension.entryPath ?? extension.path}
          </p>
          {extension.issue && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{extension.issue}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="打开所在位置"
          onClick={() =>
            void window.api
              .showPiLocalExtensionInFolder(extension.path)
              .catch((error) => toast.error(`打开失败：${errorMessage(error)}`))
          }
        >
          <FolderOpen />
        </Button>
      </div>
    </Card>
  )
}

export default function PiPluginsPage(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('installed')
  const [result, setResult] = useState<PiPluginsListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showUpdatesOnly, setShowUpdatesOnly] = useState(false)
  const [rawConfigOpen, setRawConfigOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [busy, setBusy] = useState<BusyOperation | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installMode, setInstallMode] = useState<InstallMode>('search')
  const [installSource, setInstallSource] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PiPluginSearchItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const searchRequestIdRef = useRef(0)
  const [removing, setRemoving] = useState<PiPluginInfo | null>(null)

  const load = useCallback(async (checkUpdates = false): Promise<PiPluginsListResult> => {
    const next = await window.api.listPiPlugins(checkUpdates)
    setResult(next)
    setLoadError(null)
    return next
  }, [])

  useEffect(() => {
    void window.api
      .listPiPlugins(false)
      .then((next) => {
        setResult(next)
        setLoadError(null)
      })
      .catch((error: unknown) => setLoadError(errorMessage(error)))
      .finally(() => setLoading(false))
  }, [])

  const updateCount =
    result?.plugins.filter((plugin) => plugin.updateState === 'available').length ?? 0

  const filteredPlugins = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (result?.plugins ?? []).filter((plugin) => {
      if (showUpdatesOnly && plugin.updateState !== 'available') return false
      if (!needle) return true
      return [plugin.name, plugin.source, plugin.description ?? ''].some((value) =>
        value.toLowerCase().includes(needle)
      )
    })
  }, [query, result?.plugins, showUpdatesOnly])

  const perform = async (
    nextBusy: BusyOperation,
    action: () => Promise<void>,
    successMessage: string,
    checkUpdatesAfter = false
  ): Promise<boolean> => {
    if (busy) return false
    setBusy(nextBusy)
    try {
      await action()
      toast.success(successMessage)
      try {
        await load(checkUpdatesAfter)
      } catch (error) {
        toast.error(`操作已完成，但刷新列表失败：${errorMessage(error)}`)
      }
      return true
    } catch (error) {
      toast.error(`${OPERATION_LABEL[nextBusy.kind]}失败：${errorMessage(error)}`)
      return false
    } finally {
      setBusy(null)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await load(false)
    } catch (error) {
      toast.error(`刷新失败：${errorMessage(error)}`)
    } finally {
      setRefreshing(false)
    }
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setCheckingUpdates(true)
    try {
      const next = await load(true)
      const count = next.plugins.filter((plugin) => plugin.updateState === 'available').length
      setShowUpdatesOnly(count > 0)
      toast.success(count > 0 ? `发现 ${count} 个插件可更新，已为你筛选` : '没有发现可用更新')
    } catch (error) {
      toast.error(`检查更新失败：${errorMessage(error)}`)
    } finally {
      setCheckingUpdates(false)
    }
  }

  const resetInstallDialog = (): void => {
    searchRequestIdRef.current += 1
    setInstallMode('search')
    setInstallSource('')
    setSearchQuery('')
    setSearchResults([])
    setSearching(false)
    setSearchError(null)
    setHasSearched(false)
  }

  const closeInstallDialog = (): void => {
    setInstallOpen(false)
    resetInstallDialog()
  }

  const handleSearchPlugins = async (): Promise<void> => {
    const value = searchQuery.trim()
    if (!value || searching) return
    const requestId = ++searchRequestIdRef.current
    setSearching(true)
    setSearchResults([])
    setSearchError(null)
    setHasSearched(true)
    try {
      const searchResult = await window.api.searchPiPlugins(value)
      if (requestId !== searchRequestIdRef.current) return
      setSearchResults(searchResult.items)
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return
      setSearchResults([])
      setSearchError(errorMessage(error))
    } finally {
      if (requestId === searchRequestIdRef.current) setSearching(false)
    }
  }

  const handleUpdateAll = async (): Promise<void> => {
    const updated = await perform(
      { kind: 'update-all' },
      () => window.api.updateAllPiPlugins(),
      '所有可更新插件已更新',
      true
    )
    if (updated) setShowUpdatesOnly(false)
  }

  const handleInstall = async (sourceInput = installSource): Promise<void> => {
    const source = sourceInput.trim()
    if (!source) return
    const installed = await perform(
      { kind: 'install', source },
      () => window.api.installPiPlugin(source),
      `已安装 ${source}`
    )
    if (installed) closeInstallDialog()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 pb-6">
      <div className="flex shrink-0 flex-wrap items-start gap-4">
        <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-current/10">
          <Blocks className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">Pi 插件</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            基于 Pi Packages 管理全局扩展、技能、提示词和主题
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRawConfigOpen(true)}>
            <FileCode2 />
            编辑配置
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void window.api.openExternal('https://pi.dev/packages?type=extension')}
          >
            <ExternalLink />
            官方市场
          </Button>
          <Button size="sm" disabled={busy !== null} onClick={() => setInstallOpen(true)}>
            <PackagePlus />
            安装插件
          </Button>
        </div>
      </div>

      {result?.warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="break-all">{warning}</span>
        </div>
      ))}

      <div className="border-border flex items-center gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab('installed')}
          className={cn(
            'relative px-3 py-2 text-sm font-medium transition-colors',
            tab === 'installed' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          已安装
          {result && <span className="ml-1.5 text-xs opacity-60">{result.plugins.length}</span>}
          {tab === 'installed' && (
            <span className="bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('local')}
          className={cn(
            'relative px-3 py-2 text-sm font-medium transition-colors',
            tab === 'local' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          本地扩展
          {result && (
            <span className="ml-1.5 text-xs opacity-60">{result.localExtensions.length}</span>
          )}
          {tab === 'local' && (
            <span className="bg-primary absolute inset-x-2 -bottom-px h-0.5 rounded-full" />
          )}
        </button>
      </div>

      {tab === 'installed' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、来源或描述"
                className="pl-9"
                aria-label="搜索已安装插件"
              />
            </div>
            {(updateCount > 0 || showUpdatesOnly) && (
              <Button
                variant={showUpdatesOnly ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={showUpdatesOnly}
                onClick={() => setShowUpdatesOnly((current) => !current)}
              >
                <ListFilter />
                可更新 {updateCount}
              </Button>
            )}
            <Button
              variant={updateCount > 0 ? 'default' : 'outline'}
              size="sm"
              disabled={busy !== null || checkingUpdates}
              onClick={() => (updateCount > 0 ? void handleUpdateAll() : void handleCheckUpdates())}
            >
              {checkingUpdates || busy?.kind === 'update-all' ? (
                <Loader2 className="animate-spin" />
              ) : updateCount > 0 ? (
                <CloudDownload />
              ) : (
                <Download />
              )}
              {checkingUpdates
                ? '检查中…'
                : busy?.kind === 'update-all'
                  ? '更新中…'
                  : updateCount > 0
                    ? `更新全部 (${updateCount})`
                    : '检查更新'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="刷新插件列表"
              disabled={busy !== null || refreshing}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
            {loading && (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-20 text-sm">
                <Loader2 className="size-4 animate-spin" />
                正在读取 Pi Packages…
              </div>
            )}

            {!loading && loadError && (
              <div className="border-destructive/25 bg-destructive/8 text-destructive flex flex-col items-center gap-3 rounded-xl border py-14 text-sm">
                <CircleAlert className="size-5" />
                <span className="max-w-xl break-all text-center">{loadError}</span>
                <Button variant="outline" size="sm" onClick={() => void handleRefresh()}>
                  重试
                </Button>
              </div>
            )}

            {!loading && !loadError && filteredPlugins.length === 0 && (
              <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-sm">
                <Blocks className="size-7 opacity-40" />
                <span>
                  {showUpdatesOnly
                    ? query
                      ? '可更新插件中没有匹配项'
                      : '当前没有可更新的插件'
                    : query
                      ? '没有匹配的插件'
                      : '还没有安装 Pi Package'}
                </span>
                {!query && !showUpdatesOnly && (
                  <Button size="sm" onClick={() => setInstallOpen(true)}>
                    <PackagePlus />
                    安装第一个插件
                  </Button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredPlugins.map((plugin) => (
                <PluginCard
                  key={plugin.source}
                  plugin={plugin}
                  busy={busy}
                  onToggle={(item, enabled) =>
                    void perform(
                      { kind: 'toggle', source: item.source },
                      () => window.api.setPiPluginEnabled(item.source, enabled),
                      `${item.name} 已${enabled ? '启用' : '停用'}`
                    )
                  }
                  onUpdate={(item) =>
                    void perform(
                      { kind: 'update', source: item.source },
                      () => window.api.updatePiPlugin(item.source),
                      `${item.name} 已更新`,
                      true
                    )
                  }
                  onRemove={setRemoving}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'local' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
          <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            本地扩展来自 Pi 自动发现目录或
            settings.extensions。此处只检查入口并打开位置，不删除用户源码。
          </div>
          {loading && (
            <div className="text-muted-foreground py-16 text-center text-sm">正在扫描本地扩展…</div>
          )}
          {!loading && result?.localExtensions.length === 0 && (
            <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
              没有发现本地扩展
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result?.localExtensions.map((extension) => (
              <LocalExtensionCard key={extension.path} extension={extension} />
            ))}
          </div>
        </div>
      )}

      {rawConfigOpen && (
        <ConfigFileDialog
          agent="pi"
          kind="switch"
          title="编辑 Pi settings.json"
          onSaved={() => void load(false)}
          onClose={() => setRawConfigOpen(false)}
        />
      )}

      <Dialog open={installOpen} onOpenChange={(open) => !open && !busy && closeInstallDialog()}>
        <DialogContent className="flex h-[78vh] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>安装 Pi 插件</DialogTitle>
            <DialogDescription>
              先搜索带有 pi-package 标记的 npm 包，确认包名、作者和说明后再安装。
            </DialogDescription>
          </DialogHeader>

          <div
            className="bg-muted/70 grid shrink-0 grid-cols-2 rounded-lg border p-1"
            role="tablist"
            aria-label="安装方式"
          >
            <button
              type="button"
              role="tab"
              aria-selected={installMode === 'search'}
              className={cn(
                'focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-[background-color,color,box-shadow,transform] focus-visible:ring-2 active:scale-[0.98] motion-reduce:active:scale-100',
                installMode === 'search'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setInstallMode('search')}
            >
              搜索 npm 插件
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={installMode === 'source'}
              className={cn(
                'focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-[background-color,color,box-shadow,transform] focus-visible:ring-2 active:scale-[0.98] motion-reduce:active:scale-100',
                installMode === 'source'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setInstallMode('source')}
            >
              Git 或本地来源
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {installMode === 'search' ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex shrink-0 gap-2">
                  <div className="relative flex-1">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && void handleSearchPlugins()}
                      placeholder="搜索插件名称或功能"
                      className="pl-9"
                      autoFocus
                    />
                  </div>
                  <Button
                    disabled={!searchQuery.trim() || searching || busy !== null}
                    onClick={() => void handleSearchPlugins()}
                  >
                    {searching ? <Loader2 className="animate-spin" /> : <Search />}
                    搜索
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {searchError && (
                    <div className="border-destructive/25 bg-destructive/8 text-destructive rounded-lg border px-3 py-2 text-sm">
                      搜索失败：{searchError}
                    </div>
                  )}
                  {searching && (
                    <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                      <Loader2 className="size-4 animate-spin" />
                      正在搜索 npm Registry…
                    </div>
                  )}
                  {!searching && hasSearched && !searchError && searchResults.length === 0 && (
                    <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
                      没有找到带 pi-package 标记的插件
                    </div>
                  )}
                  {!searching && searchResults.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {searchResults.map((item) => {
                        const source = `npm:${item.name}`
                        const installed = result?.plugins.some(
                          (plugin) =>
                            plugin.source === source || plugin.source.startsWith(`${source}@`)
                        )
                        const installing = busy?.kind === 'install' && busy.source === source
                        return (
                          <div
                            key={item.name}
                            className="bg-card flex items-start gap-3 rounded-xl border p-3 shadow-xs"
                          >
                            <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                              <Blocks className="size-4" aria-hidden="true" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="truncate text-sm font-semibold">{item.name}</h4>
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  v{item.version}
                                </span>
                                {item.publisher && (
                                  <span className="text-muted-foreground text-[11px]">
                                    by {item.publisher}
                                  </span>
                                )}
                              </div>
                              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                                {item.description || '该插件没有提供说明。'}
                              </p>
                              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-3 text-[10px]">
                                <span>周下载 {item.weeklyDownloads.toLocaleString()}</span>
                                {item.license && <span>{item.license}</span>}
                                {item.homepage && (
                                  <button
                                    type="button"
                                    className="hover:text-foreground inline-flex items-center gap-1"
                                    onClick={() => void window.api.openExternal(item.homepage!)}
                                  >
                                    查看主页 <ExternalLink className="size-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={installed ? 'secondary' : 'default'}
                              disabled={busy !== null || installed}
                              onClick={() => void handleInstall(source)}
                            >
                              {installing ? <Loader2 className="animate-spin" /> : <PackagePlus />}
                              {installed ? '已安装' : '安装'}
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="pi-plugin-source">Git 地址或本地路径</Label>
                <div className="flex gap-2">
                  <Input
                    id="pi-plugin-source"
                    value={installSource}
                    onChange={(event) => setInstallSource(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void handleInstall()}
                    placeholder="https://github.com/user/repo"
                    autoFocus
                  />
                  <Button
                    variant="outline"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() =>
                      void window.api
                        .pickPiPluginPath()
                        .then((path) => path && setInstallSource(path))
                    }
                  >
                    <FolderOpen />
                    选择本地
                  </Button>
                </div>
                <div className="text-muted-foreground font-mono text-[10px]">
                  git:github.com/user/repo@v1
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0">
            <Button variant="outline" disabled={busy !== null} onClick={closeInstallDialog}>
              取消
            </Button>
            {installMode === 'source' && (
              <Button
                disabled={busy !== null || !installSource.trim()}
                onClick={() => void handleInstall()}
              >
                {busy?.kind === 'install' ? <Loader2 className="animate-spin" /> : <PackagePlus />}
                从此来源安装
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {removing && (
        <ConfirmDialog
          title={`卸载插件「${removing.name}」？`}
          description={
            removing.sourceKind === 'local'
              ? '只会从 Pi 配置移除引用，不会删除本地源文件。'
              : '会调用 Pi 原生卸载命令并移除全局配置。插件自行保存的数据可能仍会保留。'
          }
          confirmLabel="卸载"
          onConfirm={() =>
            void perform(
              { kind: 'remove', source: removing.source },
              () => window.api.removePiPlugin(removing.source),
              `${removing.name} 已卸载`
            )
          }
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
