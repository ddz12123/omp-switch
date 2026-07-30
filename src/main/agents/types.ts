import type { AgentId, ProviderMap, SwitchState } from '../../shared/types'

/**
 * Agent 适配器：屏蔽 pi / omp 两套配置文件格式差异，
 * 上层（IPC / 托盘）只面向统一的 ProviderMap + SwitchState。
 */
export interface AgentAdapter {
  readonly id: AgentId
  readonly label: string
  readonly providersPath: string
  readonly switchPath: string
  /** CLI 的全局技能目录（skills 同步目标） */
  readonly skillsDir: string
  /** CLI 的全局 MCP 配置文件（mcpServers 映射） */
  readonly mcpPath: string
  /** 是否支持多角色映射（omp true / pi false） */
  readonly multiRole: boolean

  /** 任一配置文件存在即视为已安装 */
  detect(): boolean
  readProviders(): Promise<ProviderMap>
  writeProviders(map: ProviderMap): Promise<void>
  readSwitchState(): Promise<SwitchState>
  writeSwitchState(state: SwitchState): Promise<void>
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
