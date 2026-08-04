import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, PanelRight, PanelRightClose, Save } from 'lucide-react'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { editor as MonacoEditor } from 'monaco-editor/editor/editor.api.js'
import type { AgentId, RuleFileInfo } from '@shared/types'
import { loadMonaco } from '../lib/monaco'
import { errorMessage } from '../stores/app'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface RuleFileDialogProps {
  agent: AgentId
  file: RuleFileInfo
  onClose: () => void
  /** 保存成功后回调（刷新页面数据） */
  onSaved: () => void
}

/** 用 Monaco 编辑全局规则文件（Markdown），默认左编辑右预览，预览可关闭 */
export default function RuleFileDialog({
  agent,
  file,
  onClose,
  onSaved
}: RuleFileDialogProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const [saving, setSaving] = useState(false)
  /** 弹框内容经 portal 渲染，ref 在挂载后才可用；就绪后创建编辑器 */
  const [ready, setReady] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  /** 编辑区当前文本，驱动右侧预览实时渲染 */
  const [text, setText] = useState(file.content)
  /** 预览面板开关（默认两栏，可关闭成纯编辑） */
  const [previewOpen, setPreviewOpen] = useState(true)

  // ref callback：容器挂载/卸载时同步就绪状态（setState 在 commit 阶段，不触发 lint 规则）
  const bindContainer = useCallback((el: HTMLDivElement | null): void => {
    containerRef.current = el
    setReady(el !== null)
  }, [])

  // 容器就绪后才加载 Monaco 和 Markdown 语言，弹框未打开时不下载编辑器代码。
  useEffect(() => {
    if (!ready || !containerRef.current) return undefined
    let disposed = false
    let editor: MonacoEditor.IStandaloneCodeEditor | null = null

    setEditorReady(false)
    setEditorError(null)
    void loadMonaco('markdown')
      .then((monaco) => {
        if (disposed || !containerRef.current) return
        editor = monaco.editor.create(containerRef.current, {
          value: file.content,
          language: 'markdown',
          theme: document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          tabSize: 2,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'none',
          fixedOverflowWidgets: true,
          padding: { top: 10, bottom: 10 }
        })
        // 编辑内容变化时同步到预览
        editor.onDidChangeModelContent(() => setText(editor?.getValue() ?? ''))
        // Ctrl/Cmd + S 直接保存
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
        editorRef.current = editor
        setText(editor.getValue())
        setEditorReady(true)
        editor.focus()
      })
      .catch((error: unknown) => {
        if (!disposed) setEditorError(`编辑器加载失败：${errorMessage(error)}`)
      })

    return () => {
      disposed = true
      editor?.dispose()
      editorRef.current = null
    }
  }, [file, ready])

  const handleSave = async (): Promise<void> => {
    const editor = editorRef.current
    if (!editor || saving) return
    setSaving(true)
    setEditorError(null)
    try {
      await window.api.writeRules(agent, file.name, editor.getValue())
      toast.success(`已保存「${file.name}」`)
      onSaved()
      onClose()
    } catch (error) {
      setEditorError(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  // 让编辑器内 Ctrl+S 快捷键始终拿到最新的保存函数
  useEffect(() => {
    saveRef.current = () => void handleSave()
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[78vh] max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{file.name}</DialogTitle>
              <DialogDescription className="font-mono text-xs">{file.path}</DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="在文件夹中显示"
                aria-label="在文件夹中显示"
                onClick={() => void window.api.showRuleInFolder(agent, file.name)}
              >
                <FolderOpen aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title={previewOpen ? '关闭预览' : '打开预览'}
                aria-label={previewOpen ? '关闭预览' : '打开预览'}
                aria-pressed={previewOpen}
                onClick={() => setPreviewOpen((v) => !v)}
                className="mr-12"
              >
                {previewOpen ? (
                  <PanelRightClose aria-hidden="true" />
                ) : (
                  <PanelRight aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
            <div ref={bindContainer} className="h-full w-full" aria-label="规则文件编辑器" />
            {!editorReady && !editorError && (
              <div
                className="bg-background/80 text-muted-foreground absolute inset-0 flex items-center justify-center text-sm"
                role="status"
              >
                编辑器加载中…
              </div>
            )}
          </div>
          {previewOpen && (
            <div
              className="bg-muted/30 dark:bg-muted/20 min-w-0 flex-1 overflow-y-auto rounded-lg border border-black/[0.06] p-4 dark:border-white/[0.08]"
              aria-label="Markdown 预览"
            >
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
        {editorError && (
          <p className="text-destructive text-sm" role="alert">
            {editorError}
          </p>
        )}
        <DialogFooter className="shrink-0 pt-2 pb-1">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" disabled={!editorReady || saving} onClick={() => void handleSave()}>
            <Save aria-hidden="true" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
