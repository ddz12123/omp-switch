import type {
  AgentId,
  AgentStatus,
  AppConfig,
  AppConfigResult,
  CliVersionInfo,
  ConfigFileKind,
  McpListResult,
  McpSaveRequest,
  PiPluginOperationEvent,
  PiPluginSearchResult,
  PiPluginsListResult,
  ProviderMap,
  RawConfigFile,
  RemoteSkillsResult,
  ConfigFieldsResult,
  RuleFileInfo,
  SessionMeta,
  SessionRaw,
  SessionRootInfo,
  SkillsListResult,
  SkillsShSkill,
  SkillSyncMode,
  SwitchState,
  UpdaterEvent
} from './types'

/** 拉取远程模型列表的入参（来自供应商编辑表单，不落盘） */
export interface FetchRemoteModelsPayload {
  baseUrl: string
  apiKey?: string
  api?: string
}

/** preload 暴露给渲染进程的 API 契约（纯类型，避免渲染层引入 electron 类型依赖） */
export interface PreloadApi {
  agentsStatus(): Promise<AgentStatus[]>
  readProviders(agentId: AgentId): Promise<ProviderMap>
  writeProviders(agentId: AgentId, map: ProviderMap): Promise<void>
  readSwitch(agentId: AgentId): Promise<SwitchState>
  writeSwitch(agentId: AgentId, state: SwitchState): Promise<void>
  /** 请求供应商 /models 接口，返回模型 id 列表 */
  fetchRemoteModels(payload: FetchRemoteModelsPayload): Promise<string[]>
  /** 检测 pi / omp 命令行的当前版本与 npm 最新版本（本地环境检查） */
  cliVersions(): Promise<CliVersionInfo[]>
  /** 在资源管理器中显示指定配置文件；文件不存在时打开其所在目录 */
  showConfigInFolder(agentId: AgentId, kind: ConfigFileKind): Promise<void>
  /** 读取原始配置文件文本（供 Monaco 编辑器直接编辑），文件不存在时 content 为空串 */
  readRawConfig(agentId: AgentId, kind: ConfigFileKind): Promise<RawConfigFile>
  /** 覆写原始配置文件，主进程会先做 YAML/JSON 语法校验，失败抛错不落盘 */
  writeRawConfig(agentId: AgentId, kind: ConfigFileKind, content: string): Promise<void>
  /** 读取某 Agent 的全局规则文件列表（含内容，不存在时 content 为空串），多 Agent 由适配器声明 */
  readRules(agentId: AgentId): Promise<RuleFileInfo[]>
  /** 覆写某 Agent 的规则文件（按文件名定位），自动 .bak 备份，不存在则创建 */
  writeRules(agentId: AgentId, name: string, content: string): Promise<void>
  /** 在资源管理器中显示某规则文件（不存在时打开其所在目录） */
  showRuleInFolder(agentId: AgentId, name: string): Promise<void>
  /** 读取全局配置可视化的字段清单与当前值（只含 schema 覆盖的字段） */
  readConfigFields(agentId: AgentId): Promise<ConfigFieldsResult>
  /**
   * 提交配置修改：updates 为要写入的值；deletes 为要从配置中删除的字段路径。
   * 删除与写入分开传递，避免 undefined 值经 IPC 序列化丢失。
   */
  writeConfigFields(
    agentId: AgentId,
    updates: Record<string, unknown>,
    deletes: string[]
  ): Promise<void>
  /** 弹系统文件选择框，选中返回绝对路径，取消返回 null（供 path 类型字段使用） */
  pickConfigFilePath(): Promise<string | null>
  /** 读取本应用配置（默认 ~/.omp-switch/config.json，可自定义目录）及其路径 */
  readAppConfig(): Promise<AppConfigResult>
  /** 整体覆写本应用配置；当前文件损坏时会拒绝覆盖。 */
  writeAppConfig(config: AppConfig): Promise<void>
  /** 从校验通过的 .bak 恢复损坏配置。 */
  restoreAppConfigBackup(): Promise<AppConfigResult>
  /** 保留损坏快照后重置应用配置。 */
  resetInvalidAppConfig(): Promise<AppConfigResult>
  /** 在资源管理器中显示本应用配置文件 */
  showAppConfigInFolder(): Promise<void>
  /** 弹目录选择框迁移配置存储位置，取消返回 null，成功返回新路径 */
  changeAppConfigDir(): Promise<string | null>
  /** 在系统默认浏览器中打开 http(s) 链接 */
  openExternal(url: string): Promise<void>
  /** 读取 Pi 全局 Packages 和本地扩展；checkUpdates=true 时同时查询 npm 最新版本。 */
  listPiPlugins(checkUpdates?: boolean): Promise<PiPluginsListResult>
  /** 从 npm Registry 搜索带 pi-package 关键词的可安装插件。 */
  searchPiPlugins(query: string): Promise<PiPluginSearchResult>
  /** 用 Pi 原生命令安装 npm、Git 或绝对本地路径 Package。 */
  installPiPlugin(source: string): Promise<void>
  /** 更新单个未固定版本的 npm/Git Package。 */
  updatePiPlugin(source: string): Promise<void>
  /** 更新全部未固定版本的 Package。 */
  updateAllPiPlugins(): Promise<void>
  /** 卸载 Package；本地路径只移除配置引用，不删除源文件。 */
  removePiPlugin(source: string): Promise<void>
  /** 启停未配置精细资源过滤的 Package。 */
  setPiPluginEnabled(source: string, enabled: boolean): Promise<void>
  /** 选择一个本地 Package 文件或目录。 */
  pickPiPluginPath(): Promise<string | null>
  /** 在资源管理器中打开 Package 安装位置。 */
  showPiPluginInFolder(source: string): Promise<void>
  /** 在资源管理器中显示一个经过重新发现校验的本地扩展。 */
  showPiLocalExtensionInFolder(path: string): Promise<void>
  /** 在资源管理器中显示 Pi settings.json。 */
  showPiPluginsConfig(): Promise<void>
  /** 订阅 Pi 包管理命令的实时状态和输出。 */
  onPiPluginOperation(callback: (event: PiPluginOperationEvent) => void): () => void
  /** 列出中央仓库里的技能及各自已同步到的 Agent */
  listSkills(): Promise<SkillsListResult>
  /** 同步 / 取消同步某技能到某 Agent（enabled=true 时按当前同步方式建链或复制） */
  setSkillSync(dir: string, agentId: AgentId, enabled: boolean): Promise<void>
  /** 删除技能：先取消所有 Agent 的同步，再删中央仓库目录 */
  deleteSkill(dir: string): Promise<void>
  /** 解析 GitHub 仓库输入（owner/repo 或 URL），扫描其中的技能列表；branch 缺省用默认分支 */
  fetchRepoSkills(input: string, branch?: string): Promise<RemoteSkillsResult>
  /** 从仓库安装选中的技能（下载 zipball 解压到中央仓库），返回安装的目录名 */
  installSkills(repo: string, branch: string, paths: string[]): Promise<string[]>
  /** 检查已安装技能是否有更新（对比本地与远程内容哈希），返回有更新的技能目录名 */
  checkSkillUpdates(): Promise<string[]>
  /** 更新单个技能：重新下载来源仓库覆盖本地并重建同步 */
  updateSkill(dir: string): Promise<void>
  /** 在 skills.sh 公共注册表中搜索技能（空关键词返回热门榜） */
  searchSkillsSh(query: string): Promise<SkillsShSkill[]>
  /** 弹目录选择框迁移技能存储位置（含重建同步），取消返回 null，成功返回新路径 */
  changeSkillsDir(): Promise<string | null>
  /** 切换同步方式后重建所有已同步的链接/副本 */
  resyncSkills(mode: SkillSyncMode): Promise<void>
  /** 在资源管理器中打开技能存储目录 */
  showSkillsDirInFolder(): Promise<void>
  /** 列出中央库全部 MCP 服务器、实际启用的 Agent 和各目标配置错误。 */
  listMcpServers(): Promise<McpListResult>
  /** MCP 中央库文件（mcp-servers.json）的绝对路径 */
  mcpStorePath(): Promise<string>
  /** 在资源管理器中显示 MCP 中央库文件（不存在时打开所在目录） */
  showMcpInFolder(): Promise<void>
  /** 新增/编辑/改名并设置全部目标 Agent；中央库和 Agent 配置一次事务提交。 */
  saveMcpServer(request: McpSaveRequest): Promise<void>
  /** 删除 MCP 服务器：中央库和所有 Agent 配置一次事务提交。 */
  deleteMcpServer(name: string): Promise<void>
  /** 启用/停用单个目标，写入失败时恢复原始配置。 */
  toggleMcpServer(name: string, agentId: AgentId, enabled: boolean): Promise<void>
  /** 列出所有已探测到的会话根目录（默认 home + env 覆盖 + 用户自定义），供设置页展示 */
  sessionRoots(): Promise<SessionRootInfo[]>
  /** 遍历所有会话根目录，读取每个 .jsonl 头部元信息（不含正文），按修改时间倒序 */
  listSessions(): Promise<SessionMeta[]>
  /** 读取单个会话文件的原始文本（供只读查看），过大时截断 */
  readSessionRaw(filePath: string): Promise<SessionRaw>
  /** 批量删除会话：删 .jsonl + 同名日志目录 +（变空的）项目目录，路径受根目录约束 */
  deleteSessions(filePaths: string[]): Promise<{ deleted: number }>
  /** 在资源管理器中显示某个会话文件 */
  showSessionInFolder(filePath: string): Promise<void>
  /** Open the working directory recorded by a validated session file. */
  openSessionWorkingDirectory(filePath: string): Promise<void>
  /** 弹目录选择框添加自定义会话目录，取消返回 null，成功返回所选目录 */
  addSessionDir(): Promise<string | null>
  /** 订阅主进程侧（托盘）触发的配置变更，返回取消订阅函数 */
  onStateChanged(callback: (agentId: AgentId) => void): () => void
  /** 订阅关闭按钮点击（主进程已拦截 close），返回取消订阅函数 */
  onCloseRequested(callback: () => void): () => void
  /** 关闭确认结果：最小化到托盘 or 直接退出 */
  closeAction(action: 'minimize' | 'quit'): void
  /** 当前应用版本号（package.json version） */
  appVersion(): Promise<string>
  /** 手动检查更新（开发环境仅回 dev 状态，不真正检查）；结果经 onUpdaterEvent 推送 */
  checkForUpdates(): Promise<void>
  /** 下载已发现的更新（autoDownload 关闭，需显式触发）；进度经 onUpdaterEvent 推送 */
  downloadUpdate(): Promise<void>
  /** 退出并安装已下载完成的更新 */
  quitAndInstallUpdate(): Promise<void>
  /** 订阅应用自更新状态事件，返回取消订阅函数 */
  onUpdaterEvent(callback: (event: UpdaterEvent) => void): () => void
}
