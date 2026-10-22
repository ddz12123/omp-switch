import type { AgentId, ModelDef, Provider } from '@shared/types'
import { AGENT_IDS } from '@shared/types'

/**
 * 供应商跨 Agent 复制（pi ⇄ omp）。
 *
 * 带过去的东西：供应商信息（api / baseUrl / apiKey）+ 模型列表。
 * 模型只保留基础五项：id、名称（name）、上下文大小（contextWindow）、
 * 最大输出（maxTokens）、输入类型（input）。
 * 其余字段一律不带：provider 级的 authHeader / discovery / compat / modelOverrides / headers，
 * 模型级的 reasoning / cost 等 —— 那些是各自本地调出来的细节，
 * 搬过去反而可能让对方配置对不上。
 */

export const AGENT_LABEL: Record<AgentId, string> = { pi: 'Pi', omp: 'OMP' }

export function agentLabel(id: AgentId): string {
  return AGENT_LABEL[id]
}

/**
 * 提取一个供应商的核心配置：供应商信息（api / baseUrl / apiKey）+ 模型列表。
 * 模型只保留基础五项：id、名称、上下文大小、最大输出、输入类型。
 * reasoning / cost 这些本地产出的细节不带，让对方侧用自己的默认值。
 */
export function pickCoreProvider(provider: Provider): Provider {
  const core: Provider = {}
  if (provider.api) core.api = provider.api
  if (provider.baseUrl) core.baseUrl = provider.baseUrl
  if (provider.apiKey) core.apiKey = provider.apiKey
  if (Array.isArray(provider.models)) {
    const models = cloneModels(provider.models)
    if (models.length > 0) core.models = models
  }
  return core
}

/** 模型只带这五项 */
function cloneModels(models: ModelDef[]): ModelDef[] {
  return models
    .filter((model) => model && typeof model.id === 'string' && model.id !== '')
    .map((model) => {
      const copy: ModelDef = { id: model.id }
      if (model.name) copy.name = model.name
      if (model.contextWindow !== undefined) copy.contextWindow = model.contextWindow
      if (model.maxTokens !== undefined) copy.maxTokens = model.maxTokens
      if (Array.isArray(model.input) && model.input.length > 0) copy.input = [...model.input]
      return copy
    })
}

/** 另一个 Agent（当前只支持 pi ⇄ omp 互转） */
export function otherAgentOf(agent: AgentId): AgentId {
  return AGENT_IDS.find((id) => id !== agent) ?? agent
}

/**
 * 找一个不冲突的名字：优先原名，撞了加 -copy、-copy-2、-copy-3…
 * 与「复制供应商」的命名习惯保持一致。
 */
export function uniqueName(base: string, taken: string[]): string {
  const existing = new Set(taken)
  if (!existing.has(base)) return base
  const copyBase = `${base}-copy`
  if (!existing.has(copyBase)) return copyBase
  let suffix = 2
  while (existing.has(`${copyBase}-${suffix}`)) suffix += 1
  return `${copyBase}-${suffix}`
}
