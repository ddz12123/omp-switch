import { useCallback, useEffect, useState } from 'react'
import { FileCode, FolderOpen, Loader2, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { ConfigFieldsResult } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { Button } from '../components/ui/button'
import ConfigGroupSection from '../components/config/ConfigGroupSection'
import ConfigFileDialog from '../components/ConfigFileDialog'

/** 全局配置可视化：schema 驱动表单 + 统一保存（只写变更字段，未知字段保留） */
export default function ConfigPage(): React.JSX.Element {
  const { agent } = useApp()
  const [result, setResult] = useState<ConfigFieldsResult | null>(null)
  /** 编辑中的字段值；null = 无未保存修改 */
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)

  const load = useCallback(
    (): Promise<void> =>
      window.api
        .readConfigFields(agent)
        .then((res) => {
          setResult(res)
          setDraft(null)
        })
        .catch((error) => {
          toast.error(`读取配置失败：${errorMessage(error)}`)
          return undefined
        }),
    [agent]
  )

  useEffect(() => {
    void load()
  }, [load])

  const handleChange = (key: string, value: unknown): void => {
    // 必须返回新对象：原地修改 prev 后返回同一引用，React 会 bailout 不重渲染
    setDraft((prev) => ({ ...(prev ?? result?.values ?? {}), [key]: value }))
  }

  /** 与磁盘值的差异：updates 为写入值，deletes 为要删除的字段路径 */
  const buildPatch = (): {
    updates: Record<string, unknown>
    deletes: string[]
  } => {
    const updates: Record<string, unknown> = {}
    const deletes: string[] = []
    if (!result || !draft) return { updates, deletes }
    for (const [key, value] of Object.entries(draft)) {
      if (result.values[key] === value) continue
      if (value === undefined) deletes.push(key)
      else updates[key] = value
    }
    return { updates, deletes }
  }

  const handleSave = async (): Promise<void> => {
    if (!result || !draft || saving) return
    const { updates, deletes } = buildPatch()
    if (Object.keys(updates).length === 0 && deletes.length === 0) {
      setDraft(null)
      return
    }
    setSaving(true)
    try {
      await window.api.writeConfigFields(agent, updates, deletes)
      toast.success('配置已保存')
      await load()
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    result !== null &&
    draft !== null &&
    (Object.keys(buildPatch().updates).length > 0 || buildPatch().deletes.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      {/* 顶部固定：标题 + 操作按钮 + 文件路径 */}
      <div className="shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            全局配置
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              表单化编辑高频配置项，未覆盖字段请用「原始编辑」
            </span>
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRawOpen(true)}>
              <FileCode />
              原始编辑
            </Button>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw />
              刷新
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                <RotateCcw />
                重置
              </Button>
            )}
            <Button onClick={() => void handleSave()} disabled={!dirty || saving}>
              <Save />
              {saving ? '保存中…' : dirty ? '保存' : '无修改'}
            </Button>
          </div>
        </div>
      </div>

      {/* 下方内容区：仅此处滚动，修改时头部保持可见 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {result === null ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-sm">
            <Loader2 className="size-4 animate-spin" />
            加载中…
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => void window.api.showConfigInFolder(agent, 'switch')}
              className="text-muted-foreground/70 hover:text-foreground flex max-w-full items-center gap-1 font-mono text-xs transition-colors"
              title="在文件夹中显示"
            >
              <FolderOpen className="size-3 shrink-0" />
              <span className="truncate">{result.path}</span>
            </button>
            {result.schema.map((group) => (
              <ConfigGroupSection
                key={group.id}
                group={group}
                values={draft ?? result.values}
                onChange={handleChange}
              />
            ))}
          </div>
        )}
      </div>

      {rawOpen && (
        <ConfigFileDialog
          agent={agent}
          kind="switch"
          title="编辑全局配置文件"
          onSaved={() => void load()}
          onClose={() => setRawOpen(false)}
        />
      )}
    </div>
  )
}
