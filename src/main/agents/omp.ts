import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parseDocument, Document } from 'yaml'
import type { ProviderMap, SwitchState } from '../../shared/types'
import { formatModelRef, parseModelRef } from '../../shared/modelRef'
import { readTextFile, writeTextFileSafe } from '../lib/fileio'
import { isPlainObject, type AgentAdapter } from './types'

/**
 * omp (Oh My Pi) 适配器：
 * - 供应商: ~/.omp/agent/models.yml（YAML，根键 providers）
 * - 切换:   ~/.omp/agent/config.yml（modelRoles 角色映射，值形如 Provider/model:effort）
 * 用 yaml Document API 只替换目标节点，文件其余部分（setupVersion、根级注释等）保持原样。
 */
export class OmpAdapter implements AgentAdapter {
  readonly id = 'omp' as const
  readonly label = 'OMP'
  readonly multiRole = true
  readonly providersPath = join(homedir(), '.omp', 'agent', 'models.yml')
  readonly switchPath = join(homedir(), '.omp', 'agent', 'config.yml')
  readonly skillsDir = join(homedir(), '.omp', 'agent', 'skills')
  readonly mcpPath = join(homedir(), '.omp', 'agent', 'mcp.json')

  detect(): boolean {
    return existsSync(this.providersPath) || existsSync(this.switchPath)
  }

  /** 解析失败时抛错并中止写入，避免把用户可手工修复的文件覆盖掉 */
  private async readDocument(path: string): Promise<Document> {
    const content = (await readTextFile(path)) ?? ''
    const doc = parseDocument(content)
    if (doc.errors.length > 0) {
      throw new Error(`解析 ${path} 失败：${doc.errors[0].message}`)
    }
    return doc
  }

  async readProviders(): Promise<ProviderMap> {
    const doc = await this.readDocument(this.providersPath)
    const root: unknown = doc.toJS()
    if (!isPlainObject(root)) return {}
    return isPlainObject(root.providers) ? (root.providers as ProviderMap) : {}
  }

  async writeProviders(map: ProviderMap): Promise<void> {
    const doc = await this.readDocument(this.providersPath)
    doc.setIn(['providers'], doc.createNode(map))
    await writeTextFileSafe(this.providersPath, doc.toString())
  }

  async readSwitchState(): Promise<SwitchState> {
    const doc = await this.readDocument(this.switchPath)
    const root: unknown = doc.toJS()
    const roles: SwitchState['roles'] = {}
    if (isPlainObject(root) && isPlainObject(root.modelRoles)) {
      for (const [role, value] of Object.entries(root.modelRoles)) {
        if (typeof value === 'string') {
          roles[role] = parseModelRef(value)
        }
      }
    }
    return { roles }
  }

  async writeSwitchState(state: SwitchState): Promise<void> {
    const doc = await this.readDocument(this.switchPath)
    const modelRoles: Record<string, string> = {}
    for (const [role, assignment] of Object.entries(state.roles)) {
      modelRoles[role] = formatModelRef(assignment)
    }
    doc.setIn(['modelRoles'], doc.createNode(modelRoles))
    await writeTextFileSafe(this.switchPath, doc.toString())
  }
}
