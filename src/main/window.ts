import type { BrowserWindow } from 'electron'

/**
 * 主窗口句柄的共享存放点。
 * ipc.ts 需要在不依赖 main/index.ts 的情况下给渲染进程推事件，
 * 单独放一个模块避免 ipc ↔ index 循环依赖。
 */
let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
