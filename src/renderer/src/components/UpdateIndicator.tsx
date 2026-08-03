import { Download, RotateCw, Sparkles } from 'lucide-react'
import { useApp } from '../stores/app'
import { Button } from './ui/button'

/**
 * 首页顶栏的应用更新角标（挂在「OMP Switch」标题旁）：
 * - available：琥珀色「可更新」图标，点击开始下载
 * - downloading：下载图标 + 圆圈进度
 * - downloaded：更新完成，变成「更新并重启」按钮
 * 其余状态（idle / checking / not-available / dev / error）不显示，避免打扰。
 */
export default function UpdateIndicator(): React.JSX.Element | null {
  const { updater, downloadUpdate, installUpdate } = useApp()
  switch (updater.status) {
    case 'available':
      return (
        <button
          onClick={downloadUpdate}
          title={`检测到新版本 v${updater.version}，点击下载更新`}
          className="text-amber-500 transition-colors hover:text-amber-600"
        >
          <Sparkles className="size-4" />
        </button>
      )
    case 'downloading':
      return <DownloadRing percent={updater.percent ?? 0} />
    case 'downloaded':
      return (
        <Button
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs"
          onClick={installUpdate}
          title="更新并重启应用"
        >
          <RotateCw className="size-3.5" />
          更新
        </Button>
      )
    default:
      return null
  }
}

/** 下载图标 + 圆圈进度（stroke-dashoffset 按百分比推进，过渡平滑） */
function DownloadRing({ percent }: { percent: number }): React.JSX.Element {
  const size = 22
  const stroke = 2.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)
  return (
    <div className="relative shrink-0" title={`正在下载更新 ${Math.round(percent)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-blue-500/20"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-blue-500 transition-[stroke-dashoffset] duration-300"
        />
      </svg>
      <Download className="text-blue-500 absolute inset-0 m-auto size-3" />
    </div>
  )
}
