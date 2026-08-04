import { rm } from 'fs/promises'
import { join } from 'path'
import type {
  AgentId,
  McpListResult,
  McpSaveRequest,
  McpServerConfig,
  McpServerInfo,
  McpTargetError
} from '../shared/types'
import type { AgentAdapter } from './agents/types'
import { isPlainObject } from './agents/types'
import { getAdapter, listAdapters } from './agents'
import { getConfigDir } from './appConfig'
import { readTextFile, writeTextFileSafe } from './lib/fileio'

/**
 * MCP 服务器统一管理：定义存中央库（<配置目录>/mcp-servers.json），同步时将
 * 定义和启用状态作为一次事务写入目标 Agent。所有 JSON 根节点和 server 中的
 * 未知字段都会保留；OMP 额外维护 enabledServers / disabledServers。
 */

const STORE_FILE = 'mcp-servers.json'
const NAME_RE = /^[a-zA-Z0-9_.-]{1,100}$/
const TRANSPORTS = new Set(['stdio', 'http', 'sse'])
const REQUEST_ID_FORMATS = new Set(['string', 'number'])

type McpRoot = Record<string, unknown>
type NameListKey = 'enabledServers' | 'disabledServers'

interface McpSnapshot {
  path: string
  raw: string | null
  root: McpRoot
}

interface McpWritePlan {
  snapshot: McpSnapshot
  root: McpRoot
}

async function storePath(): Promise<string> {
  return join(await getConfigDir(), STORE_FILE)
}

/** 中央库文件绝对路径（设置页展示 / 打开目录用） */
export async function getMcpStorePath(): Promise<string> {
  return storePath()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 读一个 mcpServers 容器文件；解析或容器损坏时抛错，避免误覆盖。 */
async function readMcpFile(path: string): Promise<McpSnapshot> {
  const raw = await readTextFile(path)
  if (raw === null || raw.trim() === '') return { path, raw, root: {} }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`解析 ${path} 失败：${messageOf(error)}`)
  }
  if (!isPlainObject(parsed)) throw new Error(`${path} 根节点必须是 JSON 对象`)

  // 提前验证已知顶层容器，后续任何写操作都不能把损坏结构静默替换掉。
  serversOf(parsed, path)
  stringListOf(parsed, 'enabledServers', path)
  stringListOf(parsed, 'disabledServers', path)
  return { path, raw, root: parsed }
}

function serversOf(root: McpRoot, path: string): Record<string, McpServerConfig> {
  const value = root.mcpServers
  if (value === undefined) return {}
  if (!isPlainObject(value)) throw new Error(`${path} 的 mcpServers 必须是 JSON 对象`)

  for (const [name, config] of Object.entries(value)) {
    if (!isPlainObject(config)) throw new Error(`${path} 的 MCP 服务器「${name}」必须是 JSON 对象`)
  }
  return value as Record<string, McpServerConfig>
}

function stringListOf(root: McpRoot, key: NameListKey, path: string): string[] {
  const value = root[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${path} 的 ${key} 必须是字符串数组`)
  }
  return [...value]
}

function cloneRoot(root: McpRoot): McpRoot {
  return { ...root }
}

function setServers(root: McpRoot, servers: Record<string, McpServerConfig>): void {
  root.mcpServers = servers
}

/** Agent 文件原本没有 mcpServers 且结果为空时，不创建空配置文件。 */
function setAgentServers(root: McpRoot, servers: Record<string, McpServerConfig>): void {
  if (root.mcpServers !== undefined || Object.keys(servers).length > 0) root.mcpServers = servers
  else delete root.mcpServers
}

function updateNameList(
  root: McpRoot,
  path: string,
  key: NameListKey,
  removeNames: Iterable<string>,
  addName?: string
): void {
  const hadKey = Object.prototype.hasOwnProperty.call(root, key)
  const remove = new Set(removeNames)
  const next = stringListOf(root, key, path).filter((name) => !remove.has(name))
  if (addName && !next.includes(addName)) next.push(addName)
  if (hadKey || next.length > 0) root[key] = next
  else delete root[key]
}

function removeOmpSelectors(root: McpRoot, path: string, ...names: string[]): void {
  updateNameList(root, path, 'enabledServers', names)
  updateNameList(root, path, 'disabledServers', names)
}

function enableOmpServer(root: McpRoot, path: string, name: string): void {
  updateNameList(root, path, 'disabledServers', [name])
  updateNameList(root, path, 'enabledServers', [], name)
}

function disableOmpServer(root: McpRoot, path: string, name: string): void {
  updateNameList(root, path, 'enabledServers', [name])
  updateNameList(root, path, 'disabledServers', [], name)
}

function isOmpServerEnabled(root: McpRoot, path: string, name: string): boolean {
  const config = serversOf(root, path)[name]
  if (!config) return false

  const disabled = stringListOf(root, 'disabledServers', path)
  if (disabled.includes(name)) return false

  const enabled = stringListOf(root, 'enabledServers', path)
  if (enabled.includes(name)) return true
  return config.enabled !== false
}

function serializeRoot(root: McpRoot): string {
  return `${JSON.stringify(root, null, 2)}\n`
}

function rootChanged(before: McpRoot, after: McpRoot): boolean {
  return JSON.stringify(before) !== JSON.stringify(after)
}

/**
 * 依次原子替换多个 MCP 文件；任一写入失败时按逆序恢复已写文件的原始字节。
 * 回滚失败会附在异常中，避免把部分成功伪装成普通失败。
 */
async function commitTransaction(plans: McpWritePlan[]): Promise<void> {
  const changed = plans.filter((plan) => rootChanged(plan.snapshot.root, plan.root))
  const written: McpSnapshot[] = []
  try {
    for (const plan of changed) {
      await writeTextFileSafe(plan.snapshot.path, serializeRoot(plan.root))
      written.push(plan.snapshot)
    }
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const snapshot of written.reverse()) {
      try {
        if (snapshot.raw === null) await rm(snapshot.path, { force: true })
        else await writeTextFileSafe(snapshot.path, snapshot.raw, { backup: false })
      } catch (rollbackError) {
        rollbackErrors.push(`${snapshot.path}: ${messageOf(rollbackError)}`)
      }
    }

    const suffix =
      rollbackErrors.length > 0
        ? `；以下文件回滚失败：${rollbackErrors.join('；')}`
        : '；已回滚此前写入'
    throw new Error(`MCP 事务提交失败：${messageOf(error)}${suffix}`)
  }
}

function assertStringArray(value: unknown, field: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} 必须是字符串数组`)
  }
}

function assertStringRecord(value: unknown, field: string): void {
  if (!isPlainObject(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error(`${field} 必须是字符串键值对象`)
  }
}

/** 校验单个服务器定义；未知字段不参与校验并原样保留。 */
function validateServerConfig(name: string, config: McpServerConfig): void {
  if (!NAME_RE.test(name)) {
    throw new Error('名称只能包含字母、数字、_ . -，且不超过 100 个字符')
  }
  if (!isPlainObject(config)) throw new Error('MCP 服务器配置必须是 JSON 对象')

  const type = typeof config.type === 'string' ? config.type : 'stdio'
  if (!TRANSPORTS.has(type)) throw new Error(`不支持的 type: ${type}（可选 stdio / http / sse）`)
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error('enabled 必须是布尔值')
  }
  if (
    config.timeout !== undefined &&
    (typeof config.timeout !== 'number' || !Number.isFinite(config.timeout) || config.timeout <= 0)
  ) {
    throw new Error('timeout 必须是大于 0 的数字（毫秒）')
  }
  if (
    config.requestIdFormat !== undefined &&
    (typeof config.requestIdFormat !== 'string' || !REQUEST_ID_FORMATS.has(config.requestIdFormat))
  ) {
    throw new Error('requestIdFormat 只能是 string 或 number')
  }
  if (config.args !== undefined) assertStringArray(config.args, 'args')
  if (config.env !== undefined) assertStringRecord(config.env, 'env')
  if (config.headers !== undefined) assertStringRecord(config.headers, 'headers')
  if (config.cwd !== undefined && typeof config.cwd !== 'string')
    throw new Error('cwd 必须是字符串')

  const hasCommand = typeof config.command === 'string' && config.command.trim() !== ''
  const hasUrl = typeof config.url === 'string' && config.url.trim() !== ''
  if (hasCommand && hasUrl) throw new Error('command 与 url 不能同时设置')
  if (type === 'stdio' && !hasCommand) throw new Error('stdio 类型必须填写 command')
  if ((type === 'http' || type === 'sse') && !hasUrl) throw new Error(`${type} 类型必须填写 url`)
}

function desiredAgentSet(agents: AgentId[]): Set<AgentId> {
  if (!Array.isArray(agents)) throw new Error('agents 必须是 Agent id 数组')
  const available = new Set(listAdapters().map((adapter) => adapter.id))
  const desired = new Set<AgentId>()
  for (const agentId of agents) {
    if (!available.has(agentId)) throw new Error(`未知 Agent: ${String(agentId)}`)
    desired.add(agentId)
  }
  return desired
}

function targetError(adapter: AgentAdapter, error: unknown): McpTargetError {
  return {
    agentId: adapter.id,
    label: adapter.label,
    path: adapter.mcpPath,
    message: messageOf(error)
  }
}

/** 列出中央库全部服务器、实际启用状态和独立的 Agent 配置错误。 */
export async function listMcpServers(): Promise<McpListResult> {
  const storeSnapshot = await readMcpFile(await storePath())
  const store = serversOf(storeSnapshot.root, storeSnapshot.path)
  const agentRoots = new Map<AgentId, McpSnapshot>()
  const targetErrors: McpTargetError[] = []

  for (const adapter of listAdapters()) {
    try {
      agentRoots.set(adapter.id, await readMcpFile(adapter.mcpPath))
    } catch (error) {
      targetErrors.push(targetError(adapter, error))
    }
  }

  const servers: McpServerInfo[] = Object.entries(store)
    .map(([name, config]) => ({
      name,
      config,
      agents: listAdapters()
        .filter((adapter) => {
          const snapshot = agentRoots.get(adapter.id)
          if (!snapshot) return false
          if (adapter.id === 'omp') return isOmpServerEnabled(snapshot.root, snapshot.path, name)
          return name in serversOf(snapshot.root, snapshot.path)
        })
        .map((adapter) => adapter.id)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { servers, targetErrors }
}

/** 新增/编辑/改名，并在同一事务中提交中央库和全部 Agent 启用状态。 */
export async function saveMcpServer(request: McpSaveRequest): Promise<void> {
  if (!isPlainObject(request)) throw new Error('MCP 保存参数必须是对象')
  const originalName = typeof request.originalName === 'string' ? request.originalName : null
  const name = typeof request.name === 'string' ? request.name.trim() : ''
  const config = request.config
  validateServerConfig(name, config)
  const desired = desiredAgentSet(request.agents)

  const storeSnapshot = await readMcpFile(await storePath())
  const storeServers = { ...serversOf(storeSnapshot.root, storeSnapshot.path) }
  if (originalName && !(originalName in storeServers)) {
    throw new Error(`中央库中不存在要编辑的 MCP 服务器：${originalName}`)
  }
  if ((!originalName || originalName !== name) && name in storeServers) {
    throw new Error(`已存在同名 MCP 服务器：${name}`)
  }

  if (originalName && originalName !== name) delete storeServers[originalName]
  storeServers[name] = config
  const storeRoot = cloneRoot(storeSnapshot.root)
  setServers(storeRoot, storeServers)
  const plans: McpWritePlan[] = [{ snapshot: storeSnapshot, root: storeRoot }]

  // 写入前先读取并校验全部目标，任何一个损坏都不会产生部分提交。
  for (const adapter of listAdapters()) {
    const snapshot = await readMcpFile(adapter.mcpPath)
    const nextRoot = cloneRoot(snapshot.root)
    const currentServers = serversOf(snapshot.root, snapshot.path)
    const nextServers = { ...currentServers }
    const sourceName = originalName ?? name
    const hadSource = originalName !== null && sourceName in currentServers
    const isRename = originalName !== null && originalName !== name

    if (isRename && hadSource && name in currentServers) {
      throw new Error(`${snapshot.path} 已存在同名 MCP 服务器「${name}」，无法安全改名`)
    }
    if (isRename) {
      delete nextServers[sourceName]
      if (adapter.id === 'omp') removeOmpSelectors(nextRoot, snapshot.path, sourceName)
    }

    if (desired.has(adapter.id)) {
      nextServers[name] = config
      if (adapter.id === 'omp') enableOmpServer(nextRoot, snapshot.path, name)
    } else if (hadSource) {
      if (adapter.id === 'omp') {
        // OMP 停用时保留定义以便后续重新启用，并通过 denylist 明确停用。
        nextServers[name] = config
        disableOmpServer(nextRoot, snapshot.path, name)
      } else {
        delete nextServers[name]
      }
    }

    setAgentServers(nextRoot, nextServers)
    plans.push({ snapshot, root: nextRoot })
  }

  await commitTransaction(plans)
}

/** 删除服务器：中央库、所有 Agent 定义和 OMP selector 在同一事务中提交。 */
export async function deleteMcpServer(name: string): Promise<void> {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('MCP 服务器名称不能为空')

  const storeSnapshot = await readMcpFile(await storePath())
  const storeRoot = cloneRoot(storeSnapshot.root)
  const storeServers = { ...serversOf(storeSnapshot.root, storeSnapshot.path) }
  delete storeServers[name]
  setServers(storeRoot, storeServers)
  const plans: McpWritePlan[] = [{ snapshot: storeSnapshot, root: storeRoot }]

  for (const adapter of listAdapters()) {
    const snapshot = await readMcpFile(adapter.mcpPath)
    const nextRoot = cloneRoot(snapshot.root)
    const nextServers = { ...serversOf(snapshot.root, snapshot.path) }
    delete nextServers[name]
    setAgentServers(nextRoot, nextServers)
    if (adapter.id === 'omp') removeOmpSelectors(nextRoot, snapshot.path, name)
    plans.push({ snapshot, root: nextRoot })
  }

  await commitTransaction(plans)
}

/** 启用/停用单个目标；即使单文件写入失败，也恢复其事务前内容。 */
export async function toggleMcpServer(
  name: string,
  agentId: AgentId,
  enabled: boolean
): Promise<void> {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('MCP 服务器名称不能为空')
  if (typeof enabled !== 'boolean') throw new Error('enabled 必须是布尔值')

  const adapter = getAdapter(agentId)
  const storeSnapshot = await readMcpFile(await storePath())
  const store = serversOf(storeSnapshot.root, storeSnapshot.path)
  const config = store[name]
  if (enabled && !config) throw new Error(`中央库中不存在 MCP 服务器：${name}`)

  const snapshot = await readMcpFile(adapter.mcpPath)
  const nextRoot = cloneRoot(snapshot.root)
  const currentServers = serversOf(snapshot.root, snapshot.path)
  const nextServers = { ...currentServers }

  if (enabled) {
    nextServers[name] = config
    if (adapter.id === 'omp') enableOmpServer(nextRoot, snapshot.path, name)
  } else if (adapter.id === 'omp') {
    if (name in currentServers) disableOmpServer(nextRoot, snapshot.path, name)
    else removeOmpSelectors(nextRoot, snapshot.path, name)
  } else {
    delete nextServers[name]
  }

  setAgentServers(nextRoot, nextServers)
  await commitTransaction([{ snapshot, root: nextRoot }])
}
