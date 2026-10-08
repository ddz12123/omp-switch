/**
 * 点路径（dotted key）读写工具。
 *
 * 配置键统一写成 `compaction.reserveTokens` 这样的点路径：
 * - pi 的 settings.json 是嵌套 JSON，需要按路径定位；
 * - omp 的 config.yml 由 yaml Document 处理，但读取与删除判断仍走同一套语义。
 * 三套操作放一起，避免各适配器各写一份遍历。
 */

/** 按点路径从对象取值（不存在返回 undefined） */
export function getByPath(root: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = root
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 按点路径写入，中间层级缺失时自动创建对象。
 * 中间层级已存在但不是对象时抛错：那是用户手改过的冲突值，
 * 静默覆盖会违反「写回保留未知字段」的约定，交给用户去原始编辑里处理更安全。
 */
export function setByPath(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.')
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    const next = cur[part]
    if (next === undefined) {
      cur[part] = {}
    } else if (!isPlainObject(next)) {
      throw new Error(
        `配置路径冲突：${parts.slice(0, i + 1).join('.')} 已存在且不是对象，请先用「原始编辑」修正`
      )
    }
    cur = cur[part] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

/** 按点路径删除；路径不存在时静默跳过（用户可把未设置的字段选回「未设置」） */
export function deleteByPath(root: Record<string, unknown>, key: string): void {
  const parts = key.split('.')
  let cur: Record<string, unknown> = root
  for (const part of parts.slice(0, -1)) {
    const next = cur[part]
    if (!isPlainObject(next)) return
    cur = next
  }
  delete cur[parts[parts.length - 1]]
}
