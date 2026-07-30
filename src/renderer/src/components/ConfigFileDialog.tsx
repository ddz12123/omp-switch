import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentId, ConfigFileKind, RawConfigFile } from '@shared/types'
import { monaco } from '../lib/monaco'
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

function languageOf(path: string): string {
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
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const saveRef = useRef<() => void>(() => {})
  const [file, setFile] = useState<RawConfigFile | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .readRawConfig(agent, kind)
      .then((result) => {
        if (!cancelled) setFile(result)
      })
      .catch((error) => {
        toast.error(`读取配置文件失败：${errorMessage(error)}`)
        onClose()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, kind])

  // 内容就绪后挂载编辑器，弹框关闭时销毁
  useEffect(() => {
    if (!file || !containerRef.current) return undefined
    const editor = monaco.editor.create(containerRef.current, {
      value: file.content,
      language: languageOf(file.path),
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
    editor.focus()
    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [file])

  const handleSave = async (): Promise<void> => {
    const editor = editorRef.current
    if (!file || !editor || saving) return
    setSaving(true)
    try {
      await window.api.writeRawConfig(agent, kind, editor.getValue())
      toast.success(`已保存「${file.path}」`)
      onSaved()
      onClose()
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`)
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
      <DialogContent className="flex h-[78vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {file?.path ?? '加载中…'}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
          {file ? (
            <div ref={containerRef} className="h-full w-full" />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              加载中…
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!file || saving} onClick={() => void handleSave()}>
            <Save />
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
