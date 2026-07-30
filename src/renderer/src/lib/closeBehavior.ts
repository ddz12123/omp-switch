/** 关闭主窗口行为偏好。配置文件是持久化源，localStorage 仅作启动镜像 */

import type { CloseBehavior } from '@shared/types'

export type { CloseBehavior }

const STORAGE_KEY = 'omp-switch:close-behavior'

export function getCloseBehavior(): CloseBehavior {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'minimize' || value === 'quit' ? value : 'ask'
}

export function storeCloseBehavior(value: CloseBehavior): void {
  localStorage.setItem(STORAGE_KEY, value)
}
