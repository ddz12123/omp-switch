import { EFFORT_LEVELS, type RoleAssignment } from './types'

/**
 * 解析 `Provider/model:effort` 三段式引用（effort 可选）。
 * 无法解析时返回 provider 为空串、model 存原文的兜底值，保证写回不丢原始内容。
 */
export function parseModelRef(ref: string): RoleAssignment {
  const raw = ref.trim()
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) {
    return { provider: '', model: raw }
  }
  const provider = raw.slice(0, slash)
  let model = raw.slice(slash + 1)
  let effort: string | undefined
  const colon = model.lastIndexOf(':')
  if (colon > 0) {
    const suffix = model.slice(colon + 1)
    // 只有后缀是已知 effort 等级才当作 effort，避免误切模型 id 里的冒号
    if ((EFFORT_LEVELS as readonly string[]).includes(suffix)) {
      effort = suffix
      model = model.slice(0, colon)
    }
  }
  return { provider, model, effort }
}

export function formatModelRef(a: RoleAssignment): string {
  if (!a.provider) return a.model
  const base = `${a.provider}/${a.model}`
  return a.effort ? `${base}:${a.effort}` : base
}

/** 不带 effort 的 `provider/model` 键，用于选项对比 */
export function modelKey(a: Pick<RoleAssignment, 'provider' | 'model'>): string {
  return a.provider ? `${a.provider}/${a.model}` : a.model
}
