import { join } from 'path'
import type { AgentId, McpServerConfig, McpServerInfo } from '../shared/types'
import type { AgentAdapter } from './agents/types'
import { isPlainObject } from './agents/types'
import { getAdapter, listAdapters } from './agents'
import { getConfigDir } from './appConfig'
import { readTextFile, writeTextFileSafe } from './lib/fileio'

/**
 * MCP 服务器统一管理：定义存中央库（<配置目录>/mcp-servers.json，格式与
 * CLI 的 mcp.json 相同，便于手工编辑），按名字启用到各 Agent —— 启用即把
 * 定义写进该 Agent 的 mcp.json（其余字段原样保留），停用即移除。
 */

const STORE_FILE = 'mcp-servers.json'
const NAME_RE = /^[a-zA-Z0-9_.-]{1,100}$/

async function storePath(): Promise<string> {
  return join(await getConfigDir(), STORE_FILE)
}

/** 中央库文件绝对路径（设置页展示 / 打开目录用） */
export async function getMcpStorePath(): Promise<string> {
  return storePath()
}

/** 读一个 mcpServers 容器文件（中央库或 Agent 的 mcp.json），解析失败抛错防止覆盖 */
async function readMcpFile(path: string): Promise<Record<string, unknown>> {
  const raw = await readTextFile(path)
  if (!raw || raw.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`解析 ${path} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isPlainObject(parsed)) throw new Error(`${path} 根节点必须是 JSON 对象`)
  return parsed
}

function serversOf(root: Record<string, unknown>): Record<string, McpServerConfig> {
  const servers = root.mcpServers
  return isPlainObject(servers) ? (servers as Record<string, McpServerConfig>) : {}
}

async function writeMcpFile(path: string, root: Record<string, unknown>): Promise<void> {
  await writeTextFileSafe(path, `${JSON.stringify(root, null, 2)}\n`)
}

/** 校验单个服务器定义（对齐 omp 的 validateServerConfig 规则） */
function validateServerConfig(name: string, config: McpServerConfig): void {
  if (!NAME_RE.test(name)) {
    throw new Error('名称只能包含字母、数字、_ . -，且不超过 100 个字符')
  }
  const type = typeof config.type === 'string' ? config.type : 'stdio'
  const hasCommand = typeof config.command === 'string' && config.command.trim() !== ''
  const hasUrl = typeof config.url === 'string' && config.url.trim() !== ''
  if (hasCommand && hasUrl) throw new Error('command 与 url 不能同时设置')
  if (type === 'stdio') {
    if (!hasCommand) throw new Error('stdio 类型必须填写 command（远程服务请设 type 为 http）')
  } else if (type === 'http' || type === 'sse') {
    if (!hasUrl) throw new Error(`${type} 类型必须填写 url`)
  } else {
    throw new Error(`不支持的 type: ${type}（可选 stdio / http / sse）`)
  }
}

/** 列出中央库全部服务器及各自已启用（写入）的 Agent */
export async function listMcpServers(): Promise<McpServerInfo[]> {
  const store = serversOf(await readMcpFile(await storePath()))
  // Agent 侧文件损坏不阻塞列表，按未启用处理
  const agentServers = new Map<AgentId, Record<string, McpServerConfig>>()
  for (const adapter of listAdapters()) {
    try {
      agentServers.set(adapter.id, serversOf(await readMcpFile(adapter.mcpPath)))
    } catch {
      agentServers.set(adapter.id, {})
    }
  }
  return Object.entries(store)
    .map(([name, config]) => ({
      name,
      config,
      agents: listAdapters()
        .filter((a) => name in (agentServers.get(a.id) ?? {}))
        .map((a) => a.id)
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 把定义写进某个 Agent 的 mcp.json（保留其余字段），或从中移除 */
async function writeAgentServer(
  adapter: AgentAdapter,
  name: string,
  config: McpServerConfig | null
): Promise<void> {
  const root = await readMcpFile(adapter.mcpPath)
  const servers = { ...serversOf(root) }
  if (config) servers[name] = config
  else if (name in servers) delete servers[name]
  else return // 本来就没有，不必写文件
  await writeMcpFile(adapter.mcpPath, { ...root, mcpServers: servers })
}

/** 新增/编辑服务器定义；改名时同步替换中央库与各 Agent 里的旧名 */
export async function saveMcpServer(
  originalName: string | null,
  name: string,
  config: McpServerConfig
): Promise<void> {
  validateServerConfig(name, config)
  const path = await storePath()
  const root = await readMcpFile(path)
  const servers = { ...serversOf(root) }
  if (!originalName && name in servers) {
    throw new Error(`已存在同名 MCP 服务器：${name}`)
  }
  // 找出旧名已启用的 Agent，改名/改定义后保持启用状态
  const enabledAgents: AgentAdapter[] = []
  if (originalName) {
    for (const adapter of listAdapters()) {
      try {
        if (originalName in serversOf(await readMcpFile(adapter.mcpPath))) {
          enabledAgents.push(adapter)
        }
      } catch {
        // Agent 文件损坏时跳过它的状态同步
      }
    }
    if (originalName !== name) delete servers[originalName]
  }
  servers[name] = config
  await writeMcpFile(path, { ...root, mcpServers: servers })
  for (const adapter of enabledAgents) {
    if (originalName && originalName !== name) {
      await writeAgentServer(adapter, originalName, null)
    }
    await writeAgentServer(adapter, name, config)
  }
}

/** 删除服务器：先从所有 Agent 移除，再删中央库 */
export async function deleteMcpServer(name: string): Promise<void> {
  for (const adapter of listAdapters()) {
    await writeAgentServer(adapter, name, null)
  }
  const path = await storePath()
  const root = await readMcpFile(path)
  const servers = { ...serversOf(root) }
  if (name in servers) {
    delete servers[name]
    await writeMcpFile(path, { ...root, mcpServers: servers })
  }
}

/** 启用/停用某服务器到某 Agent */
export async function toggleMcpServer(
  name: string,
  agentId: AgentId,
  enabled: boolean
): Promise<void> {
  const adapter = getAdapter(agentId)
  if (!enabled) {
    await writeAgentServer(adapter, name, null)
    return
  }
  const store = serversOf(await readMcpFile(await storePath()))
  const config = store[name]
  if (!config) throw new Error(`中央库中不存在 MCP 服务器：${name}`)
  await writeAgentServer(adapter, name, config)
}
