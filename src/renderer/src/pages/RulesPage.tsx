import { useCallback, useEffect, useState } from 'react'
import { BookOpen, FolderOpen, Loader2, Pencil, Pin, Plus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { RuleFileInfo } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import RuleFileDialog from '../components/RuleFileDialog'

/** 规则文件类别说明 */
const KIND_META: Record<RuleFileInfo['kind'], { label: string; desc: string }> = {
  context: {
    label: '开场注入',
    desc: '会话开始时自动注入上下文，用于全局约定、编码规范等背景指引。'
  },
  sticky: {
    label: '始终生效',
    desc: 'sticky 规则，长会话也会被重新附加到当前轮次，用于必须始终遵守的硬性要求。'
  }
}

/** 全局规则管理：按当前 Agent 列出其规则文件（pi: AGENTS.md；omp: AGENTS.md + RULES.md） */
export default function RulesPage(): React.JSX.Element {
  const { agent, statuses } = useApp()
  const [files, setFiles] = useState<RuleFileInfo[] | null>(null)
  const [editing, setEditing] = useState<RuleFileInfo | null>(null)

  // promise 链写法：setState 都在回调里，避免 effect 中同步 setState
  const load = useCallback(
    (): Promise<void> =>
      window.api
        .readRules(agent)
        .then((result) => setFiles(result))
        .catch((error) => {
          toast.error(`读取规则文件失败：${errorMessage(error)}`)
        }),
    [agent]
  )

  useEffect(() => {
    void load()
  }, [load])

  const label = statuses.find((s) => s.id === agent)?.label ?? agent

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          全局规则
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            管理 {label} 的全局规则文件，会话开始时自动生效
          </span>
        </h2>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw />
          刷新
        </Button>
      </div>

      {files === null ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-sm">
          <Loader2 className="size-4 animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {files.map((file) => {
            const meta = KIND_META[file.kind]
            return (
              <div
                key={file.name}
                className="border-border/60 bg-card flex items-center gap-4 rounded-xl border p-4"
              >
                <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                  {file.kind === 'sticky' ? (
                    <Pin className="size-4.5" />
                  ) : (
                    <BookOpen className="size-4.5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">{file.name}</span>
                    <Badge variant="secondary">{meta.label}</Badge>
                    {!file.exists && <Badge variant="outline">未创建</Badge>}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{meta.desc}</p>
                  <button
                    type="button"
                    onClick={() => void window.api.showRuleInFolder(agent, file.name)}
                    className="text-muted-foreground/70 hover:text-foreground mt-0.5 flex max-w-full items-center gap-1 font-mono text-xs transition-colors"
                    title="在文件夹中显示"
                  >
                    <FolderOpen className="size-3 shrink-0" />
                    <span className="truncate">{file.path}</span>
                  </button>
                </div>
                <Button variant="outline" onClick={() => setEditing(file)}>
                  {file.exists ? <Pencil /> : <Plus />}
                  {file.exists ? '编辑' : '创建'}
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <RuleFileDialog
          agent={agent}
          file={editing}
          onSaved={() => void load()}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
