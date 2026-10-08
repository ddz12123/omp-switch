import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { setupTray } from './tray'
import { setupUpdater } from './updater'
import { getMainWindow, setMainWindow } from './window'
import { inspectAppConfig } from './appConfig'
import { setOmpProfile } from './agents'
import {
  configureTrustedRendererUrl,
  assertTrustedIpcSender,
  isAllowedExternalUrl,
  isTrustedRendererUrl
} from './lib/security'

/** app.quit() 流程中（托盘退出/渲染层确认退出），放行窗口 close */
let isQuitting = false

// 单实例：重复启动时唤起已有实例的窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // 点关闭按钮不直接关：交给渲染层弹确认框（最小化到托盘 / 直接退出）
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    getMainWindow()?.webContents.send('close-requested')
  })

  // 窗口销毁后释放引用，应用驻留托盘（见 window-all-closed）
  window.on('closed', () => {
    setMainWindow(null)
  })
  setMainWindow(window)

  const rendererFile = join(__dirname, '../renderer/index.html')
  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(rendererFile).toString()
  configureTrustedRendererUrl(rendererUrl)

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  // Only allow sanitized clipboard writes from our trusted renderer. Clipboard reads and all
  // other sensitive web permissions remain denied.
  window.webContents.session.setPermissionCheckHandler((contents, permission) => {
    return (
      permission === 'clipboard-sanitized-write' &&
      contents !== null &&
      isTrustedRendererUrl(contents.getURL())
    )
  })
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' && isTrustedRendererUrl(contents.getURL()))
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(rendererFile)
  }
}

function showWindow(): void {
  const existing = getMainWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
  } else {
    createWindow()
  }
}

/**
 * 启动时恢复上次选择的 omp profile。
 * 必须在 registerIpc / setupTray 之前：托盘和所有 IPC 读的都是适配器当前的 agentDir。
 */
async function restoreOmpProfile(): Promise<void> {
  try {
    const result = await inspectAppConfig()
    if (result.status !== 'ok') return
    const profile = typeof result.config.ompProfile === 'string' ? result.config.ompProfile : ''
    if (profile === '') {
      setOmpProfile('')
      return
    }
    setOmpProfile(profile)
  } catch (error) {
    // profile 恢复失败不能阻断启动，退回默认 profile
    console.error('恢复 omp profile 失败，使用默认 profile', error)
    setOmpProfile('')
  }
}

app.whenReady().then(async () => {
  // 先恢复 profile，再建托盘/IPC，保证两者一开始就用对的 agent 目录
  await restoreOmpProfile()

  electronApp.setAppUserModelId('com.ompswitch.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('second-instance', showWindow)

  // 渲染层关闭确认框的结果：最小化到托盘（销毁窗口省内存）或直接退出
  ipcMain.on('window:close-action', (event, action: unknown) => {
    assertTrustedIpcSender(event)
    if (action !== 'minimize' && action !== 'quit') return
    if (action === 'quit') {
      isQuitting = true
      app.quit()
    } else {
      // destroy 不触发 close 事件，避免再次弹确认
      getMainWindow()?.destroy()
    }
  })

  // app.quit() 前置标记，保证托盘「退出」也能通过 close 拦截
  app.on('before-quit', () => {
    isQuitting = true
  })

  const { refreshTray } = setupTray({
    iconPath: icon,
    showWindow,
    onStateChanged: (agentId) => {
      // 托盘切换后通知打开着的窗口刷新数据
      getMainWindow()?.webContents.send('state-changed', agentId)
    }
  })

  registerIpc(refreshTray)

  // 自更新接线：窗口用 getter 惰性获取（事件在 checkForUpdates 后才触发）
  setupUpdater(getMainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭后不退出，驻留托盘；退出入口在托盘菜单
app.on('window-all-closed', () => {
  // 保持运行
})
