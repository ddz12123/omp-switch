import type { AgentId, AgentStatus } from '../../shared/types'
import type { AgentAdapter } from './types'
import { PiAdapter } from './pi'
import { OmpAdapter } from './omp'

const adapters: Record<AgentId, AgentAdapter> = {
  pi: new PiAdapter(),
  omp: new OmpAdapter()
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
    multiRole: a.multiRole
  }))
}
