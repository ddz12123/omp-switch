/**
 * 主进程 / 渲染进程共享的领域类型。
 * Provider / ModelDef 均带索引签名：未知字段原样保留，写回时不丢数据。
 */

export type AgentId = 'pi' | 'omp'

export const AGENT_IDS: AgentId[] = ['pi', 'omp']

export interface ModelCost {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  [key: string]: unknown
}

export interface ModelDef {
  id: string
  name?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
  cost?: ModelCost
  [key: string]: unknown
}

export interface Provider {
  api?: string
  baseUrl?: string
  apiKey?: string
  /** omp 特有 */
  authHeader?: boolean
  /** omp 特有 */
  disableStrictTools?: boolean
  models?: ModelDef[]
  [key: string]: unknown
}

export type ProviderMap = Record<string, Provider>

/**
 * 归一化的模型切换状态。
 * - omp: config.yml 的 modelRoles，多角色
 * - pi:  settings.json 的 defaultProvider/defaultModel/defaultThinkingLevel，
 *        归一为只有 default 一个角色的特例
 */
export interface RoleAssignment {
  /** provider 为空串表示原始值无法解析，model 存放原文，写回时原样输出 */
  provider: string
  model: string
  effort?: string
}

export interface SwitchState {
  roles: Record<string, RoleAssignment>
}

export interface AgentStatus {
  id: AgentId
  label: string
  /** 配置文件是否存在（providers 或 switch 任一存在即视为已安装） */
  installed: boolean
  providersPath: string
  switchPath: string
  /** 全局 MCP 配置文件路径（mcpServers 容器，设置页展示用） */
  mcpPath: string
  /** 是否支持多角色（omp true / pi false） */
  multiRole: boolean
}

/** 本地 CLI（pi/omp）版本检测结果，用于设置页「本地环境检查」 */
export interface CliVersionInfo {
  id: AgentId
  label: string
  /** 是否检测到本地已安装（能执行 <cli> --version 取到版本） */
  installed: boolean
  /** 本地当前版本（未安装时为空串） */
  current: string
  /** npm registry 上的最新版本（拉取失败时为空串） */
  latest: string
  /** latest 高于 current，存在可升级的新版本 */
  hasUpdate: boolean
  /** 安装 / 重装命令（常驻提供，任选其一在终端执行） */
  installCommands: string[]
  /** 升级命令（可能有多种方式，任选其一在终端执行；供用户复制自行升级） */
  upgradeCommands: string[]
  /** 拉取最新版本时的错误信息（失败时有） */
  error?: string
}

/** 原始配置文件的类别：供应商文件 / 切换（角色映射）文件 */
export type ConfigFileKind = 'providers' | 'switch'

/** 原始配置文件读取结果 */
export interface RawConfigFile {
  path: string
  content: string
}

/** Skills 同步方式：软链接（省空间、实时同步）/ 文件复制（兼容性最好） */
export type SkillSyncMode = 'symlink' | 'copy'

/** 用户添加的技能仓库 */
export interface SkillRepo {
  /** owner/name */
  repo: string
  /** 缺省用仓库默认分支 */
  branch?: string
}

/** Skills 设置（存本应用 config.json），dir 缺省 = <配置目录>/skills */
export interface SkillsConfig {
  dir?: string
  syncMode?: SkillSyncMode
  repos?: SkillRepo[]
}

/** 中央仓库里一个已安装技能 */
export interface SkillInfo {
  /** 存储目录名（唯一标识） */
  dir: string
  /** SKILL.md frontmatter 的 name（缺失时用目录名） */
  name: string
  description?: string
  /** 来源仓库（owner/repo），手工放入的技能没有 */
  repo?: string
  /** 来源分支（用于拼查看链接/更新检测，老数据可能缺失） */
  branch?: string
  /** 技能在来源仓库内的路径（根目录技能为空串；老数据可能缺失） */
  path?: string
  /** 已同步到哪些 Agent */
  agents: AgentId[]
}

export interface SkillsListResult {
  /** 当前技能存储目录（解析后的绝对路径） */
  dir: string
  skills: SkillInfo[]
}

/** 远程仓库里发现的技能 */
export interface RemoteSkillInfo {
  /** 仓库内路径（根目录技能为空串） */
  path: string
  name: string
  description?: string
}

export interface RemoteSkillsResult {
  /** 归一化后的 owner/repo */
  repo: string
  branch: string
  skills: RemoteSkillInfo[]
}

/** skills.sh 公共注册表搜索结果里的单个技能 */
export interface SkillsShSkill {
  /** 技能目录名（仓库内的文件夹名） */
  skillId: string
  /** 展示名 */
  name: string
  /** 来源，GitHub 仓库为 owner/repo；也可能是域名等非 GitHub 来源 */
  source: string
  /** skills.sh 统计的安装量 */
  installs: number
}

/**
 * MCP 服务器定义：与各 CLI mcp.json 里 mcpServers 的值一致，原样透传。
 * stdio: command/args/env；http/sse: url/headers。
 */
export type McpServerConfig = Record<string, unknown>

/** 中央库里一个 MCP 服务器及其启用状态 */
export interface McpServerInfo {
  name: string
  config: McpServerConfig
  /** 已写入（启用）的 Agent */
  agents: AgentId[]
}

/** 应用外观主题 */
export type Theme = 'light' | 'dark' | 'system'

/** 关闭主窗口行为偏好：每次询问 / 最小化到托盘 / 直接退出 */
export type CloseBehavior = 'ask' | 'minimize' | 'quit'

/** 主界面 Agent 的显示设置：顺序 + 隐藏项 */
export interface AgentDisplayConfig {
  order?: AgentId[]
  hidden?: AgentId[]
}

/**
 * 本应用自身的配置，存 ~/.omp-switch/config.json。
 * 与 CLI 的配置文件分离；未知字段原样保留，向后兼容。
 */
export interface AppConfig {
  theme?: Theme
  closeBehavior?: CloseBehavior
  /** 供应商官网映射，key 为 "agent/供应商名" */
  websites?: Record<string, string>
  /** 主界面 Agent 显示与顺序 */
  agents?: AgentDisplayConfig
  /** Skills 存储与同步设置 */
  skills?: SkillsConfig
  /** 会话管理设置（用户手动添加的会话根目录） */
  sessions?: SessionsConfig
  [key: string]: unknown
}

export interface AppConfigResult {
  path: string
  config: AppConfig
}

/** 会话管理设置 */
export interface SessionsConfig {
  /** 用户在 omp-switch 内手动添加的会话根目录（绝对路径），追加到自动探测结果之后 */
  customDirs?: string[]
}

/**
 * 会话根目录来源：
 * - omp-default / pi-default：CLI 默认 home 下的 sessions 目录
 * - env-agent-dir：PI_CODING_AGENT_DIR 指向的 home 下的 sessions
 * - env-session-dir：PI_CODING_AGENT_SESSION_DIR 直接指向的会话目录
 * - config-session-dir：CLI 配置文件（pi settings.json / omp config.yml）里的 sessionDir
 * - custom：用户在 omp-switch 里手动添加的目录
 */
export type SessionRootKind =
  | 'omp-default'
  | 'pi-default'
  | 'env-agent-dir'
  | 'env-session-dir'
  | 'config-session-dir'
  | 'custom'

/** 一个会话根目录（sessions 目录本身）及其来源 */
export interface SessionRootInfo {
  /** 稳定标识（用于分组与关联 SessionMeta.rootId），取规范化后的绝对路径 */
  id: string
  /** 展示标签，如「OMP · 默认目录」「自定义 · PI_CODING_AGENT_DIR」 */
  label: string
  /** 会话根目录绝对路径 */
  path: string
  kind: SessionRootKind
  /** 目录是否存在 */
  exists: boolean
}

/** 单个会话的列表元信息（从 JSONL 头部解析，不含正文） */
export interface SessionMeta {
  /** 所属会话根目录标识（= SessionRootInfo.id） */
  rootId: string
  /** session 记录里的 uuid，缺失时用文件名（不含扩展名） */
  id: string
  /** .jsonl 文件绝对路径 */
  filePath: string
  /** 标题：type:title 优先，其次 type:session.title，再退回文件名 */
  title: string
  /** 会话真实工作目录（type:session.cwd） */
  cwd: string
  /** 会话创建时间（type:session.timestamp 的 ISO 串，缺失为空串） */
  createdAt: string
  /** 文件最后修改时间（fs.stat mtime 的 ISO 串） */
  updatedAt: string
  /** 首个 model_change 的模型标识（可空） */
  model?: string
  /** 文件字节数 */
  size: number
}

/** 会话原始内容（供只读查看） */
export interface SessionRaw {
  filePath: string
  content: string
  /** 内容是否因过大被截断 */
  truncated: boolean
}

/** pi/omp 的思考等级（pi 文档：defaultThinkingLevel；omp：modelRef 的 :effort 后缀） */
export const EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export const OMP_KNOWN_ROLES = [
  'default',
  'smol',
  'slow',
  'plan',
  'vision',
  'designer',
  'commit',
  'task',
  'advisor',
  'tiny'
] as const

/**
 * 应用自更新状态机（electron-updater 事件归一化）：
 * - dev：开发环境不检查更新
 * - checking：正在检查
 * - available：发现新版本（autoDownload=false，未自动下载）
 * - not-available：已是最新
 * - downloading：下载中（带进度）
 * - downloaded：下载完成，待重启安装
 * - error：检查/下载出错
 */
export type UpdaterStatus =
  | 'idle'
  | 'dev'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 主进程推送给渲染层的更新状态事件 */
export interface UpdaterEvent {
  status: UpdaterStatus
  /** 新版本号（available / downloaded 时有） */
  version?: string
  /** 下载进度百分比 0-100（downloading 时有） */
  percent?: number
  /** 错误信息（error 时有） */
  message?: string
}
