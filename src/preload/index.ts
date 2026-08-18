import { contextBridge, ipcRenderer } from 'electron'
import type { PreloadApi } from '../shared/api'
import type { AgentId, PiPluginOperationEvent, UpdaterEvent } from '../shared/types'

// 渲染进程可用的白名单 API，全部经 IPC 走主进程
const api: PreloadApi = {
  agentsStatus: () => ipcRenderer.invoke('agents:status'),
  readProviders: (agentId) => ipcRenderer.invoke('providers:read', agentId),
  writeProviders: (agentId, map) => ipcRenderer.invoke('providers:write', agentId, map),
  readSwitch: (agentId) => ipcRenderer.invoke('switch:read', agentId),
  writeSwitch: (agentId, state) => ipcRenderer.invoke('switch:write', agentId, state),
  fetchRemoteModels: (payload) => ipcRenderer.invoke('models:fetch-remote', payload),
  fetchProviderUsage: (payload) => ipcRenderer.invoke('providers:fetch-usage', payload),
  cliVersions: () => ipcRenderer.invoke('cli:versions'),
  showConfigInFolder: (agentId, kind) => ipcRenderer.invoke('config:show-in-folder', agentId, kind),
  readRawConfig: (agentId, kind) => ipcRenderer.invoke('config:read-raw', agentId, kind),
  writeRawConfig: (agentId, kind, content) =>
    ipcRenderer.invoke('config:write-raw', agentId, kind, content),
  readRules: (agentId) => ipcRenderer.invoke('rules:list', agentId),
  writeRules: (agentId, name, content) => ipcRenderer.invoke('rules:write', agentId, name, content),
  showRuleInFolder: (agentId, name) => ipcRenderer.invoke('rules:show-in-folder', agentId, name),
  readConfigFields: (agentId) => ipcRenderer.invoke('config-fields:read', agentId),
  writeConfigFields: (agentId, updates, deletes) =>
    ipcRenderer.invoke('config-fields:write', agentId, updates, deletes),
  pickConfigFilePath: () => ipcRenderer.invoke('config-fields:pick-file'),
  readAppConfig: () => ipcRenderer.invoke('app-config:read'),
  writeAppConfig: (config) => ipcRenderer.invoke('app-config:write', config),
  restoreAppConfigBackup: () => ipcRenderer.invoke('app-config:restore-backup'),
  resetInvalidAppConfig: () => ipcRenderer.invoke('app-config:reset-invalid'),
  showAppConfigInFolder: () => ipcRenderer.invoke('app-config:show-in-folder'),
  changeAppConfigDir: () => ipcRenderer.invoke('app-config:change-dir'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  listPiPlugins: (checkUpdates) => ipcRenderer.invoke('pi-plugins:list', checkUpdates),
  searchPiPlugins: (query) => ipcRenderer.invoke('pi-plugins:search', query),
  installPiPlugin: (source) => ipcRenderer.invoke('pi-plugins:install', source),
  updatePiPlugin: (source) => ipcRenderer.invoke('pi-plugins:update', source),
  updateAllPiPlugins: () => ipcRenderer.invoke('pi-plugins:update-all'),
  removePiPlugin: (source) => ipcRenderer.invoke('pi-plugins:remove', source),
  setPiPluginEnabled: (source, enabled) =>
    ipcRenderer.invoke('pi-plugins:set-enabled', source, enabled),
  pickPiPluginPath: () => ipcRenderer.invoke('pi-plugins:pick-path'),
  showPiPluginInFolder: (source) => ipcRenderer.invoke('pi-plugins:show-in-folder', source),
  showPiLocalExtensionInFolder: (path) =>
    ipcRenderer.invoke('pi-plugins:show-local-in-folder', path),
  showPiPluginsConfig: () => ipcRenderer.invoke('pi-plugins:show-config'),
  onPiPluginOperation: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, event: PiPluginOperationEvent): void =>
      callback(event)
    ipcRenderer.on('pi-plugins:operation', listener)
    return () => ipcRenderer.removeListener('pi-plugins:operation', listener)
  },
  listSkills: () => ipcRenderer.invoke('skills:list'),
  setSkillSync: (dir, agentId, enabled) => ipcRenderer.invoke('skills:sync', dir, agentId, enabled),
  deleteSkill: (dir) => ipcRenderer.invoke('skills:delete', dir),
  fetchRepoSkills: (input, branch) => ipcRenderer.invoke('skills:repo-skills', input, branch),
  installSkills: (repo, branch, paths) => ipcRenderer.invoke('skills:install', repo, branch, paths),
  checkSkillUpdates: () => ipcRenderer.invoke('skills:check-updates'),
  updateSkill: (dir) => ipcRenderer.invoke('skills:update', dir),
  searchSkillsSh: (query) => ipcRenderer.invoke('skills:search-sh', query),
  changeSkillsDir: () => ipcRenderer.invoke('skills:change-dir'),
  resyncSkills: (mode) => ipcRenderer.invoke('skills:resync', mode),
  showSkillsDirInFolder: () => ipcRenderer.invoke('skills:show-in-folder'),
  listMcpServers: () => ipcRenderer.invoke('mcp:list'),
  mcpStorePath: () => ipcRenderer.invoke('mcp:store-path'),
  showMcpInFolder: () => ipcRenderer.invoke('mcp:show-in-folder'),
  saveMcpServer: (request) => ipcRenderer.invoke('mcp:save', request),
  deleteMcpServer: (name) => ipcRenderer.invoke('mcp:delete', name),
  toggleMcpServer: (name, agentId, enabled) =>
    ipcRenderer.invoke('mcp:toggle', name, agentId, enabled),
  sessionRoots: () => ipcRenderer.invoke('sessions:roots'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  readSessionRaw: (filePath) => ipcRenderer.invoke('sessions:read-raw', filePath),
  deleteSessions: (filePaths) => ipcRenderer.invoke('sessions:delete', filePaths),
  showSessionInFolder: (filePath) => ipcRenderer.invoke('sessions:show-in-folder', filePath),
  openSessionWorkingDirectory: (filePath) =>
    ipcRenderer.invoke('sessions:open-working-directory', filePath),
  addSessionDir: () => ipcRenderer.invoke('sessions:add-dir'),
  onStateChanged: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, agentId: AgentId): void => callback(agentId)
    ipcRenderer.on('state-changed', listener)
    return () => ipcRenderer.removeListener('state-changed', listener)
  },
  onCloseRequested: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('close-requested', listener)
    return () => ipcRenderer.removeListener('close-requested', listener)
  },
  closeAction: (action) => ipcRenderer.send('window:close-action', action),
  appVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('updater:quit-install'),
  onUpdaterEvent: (callback) => {
    const listener = (_e: Electron.IpcRendererEvent, event: UpdaterEvent): void => callback(event)
    ipcRenderer.on('updater:event', listener)
    return () => ipcRenderer.removeListener('updater:event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
