import type { AgentId, AgentStatus, OmpProfileInfo } from '../../shared/types'
import type { AgentAdapter } from './types'
import { PiAdapter } from './pi'
import { OmpAdapter } from './omp'

const pi = new PiAdapter()
const omp = new OmpAdapter()

const adapters: Record<AgentId, AgentAdapter> = {
  pi,
  omp
}

export function getAdapter(id: AgentId): AgentAdapter {
  const adapter = adapters[id]
  if (!adapter) throw new Error(`未知 Agent: ${id}`)
  return adapter
}

export function listAdapters(): AgentAdapter[] {
  return Object.values(adapters)
}

export function getAgentStatuses(): AgentStatus[] {
  return listAdapters().map((a) => ({
    id: a.id,
    label: a.label,
    installed: a.detect(),
    providersPath: a.providersPath,
    switchPath: a.switchPath,
    mcpPath: a.mcpPath,
    multiRole: a.multiRole,
    ...(a.id === 'omp' ? { profile: omp.profileName } : {})
  }))
}

/** omp 的 agent 目录（切 profile 后链路全部跟着变：sessions/skills/mcp 都从这里派生） */
export function getOmpAgentDir(): string {
  return omp.agentDir
}

/** 当前激活的 omp profile 名，空串 = 默认 profile */
export function getOmpProfile(): string {
  return omp.profileName
}

/** 本机已存在的 omp 命名 profile 列表 */
export function listOmpProfiles(): OmpProfileInfo[] {
  return omp.listProfiles()
}

/**
 * 切换 omp profile（只改内存态，持久化由调用方写应用配置）。
 * 名字不存在时抛错，避免把配置写进意外的目录。
 */
export function setOmpProfile(name: string): void {
  omp.setProfile(name)
}
