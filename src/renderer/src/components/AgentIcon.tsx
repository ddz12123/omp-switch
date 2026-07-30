import type { AgentId } from '@shared/types'
import { cn } from '../lib/utils'

/**
 * Agent 品牌图标（内置 SVG，不依赖外部图片，明暗主题都清晰）：
 * - pi:  π 符号（pi.dev / badlogic/pi-mono 的品牌标识），蓝色圆角方块
 * - omp: ⌥ 符号（can1357/oh-my-pi 仓库的品牌标识），深灰圆角方块
 */
const GLYPHS: Record<AgentId, { tile: string; paths: string[] }> = {
  pi: {
    tile: '#2563eb',
    paths: [
      'M5.5 8.2 C6.5 7 7.5 7 9 7.2 L18.5 7.2',
      'M9.4 7.4 C9.4 11 8.9 14.4 7.8 17',
      'M14.8 7.4 L14.8 15 C14.8 16.4 15.6 17.2 17 16.8'
    ]
  },
  omp: {
    tile: '#27272a',
    paths: ['M5 7.5 L9.5 7.5 L14.5 16.5 L19 16.5', 'M14 7.5 L19 7.5']
  }
}

export function AgentIcon({
  agent,
  className
}: {
  agent: AgentId
  className?: string
}): React.JSX.Element {
  const glyph = GLYPHS[agent]
  return (
    <svg viewBox="0 0 24 24" className={cn('size-4 shrink-0', className)} aria-hidden="true">
      <rect x="0.5" y="0.5" width="23" height="23" rx="5.5" fill={glyph.tile} />
      {/* 内描边：深色主题下深色方块不至于沉底 */}
      <rect
        x="0.5"
        y="0.5"
        width="23"
        height="23"
        rx="5.5"
        fill="none"
        stroke="rgba(255,255,255,0.18)"
      />
      {glyph.paths.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="#fff"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
