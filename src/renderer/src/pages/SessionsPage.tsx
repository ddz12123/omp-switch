import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderPlus,
  LayoutList,
  ListChecks,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import type { SessionMeta, SessionRootInfo } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { cn } from '../lib/utils'
import { formatSize, projectName, relativeTime } from '../lib/format'
import { SessionReader } from '../components/sessions/SessionReader'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type SourceFilter = 'all' | 'pi' | 'omp'
type Grouping = 'project' | 'time'

interface SessionGroup {
  key: string
  label: string
  sessions: SessionMeta[]
}

const TIME_ORDER = ['今天', '昨天', '近 7 天', '近 30 天', '更早']
/** 无项目 / 目录名无法表达项目的会话统一归入这个匿名分组 */
const UNCLASSIFIED_GROUP = '__unclassified__'

function projectGroupKey(cwd: string): string {
  const trimmed = cwd.trim()
  if (!trimmed) return UNCLASSIFIED_GROUP
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const last = parts[parts.length - 1] || ''
  // 纯数字或过短的目录名（如临时目录「1」「4」）不算一个项目
  if (!last || last.length <= 2 || /^\d+$/.test(last)) return UNCLASSIFIED_GROUP
  return trimmed
}

function timeBucket(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return '更早'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days < 1) return '今天'
  if (days < 2) return '昨天'
  if (days < 7) return '近 7 天'
  if (days < 30) return '近 30 天'
  return '更早'
}

export default function SessionsPage({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [roots, setRoots] = useState<SessionRootInfo[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [grouping, setGrouping] = useState<Grouping>('project')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  /** 待确认删除的文件路径集合（单个或批量），null 表示无待确认 */
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const addSessionCustomDir = useApp((state) => state.addSessionCustomDir)

  const load = useCallback(
    (): Promise<void> =>
      Promise.all([window.api.sessionRoots(), window.api.listSessions()])
        .then(([r, s]) => {
          setRoots(r)
          setSessions(s)
        })
        .catch((error: unknown) => {
          toast.error(`读取会话失败：${errorMessage(error)}`)
        })
        .finally(() => setLoading(false)),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    )
  }, [sessions, query])

  const counts = useMemo(
    () => ({
      all: searched.length,
      pi: searched.filter((s) => s.agent === 'pi').length,
      omp: searched.filter((s) => s.agent === 'omp').length
    }),
    [searched]
  )

  const visible = useMemo(
    () => (source === 'all' ? searched : searched.filter((s) => s.agent === source)),
    [searched, source]
  )

  const totalSize = useMemo(() => sessions.reduce((sum, s) => sum + s.size, 0), [sessions])

  const groups = useMemo<SessionGroup[]>(() => {
    const buckets = new Map<string, SessionMeta[]>()
    for (const s of visible) {
      const key = grouping === 'project' ? projectGroupKey(s.cwd) : timeBucket(s.updatedAt)
      const list = buckets.get(key)
      if (list) list.push(s)
      else buckets.set(key, [s])
    }
    const result = [...buckets].map(([key, list]) => ({
      key,
      label:
        grouping === 'project' ? (key === UNCLASSIFIED_GROUP ? '未归类' : projectName(key)) : key,
      sessions: list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }))
    if (grouping === 'time') {
      return result.sort((a, b) => TIME_ORDER.indexOf(a.key) - TIME_ORDER.indexOf(b.key))
    }
    // 未归类固定在末尾，其余按组内最近会话时间倒序
    return result.sort((a, b) => {
      if (a.key === UNCLASSIFIED_GROUP) return 1
      if (b.key === UNCLASSIFIED_GROUP) return -1
      return (b.sessions[0]?.updatedAt ?? '').localeCompare(a.sessions[0]?.updatedAt ?? '')
    })
  }, [visible, grouping])

  const active = useMemo(
    () => sessions.find((s) => s.filePath === activeFilePath) ?? null,
    [sessions, activeFilePath]
  )
  const activeRootLabel = active
    ? (roots.find((r) => r.id === active.rootId)?.label ?? undefined)
    : undefined

  const toggleGroup = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelect = (filePath: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const exitMultiSelect = (): void => {
    setMultiSelect(false)
    setSelected(new Set())
  }

  const toggleSelectAll = (): void => {
    setSelected((prev) =>
      prev.size === visible.length && visible.length > 0
        ? new Set()
        : new Set(visible.map((s) => s.filePath))
    )
  }

  const runDelete = async (paths: string[]): Promise<void> => {
    try {
      const { deleted } = await window.api.deleteSessions(paths)
      toast.success(`已删除 ${deleted} 个会话`)
      if (activeFilePath && paths.includes(activeFilePath)) setActiveFilePath(null)
      setSelected(new Set())
      await load()
    } catch (error) {
      toast.error(`删除失败：${errorMessage(error)}`)
    }
  }

  const handleAddDir = async (): Promise<void> => {
    await addSessionCustomDir()
    await load()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
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
            <h2 className="text-lg leading-tight font-semibold tracking-[-0.01em]">会话管理</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {sessions.length} 个会话 · {formatSize(totalSize)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void handleAddDir()}>
            <FolderPlus />
            添加目录
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw />
            刷新
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-hidden">
        {/* 左栏：搜索 + 来源 + 分组 + 列表 */}
        <div className="flex w-80 min-w-0 shrink-0 flex-col gap-2 overflow-hidden">
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <label htmlFor="session-search" className="sr-only">
                搜索会话
              </label>
              <Input
                id="session-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / 项目 / ID"
                className="pl-8"
              />
            </div>
            <Button
              variant={multiSelect ? 'default' : 'outline'}
              size="icon"
              className="size-9 shrink-0"
              title={multiSelect ? '退出多选' : '多选删除'}
              onClick={() => (multiSelect ? exitMultiSelect() : setMultiSelect(true))}
            >
              <ListChecks />
            </Button>
          </div>

          {/* 来源与分组都用带边框的按钮，选中项用实心主色填充 */}
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {(['all', 'pi', 'omp'] as const).map((id) => (
                <Button
                  key={id}
                  variant={source === id ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 min-w-0 flex-1 px-1.5 text-xs"
                  onClick={() => setSource(id)}
                >
                  {id === 'all' ? '全部' : id === 'pi' ? 'Pi' : 'OMP'}
                  <span className="tabular-nums opacity-60">{counts[id]}</span>
                </Button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant={grouping === 'project' ? 'default' : 'outline'}
                size="icon"
                className="size-7"
                title="按项目分组"
                onClick={() => setGrouping('project')}
              >
                <LayoutList />
              </Button>
              <Button
                variant={grouping === 'time' ? 'default' : 'outline'}
                size="icon"
                className="size-7"
                title="按时间分组"
                onClick={() => setGrouping('time')}
              >
                <Clock />
              </Button>
            </div>
          </div>

          {multiSelect && (
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                {selected.size === visible.length && visible.length > 0 ? '清空' : '全选'}
              </button>
              <Button
                variant="ghost"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setPendingDelete([...selected])}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive h-7 px-2 text-xs disabled:opacity-40"
              >
                <Trash2 className="size-3.5" />
                删除{selected.size > 0 ? ` ${selected.size}` : ''}
              </Button>
            </div>
          )}

          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1 pb-4">
            {loading ? (
              <div className="text-muted-foreground py-16 text-center text-sm">加载中…</div>
            ) : groups.length === 0 ? (
              <div className="text-muted-foreground py-16 text-center text-sm">
                {sessions.length === 0 ? '暂无会话' : '没有匹配的会话'}
              </div>
            ) : (
              groups.map((group) => {
                // 单会话项目不再各占一条组头：项目路径已在卡片第二行，归属照样清楚
                const showHeader =
                  grouping === 'time' ||
                  group.sessions.length > 1 ||
                  group.key === UNCLASSIFIED_GROUP
                const isCollapsed = showHeader && collapsed.has(group.key)
                return (
                  <div key={group.key} className="mb-2 last:mb-0">
                    {showHeader && (
                      <div className="bg-background sticky top-0 z-20 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={!isCollapsed}
                          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 px-1 text-left transition-colors"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="size-3 shrink-0" />
                          ) : (
                            <ChevronDown className="size-3 shrink-0" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                            {group.label}
                          </span>
                          <span className="text-[11px] tabular-nums opacity-70">
                            {group.sessions.length}
                          </span>
                        </button>
                      </div>
                    )}
                    {!isCollapsed && (
                      <div className="flex flex-col gap-2 pt-1">
                        {group.sessions.map((s) => {
                          const isActive = s.filePath === activeFilePath
                          return (
                            <div
                              key={s.filePath}
                              className={cn(
                                'flex min-w-0 items-start gap-2 rounded-xl border px-3 py-2.5 transition-colors',
                                isActive
                                  ? 'border-primary/70 bg-primary/[0.05] shadow-xs'
                                  : 'border-black/[0.08] hover:bg-accent/40 dark:border-white/[0.10]'
                              )}
                            >
                              {multiSelect && (
                                <input
                                  type="checkbox"
                                  checked={selected.has(s.filePath)}
                                  onChange={() => toggleSelect(s.filePath)}
                                  aria-label={`选择会话：${s.title}`}
                                  className="accent-primary mt-0.5 size-3.5 shrink-0"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => setActiveFilePath(s.filePath)}
                                aria-current={isActive ? 'true' : undefined}
                                className="flex min-w-0 flex-1 flex-col gap-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                <span
                                  className="line-clamp-3 text-[13px] leading-snug font-medium"
                                  title={s.title}
                                >
                                  {s.title}
                                </span>
                                <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-[11px]">
                                  <span className="min-w-0 flex-1 truncate" title={s.cwd}>
                                    {s.cwd || '—'}
                                  </span>
                                  <span className="shrink-0">{relativeTime(s.updatedAt)}</span>
                                  <span className="shrink-0 tabular-nums">
                                    {formatSize(s.size)}
                                  </span>
                                </span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* 右栏：结构化阅读器 */}
        <div className="bg-card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.08]">
          {active ? (
            <SessionReader
              key={active.filePath}
              session={active}
              rootLabel={activeRootLabel}
              onRequestDelete={(filePath) => setPendingDelete([filePath])}
            />
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
              <FileText className="size-8 opacity-40" />
              从左侧选择一个会话查看详情与结构化内容
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.length > 1
              ? `删除选中的 ${pendingDelete.length} 个会话？`
              : '删除该会话？'
          }
          description="将删除 .jsonl 文件及其同名日志目录，共享的图片附件（blobs）不受影响。此操作不可撤销。"
          onConfirm={() => void runDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
