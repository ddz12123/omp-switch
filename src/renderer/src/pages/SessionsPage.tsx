import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  ListChecks,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react'
import type { AgentId, SessionMeta, SessionRaw, SessionRootInfo } from '@shared/types'
import { AGENT_IDS } from '@shared/types'
import { monaco } from '../lib/monaco'
import { errorMessage } from '../stores/app'
import { cn } from '../lib/utils'
import { AgentIcon } from '../components/AgentIcon'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select'

/** 相对时间（列表次要行用），超过 30 天退回本地日期 */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return ''
  const sec = Math.floor((Date.now() - t) / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  const day = Math.floor(sec / 86400)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString()
}

/** 详情卡里的绝对时间 */
function formatDateTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return iso || '—'
  return new Date(t).toLocaleString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 根目录来源徽章文案 */
function rootBadge(root: SessionRootInfo): string {
  switch (root.kind) {
    case 'omp-default':
      return 'OMP'
    case 'pi-default':
      return 'Pi'
    case 'config-session-dir':
      return '配置'
    default:
      return '自定义'
  }
}

/** 会话根目录对应的 Agent（仅默认目录能明确归属，其余返回 null） */
function rootAgent(root: SessionRootInfo): AgentId | null {
  if (root.kind === 'omp-default') return 'omp'
  if (root.kind === 'pi-default') return 'pi'
  return null
}

/** 只读 Monaco 展示单个会话的原始 JSONL；filePath 变化时整体重挂 */
function RawViewer({ filePath }: { filePath: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [raw, setRaw] = useState<SessionRaw | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .readSessionRaw(filePath)
      .then((r) => {
        if (!cancelled) setRaw(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  useEffect(() => {
    if (!raw || !containerRef.current) return undefined
    const editor = monaco.editor.create(containerRef.current, {
      value: raw.content,
      language: 'plaintext',
      theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
      readOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      lineHeight: 18,
      tabSize: 2,
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 }
    })
    return () => editor.dispose()
  }, [raw])

  if (error) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-4 text-center text-sm">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {raw?.truncated && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
          文件过大，仅展示前 8MB 内容
        </div>
      )}
      {raw ? (
        <div ref={containerRef} className="min-h-0 flex-1" />
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          加载中…
        </div>
      )}
    </div>
  )
}

/** 详情卡里的一行元信息 */
function MetaRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="text-foreground/90 min-w-0 break-all text-xs">{value}</span>
    </div>
  )
}

export default function SessionsPage({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const [roots, setRoots] = useState<SessionRootInfo[]>([])
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  /** 目录/Agent 过滤：'all' 或某个 rootId */
  const [rootFilter, setRootFilter] = useState<string>('all')
  /** 待确认删除的文件路径集合（单个或批量），null 表示无待确认 */
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.cwd.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    )
  }, [sessions, query])

  /** 每个 root 的会话数（用于下拉展示计数） */
  const countByRoot = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) map.set(s.rootId, (map.get(s.rootId) ?? 0) + 1)
    return map
  }, [sessions])

  /** 下拉可选的目录：存在的 root（含计数），保证选中项始终有效 */
  const filterRoots = useMemo(() => roots.filter((r) => r.exists), [roots])

  /** 当前过滤后的可见会话（先按搜索，再按选中目录） */
  const visible = useMemo(
    () => (rootFilter === 'all' ? filtered : filtered.filter((s) => s.rootId === rootFilter)),
    [filtered, rootFilter]
  )

  const active = useMemo(
    () => sessions.find((s) => s.filePath === activeFilePath) ?? null,
    [sessions, activeFilePath]
  )
  const activeRoot = active ? (roots.find((r) => r.id === active.rootId) ?? null) : null

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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
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
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">会话管理</h2>
              {/* 会话跨 Agent 汇总，标注覆盖的 Agent */}
              <span className="flex items-center gap-1">
                {AGENT_IDS.map((id) => (
                  <AgentIcon key={id} agent={id} className="size-4" />
                ))}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              按目录浏览 pi / omp 的历史会话，支持查看原文与删除（共 {sessions.length} 个）
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" title="重新读取" onClick={() => void load()}>
          <RefreshCw />
          刷新
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左栏：搜索 + 多选 + 分组列表 */}
        <div className="flex w-80 shrink-0 flex-col gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / 目录 / ID"
                className="pl-8"
              />
            </div>
            <Button
              variant={multiSelect ? 'default' : 'outline'}
              size="icon"
              title={multiSelect ? '退出多选' : '多选删除'}
              onClick={() => (multiSelect ? exitMultiSelect() : setMultiSelect(true))}
            >
              <ListChecks />
            </Button>
          </div>

          <Select value={rootFilter} onValueChange={setRootFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部目录（{sessions.length}）</SelectItem>
              {filterRoots.map((root) => {
                const agent = rootAgent(root)
                return (
                  <SelectItem key={root.id} value={root.id}>
                    <span className="flex items-center gap-2">
                      {agent && <AgentIcon agent={agent} className="size-4" />}
                      {root.label}（{countByRoot.get(root.id) ?? 0}）
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          {multiSelect && (
            <div className="flex shrink-0 items-center justify-between gap-2">
              <button
                onClick={toggleSelectAll}
                className="text-muted-foreground hover:text-foreground text-xs"
              >
                {selected.size === visible.length && visible.length > 0 ? '清空选择' : '全选'}
              </button>
              <Button
                variant="destructive"
                size="sm"
                disabled={selected.size === 0}
                onClick={() => setPendingDelete([...selected])}
              >
                <Trash2 />
                删除所选 ({selected.size})
              </Button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {loading ? (
              <div className="text-muted-foreground py-16 text-center text-sm">加载中…</div>
            ) : visible.length === 0 ? (
              <div className="text-muted-foreground py-16 text-center text-sm">
                {sessions.length === 0 ? '暂无会话' : '没有匹配的会话'}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {visible.map((s) => {
                  const isActive = s.filePath === activeFilePath
                  const itemRoot = roots.find((r) => r.id === s.rootId) ?? null
                  const itemAgent = itemRoot ? rootAgent(itemRoot) : null
                  return (
                    <div
                      key={s.filePath}
                      onClick={() => setActiveFilePath(s.filePath)}
                      className={cn(
                        'flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'border-primary bg-accent'
                          : 'hover:bg-accent/50 border-black/[0.06] dark:border-white/[0.08]'
                      )}
                    >
                      {multiSelect && (
                        <input
                          type="checkbox"
                          checked={selected.has(s.filePath)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(s.filePath)}
                          className="accent-primary mt-1 size-3.5 shrink-0"
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{s.title}</span>
                        <span className="text-muted-foreground/80 truncate font-mono text-[11px]">
                          {s.cwd || '—'}
                        </span>
                        <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
                          <span className="shrink-0">{relativeTime(s.updatedAt)}</span>
                          {itemAgent ? (
                            <span className="flex shrink-0 items-center" title={itemRoot?.label}>
                              <AgentIcon agent={itemAgent} className="size-3.5" />
                            </span>
                          ) : (
                            rootFilter === 'all' &&
                            itemRoot && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                {rootBadge(itemRoot)}
                              </Badge>
                            )
                          )}
                          {s.model && (
                            <Badge variant="outline" className="truncate text-[10px]">
                              {s.model}
                            </Badge>
                          )}
                          <span className="ml-auto shrink-0">{formatSize(s.size)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：详情 + 原始 JSONL */}
        <div className="bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-black/[0.06] dark:border-white/[0.08]">
          {active ? (
            <>
              <div className="shrink-0 border-b border-black/[0.06] p-4 dark:border-white/[0.08]">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <h3
                    className="min-w-0 flex-1 truncate text-base font-semibold"
                    title={active.title}
                  >
                    {active.title}
                  </h3>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      title="在文件夹中显示"
                      onClick={() => void window.api.showSessionInFolder(active.filePath)}
                    >
                      <FolderOpen />
                      打开文件夹
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      title="删除该会话"
                      onClick={() => setPendingDelete([active.filePath])}
                    >
                      <Trash2 />
                      删除
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <MetaRow
                    label="所在目录"
                    value={activeRoot ? `${activeRoot.label}（${activeRoot.path}）` : '—'}
                  />
                  <MetaRow label="会话 ID" value={active.id} />
                  <MetaRow label="工作目录" value={active.cwd || '—'} />
                  <MetaRow label="创建时间" value={formatDateTime(active.createdAt)} />
                  <MetaRow label="修改时间" value={formatDateTime(active.updatedAt)} />
                  <MetaRow label="模型" value={active.model || '—'} />
                  <MetaRow label="文件大小" value={formatSize(active.size)} />
                  <MetaRow label="完整路径" value={active.filePath} />
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <RawViewer key={active.filePath} filePath={active.filePath} />
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
              <FileText className="size-8 opacity-40" />
              从左侧选择一个会话查看详情与原始内容
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
