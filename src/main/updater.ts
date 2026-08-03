import { app, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdaterEvent } from '../shared/types'

/**
 * 应用自更新（electron-updater）接线。
 * - 只在打包环境真正检查更新；开发环境返回 dev 状态，避免 checkForUpdates 报错。
 * - autoDownload 关闭：发现新版本后由用户显式点击「下载更新」。
 * - 所有状态经 updater:event 通道推送给渲染层（见 shared/types 的 UpdaterEvent）。
 */

let getWindow: (() => BrowserWindow | null) | null = null
let wired = false

function emit(event: UpdaterEvent): void {
  getWindow?.()?.webContents.send('updater:event', event)
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err == null) return '未知错误'
  return String(err)
}

/** 注册 electron-updater 事件监听，转发到渲染层。传入取窗口的 getter（窗口可能后创建）。 */
export function setupUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  if (wired) return
  wired = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }))
  autoUpdater.on('download-progress', (progress) =>
    emit({ status: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    emit({ status: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) => emit({ status: 'error', message: toMessage(err) }))
}

/** 手动检查更新；开发环境直接回 dev 状态。 */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    emit({ status: 'dev' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ status: 'error', message: toMessage(err) })
  }
}

/** 下载已发现的更新；开发环境未真正检查过更新，直接回错误（autoUpdater 会抛 "Please check update first"） */
export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) {
    emit({ status: 'error', message: '开发模式不支持下载更新' })
    return
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ status: 'error', message: toMessage(err) })
  }
}

/** 退出并安装已下载完成的更新。 */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
