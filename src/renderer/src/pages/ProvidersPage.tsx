import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3,
  Copy,
  ExternalLink,
  FileCode,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { Provider } from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { getWebsite, removeWebsite, setWebsite } from '../lib/websites'
import { getUsageEndpoint, removeUsageEndpoint, setUsageEndpoint } from '../lib/usageEndpoints'
import {
  fetchUsageQuery,
  getUsageQuery,
  removeUsageQuery,
  setUsageQuery
} from '../lib/usageQueries'
import { cn } from '../lib/utils'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import ProviderDialog from '../components/ProviderDialog'
import ConfirmDialog from '../components/ConfirmDialog'
import ConfigFileDialog from '../components/ConfigFileDialog'
import UsageDialog from '../components/UsageDialog'

interface UsageDisplay {
  loading: boolean
  updatedAt?: number
  extracted?: unknown
  error?: string
}

function balanceOf(extracted: unknown): { remaining: string; unit: string } | null {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) return null
  const value = extracted as Record<string, unknown>
  if (value.isValid === false) return null
  const remaining = value.remaining
  if (typeof remaining !== 'number' && typeof remaining !== 'string') return null
  const numeric = typeof remaining === 'number' ? remaining : Number(remaining)
  return {
    remaining: Number.isFinite(numeric) ? numeric.toFixed(2) : String(remaining),
    unit: typeof value.unit === 'string' ? value.unit : ''
  }
}

function elapsedLabel(timestamp: number, now: number): string {
  const minutes = Math.floor((now - timestamp) / 60_000)
  return minutes <= 0 ? '刚刚' : `${minutes} 分钟前`
}

export default function ProvidersPage(): React.JSX.Element {
  const { agent, providers, switchState, usageQueries, saveProviders, saveSwitch, reload } =
    useApp()
  const [dialogOpen, setDialogOpen] = useState(false)
  /** null = 新增，否则为正在编辑的 provider 名 */
  const [editingName, setEditingName] = useState<string | null>(null)
  /** 待删除的 provider 名（非 null 时显示确认弹框） */
  const [deletingName, setDeletingName] = useState<string | null>(null)
  /** 原始配置文件编辑弹框开关 */
  const [rawOpen, setRawOpen] = useState(false)
  /** 正在查询用量的 provider 名 */
  const [usageDisplays, setUsageDisplays] = useState<Record<string, UsageDisplay>>({})
  const [now, setNow] = useState(() => Date.now())
  const [usageName, setUsageName] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

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
    if (ok) {
      removeWebsite(agent, name)
      removeUsageEndpoint(agent, name)
      removeUsageQuery(agent, name)
    }
  }

  /**
   * 官网与自定义用量接口一起复制。saveProviders 失败时不写应用配置，
   * 避免给不存在的供应商留下孤立记录。
   */
  const copyProvider = async (name: string): Promise<void> => {
    const source = providers[name]
    if (!source) return
    const base = `${name}-copy`
    let newName = base
    let suffix = 2
    while (newName in providers) {
      newName = `${base}-${suffix}`
      suffix += 1
    }
    const cloned = JSON.parse(JSON.stringify(source)) as Provider
    const next = { ...providers, [newName]: cloned }
    const website = getWebsite(agent, name)
    const usageEndpoint = getUsageEndpoint(agent, name)
    const ok = await saveProviders(next, `已复制供应商「${name}」 → 「${newName}」`)
    if (ok) {
      if (website) setWebsite(agent, newName, website)
      if (usageEndpoint) setUsageEndpoint(agent, newName, usageEndpoint)
      const usageQuery = getUsageQuery(agent, name, source)
      if (usageQuery.enabled || usageQuery.script) setUsageQuery(agent, newName, usageQuery)
    }
  }

  const handleSave = async (name: string, provider: Provider): Promise<boolean> => {
    const next = { ...providers }
    if (editingName && editingName !== name) delete next[editingName]
    next[name] = provider
    return saveProviders(next)
  }

  const refreshUsage = useCallback(
    async (name: string): Promise<void> => {
      const provider = providers[name]
      if (!provider) return
      const query = getUsageQuery(agent, name, provider)
      if (!query.enabled) return
      setUsageDisplays((current) => ({
        ...current,
        [name]: { ...current[name], loading: true, error: undefined }
      }))
      try {
        const result = await fetchUsageQuery(query, provider)
        setUsageDisplays((current) => ({
          ...current,
          [name]: { loading: false, updatedAt: Date.now(), extracted: result.extracted }
        }))
      } catch (error) {
        setUsageDisplays((current) => ({
          ...current,
          [name]: { ...current[name], loading: false, error: errorMessage(error) }
        }))
      }
    },
    [agent, providers]
  )

  useEffect(() => {
    const timers = Object.entries(providers).flatMap(([name, provider]) => {
      const query = getUsageQuery(agent, name, provider)
      if (!query.enabled) return []
      void refreshUsage(name)
      if (query.intervalMinutes === 0) return []
      return [window.setInterval(() => void refreshUsage(name), query.intervalMinutes * 60_000)]
    })
    return () => timers.forEach((timer) => window.clearInterval(timer))
  }, [agent, providers, usageQueries, refreshUsage])

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
            const usageQuery = getUsageQuery(agent, name, provider)
            const usageDisplay = usageDisplays[name]
            const balance = balanceOf(usageDisplay?.extracted)
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
                {usageQuery.enabled && (
                  <div className="flex min-w-44 flex-col items-center gap-0.5 text-xs leading-4">
                    <div className="text-muted-foreground flex items-center gap-1 text-[11px] leading-3">
                      <span>
                        {usageDisplay?.updatedAt
                          ? elapsedLabel(usageDisplay.updatedAt, now)
                          : '查询中…'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        title="刷新用量"
                        aria-label="刷新用量"
                        disabled={usageDisplay?.loading}
                        onClick={() => void refreshUsage(name)}
                      >
                        <RefreshCw
                          className={usageDisplay?.loading ? 'size-3.5 animate-spin' : 'size-3.5'}
                        />
                      </Button>
                    </div>
                    {balance ? (
                      <span className="whitespace-nowrap">
                        剩余：
                        <strong className="text-emerald-500 font-mono text-sm font-semibold tabular-nums">
                          {balance.remaining}
                        </strong>
                        {balance.unit && (
                          <span className="ml-1 font-mono text-[11px] tabular-nums">
                            {balance.unit}
                          </span>
                        )}
                      </span>
                    ) : usageDisplay?.error ? (
                      <span className="text-destructive" title={usageDisplay.error}>
                        查询失败
                      </span>
                    ) : (
                      <span className="text-muted-foreground">暂未返回余额</span>
                    )}
                  </div>
                )}

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
                    className="text-muted-foreground hover:text-foreground size-9"
                    title="复制"
                    onClick={() => void copyProvider(name)}
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground size-9"
                    title="用量查询"
                    onClick={() => setUsageName(name)}
                  >
                    <BarChart3 />
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

      {usageName && providers[usageName] && (
        <UsageDialog
          agent={agent}
          name={usageName}
          provider={providers[usageName]}
          onClose={() => setUsageName(null)}
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
