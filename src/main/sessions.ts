import { existsSync, type Stats } from 'fs'
import { lstat, open, readdir, readFile, realpath, rm, rmdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type {
  AgentId,
  SessionMessage,
  SessionMessageRole,
  SessionMeta,
  SessionRaw,
  SessionRootInfo,
  SessionRootKind,
  SessionStats,
  SessionToolCall,
  SessionTranscript
} from '../shared/types'
import { readAppConfig } from './appConfig'
import { getOmpAgentDir, getOmpProfile } from './agents'

/**
 * 会话（sessions）读取与管理。
 *
 * pi / omp 都基于 pi-coding-agent，内部 APP_NAME 均为 "pi"，因此共用同一组 env：
 * - PI_CODING_AGENT_DIR：整个 agent home（会话在 <home>/sessions）
 * - PI_CODING_AGENT_SESSION_DIR：直接指定会话目录
 * 二者只有默认 home 不同（~/.pi/agent vs ~/.omp/agent）。
 * 会话文件同为 version:3 JSONL，仅字段方言不同（model_change / 标题），
 * 因此用一套解析器 + 按记录自动适配方言，root 来源只是优先提示。
 */

const OMP_DEFAULT_SESSIONS = join(homedir(), '.omp', 'agent', 'sessions')
const PI_DEFAULT_SESSIONS = join(homedir(), '.pi', 'agent', 'sessions')
const ENV_AGENT_DIR = 'PI_CODING_AGENT_DIR'
const ENV_SESSION_DIR = 'PI_CODING_AGENT_SESSION_DIR'

/** 列表阶段每个会话文件只读头/尾各 16KB，避免全量读大文件 */
const HEAD_BYTES = 16 * 1024
const TAIL_BYTES = 16 * 1024
/** 原始查看上限，超出截断（大会话文件可达数 MB） */
const RAW_MAX_BYTES = 8 * 1024 * 1024
/** 结构化全文加载上限，超出只读前 24MB 的完整行 */
const TRANSCRIPT_MAX_BYTES = 24 * 1024 * 1024
/** 单块文本/工具参数上限，原始视图仍可看全 */
const TEXT_BLOCK_MAX = 2 * 1024
/** 扫描文件的并发池大小 */
const SCAN_CONCURRENCY = 8
/** 头部被超长 system prompt / 内嵌图片占满时，为找首条 user 消息额外读的上限 */
const META_USER_SCAN_BYTES = 512 * 1024
const TITLE_MAX = 60
const SUMMARY_MAX = 120

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
 * 读取 pi 的 settings.json 里的 sessionDir 设置。
 * omp 没有这个配置项（会话目录固定为 <agent dir>/sessions，实测 `omp config list` 无此键），
 * 因此只探测 pi；相对路径按官方文档相对 agent home 解析，文件缺失或损坏时静默忽略。
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
  return dirs
}

/**
 * 枚举全部候选会话根目录，去重（按规范化绝对路径）：
 * 默认 home ×2（含 omp 命名 profile）→ PI_CODING_AGENT_DIR/sessions →
 * PI_CODING_AGENT_SESSION_DIR → pi settings.json 的 sessionDir → 用户自定义。
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

  // omp 命名 profile 有独立的 agent 目录，会话也存在各自目录下
  const ompProfile = getOmpProfile()
  if (ompProfile !== '') {
    add(join(getOmpAgentDir(), 'sessions'), `OMP · profile ${ompProfile}`, 'omp-default')
  }

  const envHome = process.env[ENV_AGENT_DIR]?.trim()
  if (envHome)
    add(join(expandTilde(envHome), 'sessions'), `自定义 · ${ENV_AGENT_DIR}`, 'env-agent-dir')

  const envSession = process.env[ENV_SESSION_DIR]?.trim()
  if (envSession) add(envSession, `自定义 · ${ENV_SESSION_DIR}`, 'env-session-dir')

  // pi settings.json 里的 sessionDir（env home 生效时 pi 会用该 home 下的配置）
  const homes: { home: string; label: string }[] = [
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

/** 读取文件末尾若干字节（尾部 model_change / 标题需要）；首行可能残破，调用方跳过 */
async function readTail(filePath: string, bytes: number, size: number): Promise<string> {
  if (size <= 0) return ''
  const start = Math.max(0, size - bytes)
  const length = Math.min(bytes, size)
  const fh = await open(filePath, 'r')
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await fh.read(buf, 0, length, start)
    return buf.subarray(0, bytesRead).toString('utf-8')
  } finally {
    await fh.close()
  }
}

/** 逐行解析 JSON 记录，坏行/半行跳过；tail 的首行一律丢弃 */
function* parseRecords(chunk: string, skipFirstLine = false): Generator<Record<string, unknown>> {
  const lines = chunk.split('\n')
  for (let i = skipFirstLine ? 1 : 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue
    let rec: unknown
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof rec === 'object' && rec !== null && !Array.isArray(rec)) {
      yield rec as Record<string, unknown>
    }
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function truncateText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** 动态拼接避免正则字面量里出现控制字符（ESLint no-control-regex） */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g')

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Agent 会把图片附件与上下文以标记/XML 注入 user 文本，结构化阅读时不应原样展示。
 * 这里只做展示层清洗，原始 JSON 视图仍通过 readSessionRaw 看全文。
 */
const INJECTED_CONTEXT =
  /<t3_context[\s\S]*?<\/t3_context>|<system-reminder[\s\S]*?<\/system-reminder>|<context\b[^>]*>/gi
const IMAGE_MARKER = /\[Image:\s*([^\];]+?)\s*(?:;[\s\S]*?)?\]/gi
const ATTACHED_IMAGE = /\[Attached image\s+"[^"]*"[^\]]*\]/gi
const ATTACHMENT_META = /^(?:name|mimeType|sizeBytes|attachmentId|ref)\s*:\s*[^\n]*$/gim

function cleanDisplayText(value: string): string {
  return value
    .replace(INJECTED_CONTEXT, '')
    .replace(IMAGE_MARKER, (_match, name: string) => `［图片附件：${name.trim()}］`)
    .replace(ATTACHED_IMAGE, '')
    .replace(ATTACHMENT_META, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** content 兼容字符串与块数组两种形态，只取 text 块 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return cleanDisplayText(stripAnsi(content))
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(cleanDisplayText(stripAnsi(b.text)))
    }
  }
  return parts.join('\n')
}

/**
 * 方言适配：
 * - omp：model_change.model 已是 provider/model
 * - pi：model_change.provider + modelId 归一为 provider/modelId
 * 两种字段同时识别，因此 env/custom 等来源无需预先知道方言。
 */
function normalizeModelChange(rec: Record<string, unknown>): string {
  const model = asString(rec.model).trim()
  if (model) return model
  const provider = asString(rec.provider).trim()
  const modelId = asString(rec.modelId).trim()
  return [provider, modelId].filter(Boolean).join('/')
}

function normalizeMessageModel(message: Record<string, unknown>): string {
  const provider = asString(message.provider).trim()
  const model = asString(message.model).trim()
  if (!model) return ''
  if (provider && !model.includes('/') && !model.startsWith(`${provider}/`)) {
    return `${provider}/${model}`
  }
  return model
}

/** root kind 推断 + 路径兜底（/.omp/ → omp、/.pi/ → pi） */
function inferAgentFromRoot(root: SessionRootInfo | null): AgentId | null {
  if (!root) return null
  if (root.kind === 'omp-default') return 'omp'
  if (root.kind === 'pi-default') return 'pi'
  const parts = normalizeId(root.path).toLowerCase().split(/[\\/]/)
  if (parts.includes('.omp')) return 'omp'
  if (parts.includes('.pi')) return 'pi'
  return null
}

interface ParsedSessionMeta {
  id: string
  title: string
  summary: string
  /** 首条 user 文本（未截断），供 buildSessionMeta 做大头部补偿 */
  firstUserText: string
  cwd: string
  createdAt: string
  model?: string
  agent: AgentId | null
}

/**
 * 轻量元数据索引：只读头 16KB + 尾 16KB。
 * 标题优先级：title 记录（空串跳过）→ title_change → pi session_info.name →
 * 首条 user 文本（60 字）→ 文件名。model 取头尾合并后的最后一条 model_change。
 */
export function parseSessionMeta(
  head: string,
  tail: string,
  fileBase: string,
  root: SessionRootInfo | null = null
): ParsedSessionMeta {
  let id = ''
  let cwd = ''
  let createdAt = ''
  let titleRecord = ''
  let titleChange = ''
  let sessionInfoName = ''
  let firstUserText = ''
  let model = ''
  let sawPi = false
  let sawOmp = false

  // 头尾可能有重叠；重复的旧记录不影响"取最后一条"的结果
  for (const rec of [...parseRecords(head), ...parseRecords(tail, true)]) {
    const type = asString(rec.type)
    if (type === 'session') {
      if (!id) id = asString(rec.id)
      if (!cwd) cwd = asString(rec.cwd)
      if (!createdAt) createdAt = asString(rec.timestamp)
      if (asString(rec.titleSource) || asString(rec.title)) sawOmp = true
    } else if (type === 'title') {
      const value = asString(rec.title).trim()
      if (value) titleRecord = value
    } else if (type === 'title_change') {
      const value = asString(rec.title).trim()
      if (value) titleChange = value
    } else if (type === 'session_info') {
      const value = asString(rec.name).trim()
      if (value) sessionInfoName = value
      sawPi = true
    } else if (type === 'model_change') {
      const value = normalizeModelChange(rec)
      if (value) model = value
      if (asString(rec.model)) sawOmp = true
      else if (asString(rec.provider) || asString(rec.modelId)) sawPi = true
    } else if (type === 'message' && !firstUserText) {
      const raw = rec.message
      if (typeof raw === 'object' && raw !== null) {
        const message = raw as Record<string, unknown>
        if (message.role === 'user') firstUserText = oneLine(extractText(message.content))
      }
    }
  }

  const title =
    titleRecord ||
    titleChange ||
    sessionInfoName ||
    truncateText(firstUserText, TITLE_MAX) ||
    truncateText(fileBase, TITLE_MAX)
  const agent =
    inferAgentFromRoot(root) ?? (sawPi && !sawOmp ? 'pi' : sawOmp && !sawPi ? 'omp' : null)

  return {
    id,
    title,
    summary: truncateText(firstUserText, SUMMARY_MAX),
    firstUserText,
    cwd,
    createdAt,
    model: model || undefined,
    agent
  }
}

async function buildSessionMeta(
  filePath: string,
  root: SessionRootInfo | null,
  st: Stats
): Promise<SessionMeta> {
  const head = await readHead(filePath, HEAD_BYTES)
  const tail = st.size > HEAD_BYTES ? await readTail(filePath, TAIL_BYTES, st.size) : ''
  const fileBase = basename(filePath).replace(/\.jsonl$/i, '')
  const parsed = parseSessionMeta(head, tail, fileBase, root)

  // 有些会话开头是一整段超长 system prompt，16KB 头部里根本没有 user 记录。
  // 这时只补读一次更大的头部找首条 user 文本，其余字段仍以头尾解析结果为准。
  if (!parsed.firstUserText && st.size > HEAD_BYTES) {
    const widerHead = await readHead(filePath, Math.min(st.size, META_USER_SCAN_BYTES))
    const wider = parseSessionMeta(widerHead, '', fileBase, root)
    if (wider.firstUserText) {
      parsed.firstUserText = wider.firstUserText
      parsed.summary = truncateText(wider.firstUserText, SUMMARY_MAX)
      if (parsed.title === truncateText(fileBase, TITLE_MAX)) {
        parsed.title = truncateText(wider.firstUserText, TITLE_MAX)
      }
    }
  }
  return {
    rootId: root?.id ?? '',
    id: parsed.id || fileBase,
    filePath,
    title: parsed.title,
    summary: parsed.summary,
    cwd: parsed.cwd,
    createdAt: parsed.createdAt,
    updatedAt: st.mtime.toISOString(),
    model: parsed.model,
    agent: parsed.agent,
    size: st.size
  }
}

/** 读取单个会话文件的元信息（不校验 root 归属，供内部与验证脚本使用） */
export async function readSessionMeta(
  filePath: string,
  root: SessionRootInfo | null = null
): Promise<SessionMeta> {
  return buildSessionMeta(filePath, root, await lstat(filePath))
}

/**
 * 只认 root/<项目>/<file>.jsonl 三层结构：
 * 跳过 subagent-artifacts 目录、与 .jsonl 同名的 sidecar 目录（其中的嵌套 jsonl 是子代理/日志噪声）。
 * 目录项一律不递归，符号链接（Dirent.isFile=false）也不会被收集。
 */
async function collectSessionFiles(root: string): Promise<string[]> {
  const projects = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const project of projects) {
    if (!project.isDirectory() || project.name.toLowerCase() === 'subagent-artifacts') continue
    const projectPath = join(root, project.name)
    const entries = await readdir(projectPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && /\.jsonl$/i.test(entry.name)) files.push(join(projectPath, entry.name))
    }
  }
  return files
}

/** 固定大小的并发池，避免一次性打开成百上千个文件 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

interface CachedSessionMeta {
  mtimeMs: number
  size: number
  rootId: string
  meta: SessionMeta
}

/** 模块级元数据缓存：刷新时只 lstat，未变更项直接复用，消失项剔除 */
const metaCache = new Map<string, CachedSessionMeta>()

/** 遍历所有会话根目录，读取轻量元数据索引，按修改时间倒序 */
export async function listSessions(): Promise<SessionMeta[]> {
  const roots = (await resolveSessionRoots()).filter((root) => root.exists)
  const groups = await Promise.all(
    roots.map(async (root) => ({ root, files: await collectSessionFiles(root.path) }))
  )
  const tasks = groups.flatMap(({ root, files }) => files.map((filePath) => ({ root, filePath })))

  const alive = new Set(tasks.map(({ filePath }) => normalizeId(filePath)))
  for (const key of metaCache.keys()) if (!alive.has(key)) metaCache.delete(key)

  const metas = await mapPool(tasks, SCAN_CONCURRENCY, async ({ root, filePath }) => {
    const key = normalizeId(filePath)
    try {
      const st = await lstat(filePath)
      if (!st.isFile()) return null
      const cached = metaCache.get(key)
      if (
        cached &&
        cached.mtimeMs === st.mtimeMs &&
        cached.size === st.size &&
        cached.rootId === root.id
      ) {
        return cached.meta
      }
      const resolved = await assertSessionPathInRoots([root], filePath)
      const meta = await buildSessionMeta(resolved, root, st)
      // 列表/删除/查看都按渲染层传回的原始路径定位，保持与 resolveSessionRoots 一致
      meta.filePath = filePath
      metaCache.set(key, { mtimeMs: st.mtimeMs, size: st.size, rootId: root.id, meta })
      return meta
    } catch {
      // 单个文件读失败或路径校验失败不影响整体列表
      return null
    }
  })

  return metas
    .filter((meta): meta is SessionMeta => meta !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

function recordTimestamp(rec: Record<string, unknown>): string {
  const ts = rec.timestamp
  if (typeof ts === 'string' && ts) return ts
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const date = new Date(ts)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return ''
}

function messageTimestamp(message: Record<string, unknown>): string {
  const ts = message.timestamp
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const date = new Date(ts)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return ''
}

function compactArgs(value: unknown): string {
  if (value === undefined || value === null) return ''
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? truncateText(json, TEXT_BLOCK_MAX) : ''
  } catch {
    return ''
  }
}

/** 只取阅读器会展示的 totalTokens，其余 usage 字段一律不进 IPC */
function normalizeTokens(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  return asNumber((value as Record<string, unknown>).totalTokens)
}

/**
 * 解析单条 message 记录为结构化消息。
 * 只拷贝展示所需字段，providerPayload / details / toolResult.details /
 * contextSnapshot / thinkingSignature 等大字段全部剥离。
 */
function parseSessionMessage(message: Record<string, unknown>, ts: string): SessionMessage {
  const role = asString(message.role) as SessionMessageRole
  const texts: string[] = []
  const thinkings: string[] = []
  const toolCalls: SessionToolCall[] = []
  const content = message.content

  if (typeof content === 'string') {
    const text = cleanDisplayText(stripAnsi(content))
    if (text) texts.push(truncateText(text, TEXT_BLOCK_MAX))
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue
      const block = item as Record<string, unknown>
      if (block.type === 'text') {
        const text = cleanDisplayText(stripAnsi(asString(block.text)))
        if (text) texts.push(truncateText(text, TEXT_BLOCK_MAX))
      } else if (block.type === 'thinking') {
        const thinking = cleanDisplayText(
          stripAnsi(asString(block.thinking) || asString(block.text))
        )
        if (thinking) thinkings.push(truncateText(thinking, TEXT_BLOCK_MAX))
      } else if (block.type === 'toolCall') {
        toolCalls.push({
          id: asString(block.id),
          name: asString(block.name) || '未知工具',
          args: compactArgs(block.arguments ?? block.args)
        })
      }
    }
  }

  const result: SessionMessage = {
    role,
    text: texts.join('\n'),
    ts: ts || messageTimestamp(message)
  }
  if (thinkings.length) result.thinking = thinkings.join('\n')
  if (toolCalls.length) result.toolCalls = toolCalls

  if (role === 'toolResult') {
    result.toolCallId = asString(message.toolCallId)
    result.toolName = asString(message.toolName) || '未知工具'
    result.isError = message.isError === true
  }
  if (role === 'assistant') {
    const tokens = normalizeTokens(message.usage)
    if (tokens > 0) result.tokens = tokens
    const model = normalizeMessageModel(message)
    if (model) result.model = model
    const stopReason = asString(message.stopReason)
    const errorMessage = asString(message.errorMessage)
    if (errorMessage || stopReason === 'error' || stopReason === 'aborted') {
      result.errorMessage = errorMessage || `${stopReason}（未提供错误详情）`
    }
  }
  return result
}

/**
 * 按需加载结构化全文：整文件读（上限 24MB，超出截断），逐行解析 type:message 记录，
 * 同时汇总消息/工具/错误计数、tokens、模型与起止时间。
 */
export async function loadTranscript(filePath: string): Promise<SessionTranscript> {
  const resolved = await assertSessionPath(filePath)
  const st = await lstat(resolved)
  const truncated = st.size > TRANSCRIPT_MAX_BYTES
  const content = truncated
    ? await readHead(resolved, TRANSCRIPT_MAX_BYTES)
    : await readFile(resolved, 'utf-8')
  const lines = content.split('\n')
  if (truncated) lines.pop() // 截断处最后一行通常残破

  const messages: SessionMessage[] = []
  const stats: SessionStats = {
    messages: 0,
    questions: 0,
    toolCalls: 0,
    errors: 0,
    totalTokens: 0,
    models: [],
    startedAt: '',
    endedAt: ''
  }
  const models = new Set<string>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec: unknown
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof rec !== 'object' || rec === null) continue
    const record = rec as Record<string, unknown>
    const ts = recordTimestamp(record)
    if (ts && !stats.startedAt) stats.startedAt = ts
    if (ts) stats.endedAt = ts

    if (record.type === 'model_change') {
      const model = normalizeModelChange(record)
      if (model) models.add(model)
      continue
    }
    if (record.type !== 'message') continue
    const raw = record.message
    if (typeof raw !== 'object' || raw === null) continue
    const rawMessage = raw as Record<string, unknown>
    const role = asString(rawMessage.role)
    if (role !== 'user' && role !== 'assistant' && role !== 'toolResult') continue

    const message = parseSessionMessage(rawMessage, ts)
    messages.push(message)
    stats.messages++
    if (role === 'user') stats.questions++
    stats.toolCalls += message.toolCalls?.length ?? 0
    if (message.errorMessage) stats.errors++
    if (role === 'toolResult' && message.isError) stats.errors++
    stats.totalTokens += message.tokens ?? 0
    if (message.model) models.add(message.model)
  }

  stats.models = [...models]
  return { filePath: resolved, messages, stats, truncated }
}

/** Resolve the existing working directory recorded inside a validated session file. */
export async function resolveSessionWorkingDirectory(filePath: string): Promise<string> {
  const resolvedSession = await assertSessionPath(filePath)
  const meta = await readSessionMeta(resolvedSession)
  const expanded = meta.cwd ? expandTilde(meta.cwd.trim()) : ''
  if (!expanded || !isAbsolute(expanded)) {
    throw new Error('Session does not contain a valid absolute working directory')
  }

  const workingDirectory = normalizeId(expanded)
  const workingDirectoryStat = await stat(workingDirectory)
  if (!workingDirectoryStat.isDirectory()) {
    throw new Error(`Session working directory does not exist: ${workingDirectory}`)
  }
  return normalizeId(await realpath(workingDirectory))
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
  // Validate every path before mutating the filesystem. A top-level session can own a same-name
  // log directory containing nested .jsonl sessions; deleting it first must not make validation of
  // another selected nested session fail with ENOENT. Canonical paths also collapse root aliases.
  const resolvedPaths = [
    ...new Set(await Promise.all(filePaths.map((path) => assertSessionPathInRoots(roots, path))))
  ]
  for (const path of [...filePaths, ...resolvedPaths]) metaCache.delete(normalizeId(path))

  for (const resolved of resolvedPaths) {
    await rm(resolved, { force: true })

    const logDir = await resolveSafeSessionLogDir(roots, resolved.replace(/\.jsonl$/i, ''))
    if (logDir) await rm(logDir, { recursive: true, force: true })

    const parent = dirname(resolved)
    if (!rootIds.has(normalizeId(parent))) {
      const remaining = await readdir(parent).catch(() => null)
      // rmdir only removes an empty parent and never recursively removes a session root.
      if (remaining && remaining.length === 0) await rmdir(parent).catch(() => {})
    }
  }
  return { deleted: resolvedPaths.length }
}

/** 校验会话路径合法（供 ipc show-in-folder 复用） */
export async function resolveSafeSessionPath(filePath: string): Promise<string> {
  return assertSessionPath(filePath)
}
