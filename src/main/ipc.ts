import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'
import { parseDocument } from 'yaml'
import type {
  AgentId,
  AppConfig,
  ConfigFileKind,
  McpServerConfig,
  ProviderMap,
  SkillSyncMode,
  SwitchState
} from '../shared/types'
import type { FetchRemoteModelsPayload } from '../shared/api'
import { getAdapter, getAgentStatuses } from './agents'
import { fetchRemoteModels } from './remoteModels'
import { getCliVersions } from './cliVersion'
import { changeConfigDir, getAppConfigPath, readAppConfig, writeAppConfig } from './appConfig'
import {
  deleteSkill,
  fetchRepoSkills,
  getSkillsDir,
  installSkills,
  checkSkillUpdates,
  updateSkill,
  listSkills,
  migrateSkillsDir,
  resyncSkills,
  searchSkillsSh,
  setSkillSync
} from './skills'
import {
  deleteMcpServer,
  getMcpStorePath,
  listMcpServers,
  saveMcpServer,
  toggleMcpServer
} from './mcp'
import {
  deleteSessions,
  listSessions,
  readSessionRaw,
  resolveSafeSessionPath,
  resolveSessionRoots
} from './sessions'
import { readTextFile, writeTextFileSafe } from './lib/fileio'
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updater'

/** 根据类别取原始配置文件路径 */
function rawConfigPath(agentId: AgentId, kind: ConfigFileKind): string {
  const adapter = getAdapter(agentId)
  return kind === 'providers' ? adapter.providersPath : adapter.switchPath
}

/** 落盘前按扩展名做语法校验，坏文件直接拒绝写入 */
function assertSyntax(path: string, content: string): void {
  if (/\.ya?ml$/i.test(path)) {
    const doc = parseDocument(content)
    if (doc.errors.length > 0) {
      throw new Error(`YAML 语法错误：${doc.errors[0].message}`)
    }
  } else if (/\.json$/i.test(path)) {
    try {
      JSON.parse(content)
    } catch (error) {
      throw new Error(`JSON 语法错误：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * IPC 通道注册。所有写操作完成后刷新托盘菜单，保持勾选态同步。
 * handler 抛出的异常会以 rejected promise 形式传给渲染进程展示。
 */
export function registerIpc(refreshTray: () => void): void {
  ipcMain.handle('agents:status', () => getAgentStatuses())

  ipcMain.handle('providers:read', (_e, agentId: AgentId) => getAdapter(agentId).readProviders())

  ipcMain.handle('providers:write', async (_e, agentId: AgentId, map: ProviderMap) => {
    await getAdapter(agentId).writeProviders(map)
    refreshTray()
  })

  ipcMain.handle('switch:read', (_e, agentId: AgentId) => getAdapter(agentId).readSwitchState())

  ipcMain.handle('switch:write', async (_e, agentId: AgentId, state: SwitchState) => {
    await getAdapter(agentId).writeSwitchState(state)
    refreshTray()
  })

  ipcMain.handle('models:fetch-remote', (_e, payload: FetchRemoteModelsPayload) =>
    fetchRemoteModels(payload)
  )

  ipcMain.handle('cli:versions', () => getCliVersions())

  ipcMain.handle('config:show-in-folder', (_e, agentId: AgentId) => {
    shell.showItemInFolder(getAdapter(agentId).providersPath)
  })

  ipcMain.handle('config:read-raw', async (_e, agentId: AgentId, kind: ConfigFileKind) => {
    const path = rawConfigPath(agentId, kind)
    return { path, content: (await readTextFile(path)) ?? '' }
  })

  ipcMain.handle(
    'config:write-raw',
    async (_e, agentId: AgentId, kind: ConfigFileKind, content: string) => {
      const path = rawConfigPath(agentId, kind)
      assertSyntax(path, content)
      await writeTextFileSafe(path, content)
      refreshTray()
    }
  )

  ipcMain.handle('shell:open-external', (_e, url: string) => {
    // 只放行 http/https，防止渲染层传入任意协议
    if (!/^https?:\/\//i.test(url)) throw new Error(`拒绝打开非 http(s) 链接: ${url}`)
    return shell.openExternal(url)
  })

  ipcMain.handle('app-config:read', async () => ({
    path: await getAppConfigPath(),
    config: await readAppConfig()
  }))

  ipcMain.handle('app-config:write', (_e, config: AppConfig) => writeAppConfig(config))

  ipcMain.handle('app-config:show-in-folder', async () => {
    shell.showItemInFolder(await getAppConfigPath())
  })

  /** 弹目录选择框并迁移配置，取消时返回 null，成功返回新的 config.json 路径 */
  ipcMain.handle('app-config:change-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: '选择配置文件存储目录',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return changeConfigDir(result.filePaths[0])
  })

  ipcMain.handle('skills:list', () => listSkills())

  ipcMain.handle('skills:sync', (_e, dir: string, agentId: AgentId, enabled: boolean) =>
    setSkillSync(dir, agentId, enabled)
  )

  ipcMain.handle('skills:delete', (_e, dir: string) => deleteSkill(dir))

  ipcMain.handle('skills:repo-skills', (_e, input: string, branch?: string) =>
    fetchRepoSkills(input, branch)
  )

  ipcMain.handle('skills:install', (_e, repo: string, branch: string, paths: string[]) =>
    installSkills(repo, branch, paths)
  )

  ipcMain.handle('skills:check-updates', () => checkSkillUpdates())

  ipcMain.handle('skills:update', (_e, dir: string) => updateSkill(dir))

  ipcMain.handle('skills:search-sh', (_e, query: string) => searchSkillsSh(query))

  ipcMain.handle('skills:resync', (_e, mode: SkillSyncMode) => resyncSkills(mode))

  ipcMain.handle('skills:show-in-folder', async () => {
    const dir = await getSkillsDir()
    await mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })

  /** 弹目录选择框迁移技能存储位置，取消返回 null；新路径由渲染层写回 config */
  ipcMain.handle('skills:change-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: '选择技能存储目录',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return migrateSkillsDir(result.filePaths[0])
  })

  ipcMain.handle('mcp:list', () => listMcpServers())

  ipcMain.handle('mcp:store-path', () => getMcpStorePath())

  /** 在资源管理器中显示中央库文件；文件尚不存在则打开其所在目录 */
  ipcMain.handle('mcp:show-in-folder', async () => {
    const path = await getMcpStorePath()
    await mkdir(dirname(path), { recursive: true })
    if (existsSync(path)) shell.showItemInFolder(path)
    else await shell.openPath(dirname(path))
  })

  ipcMain.handle(
    'mcp:save',
    (_e, originalName: string | null, name: string, config: McpServerConfig) =>
      saveMcpServer(originalName, name, config)
  )

  ipcMain.handle('mcp:delete', (_e, name: string) => deleteMcpServer(name))

  ipcMain.handle('mcp:toggle', (_e, name: string, agentId: AgentId, enabled: boolean) =>
    toggleMcpServer(name, agentId, enabled)
  )

  ipcMain.handle('sessions:roots', () => resolveSessionRoots())

  ipcMain.handle('sessions:list', () => listSessions())

  ipcMain.handle('sessions:read-raw', (_e, filePath: string) => readSessionRaw(filePath))

  ipcMain.handle('sessions:delete', (_e, filePaths: string[]) => deleteSessions(filePaths))

  /** 在资源管理器中定位会话文件（路径经安全校验，须落在某个会话根内） */
  ipcMain.handle('sessions:show-in-folder', async (_e, filePath: string) => {
    shell.showItemInFolder(await resolveSafeSessionPath(filePath))
  })

  /** 弹目录选择框添加自定义会话目录，取消返回 null；新路径由渲染层写回 config */
  ipcMain.handle('sessions:add-dir', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: '选择会话目录',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── 应用自更新 ──────────────────────────────────────────────
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:quit-install', () => quitAndInstall())
}
