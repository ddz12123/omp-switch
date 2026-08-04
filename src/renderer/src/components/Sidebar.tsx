import { ArrowLeftRight, ScrollText, Server, Settings, ToggleLeft } from 'lucide-react'
import { useApp, type PageId } from '../stores/app'
import UpdateIndicator from './UpdateIndicator'
import { cn } from '../lib/utils'

interface NavItem {
  id: PageId
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { id: 'providers', label: '供应商', icon: Server },
  { id: 'switch', label: '模型切换', icon: ArrowLeftRight },
  { id: 'config', label: '全局配置', icon: ToggleLeft },
  { id: 'rules', label: '全局规则', icon: ScrollText }
]

const SETTINGS_ITEM: NavItem = { id: 'settings', label: '设置', icon: Settings }

export function Sidebar(): React.JSX.Element {
  const { page, setPage } = useApp()

  const itemCls = (id: PageId): string =>
    cn(
      'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 [transition-timing-function:var(--ease-fluid)]',
      page === id
        ? 'bg-card text-foreground shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] font-medium'
        : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
    )

  const iconCls = (id: PageId): string =>
    cn(
      'size-4 shrink-0 transition-colors duration-200',
      page === id ? 'text-foreground' : 'text-muted-foreground/70'
    )

  const renderItem = (item: NavItem, trailing?: React.ReactNode): React.JSX.Element => (
    <div key={item.id} className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setPage(item.id)}
        className={itemCls(item.id)}
        aria-current={page === item.id ? 'page' : undefined}
      >
        <item.icon className={iconCls(item.id)} />
        {item.label}
      </button>
      {trailing}
    </div>
  )

  return (
    <aside className="flex w-48 shrink-0 flex-col gap-1 p-3">
      {NAV_ITEMS.map((item) => renderItem(item))}
      {/* 更新角标挂在左下角「设置」旁（全局页隐藏侧边栏，设置页内有自己的更新卡片） */}
      <div className="mt-auto">{renderItem(SETTINGS_ITEM, <UpdateIndicator />)}</div>
    </aside>
  )
}
