/** 会话列表与详情阅读器共用的展示格式化工具 */

/** 相对时间（列表次要行用），超过 30 天退回本地日期 */
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return ''
  const sec = Math.floor((Date.now() - t) / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  const day = Math.floor(sec / 86400)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString()
}

/** 详情里的绝对时间 */
export function formatDateTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return iso || '—'
  return new Date(t).toLocaleString()
}

/** 消息行的紧凑时间：M/D HH:mm */
export function formatShortTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!iso || Number.isNaN(t)) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/** 大数字紧凑显示，避免统计块里出现一长串位数 */
export function formatCompact(value: number): string {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

/** 工作目录最后一段作为项目名；过短或纯数字时带上父目录，避免出现「1」「4」这种组名 */
export function projectName(cwd: string): string {
  if (!cwd) return '未知项目'
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  const last = parts[parts.length - 1] || cwd
  if (last.length <= 2 || /^\d+$/.test(last)) {
    const parent = parts[parts.length - 2]
    return parent ? `${parent}/${last}` : last
  }
  return last
}
