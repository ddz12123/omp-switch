import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { editor as MonacoEditor } from 'monaco-editor/editor/editor.api.js'
import type { AgentId, ConfigFileKind, RawConfigFile } from '@shared/types'
import { loadMonaco, type MonacoLanguage } from '../lib/monaco'
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

interface ConfigFileDialogProps {
  agent: AgentId
  kind: ConfigFileKind
  title: string
  onClose: () => void
  /** 保存成功后回调（刷新页面数据） */
  onSaved: () => void
}

function languageOf(path: string): MonacoLanguage {
  if (/\.json$/i.test(path)) return 'json'
  if (/\.ya?ml$/i.test(path)) return 'yaml'
  return 'plaintext'
}

/** 用 Monaco 直接编辑原始配置文件的弹框，保存时主进程做语法校验 + .bak 备份 */
export default function ConfigFileDialog({
  agent,
  kind,
  title,
  onClose,
  onSaved
}: ConfigFileDialogProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const [file, setFile] = useState<RawConfigFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadFile = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    setFile(null)
    try {
      setFile(await window.api.readRawConfig(agent, kind))
    } catch (error) {
      setLoadError(`读取配置文件失败：${errorMessage(error)}`)
    } finally {
      setLoading(false)
    }
  }, [agent, kind])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFile(), 0)
    return () => window.clearTimeout(timer)
  }, [loadFile])

  // 内容就绪后再异步加载 Monaco；弹框未打开时不会下载编辑器代码和 worker。
  useEffect(() => {
    if (!file || !containerRef.current) return undefined
    let disposed = false
    let editor: MonacoEditor.IStandaloneCodeEditor | null = null
    const language = languageOf(file.path)

    setEditorError(null)
    setEditorReady(false)
    void loadMonaco(language)
      .then((monaco) => {
        if (disposed || !containerRef.current) return
        editor = monaco.editor.create(containerRef.current, {
          value: file.content,
          language,
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
        // Ctrl/Cmd + S 直接保存
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
        editorRef.current = editor
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
  }, [file])

  const handleSave = async (): Promise<void> => {
    const editor = editorRef.current
    if (!file || !editor || saving) return
    setSaving(true)
    setEditorError(null)
    try {
      await window.api.writeRawConfig(agent, kind, editor.getValue())
      toast.success(`已保存「${file.path}」`)
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
      <DialogContent className="flex h-[78vh] max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {file?.path ?? (loading ? '加载中…' : '尚未读取配置文件')}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
          {loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-destructive text-sm" role="alert">
                {loadError}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadFile()}>
                <RefreshCw aria-hidden="true" />
                重新读取
              </Button>
            </div>
          ) : file ? (
            <div ref={containerRef} className="h-full w-full" aria-label="原始配置编辑器" />
          ) : (
            <div
              className="text-muted-foreground flex h-full items-center justify-center text-sm"
              role="status"
            >
              加载中…
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
          <Button
            type="button"
            disabled={!file || !editorReady || saving || Boolean(editorError)}
            onClick={() => void handleSave()}
          >
            <Save aria-hidden="true" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
