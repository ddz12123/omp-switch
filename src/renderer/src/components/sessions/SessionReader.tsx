import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileJson,
  FileText,
  FolderOpen,
  ListFilter,
  LoaderCircle,
  Trash2,
  UserRound,
  Wrench
} from 'lucide-react'
import type { editor as MonacoEditor } from 'monaco-editor/editor/editor.api.js'
import type { SessionMessage, SessionMeta, SessionRaw, SessionTranscript } from '@shared/types'
import { errorMessage } from '../../stores/app'
import { cn } from '../../lib/utils'
import { loadMonaco } from '../../lib/monaco'
import {
  formatCompact,
  formatDateTime,
  formatNumber,
  formatShortTime,
  formatSize,
  projectName,
  relativeTime
} from '../../lib/format'
import { AgentIcon } from '../AgentIcon'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/** 只读的原始 JSONL 视图，沿用项目里已有的 Monaco 懒加载方式 */
function RawViewer({ filePath }: { filePath: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [raw, setRaw] = useState<SessionRaw | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      setRaw(null)
      setError(null)
      setEditorReady(false)
      void window.api
        .readSessionRaw(filePath)
        .then((r) => {
          if (!cancelled) setRaw(r)
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errorMessage(e))
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [filePath])

  useEffect(() => {
    if (!raw || !containerRef.current) return undefined
    let disposed = false
    let editor: MonacoEditor.IStandaloneCodeEditor | null = null

    setEditorReady(false)
    void loadMonaco('plaintext')
      .then((monaco) => {
        if (disposed || !containerRef.current) return
        editor = monaco.editor.create(containerRef.current, {
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
        setEditorReady(true)
      })
      .catch((e: unknown) => {
        if (!disposed) setError(`编辑器加载失败：${errorMessage(e)}`)
      })

    return () => {
      disposed = true
      editor?.dispose()
    }
  }, [raw])

  if (error) {
    return (
      <div
        className="text-destructive flex h-full items-center justify-center p-4 text-center text-sm"
        role="alert"
      >
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {raw?.truncated && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-500">
          文件过大，仅展示前 8MB 内容
        </div>
      )}
      {raw ? (
        <div className="relative min-h-0 min-w-0 flex-1">
          <div ref={containerRef} className="h-full" aria-label="会话原始 JSONL" />
          {!editorReady && (
            <div
              className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center text-sm"
              role="status"
            >
              编辑器加载中…
            </div>
          )}
        </div>
      ) : (
        <div
          className="text-muted-foreground flex h-full items-center justify-center text-sm"
          role="status"
        >
          加载中…
        </div>
      )}
    </div>
  )
}

/** 统计数字块：数字与标签分层，不用长串点号文案 */
function Stat({
  value,
  label,
  danger = false
}: {
  value: string
  label: string
  danger?: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={cn(
          'text-sm leading-none font-semibold tabular-nums',
          danger && 'text-destructive'
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground text-[11px]">{label}</span>
    </div>
  )
}

/** 折叠面板里的一行元信息，可点击复制 */
function MetaRow({
  label,
  value,
  copyable = false,
  onCopy,
  className
}: {
  label: string
  value: string
  copyable?: boolean
  onCopy?: (value: string, label: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('grid min-w-0 grid-cols-[4.5rem_1fr] items-start gap-2', className)}>
      <span className="text-muted-foreground shrink-0 pt-0.5 text-[11px]">{label}</span>
      {copyable && onCopy ? (
        <button
          type="button"
          title={`复制${label}`}
          onClick={() => onCopy(value, label)}
          className="group flex min-w-0 items-start gap-1 text-left"
        >
          <span className="text-foreground/80 min-w-0 flex-1 break-all text-[11px] group-hover:text-primary">
            {value}
          </span>
          <Copy className="text-muted-foreground mt-0.5 size-3 shrink-0 opacity-50 group-hover:opacity-100" />
        </button>
      ) : (
        <span className="text-foreground/80 min-w-0 break-all text-[11px]">{value}</span>
      )}
    </div>
  )
}

/**
 * 只对确实含 Markdown 语法的正文做解析：长会话里绝大多数是纯文本，
 * 避免每条消息都跑一遍 remark 解析。
 */
const MARKDOWN_HINT =
  /^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|~~~|\|)|\*\*[^*]+\*\*|`[^`\n]+`|\[[^\]]+\]\([^)]+\)/m

function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text)
}

/** GFM 表格 / 列表 / 代码块 / 加粗等 Markdown 正文渲染 */
function MarkdownText({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-x-auto break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 保留原文换行，避免提问/回复里的多行文本被合并成一段
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          a: ({ href, children }) => {
            const external = typeof href === 'string' && /^https?:\/\//i.test(href)
            return (
              <a
                href={external ? href : undefined}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer' : undefined}
                onClick={(event) => {
                  // Electron 里不允许渲染层自行导航，外链交给主进程白名单校验
                  event.preventDefault()
                  if (external && href) void window.api.openExternal(href).catch(() => undefined)
                }}
              >
                {children}
              </a>
            )
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

/** 折叠的纯文本块（思考 / 工具调用参数） */
function CodeDetails({
  summary,
  content
}: {
  summary: string
  content: string
}): React.JSX.Element {
  return (
    <details className="group bg-muted/40 mb-2 rounded-md">
      <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-[11px]">
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        {summary}
      </summary>
      <pre className="text-foreground/75 max-h-64 overflow-auto px-3 pb-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {content}
      </pre>
    </details>
  )
}

/** 单条消息：用户强调色块、助手轻量排版、工具结果整行折叠 */
function MessageRow({ message }: { message: SessionMessage }): React.JSX.Element {
  if (message.role === 'toolResult') {
    return (
      <div className="py-1">
        <details className="group bg-muted/40 rounded-md">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs">
            <ChevronDown className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-180" />
            <Wrench className="text-muted-foreground size-3.5 shrink-0" />
            <span className="min-w-0 truncate font-medium">{message.toolName || '工具结果'}</span>
            {message.isError && (
              <span className="bg-destructive/10 text-destructive shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                失败
              </span>
            )}
            <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
              {formatShortTime(message.ts)}
            </span>
          </summary>
          <pre className="text-foreground/75 max-h-64 overflow-auto border-t border-black/[0.06] px-3 py-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words dark:border-white/[0.08]">
            {message.text || '（无结果）'}
          </pre>
        </details>
      </div>
    )
  }

  const isUser = message.role === 'user'
  const tail = [message.model, message.tokens ? `${formatCompact(message.tokens)} tokens` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="pb-6">
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        {isUser ? (
          <UserRound className="text-primary size-3.5 shrink-0" />
        ) : (
          <Bot className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className={cn('font-medium', isUser ? 'text-primary' : 'text-muted-foreground')}>
          {isUser ? '用户' : '助手'}
        </span>
        {message.model && (
          <span className="text-muted-foreground/70 min-w-0 truncate">{message.model}</span>
        )}
        <span className="text-muted-foreground/70 ml-auto shrink-0">
          {formatShortTime(message.ts)}
        </span>
      </div>

      {message.errorMessage && (
        <div className="border-destructive/40 bg-destructive/5 text-destructive mb-2 flex items-start gap-2 rounded-r-md border-l-2 px-3 py-2 text-xs">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{message.errorMessage}</span>
        </div>
      )}
      {message.thinking && (
        <CodeDetails summary={`思考 · ${message.thinking.length} 字`} content={message.thinking} />
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <CodeDetails
          summary={`工具调用 · ${message.toolCalls.length}`}
          content={message.toolCalls.map((c) => `${c.name}\n${c.args || '{}'}`).join('\n\n')}
        />
      )}
      {message.text && (
        <div
          className={cn(
            isUser ? 'border-primary bg-primary/[0.04] rounded-r-lg border-l-2 px-4 py-3' : 'px-1'
          )}
        >
          {looksLikeMarkdown(message.text) ? (
            <MarkdownText text={message.text} />
          ) : (
            <div className="text-sm leading-[1.7] whitespace-pre-wrap break-words">
              {message.text}
            </div>
          )}
        </div>
      )}
      {!isUser && tail && (
        <div className="text-muted-foreground/70 mt-2 px-1 text-[11px]">{tail}</div>
      )}
    </div>
  )
}

interface SessionReaderProps {
  session: SessionMeta
  rootLabel?: string
  onRequestDelete: (filePath: string) => void
}

/** 右栏：标题 + 数字块统计 + 折叠元信息 + 结构化阅读器 / 原始 JSON */
export function SessionReader({
  session,
  rootLabel,
  onRequestDelete
}: SessionReaderProps): React.JSX.Element {
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [view, setView] = useState<'structured' | 'raw'>('structured')
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.api
      .sessionTranscript(session.filePath)
      .then((result) => {
        if (!cancelled) setTranscript(result)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [session.filePath])

  const filtered = useMemo(() => {
    if (!transcript) return []
    const q = filter.trim().toLowerCase()
    if (!q) return transcript.messages
    return transcript.messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        (m.thinking ?? '').toLowerCase().includes(q) ||
        (m.toolName ?? '').toLowerCase().includes(q) ||
        (m.toolCalls ?? []).some((c) => c.name.toLowerCase().includes(q))
    )
  }, [transcript, filter])

  const stats = transcript?.stats
  const resumeCommand = session.agent
    ? `${session.agent === 'omp' ? 'omp --resume' : 'pi --session'} ${session.id}`
    : null

  const copy = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(`${label}已复制`)
    } catch (error) {
      toast.error(`复制失败：${errorMessage(error)}`)
    }
  }

  const showInFolder = async (): Promise<void> => {
    try {
      await window.api.showSessionInFolder(session.filePath)
    } catch (error) {
      toast.error(`打开文件夹失败：${errorMessage(error)}`)
    }
  }

  const openWorkingDirectory = async (): Promise<void> => {
    try {
      await window.api.openSessionWorkingDirectory(session.filePath)
    } catch (error) {
      toast.error(`打开工作目录失败：${errorMessage(error)}`)
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="shrink-0 border-b border-black/[0.06] px-5 pt-4 pb-3 dark:border-white/[0.08]">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-lg leading-snug font-semibold tracking-[-0.01em]">
              {session.title}
            </h3>
            <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-foreground/70 inline-flex min-w-0 items-center gap-1.5">
                {session.agent && <AgentIcon agent={session.agent} className="size-3.5" />}
                <span className="truncate">{projectName(session.cwd)}</span>
              </span>
              <span className="bg-border h-3 w-px" />
              <span>{relativeTime(session.updatedAt)}</span>
              <span className="bg-border h-3 w-px" />
              <span>{formatSize(session.size)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="在文件夹中显示"
              onClick={() => void showInFolder()}
            >
              <FolderOpen />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="打开工作目录"
              disabled={!session.cwd}
              onClick={() => void openWorkingDirectory()}
            >
              <ExternalLink />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive size-8"
              title="删除该会话"
              onClick={() => onRequestDelete(session.filePath)}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Stat value={stats ? formatNumber(stats.messages) : '—'} label="消息" />
          <Stat value={stats ? formatNumber(stats.questions) : '—'} label="提问" />
          <Stat value={stats ? formatNumber(stats.toolCalls) : '—'} label="工具调用" />
          <Stat value={stats ? formatCompact(stats.totalTokens) : '—'} label="tokens" />
          {(stats?.errors ?? 0) > 0 && (
            <Stat value={formatNumber(stats!.errors)} label="错误" danger />
          )}
        </div>

        <details className="group mt-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.08]">
          <summary className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer list-none items-center gap-1.5 text-xs">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            会话信息
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            <MetaRow label="会话 ID" value={session.id} copyable onCopy={copy} />
            <MetaRow
              label="恢复命令"
              value={resumeCommand || '—'}
              copyable={!!resumeCommand}
              onCopy={copy}
            />
            <MetaRow label="工作目录" value={session.cwd || '—'} copyable onCopy={copy} />
            <MetaRow label="模型" value={stats?.models.join('、') || session.model || '—'} />
            <MetaRow
              label="起止"
              value={`${formatDateTime(stats?.startedAt || session.createdAt)} — ${formatDateTime(stats?.endedAt || session.updatedAt)}`}
            />
            <MetaRow label="来源" value={rootLabel || '—'} />
            <MetaRow
              label="路径"
              value={session.filePath}
              copyable
              onCopy={copy}
              className="sm:col-span-2"
            />
          </div>
        </details>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-2 dark:border-white/[0.08]">
        <div className="bg-muted/60 inline-flex items-center gap-0.5 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setView('structured')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
              view === 'structured'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FileText className="size-3.5" />
            结构化
          </button>
          <button
            type="button"
            onClick={() => setView('raw')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
              view === 'raw'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <FileJson className="size-3.5" />
            原始 JSON
          </button>
        </div>
        {view === 'structured' && (
          <div className="relative w-44">
            <ListFilter className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <label htmlFor="session-message-filter" className="sr-only">
              会话内过滤
            </label>
            <Input
              id="session-message-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤消息"
              className="h-7 pl-8 text-xs"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        {view === 'raw' ? (
          <RawViewer key={session.filePath} filePath={session.filePath} />
        ) : loadError ? (
          <div
            className="text-destructive flex h-full items-center justify-center p-4 text-center text-sm"
            role="alert"
          >
            {loadError}
          </div>
        ) : !transcript ? (
          <div
            className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-5 py-5">
            <div className="mx-auto flex max-w-[76ch] flex-col">
              {transcript.truncated && (
                <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-500">
                  文件超过 24MB，仅展示前 24MB 的完整记录
                </div>
              )}
              {filtered.length === 0 ? (
                <div className="text-muted-foreground py-16 text-center text-sm">
                  没有匹配的消息
                </div>
              ) : (
                filtered.map((message, index) => <MessageRow key={index} message={message} />)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
