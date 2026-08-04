import { useState } from 'react'
import { ExternalLink, FileCode, FolderOpen, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import type { Provider } from '@shared/types'
import { useApp } from '../stores/app'
import { getWebsite, removeWebsite } from '../lib/websites'
import { cn } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import ProviderDialog from '../components/ProviderDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import ConfigFileDialog from '../components/ConfigFileDialog'

export default function ProvidersPage(): React.JSX.Element {
  const { agent, providers, switchState, saveProviders, saveSwitch, reload } = useApp()
  const [dialogOpen, setDialogOpen] = useState(false)
  /** null = 新增，否则为正在编辑的 provider 名 */
  const [editingName, setEditingName] = useState<string | null>(null)
  /** 待删除的 provider 名（非 null 时显示确认弹框） */
  const [deletingName, setDeletingName] = useState<string | null>(null)
  /** 原始配置文件编辑弹框开关 */
  const [rawOpen, setRawOpen] = useState(false)

  const providerNames = Object.keys(providers)

  /** 引用了该供应商的角色列表 */
  const usedBy = (name: string): string[] =>
    Object.entries(switchState.roles)
      .filter(([, a]) => a.provider === name)
      .map(([role]) => role)

  const roleCount = Object.keys(switchState.roles).length

  /** 启用供应商：所有角色切到该供应商（模型 id 存在则保留，否则用第一个模型），无角色时初始化 default */
  const enableProvider = (name: string): void => {
    const models = providers[name]?.models ?? []
    if (models.length === 0) return
    const fallback = models[0].id
    const roles = { ...switchState.roles }
    if (roleCount === 0) {
      roles.default = { provider: name, model: fallback }
    } else {
      for (const [role, prev] of Object.entries(roles)) {
        const keep = models.some((m) => m.id === prev.model) ? prev.model : fallback
        roles[role] = { ...prev, provider: name, model: keep }
      }
    }
    void saveSwitch({ ...switchState, roles }, `已启用「${name}」`)
  }

  const openCreate = (): void => {
    setEditingName(null)
    setDialogOpen(true)
  }

  const openEdit = (name: string): void => {
    setEditingName(name)
    setDialogOpen(true)
  }

  const confirmDelete = async (name: string): Promise<void> => {
    const next = { ...providers }
    delete next[name]
    const ok = await saveProviders(next, `已删除供应商「${name}」`)
    if (ok) removeWebsite(agent, name)
  }

  const handleSave = async (name: string, provider: Provider): Promise<boolean> => {
    const next = { ...providers }
    if (editingName && editingName !== name) delete next[editingName]
    next[name] = provider
    return saveProviders(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold">
          供应商
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {providerNames.length} 个
          </span>
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void window.api.showConfigInFolder(agent, 'providers')}
          >
            <FolderOpen />
            打开配置目录
          </Button>
          <Button variant="outline" onClick={() => setRawOpen(true)}>
            <FileCode />
            编辑配置文件
          </Button>
          <Button onClick={openCreate}>
            <Plus />
            添加供应商
          </Button>
        </div>
      </div>

      {providerNames.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
          还没有供应商，点击右上角「添加供应商」创建第一个
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1 pb-6">
          {providerNames.map((name) => {
            const provider = providers[name]
            const roles = usedBy(name)
            const models = provider.models ?? []
            const website = getWebsite(agent, name)
            /** 所有角色都在用该供应商才算完全启用 */
            const isActive = roleCount > 0 && roles.length === roleCount
            return (
              <div
                key={name}
                className={cn(
                  'group bg-card flex items-center gap-4 rounded-xl border p-5 shadow-xs transition-all duration-200 [transition-timing-function:var(--ease-fluid)]',
                  isActive
                    ? 'border-primary/30 ring-primary/15 ring-1'
                    : 'border-black/[0.06] hover:-translate-y-0.5 hover:shadow-md dark:border-white/[0.08]'
                )}
              >
                {/* 字母头像 */}
                <div className="bg-muted text-foreground/70 flex size-12 shrink-0 items-center justify-center rounded-xl border text-lg font-bold uppercase">
                  {name.charAt(0)}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">{name}</span>
                    {provider.api && (
                      <Badge
                        variant="secondary"
                        className="text-muted-foreground px-2 text-xs font-normal"
                      >
                        {provider.api}
                      </Badge>
                    )}
                    {roles.length > 0 && (
                      <Badge variant="success" className="px-2 text-xs">
                        使用中 · {roles.join('/')}
                      </Badge>
                    )}
                  </div>
                  {/* 有官网显示可点击链接；否则退回展示 baseUrl（纯文本，不是官网） */}
                  {website ? (
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-1 self-start text-sm text-sky-600 hover:underline dark:text-sky-400"
                      title="在浏览器中打开官网"
                      onClick={() => void window.api.openExternal(website)}
                    >
                      <span className="truncate">{website}</span>
                      <ExternalLink className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ) : (
                    <span
                      className="text-muted-foreground truncate font-mono text-sm"
                      title="API 地址（编辑供应商可填写官网）"
                    >
                      {provider.baseUrl ?? '（未设置 baseUrl）'}
                    </span>
                  )}
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {models.length === 0 ? '暂无模型' : models.map((m) => m.id).join(' · ')}
                  </div>
                </div>

                {/* 操作区：hover 浮现，避免视觉噪音 */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                  {!isActive && (
                    <Button
                      size="sm"
                      className="mr-1 rounded-full px-4"
                      disabled={models.length === 0}
                      title={models.length === 0 ? '请先添加模型' : '所有角色切换到该供应商'}
                      onClick={() => enableProvider(name)}
                    >
                      <Play className="size-3.5" />
                      启用
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-9"
                    title="编辑"
                    onClick={() => openEdit(name)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-9"
                    title="删除"
                    onClick={() => setDeletingName(name)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialogOpen && (
        <ProviderDialog
          key={editingName ?? '__new__'}
          agent={agent}
          originalName={editingName}
          initial={editingName ? providers[editingName] : undefined}
          existingNames={providerNames}
          onSave={handleSave}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {deletingName && (
        <ConfirmDialog
          title={`删除供应商「${deletingName}」？`}
          description={
            usedBy(deletingName).length > 0
              ? `该供应商正被角色 ${usedBy(deletingName).join('、')} 引用，删除后这些角色将失效。`
              : '将从配置文件中移除该供应商（写入前自动备份 .bak）。'
          }
          onConfirm={() => void confirmDelete(deletingName)}
          onClose={() => setDeletingName(null)}
        />
      )}

      {rawOpen && (
        <ConfigFileDialog
          agent={agent}
          kind="providers"
          title="编辑供应商配置文件"
          onSaved={() => void reload()}
          onClose={() => setRawOpen(false)}
        />
      )}
    </div>
  )
}
