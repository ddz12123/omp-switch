import { ArrowLeftRight, ScrollText, Server, Settings, ToggleLeft } from 'lucide-react'
import { useApp, type PageId } from '../stores/app'
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

  const renderItem = (item: NavItem): React.JSX.Element => (
    <button
      key={item.id}
      onClick={() => setPage(item.id)}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 [transition-timing-function:var(--ease-fluid)]',
        page === item.id
          ? 'bg-card text-foreground shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06] font-medium'
          : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground'
      )}
    >
      <item.icon
        className={cn(
          'size-4 transition-colors duration-200',
          page === item.id ? 'text-foreground' : 'text-muted-foreground/70'
        )}
      />
      {item.label}
    </button>
  )

  return (
    <aside className="flex w-48 shrink-0 flex-col gap-1 p-3">
      {NAV_ITEMS.map(renderItem)}
      <div className="mt-auto">{renderItem(SETTINGS_ITEM)}</div>
    </aside>
  )
}
