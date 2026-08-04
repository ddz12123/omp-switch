import { existsSync } from 'fs'
import { lstat, open, readdir, readFile, realpath, rm, rmdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import { parseDocument } from 'yaml'
import type { SessionMeta, SessionRaw, SessionRootInfo, SessionRootKind } from '../shared/types'
import { readAppConfig } from './appConfig'

/**
 * 会话（sessions）读取与管理。
 *
 * pi / omp 都基于 pi-coding-agent，内部 APP_NAME 均为 "pi"，因此共用同一组 env：
 * - PI_CODING_AGENT_DIR：整个 agent home（会话在 <home>/sessions）
 * - PI_CODING_AGENT_SESSION_DIR：直接指定会话目录
 * 二者只有默认 home 不同（~/.pi/agent vs ~/.omp/agent）。
 * 这里不做格式猜测，枚举所有可能的会话根目录，去重后按目录分组展示。
 */

const OMP_DEFAULT_SESSIONS = join(homedir(), '.omp', 'agent', 'sessions')
const PI_DEFAULT_SESSIONS = join(homedir(), '.pi', 'agent', 'sessions')
const ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR'
const ENV_SESSION_DIR = 'PI_CODING_AGENT_SESSION_DIR'

/** 列表阶段每个会话文件只读前 16KB 提取头部元信息，避免全量读大文件 */
const HEAD_BYTES = 16 * 1024
/** 原始查看上限，超出截断（大会话文件可达数 MB） */
const RAW_MAX_BYTES = 8 * 1024 * 1024
/** 递归扫描会话文件的最大深度（<root>/<项目>/<file>.jsonl，留余量兼容历史结构） */
const MAX_SCAN_DEPTH = 4

/** 规范化为可比较的绝对路径 */
function normalizeId(path: string): string {
  return normalize(resolve(path))
}

/** 展开 env 里可能的 ~ 前缀 */
function expandTilde(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * 读取某个 agent home 下 CLI 配置文件里的 sessionDir 设置
 * （pi: settings.json / omp: config.yml，二者共用该键）。
 * 相对路径按官方文档相对 agent home 解析；文件缺失或损坏时静默忽略。
 */
async function readConfigSessionDirs(home: string): Promise<string[]> {
  const dirs: string[] = []
  const push = (value: unknown): void => {
    if (typeof value !== 'string' || value.trim() === '') return
    const expanded = expandTilde(value.trim())
    dirs.push(isAbsolute(expanded) ? expanded : join(home, expanded))
  }
  try {
    const raw = await readFile(join(home, 'settings.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      push((parsed as Record<string, unknown>).sessionDir)
    }
  } catch {
    // settings.json 不存在或解析失败，跳过
  }
  try {
    const raw = await readFile(join(home, 'config.yml'), 'utf8')
    const doc = parseDocument(raw)
    if (doc.errors.length === 0) {
      const parsed: unknown = doc.toJS()
      if (typeof parsed === 'object' && parsed !== null) {
        push((parsed as Record<string, unknown>).sessionDir)
      }
    }
  } catch {
    // config.yml 不存在或解析失败，跳过
  }
  return dirs
}

/**
 * 枚举全部候选会话根目录，去重（按规范化绝对路径）：
 * 默认 home ×2 → PI_CODING_AGENT_DIR/sessions → PI_CODING_AGENT_SESSION_DIR
 * → CLI 配置文件里的 sessionDir → 用户自定义。
 */
export async function resolveSessionRoots(): Promise<SessionRootInfo[]> {
  const roots: SessionRootInfo[] = []
  const seen = new Set<string>()
  const add = (rawPath: string, label: string, kind: SessionRootKind): void => {
    const id = normalizeId(expandTilde(rawPath.trim()))
    if (!id || seen.has(id)) return
    seen.add(id)
    roots.push({ id, label, path: id, kind, exists: existsSync(id) })
  }

  add(OMP_DEFAULT_SESSIONS, 'OMP · 默认目录', 'omp-default')
  add(PI_DEFAULT_SESSIONS, 'Pi · 默认目录', 'pi-default')

  const envHome = process.env[ENV_AGENT_DIR]?.trim()
  if (envHome)
    add(join(expandTilde(envHome), 'sessions'), `自定义 · ${ENV_AGENT_DIR}`, 'env-agent-dir')

  const envSession = process.env[ENV_SESSION_DIR]?.trim()
  if (envSession) add(envSession, `自定义 · ${ENV_SESSION_DIR}`, 'env-session-dir')

  // CLI 配置文件里的 sessionDir（env home 生效时两个 CLI 都会改用该 home 下的配置）
  const homes: { home: string; label: string }[] = [
    { home: join(homedir(), '.omp', 'agent'), label: 'omp' },
    { home: join(homedir(), '.pi', 'agent'), label: 'pi' }
  ]
  if (envHome) homes.push({ home: expandTilde(envHome), label: ENV_AGENT_DIR })
  for (const { home, label } of homes) {
    for (const dir of await readConfigSessionDirs(home)) {
      add(dir, `配置 · ${label} sessionDir`, 'config-session-dir')
    }
  }

  const config = await readAppConfig()
  const customDirs = Array.isArray(config.sessions?.customDirs) ? config.sessions.customDirs : []
  for (const dir of customDirs) {
    if (typeof dir === 'string' && dir.trim()) add(dir, '自定义 · 手动', 'custom')
  }

  return roots
}

/** Compare canonical paths so a symlinked parent cannot bypass containment checks. */
function isInsideRealPath(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Resolve an existing session root. An explicitly configured root may itself be a symlink or
 * junction, but its canonical destination must be a directory.
 */
async function resolveRealSessionRoot(root: SessionRootInfo): Promise<string | null> {
  try {
    const lexicalStat = await lstat(root.path)
    if (!lexicalStat.isDirectory() && !lexicalStat.isSymbolicLink()) return null
    const resolved = normalizeId(await realpath(root.path))
    const resolvedStat = await stat(resolved)
    return resolvedStat.isDirectory() ? resolved : null
  } catch {
    return null
  }
}

/** Require an existing regular .jsonl file inside one of the canonical session roots. */
async function assertSessionPathInRoots(roots: SessionRootInfo[], target: string): Promise<string> {
  const lexicalTarget = normalizeId(target)
  if (!/\.jsonl$/i.test(lexicalTarget)) {
    throw new Error(`Only regular .jsonl session files are allowed: ${target}`)
  }

  const targetStat = await lstat(lexicalTarget)
  // lstat does not follow the final symlink, so symbolic links and junctions are rejected here.
  if (!targetStat.isFile()) throw new Error(`Session path is not a regular file: ${target}`)
  const realTarget = normalizeId(await realpath(lexicalTarget))

  for (const root of roots) {
    const realRoot = await resolveRealSessionRoot(root)
    if (realRoot && isInsideRealPath(realRoot, realTarget)) return realTarget
  }
  throw new Error(`Refusing to access a path outside the session roots: ${target}`)
}

/** Validate one session file and return its canonical absolute path. */
async function assertSessionPath(target: string): Promise<string> {
  return assertSessionPathInRoots(await resolveSessionRoots(), target)
}

/** A recursively removed sibling log directory must be a real in-root directory, never a link. */
async function resolveSafeSessionLogDir(
  roots: SessionRootInfo[],
  target: string
): Promise<string | null> {
  try {
    const lexicalTarget = normalizeId(target)
    const targetStat = await lstat(lexicalTarget)
    if (!targetStat.isDirectory()) return null
    const realTarget = normalizeId(await realpath(lexicalTarget))
    for (const root of roots) {
      const realRoot = await resolveRealSessionRoot(root)
      if (realRoot && isInsideRealPath(realRoot, realTarget) && realRoot !== realTarget) {
        return realTarget
      }
    }
  } catch {
    // Missing or unsafe sibling log directories are intentionally left untouched.
  }
  return null
}

/** 读取文件前若干字节（用于提取头部元信息或截断查看） */
async function readHead(filePath: string, bytes: number): Promise<string> {
  const fh = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } finally {
    await fh.close()
  }
}

interface HeadMeta {
  id?: string
  title?: string
  cwd?: string
  createdAt?: string
  model?: string
}

/** 逐行解析头部 JSON 记录，抽取会话元信息（容错：坏行/半行跳过） */
function parseHeadMeta(head: string): HeadMeta {
  const meta: HeadMeta = {}
  for (const line of head.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: unknown
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof rec !== 'object' || rec === null) continue
    const r = rec as Record<string, unknown>
    if (r.type === 'title') {
      if (typeof r.title === 'string' && !meta.title) meta.title = r.title
    } else if (r.type === 'session') {
      if (typeof r.id === 'string') meta.id = r.id
      if (typeof r.cwd === 'string') meta.cwd = r.cwd
      if (typeof r.timestamp === 'string') meta.createdAt = r.timestamp
      if (typeof r.title === 'string' && !meta.title) meta.title = r.title
    } else if (r.type === 'model_change') {
      if (typeof r.model === 'string' && !meta.model) meta.model = r.model
    }
  }
  return meta
}

/** 递归收集目录下的 .jsonl 文件（有界深度） */
async function collectJsonl(dir: string, depth = 0): Promise<string[]> {
  if (depth > MAX_SCAN_DEPTH) return []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectJsonl(full, depth + 1)))
    } else if (entry.isFile() && /\.jsonl$/i.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

/** 遍历所有存在的会话根目录，读取每个 .jsonl 头部元信息，按修改时间倒序 */
export async function listSessions(): Promise<SessionMeta[]> {
  const roots = await resolveSessionRoots()
  const result: SessionMeta[] = []
  for (const root of roots) {
    if (!root.exists) continue
    const files = await collectJsonl(root.path)
    for (const filePath of files) {
      try {
        const resolved = await assertSessionPathInRoots([root], filePath)
        const st = await lstat(resolved)
        const meta = parseHeadMeta(await readHead(resolved, HEAD_BYTES))
        const fileBase = basename(filePath).replace(/\.jsonl$/i, '')
        result.push({
          rootId: root.id,
          id: meta.id || fileBase,
          filePath,
          title: meta.title || fileBase,
          cwd: meta.cwd || '',
          createdAt: meta.createdAt || '',
          updatedAt: st.mtime.toISOString(),
          model: meta.model,
          size: st.size
        })
      } catch {
        // 单个文件读失败不影响整体列表
      }
    }
  }
  result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return result
}

/** 读取单个会话文件原始文本（供只读查看），过大截断 */
export async function readSessionRaw(filePath: string): Promise<SessionRaw> {
  const resolved = await assertSessionPath(filePath)
  const st = await lstat(resolved)
  if (!st.isFile()) throw new Error(`Session path is not a regular file: ${filePath}`)
  if (st.size > RAW_MAX_BYTES) {
    return { filePath: resolved, content: await readHead(resolved, RAW_MAX_BYTES), truncated: true }
  }
  return { filePath: resolved, content: await readFile(resolved, 'utf-8'), truncated: false }
}

/**
 * 批量删除会话，逐条：
 * ① 路径安全校验（须落在某个会话根内）；② 删 .jsonl；
 * ③ 删同名 sibling 日志目录（去 .jsonl 的同名目录）；④ 父项目目录若空则删（不删根目录）。
 * 共享的 blobs/ 图片附件不动。
 */
export async function deleteSessions(filePaths: string[]): Promise<{ deleted: number }> {
  const roots = await resolveSessionRoots()
  const rootIds = new Set(
    (await Promise.all(roots.map(resolveRealSessionRoot))).filter(
      (root): root is string => root !== null
    )
  )
  let deleted = 0
  for (const filePath of filePaths) {
    const resolved = await assertSessionPathInRoots(roots, filePath)
    await rm(resolved, { force: true })

    const logDir = await resolveSafeSessionLogDir(roots, resolved.replace(/\.jsonl$/i, ''))
    if (logDir) await rm(logDir, { recursive: true, force: true })

    deleted++

    const parent = dirname(resolved)
    if (!rootIds.has(normalizeId(parent))) {
      const remaining = await readdir(parent).catch(() => null)
      // rmdir only removes an empty parent and never recursively removes a session root.
      if (remaining && remaining.length === 0) await rmdir(parent).catch(() => {})
    }
  }
  return { deleted }
}

/** 校验会话路径合法（供 ipc show-in-folder 复用） */
export async function resolveSafeSessionPath(filePath: string): Promise<string> {
  return assertSessionPath(filePath)
}
