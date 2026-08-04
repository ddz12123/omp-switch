import { lazy, Suspense, useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, MessagesSquare, Plug, Wrench, X } from 'lucide-react'
import { useApp, GLOBAL_PAGES, type PageId } from './stores/app'
import { Sidebar } from './components/Sidebar'
import { AgentIcon } from './components/AgentIcon'
import { cn } from './lib/utils'
import { Button } from './components/ui/button'
import { Toaster } from './components/ui/sonner'
import CloseConfirmDialog from './components/CloseConfirmDialog'

const ProvidersPage = lazy(() => import('./pages/ProvidersPage'))
const SwitchPage = lazy(() => import('./pages/SwitchPage'))
const ConfigPage = lazy(() => import('./pages/ConfigPage'))
const RulesPage = lazy(() => import('./pages/RulesPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const McpPage = lazy(() => import('./pages/McpPage'))
const SessionsPage = lazy(() => import('./pages/SessionsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

/** 顶栏右侧共用页导航（点击进入对应全局页） */
const TOP_NAV: { id: PageId; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { id: 'skills', label: 'Skills', icon: Wrench },
    { id: 'mcp', label: 'MCP', icon: Plug },
    { id: 'sessions', label: '会话', icon: MessagesSquare }
  ]

function PageFallback(): React.JSX.Element {
  return (
    <div
      className="text-muted-foreground flex h-full min-h-40 items-center justify-center gap-2 text-sm"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      页面加载中…
    </div>
  )
}

export default function App(): React.JSX.Element {
  const {
    agent,
    page,
    returnPage,
    statuses,
    error,
    agentOrder,
    hiddenAgents,
    setAgent,
    setPage,
    init,
    reload,
    clearError
  } = useApp()
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  useEffect(() => {
    void init()
    // 应用更新：启动默认检查一次；事件推送落 store（首页角标 / 设置页关于共用）
    const unsubscribeUpdater = window.api.onUpdaterEvent((event) =>
      useApp.getState().setUpdaterEvent(event)
    )
    useApp.getState().checkUpdate()
    // 托盘侧改了配置 → 当前 Agent 数据重新拉取
    const unsubscribe = window.api.onStateChanged((changedAgent) => {
      if (changedAgent === useApp.getState().agent) void useApp.getState().reload()
    })
    // 关闭按钮：按偏好直接执行，或弹二次确认
    const unsubscribeClose = window.api.onCloseRequested(() => {
      const behavior = useApp.getState().closeBehavior
      if (behavior === 'ask') {
        setCloseConfirmOpen(true)
      } else {
        window.api.closeAction(behavior)
      }
    })
    // 窗口重新聚焦时刷新，避免外部（CLI/手工编辑）改动后界面陈旧
    const onFocus = (): void => void useApp.getState().reload()
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribeUpdater()
      unsubscribe()
      unsubscribeClose()
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentStatus = statuses.find((s) => s.id === agent)
  const visibleAgents = agentOrder.filter((id) => !hiddenAgents.includes(id))
  const agentIndex = Math.max(0, visibleAgents.indexOf(agent))
  const isGlobal = GLOBAL_PAGES.includes(page)
  const goBack = (): void => setPage(returnPage)

  return (
    <div className="flex h-screen flex-col">
      {isGlobal ? (
        /* 全局页（Skills / MCP / 会话 / 设置）：隐藏侧边栏与 Agent 切换，页面自带返回按钮 */
        <main className="min-h-0 flex-1 overflow-hidden">
          <div
            key={page}
            className="animate-in fade-in slide-in-from-bottom-2 flex h-full min-h-0 flex-col px-7 pt-6 duration-300 [animation-timing-function:var(--ease-fluid)]"
          >
            <Suspense fallback={<PageFallback />}>
              {page === 'skills' && <SkillsPage onBack={goBack} />}
              {page === 'mcp' && <McpPage onBack={goBack} />}
              {page === 'sessions' && <SessionsPage onBack={goBack} />}
              {page === 'settings' && <SettingsPage onBack={goBack} />}
            </Suspense>
          </div>
        </main>
      ) : (
        <>
          {/* 顶栏：标题 + Agent 切换 + 共用页导航 */}
          <header className="border-border/60 flex h-14 shrink-0 items-center gap-5 border-b px-5">
            <h1 className="text-sm font-semibold tracking-tight">OMP Switch</h1>
            {/* 分段控件：滑块滑动到目标位置，而不是两个背景瞬间交换 */}
            <div className="bg-muted relative flex rounded-[10px] p-1" aria-label="选择 Agent">
              <div
                className="bg-card absolute inset-y-1 left-1 w-28 rounded-lg shadow-sm transition-transform duration-300 [transition-timing-function:var(--ease-fluid)]"
                style={{ transform: `translateX(${agentIndex * 7}rem)` }}
                aria-hidden="true"
              />
              {visibleAgents.map((id) => {
                const status = statuses.find((s) => s.id === id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={agent === id}
                    onClick={() => setAgent(id)}
                    className={cn(
                      'relative z-10 flex w-28 items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-medium transition-colors duration-200',
                      agent === id
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <AgentIcon agent={id} className="size-4.5" />
                    {status?.label ?? id}
                    {status && !status.installed && (
                      <span
                        className="size-1.5 rounded-full bg-amber-500/80"
                        title="未检测到配置"
                        aria-label="未检测到配置"
                      />
                    )}
                  </button>
                )
              })}
            </div>
            {/* 共用页导航（右侧）：点击进入全局全屏页 */}
            <nav className="ml-auto flex items-center gap-1" aria-label="全局功能">
              {TOP_NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPage(item.id)}
                  className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors"
                >
                  <item.icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </nav>
          </header>

          <div className="flex min-h-0 flex-1">
            <Sidebar />

            {/* 滚动交给各页面内容区，让页面头部/工具栏保持固定 */}
            <main className="min-w-0 flex-1 overflow-hidden">
              {/* 页面切换：淡入 + 轻微上移，key 变化触发重新入场 */}
              <div
                key={`${agent}/${page}`}
                className="animate-in fade-in slide-in-from-bottom-2 flex h-full min-h-0 flex-col px-7 pt-6 duration-300 [animation-timing-function:var(--ease-fluid)]"
              >
                {/* Agent 未安装提示 */}
                {currentStatus && !currentStatus.installed && (
                  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
                    未检测到 {currentStatus.label} 的配置文件（{currentStatus.providersPath}）。
                    保存操作会自动创建文件；若已安装请确认路径。
                  </div>
                )}

                {/* 全局错误条 */}
                {error && (
                  <div
                    className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1 break-all">{error}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => void reload()}
                    >
                      重试
                    </Button>
                    <button
                      type="button"
                      onClick={clearError}
                      className="opacity-60 hover:opacity-100"
                      aria-label="关闭错误提示"
                      title="关闭错误提示"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* 供应商 / 模型切换整体在滚动区内 */}
                <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                  <Suspense fallback={<PageFallback />}>
                    {page === 'providers' && <ProvidersPage />}
                    {page === 'switch' && <SwitchPage />}
                    {page === 'config' && <ConfigPage />}
                    {page === 'rules' && <RulesPage />}
                  </Suspense>
                </div>
              </div>
            </main>
          </div>
        </>
      )}

      {closeConfirmOpen && <CloseConfirmDialog onClose={() => setCloseConfirmOpen(false)} />}
      <Toaster position="bottom-right" />
    </div>
  )
}
