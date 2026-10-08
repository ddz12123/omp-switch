import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parseDocument, Document } from 'yaml'
import type {
  OmpProfileInfo,
  ProviderMap,
  RuleFileSpec,
  SwitchState
} from '../../shared/types'
import { OMP_EFFORT_LEVELS } from '../../shared/types'
import { formatModelRef, parseModelRef } from '../../shared/modelRef'
import { readTextFile, writeTextFileSafe } from '../lib/fileio'
import { isPlainObject, type AgentAdapter } from './types'
import { OMP_CONFIG_SCHEMA } from './configSchema'
import { getByPath } from '../lib/paths'

/**
 * omp (Oh My Pi) 适配器：
 * - 供应商: ~/.omp/agent/models.yml（YAML，根键 providers）
 * - 切换:   ~/.omp/agent/config.yml（modelRoles 角色映射，值形如 Provider/model:effort）
 * 用 yaml Document API 只替换目标节点，文件其余部分（setupVersion、根级注释等）保持原样。
 *
 * omp 18.x 支持命名 profile：激活后 agent 目录变成
 * ~/.omp/profiles/<name>/agent（等价于 `omp --profile <name>` / `OMP_PROFILE=<name>`）。
 * 所有路径都从 agentDir 派生，切换 profile 只需 setProfile()，调用方无需改代码。
 */
export class OmpAdapter implements AgentAdapter {
  readonly id = 'omp' as const
  readonly label = 'OMP'
  readonly multiRole = true
  /** omp 配置根目录，PI_CONFIG_DIR 可改根名（与 omp 的 getConfigDirName 一致） */
  readonly configRoot: string
  /** 当前激活的 profile 名，空串 = 默认 profile */
  private profile = ''

  constructor(profile = '') {
    this.configRoot = join(homedir(), process.env.PI_CONFIG_DIR?.trim() || '.omp')
    this.profile = profile
  }

  /** 当前 agent 目录（默认 ~/.omp/agent，命名 profile 为 ~/.omp/profiles/<name>/agent） */
  get agentDir(): string {
    return this.profile
      ? join(this.configRoot, 'profiles', this.profile, 'agent')
      : join(this.configRoot, 'agent')
  }

  /** 当前 profile 名（空串 = 默认） */
  get profileName(): string {
    return this.profile
  }

  get providersPath(): string {
    return join(this.agentDir, 'models.yml')
  }

  get switchPath(): string {
    return join(this.agentDir, 'config.yml')
  }

  get skillsDir(): string {
    return join(this.agentDir, 'skills')
  }

  get mcpPath(): string {
    return join(this.agentDir, 'mcp.json')
  }

  /** omp 的全局规则：AGENTS.md 开场注入 + RULES.md sticky 始终生效 */
  get ruleFiles(): RuleFileSpec[] {
    return [
      { name: 'AGENTS.md', path: join(this.agentDir, 'AGENTS.md'), kind: 'context' },
      { name: 'RULES.md', path: join(this.agentDir, 'RULES.md'), kind: 'sticky' }
    ]
  }

  readonly configSchema = OMP_CONFIG_SCHEMA

  /** 本机已存在的命名 profile（~/.omp/profiles/<name>/agent 目录为空或不存在） */
  listProfiles(): OmpProfileInfo[] {
    const profilesRoot = join(this.configRoot, 'profiles')
    let entries: string[] = []
    try {
      entries = readdirSync(profilesRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      return []
    }
    return entries
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({
        name,
        agentDir: join(profilesRoot, name, 'agent'),
        label: name
      }))
  }

  /**
   * 切换激活的 profile。传空串回到默认 profile；传不存在的名字直接抛错，
   * 避免把配置写进一个意外目录。
   */
  setProfile(name: string): void {
    const next = name.trim()
    if (next !== '' && !this.listProfiles().some((p) => p.name === next)) {
      throw new Error(`OMP profile 不存在：${next}`)
    }
    this.profile = next
  }

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
          // omp 的 effort 后缀额外支持 auto
          roles[role] = parseModelRef(value, OMP_EFFORT_LEVELS)
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

  async readConfigValues(): Promise<Record<string, unknown>> {
    const doc = await this.readDocument(this.switchPath)
    const root = doc.toJS()
    const values: Record<string, unknown> = {}
    for (const field of this.configSchema.flatMap((g) => g.fields)) {
      values[field.key] = getByPath(isPlainObject(root) ? root : {}, field.key)
    }
    return values
  }

  async writeConfigValues(updates: Record<string, unknown>, deletes: string[]): Promise<void> {
    const doc = await this.readDocument(this.switchPath)
    for (const [key, value] of Object.entries(updates)) {
      doc.setIn(key.split('.'), doc.createNode(value))
    }
    for (const key of deletes) {
      const path = key.split('.')
      // 路径不存在时 deleteIn 会抛错，先检查（用户可把未设置的字段选回「未设置」）
      if (doc.hasIn(path)) doc.deleteIn(path)
    }
    await writeTextFileSafe(this.switchPath, doc.toString())
  }
}
