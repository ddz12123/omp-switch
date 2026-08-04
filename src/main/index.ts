import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpc } from './ipc'
import { setupTray } from './tray'
import { setupUpdater } from './updater'
import {
  configureTrustedRendererUrl,
  assertTrustedIpcSender,
  isAllowedExternalUrl,
  isTrustedRendererUrl
} from './lib/security'

let mainWindow: BrowserWindow | null = null
/** app.quit() 流程中（托盘退出/渲染层确认退出），放行窗口 close */
let isQuitting = false

// 单实例：重复启动时唤起已有实例的窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // 点关闭按钮不直接关：交给渲染层弹确认框（最小化到托盘 / 直接退出）
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.webContents.send('close-requested')
  })

  // 窗口销毁后释放引用，应用驻留托盘（见 window-all-closed）
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const rendererFile = join(__dirname, '../renderer/index.html')
  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(rendererFile).toString()
  configureTrustedRendererUrl(rendererUrl)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  // This application does not need camera, microphone, notifications, geolocation, or devices.
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(rendererFile)
  }
}

function showWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

app.whenReady().then(() => {
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
      mainWindow?.destroy()
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
      mainWindow?.webContents.send('state-changed', agentId)
    }
  })

  registerIpc(refreshTray)

  // 自更新接线：窗口用 getter 惰性获取（事件在 checkForUpdates 后才触发）
  setupUpdater(() => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭后不退出，驻留托盘；退出入口在托盘菜单
app.on('window-all-closed', () => {
  // 保持运行
})
