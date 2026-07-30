import { useEffect, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { useApp } from './stores/app'
import { Sidebar } from './components/Sidebar'
import { AgentIcon } from './components/AgentIcon'
import { cn } from './lib/utils'
import { Button } from './components/ui/button'
import { Toaster } from './components/ui/sonner'
import CloseConfirmDialog from './components/CloseConfirmDialog'
import ProvidersPage from './pages/ProvidersPage'
import SwitchPage from './pages/SwitchPage'
import SkillsPage from './pages/SkillsPage'
import McpPage from './pages/McpPage'
import SessionsPage from './pages/SessionsPage'
import SettingsPage from './pages/SettingsPage'

export default function App(): React.JSX.Element {
  const {
    agent,
    page,
    statuses,
    error,
    agentOrder,
    hiddenAgents,
    setAgent,
    init,
    reload,
    clearError
  } = useApp()
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  useEffect(() => {
    void init()
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
      unsubscribe()
      unsubscribeClose()
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentStatus = statuses.find((s) => s.id === agent)
  const visibleAgents = agentOrder.filter((id) => !hiddenAgents.includes(id))
  const agentIndex = Math.max(0, visibleAgents.indexOf(agent))

  return (
    <div className="flex h-screen flex-col">
      {/* 顶栏：标题 + Agent 切换 */}
      <header className="border-border/60 flex h-14 shrink-0 items-center gap-5 border-b px-5">
        <h1 className="text-sm font-semibold tracking-tight">OMP Switch</h1>
        {/* 分段控件：滑块滑动到目标位置，而不是两个背景瞬间交换 */}
        <div className="bg-muted relative flex rounded-[10px] p-1">
          <div
            className="bg-card absolute inset-y-1 left-1 w-28 rounded-lg shadow-sm transition-transform duration-300 [transition-timing-function:var(--ease-fluid)]"
            style={{ transform: `translateX(${agentIndex * 7}rem)` }}
          />
          {visibleAgents.map((id) => {
            const status = statuses.find((s) => s.id === id)
            return (
              <button
                key={id}
                onClick={() => setAgent(id)}
                className={cn(
                  'relative z-10 flex w-28 items-center justify-center gap-2 rounded-lg py-1.5 text-sm font-medium transition-colors duration-200',
                  agent === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <AgentIcon agent={id} className="size-4.5" />
                {status?.label ?? id}
                {status && !status.installed && (
                  <span className="size-1.5 rounded-full bg-amber-500/80" title="未检测到配置" />
                )}
              </button>
            )
          })}
        </div>
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
              <div className="border-destructive/30 bg-destructive/10 text-destructive mb-4 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1 break-all">{error}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => void reload()}
                >
                  重试
                </Button>
                <button onClick={clearError} className="opacity-60 hover:opacity-100">
                  <X className="size-4" />
                </button>
              </div>
            )}

            {/* Skills / 会话 页自己管理「头部固定 + 内容滚动」，其他页面整体在滚动区内 */}
            {page === 'skills' ? (
              <SkillsPage />
            ) : page === 'sessions' ? (
              <SessionsPage />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pb-6">
                {page === 'providers' && <ProvidersPage />}
                {page === 'switch' && <SwitchPage />}
                {page === 'mcp' && <McpPage />}
                {page === 'settings' && <SettingsPage />}
              </div>
            )}
          </div>
        </main>
      </div>

      {closeConfirmOpen && <CloseConfirmDialog onClose={() => setCloseConfirmOpen(false)} />}
      <Toaster position="bottom-right" />
    </div>
  )
}
