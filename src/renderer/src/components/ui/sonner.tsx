import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useApp } from '../../stores/app'

/** 全局 toast 容器，跟随应用主题，用主题变量着色 */
function Toaster(props: ToasterProps): React.JSX.Element {
  const theme = useApp((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
