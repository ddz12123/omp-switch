import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ProviderMap, SwitchState } from '../../shared/types'
import { readTextFile, writeTextFileSafe } from '../lib/fileio'
import { isPlainObject, type AgentAdapter } from './types'

/**
 * pi 适配器：
 * - 供应商: ~/.pi/agent/models.json（JSON，根键 providers）
 * - 切换:   ~/.pi/agent/settings.json（defaultProvider/defaultModel/defaultThinkingLevel）
 * 写回时只改目标键，settings.json 里 theme 等其余字段原样保留。
 */
export class PiAdapter implements AgentAdapter {
  readonly id = 'pi' as const
  readonly label = 'Pi'
  readonly multiRole = false
  readonly providersPath = join(homedir(), '.pi', 'agent', 'models.json')
  readonly switchPath = join(homedir(), '.pi', 'agent', 'settings.json')
  readonly skillsDir = join(homedir(), '.pi', 'agent', 'skills')
  readonly mcpPath = join(homedir(), '.pi', 'agent', 'mcp.json')

  detect(): boolean {
    return existsSync(this.providersPath) || existsSync(this.switchPath)
  }

  private async readJson(path: string): Promise<Record<string, unknown>> {
    const content = await readTextFile(path)
    if (content === null || content.trim() === '') return {}
    const parsed: unknown = JSON.parse(content)
    if (!isPlainObject(parsed)) {
      throw new Error(`${path} 根节点必须是 JSON 对象`)
    }
    return parsed
  }

  async readProviders(): Promise<ProviderMap> {
    const root = await this.readJson(this.providersPath)
    const providers = root.providers
    return isPlainObject(providers) ? (providers as ProviderMap) : {}
  }

  async writeProviders(map: ProviderMap): Promise<void> {
    const root = await this.readJson(this.providersPath)
    root.providers = map
    await writeTextFileSafe(this.providersPath, JSON.stringify(root, null, 2) + '\n')
  }

  async readSwitchState(): Promise<SwitchState> {
    const settings = await this.readJson(this.switchPath)
    const provider = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : ''
    const model = typeof settings.defaultModel === 'string' ? settings.defaultModel : ''
    const effort =
      typeof settings.defaultThinkingLevel === 'string' ? settings.defaultThinkingLevel : undefined
    if (!provider && !model) return { roles: {} }
    return { roles: { default: { provider, model, effort } } }
  }

  async writeSwitchState(state: SwitchState): Promise<void> {
    const assignment = state.roles.default
    if (!assignment) throw new Error('pi 需要 default 角色')
    const settings = await this.readJson(this.switchPath)
    settings.defaultProvider = assignment.provider
    settings.defaultModel = assignment.model
    if (assignment.effort) {
      settings.defaultThinkingLevel = assignment.effort
    } else {
      delete settings.defaultThinkingLevel
    }
    await writeTextFileSafe(this.switchPath, JSON.stringify(settings, null, 2) + '\n')
  }
}
