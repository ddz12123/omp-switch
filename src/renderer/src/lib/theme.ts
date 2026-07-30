/** 主题管理：浅色 / 深色 / 跟随系统，默认浅色。
 * 配置文件（~/.omp-switch/config.json）是持久化源，
 * localStorage 仅作首屏镜像，避免异步读配置期间闪白/闪黑。 */

import type { Theme } from '@shared/types'

export type { Theme }

const STORAGE_KEY = 'omp-switch:theme'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export function getStoredTheme(): Theme {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'dark' || value === 'system' ? value : 'light'
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme)
}

/** 把主题落到 <html> 的 dark class 上 */
export function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && media.matches)
  document.documentElement.classList.toggle('dark', dark)
}

/** 应用启动时调用：应用已存主题，并在「跟随系统」时响应系统切换 */
export function initTheme(): void {
  applyTheme(getStoredTheme())
  media.addEventListener('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system')
  })
}
