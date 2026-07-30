import {
  app,
  Menu,
  Notification,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions
} from 'electron'
import type { AgentId } from '../shared/types'
import { modelKey } from '../shared/modelRef'
import { getAdapter, listAdapters } from './agents'

interface TraySetupOptions {
  iconPath: string
  showWindow: () => void
  /** 托盘改配置后通知渲染进程重新拉取 */
  onStateChanged: (agentId: AgentId) => void
}

let tray: Tray | null = null

export function setupTray(options: TraySetupOptions): { refreshTray: () => void } {
  const icon = nativeImage.createFromPath(options.iconPath)
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('OMP Switch')
  tray.on('click', options.showWindow)

  const refreshTray = (): void => {
    void buildMenu(options).then((menu) => tray?.setContextMenu(menu))
  }
  refreshTray()
  return { refreshTray }
}

async function buildMenu(options: TraySetupOptions): Promise<Menu> {
  const items: MenuItemConstructorOptions[] = []

  for (const adapter of listAdapters()) {
    if (!adapter.detect()) continue
    items.push(await buildAgentSubmenu(adapter.id, adapter.label, options))
  }

  items.push(
    { type: 'separator' },
    { label: '打开主窗口', click: options.showWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  )
  return Menu.buildFromTemplate(items)
}

/** 某个 Agent 的「默认模型」快速切换子菜单，radio 勾选当前项 */
async function buildAgentSubmenu(
  agentId: AgentId,
  label: string,
  options: TraySetupOptions
): Promise<MenuItemConstructorOptions> {
  const adapter = getAdapter(agentId)
  try {
    const [providers, state] = await Promise.all([
      adapter.readProviders(),
      adapter.readSwitchState()
    ])
    const current = state.roles.default
    const currentKey = current ? modelKey(current) : ''

    const submenu: MenuItemConstructorOptions[] = []
    for (const [providerName, provider] of Object.entries(providers)) {
      for (const model of provider.models ?? []) {
        const key = `${providerName}/${model.id}`
        submenu.push({
          type: 'radio',
          label: key,
          checked: key === currentKey,
          click: () => void switchDefault(agentId, providerName, model.id, options)
        })
      }
    }
    if (submenu.length === 0) {
      submenu.push({ label: '（无可用模型）', enabled: false })
    }
    return { label: `${label} 默认模型`, submenu }
  } catch (error) {
    return {
      label: `${label}（配置读取失败）`,
      enabled: false,
      toolTip: error instanceof Error ? error.message : String(error)
    }
  }
}

async function switchDefault(
  agentId: AgentId,
  provider: string,
  model: string,
  options: TraySetupOptions
): Promise<void> {
  const adapter = getAdapter(agentId)
  try {
    const state = await adapter.readSwitchState()
    // 保留原有 effort/thinkingLevel，只换 provider/model
    const effort = state.roles.default?.effort
    state.roles.default = { provider, model, effort }
    await adapter.writeSwitchState(state)
    options.onStateChanged(agentId)
    new Notification({
      title: `${adapter.label} 已切换`,
      body: `default → ${provider}/${model}${effort ? `:${effort}` : ''}`
    }).show()
  } catch (error) {
    new Notification({
      title: `${adapter.label} 切换失败`,
      body: error instanceof Error ? error.message : String(error)
    }).show()
  } finally {
    // 无论成败都按磁盘真实状态重建勾选
    void buildMenu(options).then((menu) => tray?.setContextMenu(menu))
  }
}
