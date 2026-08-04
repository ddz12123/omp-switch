import { existsSync } from 'fs'
import { cp, lstat, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import { createHash, randomUUID } from 'crypto'
import AdmZip from 'adm-zip'
import { parse as parseYaml } from 'yaml'
import type {
  AgentId,
  RemoteSkillInfo,
  RemoteSkillsResult,
  SkillInfo,
  SkillsListResult,
  SkillsShSkill,
  SkillSyncMode
} from '../shared/types'
import type { AgentAdapter } from './agents/types'
import { isPlainObject } from './agents/types'
import { getAdapter, listAdapters } from './agents'
import { getConfigDir, readAppConfig } from './appConfig'
import { readTextFile, writeTextFileSafe } from './lib/fileio'
import { removePathNoFollow, replacePreparedPath } from './lib/atomicDirectory'
import type { AtomicPathSwap } from './lib/atomicDirectory'

/**
 * Skills 中央仓库管理：技能统一存在本应用目录（默认 <配置目录>/skills），
 * 按软链接（Windows 用 junction，无需管理员权限）或文件复制同步到各 CLI 的
 * 全局技能目录（adapter.skillsDir）。来源仓库信息记在仓库根的 skills-meta.json。
 */

const META_FILE = 'skills-meta.json'
const GH_HEADERS = { 'User-Agent': 'omp-switch', Accept: 'application/vnd.github+json' }

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function preparedSibling(parent: string, label: string): string {
  return join(parent, `.omp-switch-${label}-prepared-${process.pid}-${randomUUID()}`)
}

async function rollbackSwaps(swaps: AtomicPathSwap[]): Promise<string[]> {
  const errors: string[] = []
  for (const swap of [...swaps].reverse()) {
    try {
      await swap.rollback()
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }
  return errors
}

async function finalizeSwaps(swaps: AtomicPathSwap[]): Promise<void> {
  const errors: string[] = []
  for (const swap of swaps) {
    try {
      await swap.finalize()
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }
  if (errors.length > 0) {
    throw new Error(`The operation committed, but backup cleanup failed: ${errors.join('; ')}`)
  }
}

interface SkillMeta {
  repo: string
  /** 安装时的来源分支（老数据可能缺失） */
  branch?: string
  /** 技能在来源仓库内的路径（根目录技能为空串；老数据可能缺失） */
  path?: string
  /** 安装时的内容哈希，用于更新检测（老数据可能缺失） */
  contentHash?: string
  installedAt: string
}

/** 当前技能存储目录：config.json 的 skills.dir，缺省 <配置目录>/skills */
export async function getSkillsDir(): Promise<string> {
  const config = await readAppConfig()
  const dir = config.skills?.dir
  if (typeof dir === 'string' && dir.trim() !== '') return dir
  return join(await getConfigDir(), 'skills')
}

async function getSyncMode(): Promise<SkillSyncMode> {
  const config = await readAppConfig()
  return config.skills?.syncMode === 'copy' ? 'copy' : 'symlink'
}

/** 目录名防御：技能目录名来自渲染层/压缩包，不允许路径穿越 */
function assertDirName(name: string): void {
  if (!name || name === '.' || name === '..' || /[\\/:]/.test(name)) {
    throw new Error(`非法技能目录名: ${name}`)
  }
}

async function readMeta(dir: string): Promise<Record<string, SkillMeta>> {
  const raw = await readTextFile(join(dir, META_FILE))
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? (parsed as Record<string, SkillMeta>) : {}
  } catch {
    return {}
  }
}

async function writeMeta(dir: string, meta: Record<string, SkillMeta>): Promise<void> {
  await writeTextFileSafe(join(dir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`)
}

/**
 * 技能目录内容哈希：把所有非隐藏文件按相对路径（/ 分隔）排序后，
 * 逐个喂「相对路径 \0 文件内容 \0」给 SHA256。本地目录与 zip 条目两种来源
 * 共用同一套规则，保证哈希可直接比对，用于更新检测。
 */
function hashSkillFiles(files: { rel: string; content: Buffer }[]): string {
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const hasher = createHash('sha256')
  for (const f of files) {
    hasher.update(f.rel)
    hasher.update('\0')
    hasher.update(f.content)
    hasher.update('\0')
  }
  return hasher.digest('hex')
}

/** 递归收集本地技能目录的非隐藏文件（隐藏目录整棵跳过），算出内容哈希 */
async function hashLocalSkillDir(dir: string): Promise<string> {
  const files: { rel: string; content: Buffer }[] = []
  const walk = async (current: string): Promise<void> => {
    for (const e of await readdir(current, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = join(current, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else {
        files.push({ rel: relative(dir, full).replace(/\\/g, '/'), content: await readFile(full) })
      }
    }
  }
  await walk(dir)
  return hashSkillFiles(files)
}

/** 从 zipball 条目里算某技能目录（prefix 以 / 结尾）的内容哈希，规则同本地收集 */
function hashZipSkillDir(entries: ReturnType<AdmZip['getEntries']>, prefix: string): string {
  const files: { rel: string; content: Buffer }[] = []
  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue
    const rel = entry.entryName.slice(prefix.length)
    // 跳过空路径与隐藏文件/目录，和本地收集规则保持一致
    if (!rel || rel.split('/').some((seg) => seg.startsWith('.'))) continue
    files.push({ rel, content: entry.getData() })
  }
  return hashSkillFiles(files)
}

function safeZipRelativePath(entryName: string, prefix: string): string {
  const rel = entryName.slice(prefix.length).replace(/\\/g, '/')
  const segments = rel.split('/')
  if (
    !rel ||
    rel.startsWith('/') ||
    /^[A-Za-z]:/.test(rel) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe skill archive entry: ${entryName}`)
  }
  return segments.join('/')
}

async function prepareSkillDirectory(
  storeDir: string,
  dirName: string,
  entries: ReturnType<AdmZip['getEntries']>,
  prefix: string
): Promise<{ path: string; contentHash: string }> {
  await mkdir(storeDir, { recursive: true })
  const prepared = preparedSibling(storeDir, dirName)
  try {
    await mkdir(prepared)
    const files = entries.filter(
      (entry) => !entry.isDirectory && entry.entryName.startsWith(prefix)
    )
    if (!files.some((entry) => entry.entryName === `${prefix}SKILL.md`)) {
      throw new Error('The skill archive does not contain SKILL.md')
    }

    for (const entry of files) {
      const rel = safeZipRelativePath(entry.entryName, prefix)
      const destination = resolve(prepared, ...rel.split('/'))
      if (!isInsidePath(prepared, destination)) {
        throw new Error(`Unsafe skill archive destination: ${entry.entryName}`)
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, entry.getData())
    }

    const manifestStat = await lstat(join(prepared, 'SKILL.md'))
    if (!manifestStat.isFile()) throw new Error('SKILL.md is not a regular file')

    const expectedHash = hashZipSkillDir(entries, prefix)
    const actualHash = await hashLocalSkillDir(prepared)
    if (actualHash !== expectedHash) {
      throw new Error('The prepared skill failed content validation')
    }
    return { path: prepared, contentHash: expectedHash }
  } catch (error) {
    await removePathNoFollow(prepared).catch(() => {})
    throw error
  }
}

function isInsidePath(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** 下载来源仓库 zipball 并返回全部条目（安装/更新/更新检测共用） */
async function downloadRepoZip(
  repo: string,
  branch: string
): Promise<ReturnType<AdmZip['getEntries']>> {
  let res: Response
  try {
    res = await fetch(
      `https://codeload.github.com/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`,
      { headers: { 'User-Agent': 'omp-switch' }, signal: AbortSignal.timeout(120000) }
    )
  } catch (error) {
    throw new Error(`下载仓库失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!res.ok) throw new Error(`下载仓库压缩包失败（HTTP ${res.status}）`)
  return new AdmZip(Buffer.from(await res.arrayBuffer())).getEntries()
}

/**
 * 在 zipball 条目里定位某技能目录，返回以 / 结尾的 prefix。
 * 优先用安装时记录的仓库内路径，找不到再按目录末段名匹配（仓库结构变动时兜底）。
 */
function findSkillPrefix(
  entries: ReturnType<AdmZip['getEntries']>,
  rootPrefix: string,
  dirName: string,
  path?: string
): string | null {
  if (typeof path === 'string') {
    const direct = path === '' ? `${rootPrefix}/` : `${rootPrefix}/${path}/`
    if (entries.some((e) => e.entryName === `${direct}SKILL.md`)) return direct
  }
  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.endsWith('/SKILL.md')) continue
    const prefix = entry.entryName.slice(0, entry.entryName.length - 'SKILL.md'.length)
    const seg = prefix.replace(/\/+$/, '').split('/').pop()
    if (seg && seg.toLowerCase() === dirName.toLowerCase()) return prefix
  }
  return null
}

/** 解析 SKILL.md 顶部 frontmatter 的 name / description */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return {}
  try {
    const data: unknown = parseYaml(match[1])
    if (!isPlainObject(data)) return {}
    return {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined
    }
  } catch {
    return {}
  }
}

/** 目标是否已同步到该 Agent：软链接需真实指向中央仓库；真实目录须含 SKILL.md */
async function isSyncedTo(
  storeDir: string,
  dirName: string,
  adapter: AgentAdapter
): Promise<boolean> {
  const target = join(adapter.skillsDir, dirName)
  try {
    const st = await lstat(target)
    if (st.isSymbolicLink()) {
      const real = await realpath(target)
      return normalize(real).toLowerCase() === normalize(join(storeDir, dirName)).toLowerCase()
    }
    return st.isDirectory() && existsSync(join(target, 'SKILL.md'))
  } catch {
    return false
  }
}

/** Ensure an existing Agent target is a link or a recognizable skill directory before replacement. */
async function assertReplaceableSyncTarget(target: string): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>
  try {
    targetStat = await lstat(target)
  } catch (error) {
    if (isMissingError(error)) return
    throw error
  }
  if (targetStat.isSymbolicLink()) return
  if (targetStat.isDirectory()) {
    try {
      const manifestStat = await lstat(join(target, 'SKILL.md'))
      if (manifestStat.isFile()) return
    } catch (error) {
      if (!isMissingError(error)) throw error
    }
  }
  throw new Error(`${target} is not a replaceable skill target`)
}

/** Remove a synchronized target without following directory links or deleting unrelated data. */
async function removeSyncTarget(target: string): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>
  try {
    targetStat = await lstat(target)
  } catch (error) {
    if (isMissingError(error)) return
    throw error
  }
  if (targetStat.isSymbolicLink()) {
    await removePathNoFollow(target)
    return
  }
  if (targetStat.isDirectory()) {
    await assertReplaceableSyncTarget(target)
    await removePathNoFollow(target)
  }
}

/** Prepare and atomically swap one Agent synchronization target, retaining the old target. */
async function stageSkillSync(
  storeDir: string,
  dirName: string,
  adapter: AgentAdapter,
  mode: SkillSyncMode
): Promise<AtomicPathSwap> {
  const source = resolve(storeDir, dirName)
  const sourceStat = await lstat(source)
  const manifestStat = await lstat(join(source, 'SKILL.md'))
  if (!sourceStat.isDirectory() || !manifestStat.isFile()) {
    throw new Error(`Skill ${dirName} does not contain a regular SKILL.md`)
  }

  await mkdir(adapter.skillsDir, { recursive: true })
  const target = resolve(adapter.skillsDir, dirName)
  await assertReplaceableSyncTarget(target)
  const prepared = preparedSibling(adapter.skillsDir, dirName)

  try {
    if (mode === 'copy') {
      await cp(source, prepared, { recursive: true })
      const preparedManifest = await lstat(join(prepared, 'SKILL.md'))
      if (!preparedManifest.isFile()) throw new Error('Prepared skill copy is invalid')
    } else {
      // Use an absolute source so the junction/symlink remains valid regardless of Agent cwd.
      await symlink(source, prepared, 'junction')
      const [preparedReal, sourceReal] = await Promise.all([realpath(prepared), realpath(source)])
      if (normalize(preparedReal).toLowerCase() !== normalize(sourceReal).toLowerCase()) {
        throw new Error('Prepared skill link points to an unexpected location')
      }
    }
    return await replacePreparedPath(prepared, target)
  } catch (error) {
    await removePathNoFollow(prepared).catch(() => {})
    throw error
  }
}

/** Synchronize one skill atomically and remove the retained backup after commit. */
async function syncSkill(
  storeDir: string,
  dirName: string,
  adapter: AgentAdapter,
  mode: SkillSyncMode
): Promise<void> {
  const swap = await stageSkillSync(storeDir, dirName, adapter, mode)
  await swap.finalize()
}

/** 列出中央仓库全部技能及各自已同步到的 Agent */
export async function listSkills(): Promise<SkillsListResult> {
  const dir = await getSkillsDir()
  const meta = await readMeta(dir)
  const skills: SkillInfo[] = []
  let names: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    // 目录尚不存在视为空仓库
  }
  for (const name of names) {
    const md = await readTextFile(join(dir, name, 'SKILL.md'))
    if (md === null) continue // 没有 SKILL.md 的目录不算技能
    const fm = parseFrontmatter(md)
    const agents: AgentId[] = []
    for (const adapter of listAdapters()) {
      if (await isSyncedTo(dir, name, adapter)) agents.push(adapter.id)
    }
    skills.push({
      dir: name,
      name: fm.name || name,
      description: fm.description,
      repo: meta[name]?.repo,
      branch: meta[name]?.branch,
      path: meta[name]?.path,
      agents
    })
  }
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { dir, skills }
}

/** 同步 / 取消同步某技能到某 Agent */
export async function setSkillSync(
  dirName: string,
  agentId: AgentId,
  enabled: boolean
): Promise<void> {
  assertDirName(dirName)
  const adapter = getAdapter(agentId)
  if (!enabled) {
    await removeSyncTarget(join(adapter.skillsDir, dirName))
    return
  }
  const storeDir = await getSkillsDir()
  await syncSkill(storeDir, dirName, adapter, await getSyncMode())
}

/** 删除技能：先取消所有 Agent 的同步，再删中央仓库目录与 meta 记录 */
export async function deleteSkill(dirName: string): Promise<void> {
  assertDirName(dirName)
  for (const adapter of listAdapters()) {
    await removeSyncTarget(join(adapter.skillsDir, dirName))
  }
  const storeDir = await getSkillsDir()
  await rm(join(storeDir, dirName), { recursive: true, force: true })
  const meta = await readMeta(storeDir)
  if (meta[dirName]) {
    delete meta[dirName]
    await writeMeta(storeDir, meta)
  }
}

/** 切换同步方式后，把所有已同步的技能重建为新方式 */
export async function resyncSkills(mode: SkillSyncMode): Promise<void> {
  const { dir, skills } = await listSkills()
  for (const skill of skills) {
    for (const agentId of skill.agents) {
      const adapter = getAdapter(agentId)
      await syncSkill(dir, skill.dir, adapter, mode)
    }
  }
}

/**
 * 迁移技能存储目录：技能与 meta 复制到新目录并重建同步链接，
 * 旧目录文件保留不删（用户数据，宁多勿删）。返回解析后的新目录。
 * 注意：调用方（渲染层）负责把新目录持久化进 config.json。
 */
export async function migrateSkillsDir(newDir: string): Promise<string> {
  const target = resolve(newDir)
  const { dir: oldDir, skills } = await listSkills()
  if (normalize(target).toLowerCase() === normalize(resolve(oldDir)).toLowerCase()) {
    return oldDir
  }
  await mkdir(target, { recursive: true })
  const mode = await getSyncMode()
  for (const skill of skills) {
    await cp(join(oldDir, skill.dir), join(target, skill.dir), { recursive: true, force: true })
    // 软链接需改指新位置；复制模式的副本本就独立，重建一次保持内容一致
    for (const agentId of skill.agents) {
      const adapter = getAdapter(agentId)
      await syncSkill(target, skill.dir, adapter, mode)
    }
  }
  await writeMeta(target, await readMeta(oldDir))
  return target
}

/** 归一化仓库输入：支持 owner/repo 或 GitHub 链接 */
export function parseRepoInput(input: string): string {
  const trimmed = input.trim()
  const url = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(trimmed)
  if (url) return `${url[1]}/${url[2]}`
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return trimmed
  throw new Error('无法识别仓库地址，请输入 owner/repo 或 GitHub 仓库链接')
}

async function ghJson(url: string): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, { headers: GH_HEADERS, signal: AbortSignal.timeout(15000) })
  } catch (error) {
    throw new Error(`访问 GitHub 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (res.status === 404) throw new Error('仓库不存在或无法访问（私有仓库暂不支持）')
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub API 频率受限，请稍后再试')
  }
  if (!res.ok) throw new Error(`GitHub API 请求失败（HTTP ${res.status}）`)
  const data: unknown = await res.json()
  return isPlainObject(data) ? data : {}
}

/** 在 skills.sh 公共注册表搜索技能：只做发现，安装仍走 GitHub 仓库流程 */
export async function searchSkillsSh(query: string): Promise<SkillsShSkill[]> {
  // API 要求关键词至少 2 个字符，空关键词用通用词兜底当「热门榜」（结果按安装量降序）
  const q = query.trim().length >= 2 ? query.trim() : 'skill'
  let res: Response
  try {
    res = await fetch(`https://www.skills.sh/api/search?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'omp-switch', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    })
  } catch (error) {
    throw new Error(
      `访问 skills.sh 失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!res.ok) throw new Error(`skills.sh 请求失败（HTTP ${res.status}）`)
  const data: unknown = await res.json()
  const items = isPlainObject(data) && Array.isArray(data.skills) ? (data.skills as unknown[]) : []
  const skills: SkillsShSkill[] = []
  for (const item of items) {
    if (!isPlainObject(item)) continue
    if (typeof item.skillId !== 'string' || typeof item.source !== 'string') continue
    skills.push({
      skillId: item.skillId,
      name: typeof item.name === 'string' && item.name.trim() !== '' ? item.name : item.skillId,
      source: item.source,
      installs: typeof item.installs === 'number' ? item.installs : 0
    })
  }
  // 安装量降序，和 skills.sh 官网一致
  return skills.sort((a, b) => b.installs - a.installs)
}

/** 扫描仓库里的技能（所有含 SKILL.md 的目录），并拉取各自 frontmatter 描述 */
export async function fetchRepoSkills(input: string, branch?: string): Promise<RemoteSkillsResult> {
  const repo = parseRepoInput(input)
  let resolvedBranch = branch?.trim() || ''
  if (!resolvedBranch) {
    const info = await ghJson(`https://api.github.com/repos/${repo}`)
    resolvedBranch = typeof info.default_branch === 'string' ? info.default_branch : 'main'
  }
  const tree = await ghJson(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(resolvedBranch)}?recursive=1`
  )
  const items = Array.isArray(tree.tree) ? (tree.tree as unknown[]) : []
  const dirs = items
    .filter(
      (item): item is { path: string } =>
        isPlainObject(item) &&
        item.type === 'blob' &&
        typeof item.path === 'string' &&
        (item.path === 'SKILL.md' || item.path.endsWith('/SKILL.md'))
    )
    .map((item) => item.path.slice(0, Math.max(0, item.path.length - 'SKILL.md'.length - 1)))
  if (dirs.length === 0) throw new Error('该仓库中未找到任何技能（SKILL.md）')
  // 并行拉 frontmatter 拿名称/描述，单个失败不影响整体
  const skills: RemoteSkillInfo[] = await Promise.all(
    dirs.slice(0, 100).map(async (path) => {
      const fallback = path === '' ? repo.split('/')[1] : path.split('/').pop()!
      try {
        const res = await fetch(
          `https://raw.githubusercontent.com/${repo}/${resolvedBranch}/${path ? `${path}/` : ''}SKILL.md`,
          { headers: { 'User-Agent': 'omp-switch' }, signal: AbortSignal.timeout(15000) }
        )
        if (!res.ok) return { path, name: fallback }
        const fm = parseFrontmatter(await res.text())
        return { path, name: fm.name || fallback, description: fm.description }
      } catch {
        return { path, name: fallback }
      }
    })
  )
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return { repo, branch: resolvedBranch, skills }
}

/**
 * 安装选中的技能：下载仓库 zipball，把选中目录解压进中央仓库（同名覆盖），
 * 记录来源仓库。安装只入库、不主动同步到任何 Agent，需用户在列表页手动开启。返回安装的目录名。
 */
export async function installSkills(
  repo: string,
  branch: string,
  paths: string[]
): Promise<string[]> {
  if (paths.length === 0) return []
  const entries = await downloadRepoZip(repo, branch)
  const rootPrefix = entries[0]?.entryName.split('/')[0] ?? ''
  const storeDir = await getSkillsDir()
  const nextMeta = { ...(await readMeta(storeDir)) }
  const installed: string[] = []
  const names = new Set<string>()
  const swaps: AtomicPathSwap[] = []
  const preparedPaths: string[] = []
  let committed = false

  try {
    for (const path of paths) {
      const dirName = path === '' ? repo.split('/')[1] : path.split('/').pop()!
      assertDirName(dirName)
      if (names.has(dirName)) throw new Error(`Duplicate skill directory name: ${dirName}`)
      names.add(dirName)

      const prefix = path === '' ? `${rootPrefix}/` : `${rootPrefix}/${path}/`
      const prepared = await prepareSkillDirectory(storeDir, dirName, entries, prefix)
      preparedPaths.push(prepared.path)
      swaps.push(await replacePreparedPath(prepared.path, resolve(storeDir, dirName)))

      nextMeta[dirName] = {
        repo,
        branch,
        path,
        contentHash: prepared.contentHash,
        installedAt: new Date().toISOString()
      }
      installed.push(dirName)
    }

    await writeMeta(storeDir, nextMeta)
    committed = true
    await finalizeSwaps(swaps)
    return installed
  } catch (error) {
    if (!committed) {
      const rollbackErrors = await rollbackSwaps(swaps)
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Skill installation failed and rollback was incomplete: ${errorMessage(error)}; ${rollbackErrors.join('; ')}`
        )
      }
    }
    throw error
  } finally {
    await Promise.all(preparedPaths.map((path) => removePathNoFollow(path).catch(() => {})))
  }
}

/**
 * 检查已安装技能的更新：只查有来源仓库信息的技能，按 repo@branch 分组下载 zipball，
 * 比对本地与远程内容哈希，返回「有更新」的技能目录名列表。单个仓库失败不阻塞其他仓库。
 */
export async function checkSkillUpdates(): Promise<string[]> {
  const storeDir = await getSkillsDir()
  const { skills } = await listSkills()
  const meta = await readMeta(storeDir)

  // 按 repo@branch 分组，避免同仓库重复下载
  const groups = new Map<string, { repo: string; branch: string; dirs: string[] }>()
  for (const skill of skills) {
    const m = meta[skill.dir]
    if (!m?.repo) continue
    const branch = m.branch?.trim() || 'main'
    const key = `${m.repo}@${branch}`
    const group = groups.get(key) ?? { repo: m.repo, branch, dirs: [] }
    group.dirs.push(skill.dir)
    groups.set(key, group)
  }

  const outdated: string[] = []
  let metaChanged = false
  for (const { repo, branch, dirs } of groups.values()) {
    let entries: ReturnType<AdmZip['getEntries']>
    try {
      entries = await downloadRepoZip(repo, branch)
    } catch {
      continue
    }
    const rootPrefix = entries[0]?.entryName.split('/')[0] ?? ''
    for (const dir of dirs) {
      const m = meta[dir]
      const prefix = findSkillPrefix(entries, rootPrefix, dir, m?.path)
      if (!prefix) continue
      const remoteHash = hashZipSkillDir(entries, prefix)
      // 本地哈希优先用 meta 缓存，缺失（老数据）则实时计算并回填
      let localHash = m?.contentHash
      if (!localHash) {
        try {
          localHash = await hashLocalSkillDir(join(storeDir, dir))
          if (m) {
            m.contentHash = localHash
            metaChanged = true
          }
        } catch {
          localHash = undefined
        }
      }
      if (localHash !== remoteHash) outdated.push(dir)
    }
  }
  if (metaChanged) await writeMeta(storeDir, meta)
  return outdated
}

/** 更新单个技能：重新下载来源仓库覆盖本地目录，刷新哈希并重建原有同步 */
export async function updateSkill(dirName: string): Promise<void> {
  assertDirName(dirName)
  const storeDir = await getSkillsDir()
  const meta = await readMeta(storeDir)
  const currentMeta = meta[dirName]
  if (!currentMeta?.repo) throw new Error('This skill has no source repository and cannot update')
  const branch = currentMeta.branch?.trim() || 'main'

  const entries = await downloadRepoZip(currentMeta.repo, branch)
  const rootPrefix = entries[0]?.entryName.split('/')[0] ?? ''
  const prefix = findSkillPrefix(entries, rootPrefix, dirName, currentMeta.path)
  if (!prefix) throw new Error(`Skill ${dirName} was not found in ${currentMeta.repo}`)

  const syncedAgents: AgentId[] = []
  for (const adapter of listAdapters()) {
    if (await isSyncedTo(storeDir, dirName, adapter)) syncedAgents.push(adapter.id)
  }

  const prepared = await prepareSkillDirectory(storeDir, dirName, entries, prefix)
  const swaps: AtomicPathSwap[] = []
  let committed = false
  try {
    swaps.push(await replacePreparedPath(prepared.path, resolve(storeDir, dirName)))

    const mode = await getSyncMode()
    for (const agentId of syncedAgents) {
      try {
        swaps.push(await stageSkillSync(storeDir, dirName, getAdapter(agentId), mode))
      } catch (error) {
        throw new Error(`Failed to synchronize updated skill to ${agentId}: ${errorMessage(error)}`)
      }
    }

    const nextMeta = {
      ...meta,
      [dirName]: {
        repo: currentMeta.repo,
        branch,
        path: currentMeta.path,
        contentHash: prepared.contentHash,
        installedAt: currentMeta.installedAt || new Date().toISOString()
      }
    }
    await writeMeta(storeDir, nextMeta)
    committed = true
    await finalizeSwaps(swaps)
  } catch (error) {
    if (!committed) {
      const rollbackErrors = await rollbackSwaps(swaps)
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Skill ${dirName} update failed and rollback was incomplete: ${errorMessage(error)}; ${rollbackErrors.join('; ')}`
        )
      }
      throw new Error(
        `Skill ${dirName} update failed; the previous version and sync targets were restored: ${errorMessage(error)}`
      )
    }
    throw error
  } finally {
    await removePathNoFollow(prepared.path).catch(() => {})
  }
}
