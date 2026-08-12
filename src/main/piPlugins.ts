import { spawn as nativeSpawn } from 'child_process'
import { copyFile, readdir, readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'path'
import crossSpawn from 'cross-spawn'
import type {
  PiLocalExtensionInfo,
  PiPluginInfo,
  PiPluginLoadState,
  PiPluginOperationEvent,
  PiPluginOperationKind,
  PiPluginResources,
  PiPluginSearchResult,
  PiPluginsListResult,
  PiPluginSourceKind
} from '../shared/types'
import { getAdapter } from './agents'
import { isPlainObject } from './agents/types'
import { isNodeErrorWithCode, readTextFile, writeTextFileSafe } from './lib/fileio'

const RESOURCE_KEYS = ['extensions', 'skills', 'prompts', 'themes'] as const
const LIST_TIMEOUT_MS = 30_000
const MUTATION_TIMEOUT_MS = 10 * 60_000
const REGISTRY_TIMEOUT_MS = 12_000
const MAX_COMMAND_OUTPUT = 1024 * 1024
const MAX_EVENT_CHUNK = 16 * 1024
const METADATA_FILE_LIMIT = 1024 * 1024
const UPDATE_CACHE_MS = 5 * 60_000
const ANSI_ESCAPE_PATTERN = new RegExp(
  String.raw`\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))`,
  'g'
)

interface PackageObject extends Record<string, unknown> {
  source: string
  autoload?: boolean
}

type PackageEntry = string | PackageObject

interface PackageRecord {
  source: string
  entry: PackageEntry
}

interface SettingsSnapshot {
  raw: string | null
  settings: Record<string, unknown>
  packages: PackageRecord[]
  warnings: string[]
}

interface CommandResult {
  stdout: string
  stderr: string
}

interface PluginMetadata {
  name: string
  version?: string
  description?: string
  author?: string
  license?: string
  homepage?: string
  repository?: string
  resources: PiPluginResources
}

interface LatestCacheEntry {
  expiresAt: number
  version?: string
  error?: string
}

export type PiPluginEventSink = (event: PiPluginOperationEvent) => void

class PiCommandError extends Error {
  readonly notFound: boolean

  constructor(message: string, notFound = false) {
    super(message)
    this.name = 'PiCommandError'
    this.notFound = notFound
  }
}

const latestVersionCache = new Map<string, LatestCacheEntry>()
let activeMutation: { kind: PiPluginOperationKind; source?: string } | null = null

function piPaths(): { settingsPath: string; agentDir: string; extensionsDir: string } {
  const settingsPath = getAdapter('pi').switchPath
  const agentDir = dirname(settingsPath)
  return { settingsPath, agentDir, extensionsDir: join(agentDir, 'extensions') }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '')
}

function appendOutput(current: string, chunk: string): string {
  const combined = current + chunk
  return combined.length > MAX_COMMAND_OUTPUT ? combined.slice(-MAX_COMMAND_OUTPUT) : combined
}

function emit(
  sink: PiPluginEventSink | undefined,
  event: Omit<PiPluginOperationEvent, 'message'> & { message: string }
): void {
  if (!sink) return
  sink({ ...event, message: stripAnsi(event.message).slice(-MAX_EVENT_CHUNK) })
}

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return
  if (process.platform === 'win32') {
    const { promise, resolve: resolveDone } = Promise.withResolvers<void>()
    const killer = nativeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    killer.once('error', () => resolveDone())
    killer.once('close', () => resolveDone())
    await promise
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process already exited.
    }
  }
}

function runPiCommand(
  args: string[],
  options: {
    timeoutMs: number
    kind?: PiPluginOperationKind
    source?: string
    sink?: PiPluginEventSink
  }
): Promise<CommandResult> {
  const { agentDir } = piPaths()
  const {
    promise,
    resolve: resolveDone,
    reject: rejectDone
  } = Promise.withResolvers<CommandResult>()
  const child = crossSpawn('pi', args, {
    cwd: agentDir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  let settled = false

  function finish(error?: Error): void {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (error) rejectDone(error)
    else resolveDone({ stdout, stderr })
  }

  const timer = setTimeout(() => {
    void terminateProcessTree(child.pid)
    finish(new PiCommandError(`pi 命令执行超时（${Math.round(options.timeoutMs / 1000)} 秒）`))
  }, options.timeoutMs)

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk)
    stdout = appendOutput(stdout, text)
    if (options.kind) {
      emit(options.sink, {
        kind: options.kind,
        source: options.source,
        status: 'output',
        stream: 'stdout',
        message: text
      })
    }
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk)
    stderr = appendOutput(stderr, text)
    if (options.kind) {
      emit(options.sink, {
        kind: options.kind,
        source: options.source,
        status: 'output',
        stream: 'stderr',
        message: text
      })
    }
  })
  child.once('error', (error: NodeJS.ErrnoException) => {
    const notFound = error.code === 'ENOENT'
    finish(
      new PiCommandError(
        notFound ? '未找到 pi 命令，请先安装 Pi 并确认它已加入 PATH' : error.message,
        notFound
      )
    )
  })
  child.once('close', (code, signal) => {
    if (settled) return
    if (code === 0 && signal === null) {
      finish()
      return
    }
    const detail = stripAnsi(stderr.trim() || stdout.trim())
    finish(
      new PiCommandError(
        detail || `pi 命令执行失败（${code !== null ? `退出码 ${code}` : `信号 ${signal}`}）`
      )
    )
  })

  return promise
}

async function runMutation<T>(
  kind: PiPluginOperationKind,
  source: string | undefined,
  sink: PiPluginEventSink | undefined,
  action: () => Promise<T>
): Promise<T> {
  if (activeMutation) {
    throw new Error(
      `已有插件操作正在执行：${activeMutation.kind}${activeMutation.source ? ` ${activeMutation.source}` : ''}`
    )
  }

  activeMutation = { kind, source }
  emit(sink, {
    kind,
    source,
    status: 'started',
    message: source ? `正在执行 ${kind}：${source}` : `正在执行 ${kind}`
  })
  try {
    const result = await action()
    emit(sink, { kind, source, status: 'completed', message: '操作完成' })
    return result
  } catch (error) {
    emit(sink, { kind, source, status: 'failed', message: errorMessage(error) })
    throw error
  } finally {
    activeMutation = null
  }
}

function parseSettings(raw: string | null, settingsPath: string): SettingsSnapshot {
  let settings: Record<string, unknown> = {}
  if (raw !== null && raw.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`Pi 配置 JSON 语法错误（${settingsPath}）：${errorMessage(error)}`)
    }
    if (!isPlainObject(parsed)) throw new Error(`Pi 配置根节点必须是对象：${settingsPath}`)
    settings = parsed
  }

  const warnings: string[] = []
  const packages: PackageRecord[] = []
  const value = settings.packages
  if (value !== undefined && !Array.isArray(value)) {
    warnings.push('settings.json 的 packages 不是数组，已跳过插件列表')
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string' && entry.trim()) {
        packages.push({ source: entry, entry })
        return
      }
      if (isPlainObject(entry) && typeof entry.source === 'string' && entry.source.trim()) {
        packages.push({ source: entry.source, entry: entry as PackageObject })
        return
      }
      warnings.push(`packages[${index}] 缺少有效 source，已跳过`)
    })
  }

  return { raw, settings, packages, warnings }
}

async function readSettingsSnapshot(): Promise<SettingsSnapshot> {
  const { settingsPath } = piPaths()
  return parseSettings(await readTextFile(settingsPath), settingsPath)
}

function sourceKind(source: string): PiPluginSourceKind {
  if (source.startsWith('npm:')) return 'npm'
  if (/^(?:git:|https?:\/\/|ssh:\/\/|git:\/\/)/i.test(source)) return 'git'
  return 'local'
}

function npmSourceParts(source: string): { name: string; version?: string } | null {
  if (!source.startsWith('npm:')) return null
  const spec = source.slice(4).trim()
  if (!spec) return null
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash <= 1) return null
    const versionAt = spec.lastIndexOf('@')
    return versionAt > slash
      ? { name: spec.slice(0, versionAt), version: spec.slice(versionAt + 1) }
      : { name: spec }
  }
  const versionAt = spec.lastIndexOf('@')
  return versionAt > 0
    ? { name: spec.slice(0, versionAt), version: spec.slice(versionAt + 1) }
    : { name: spec }
}

function isExactNpmVersion(version: string | undefined): boolean {
  return (
    version !== undefined &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  )
}

function isPinnedGitSource(source: string): boolean {
  const value = source.startsWith('git:') ? source.slice(4) : source
  const lastAt = value.lastIndexOf('@')
  const lastPathSeparator = Math.max(value.lastIndexOf('/'), value.lastIndexOf(':'))
  return lastAt > lastPathSeparator
}

function isPinnedSource(source: string, kind: PiPluginSourceKind): boolean {
  if (kind === 'npm') return isExactNpmVersion(npmSourceParts(source)?.version)
  return kind === 'git' && isPinnedGitSource(source)
}

function loadState(entry: PackageEntry): PiPluginLoadState {
  if (typeof entry === 'string') return 'enabled'
  if (RESOURCE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(entry, key))) return 'custom'
  return entry.autoload === false ? 'disabled' : 'enabled'
}

function emptyResources(): PiPluginResources {
  return { extensions: [], skills: [], prompts: [], themes: [] }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function authorField(value: unknown): string | undefined {
  if (typeof value === 'string') return textField(value)
  return isPlainObject(value) ? textField(value.name) : undefined
}

function repositoryField(value: unknown): string | undefined {
  const raw =
    typeof value === 'string' ? value : isPlainObject(value) ? textField(value.url) : undefined
  if (!raw) return undefined
  return raw.replace(/^git\+/, '').replace(/\.git$/, '')
}

function fallbackName(source: string): string {
  const npm = npmSourceParts(source)
  if (npm) return npm.name
  const cleaned = source.replace(/[\\/]+$/, '')
  return basename(cleaned).replace(/\.git$/, '') || source
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > METADATA_FILE_LIMIT) return null
    const parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readPluginMetadata(path: string, source: string): Promise<PluginMetadata> {
  const fallback: PluginMetadata = { name: fallbackName(source), resources: emptyResources() }
  let info
  try {
    info = await stat(path)
  } catch {
    return fallback
  }

  if (info.isFile()) {
    if (['.ts', '.js'].includes(extname(path).toLowerCase())) {
      fallback.resources.extensions = [basename(path)]
    }
    return fallback
  }
  if (!info.isDirectory()) return fallback

  const pkg = await readJsonObject(join(path, 'package.json'))
  if (!pkg) {
    for (const key of RESOURCE_KEYS) {
      if (existsSync(join(path, key))) fallback.resources[key] = [`${key}/`]
    }
    return fallback
  }

  const resources = emptyResources()
  if (isPlainObject(pkg.pi)) {
    for (const key of RESOURCE_KEYS) resources[key] = stringArray(pkg.pi[key])
  } else {
    for (const key of RESOURCE_KEYS) {
      if (existsSync(join(path, key))) resources[key] = [`${key}/`]
    }
  }

  return {
    name: textField(pkg.name) ?? fallback.name,
    version: textField(pkg.version),
    description: textField(pkg.description),
    author: authorField(pkg.author),
    license: textField(pkg.license),
    homepage: textField(pkg.homepage),
    repository: repositoryField(pkg.repository),
    resources
  }
}

function parseListPaths(output: string): Map<string, string> {
  const paths = new Map<string, string>()
  let inUserPackages = false
  let source: string | null = null
  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line === 'User packages:') {
      inUserPackages = true
      source = null
      continue
    }
    if (line.endsWith('packages:') && line !== 'User packages:') {
      inUserPackages = false
      source = null
      continue
    }
    if (!inUserPackages || !line.trim()) continue
    if (/^ {2}\S/.test(line) && !/^ {4}/.test(line)) {
      source = line.trim()
      continue
    }
    if (source && /^ {4}\S/.test(line)) {
      paths.set(source, line.trim())
      source = null
    }
  }
  return paths
}

function fallbackInstalledPath(
  source: string,
  kind: PiPluginSourceKind,
  agentDir: string
): string | undefined {
  if (kind === 'npm') {
    const name = npmSourceParts(source)?.name
    return name ? join(agentDir, 'npm', 'node_modules', ...name.split('/')) : undefined
  }
  if (kind === 'local') return resolve(agentDir, source)
  return undefined
}

function normalizedPath(path: string): string {
  const resolved = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function inspectLocalExtension(
  path: string,
  origin: PiLocalExtensionInfo['origin']
): Promise<PiLocalExtensionInfo> {
  const base: PiLocalExtensionInfo = { path, name: basename(path), origin, valid: false }
  try {
    const info = await stat(path)
    if (info.isFile()) {
      if (['.ts', '.js'].includes(extname(path).toLowerCase())) {
        return { ...base, valid: true, entryPath: path }
      }
      return { ...base, issue: '只支持 .ts 或 .js 扩展入口' }
    }
    if (!info.isDirectory()) return { ...base, issue: '路径不是文件或目录' }

    for (const entry of ['index.ts', 'index.js']) {
      const entryPath = join(path, entry)
      if (existsSync(entryPath)) return { ...base, valid: true, entryPath }
    }
    return { ...base, issue: '目录中缺少 index.ts 或 index.js' }
  } catch (error) {
    return {
      ...base,
      issue: isNodeErrorWithCode(error, 'ENOENT') ? '路径不存在' : errorMessage(error)
    }
  }
}

async function listLocalExtensions(
  settings: Record<string, unknown>,
  warnings: string[]
): Promise<PiLocalExtensionInfo[]> {
  const { agentDir, extensionsDir } = piPaths()
  const extensions = new Map<string, PiLocalExtensionInfo>()
  try {
    const entries = await readdir(extensionsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && !['.ts', '.js'].includes(extname(entry.name).toLowerCase())) continue
      const path = join(extensionsDir, entry.name)
      const inspected = await inspectLocalExtension(path, 'auto')
      extensions.set(normalizedPath(path), inspected)
    }
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT'))
      warnings.push(`读取本地扩展目录失败：${errorMessage(error)}`)
  }

  if (settings.extensions !== undefined && !Array.isArray(settings.extensions)) {
    warnings.push('settings.json 的 extensions 不是数组，已跳过额外扩展路径')
  } else if (Array.isArray(settings.extensions)) {
    for (const value of settings.extensions) {
      if (typeof value !== 'string' || !value.trim()) {
        warnings.push('settings.extensions 中存在无效路径，已跳过')
        continue
      }
      const path = resolve(agentDir, value)
      const key = normalizedPath(path)
      if (!extensions.has(key)) extensions.set(key, await inspectLocalExtension(path, 'settings'))
    }
  }

  return [...extensions.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchLatestNpmVersion(packageName: string): Promise<LatestCacheEntry> {
  const cached = latestVersionCache.get(packageName)
  if (cached && cached.expiresAt > Date.now()) return cached

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)
  let result: LatestCacheEntry
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { headers: { Accept: 'application/json' }, signal: controller.signal }
    )
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    const body = (await response.json()) as { version?: unknown }
    const version = textField(body.version)
    if (!version) throw new Error('响应中缺少版本号')
    result = { expiresAt: Date.now() + UPDATE_CACHE_MS, version }
  } catch (error) {
    result = {
      expiresAt: Date.now() + Math.min(UPDATE_CACHE_MS, 30_000),
      error:
        error instanceof Error && error.name === 'AbortError'
          ? '请求 npm 超时'
          : errorMessage(error)
    }
  } finally {
    clearTimeout(timer)
  }
  latestVersionCache.set(packageName, result)
  return result
}

async function enrichNpmUpdates(plugins: PiPluginInfo[]): Promise<void> {
  const queue = plugins.filter(
    (plugin) => plugin.sourceKind === 'npm' && !plugin.pinned && plugin.installed
  )
  let cursor = 0
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (cursor < queue.length) {
      const plugin = queue[cursor++]
      const packageName = npmSourceParts(plugin.source)?.name
      if (!packageName) continue
      const latest = await fetchLatestNpmVersion(packageName)
      if (latest.error) {
        plugin.updateState = 'error'
        plugin.updateError = latest.error
      } else if (latest.version) {
        plugin.latestVersion = latest.version
        plugin.updateState = plugin.version === latest.version ? 'current' : 'available'
      }
    }
  })
  await Promise.all(workers)
}

export async function searchPiPlugins(query: string): Promise<PiPluginSearchResult> {
  const value = query.trim()
  if (!value) return { items: [], total: 0 }
  if (value.length > 100 || /[\0\r\n]/.test(value)) throw new Error('搜索关键词无效')

  const params = new URLSearchParams({ text: `${value} keywords:pi-package`, size: '20' })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)
  try {
    const response = await fetch(`https://registry.npmjs.org/-/v1/search?${params}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`npm Registry 返回 HTTP ${response.status}`)
    const body = (await response.json()) as unknown
    if (!isPlainObject(body) || !Array.isArray(body.objects)) {
      throw new Error('npm Registry 返回了无效数据')
    }

    const items = body.objects.flatMap((entry) => {
      if (!isPlainObject(entry) || !isPlainObject(entry.package)) return []
      const pkg = entry.package
      const name = textField(pkg.name)
      const version = textField(pkg.version)
      const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
      if (!name || !version || !keywords.includes('pi-package')) return []

      const publisher = isPlainObject(pkg.publisher) ? textField(pkg.publisher.username) : undefined
      const links = isPlainObject(pkg.links) ? pkg.links : {}
      const downloads = isPlainObject(entry.downloads) ? entry.downloads : {}
      return [
        {
          name,
          version,
          description: textField(pkg.description),
          publisher,
          license: textField(pkg.license),
          updatedAt: textField(pkg.date),
          weeklyDownloads:
            typeof downloads.weekly === 'number' && Number.isFinite(downloads.weekly)
              ? downloads.weekly
              : 0,
          homepage: textField(links.homepage),
          repository: textField(links.repository)
        }
      ]
    })

    items.sort((left, right) => Number(right.name === value) - Number(left.name === value))
    return { items, total: typeof body.total === 'number' ? body.total : items.length }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('搜索 npm 插件超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function listPiPlugins(checkUpdates = false): Promise<PiPluginsListResult> {
  const { settingsPath, agentDir } = piPaths()
  const snapshot = await readSettingsSnapshot()
  const warnings = [...snapshot.warnings]
  let cliInstalled = true
  let installedPaths = new Map<string, string>()

  try {
    const result = await runPiCommand(['list', '--no-approve'], { timeoutMs: LIST_TIMEOUT_MS })
    installedPaths = parseListPaths(result.stdout)
  } catch (error) {
    cliInstalled = !(error instanceof PiCommandError && error.notFound)
    warnings.push(errorMessage(error))
  }

  const plugins: PiPluginInfo[] = []
  for (const record of snapshot.packages) {
    const kind = sourceKind(record.source)
    const pinned = isPinnedSource(record.source, kind)
    const installedPath =
      installedPaths.get(record.source) ?? fallbackInstalledPath(record.source, kind, agentDir)
    const installed = installedPath !== undefined && existsSync(installedPath)
    const metadata = installedPath
      ? await readPluginMetadata(installedPath, record.source)
      : { name: fallbackName(record.source), resources: emptyResources() }
    plugins.push({
      source: record.source,
      sourceKind: kind,
      loadState: loadState(record.entry),
      pinned,
      installed,
      installedPath,
      ...metadata,
      updateState: pinned ? 'pinned' : kind === 'local' ? 'unsupported' : 'unknown'
    })
  }

  if (checkUpdates) await enrichNpmUpdates(plugins)

  return {
    settingsPath,
    agentDir,
    cliInstalled,
    plugins,
    localExtensions: await listLocalExtensions(snapshot.settings, warnings),
    warnings
  }
}

function assertInstallSource(source: string): string {
  const value = source.trim()
  if (!value) throw new Error('请输入插件来源')
  if (value.length > 2048) throw new Error('插件来源过长')
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('插件来源包含非法控制字符')
  }

  const kind = sourceKind(value)
  if (kind === 'npm') {
    const parts = npmSourceParts(value)
    if (!parts || !/^(?:@[a-zA-Z0-9._~-]+\/)?[a-zA-Z0-9._~-]+$/.test(parts.name)) {
      throw new Error('npm 插件格式无效，请使用 npm:package 或 npm:@scope/package')
    }
    if (parts.version !== undefined && !parts.version.trim()) throw new Error('npm 版本不能为空')
    return value
  }
  if (kind === 'git') return value
  if (!isAbsolute(value)) throw new Error('本地插件必须使用绝对路径')
  if (!existsSync(value)) throw new Error('本地插件路径不存在')
  return value
}

async function backupPiSettings(): Promise<void> {
  const { settingsPath } = piPaths()
  try {
    await copyFile(settingsPath, `${settingsPath}.bak`)
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
  }
}

async function configuredPackage(source: string): Promise<PackageRecord> {
  if (
    !source ||
    source.length > 2048 ||
    source.startsWith('-') ||
    source.includes('\0') ||
    source.includes('\r') ||
    source.includes('\n')
  ) {
    throw new Error('插件来源包含非法参数')
  }
  const snapshot = await readSettingsSnapshot()
  const record = snapshot.packages.find((plugin) => plugin.source === source)
  if (!record) throw new Error(`未找到已配置插件：${source}`)
  return record
}

export async function installPiPlugin(source: string, sink?: PiPluginEventSink): Promise<void> {
  const value = assertInstallSource(source)
  await runMutation('install', value, sink, async () => {
    await backupPiSettings()
    await runPiCommand(['install', value, '--no-approve'], {
      timeoutMs: MUTATION_TIMEOUT_MS,
      kind: 'install',
      source: value,
      sink
    })
  })
}

export async function updatePiPlugin(source: string, sink?: PiPluginEventSink): Promise<void> {
  await configuredPackage(source)
  const kind = sourceKind(source)
  if (kind === 'local') throw new Error('本地路径插件不支持更新')
  if (isPinnedSource(source, kind)) throw new Error('该插件已固定版本或 Git 引用，不能自动更新')

  await runMutation('update', source, sink, async () => {
    await backupPiSettings()
    await runPiCommand(['update', '--extension', source, '--no-approve'], {
      timeoutMs: MUTATION_TIMEOUT_MS,
      kind: 'update',
      source,
      sink
    })
    const packageName = npmSourceParts(source)?.name
    if (packageName) latestVersionCache.delete(packageName)
  })
}

export async function updateAllPiPlugins(sink?: PiPluginEventSink): Promise<void> {
  await runMutation('update-all', undefined, sink, async () => {
    await backupPiSettings()
    await runPiCommand(['update', '--extensions', '--no-approve'], {
      timeoutMs: MUTATION_TIMEOUT_MS,
      kind: 'update-all',
      sink
    })
    latestVersionCache.clear()
  })
}

export async function removePiPlugin(source: string, sink?: PiPluginEventSink): Promise<void> {
  await configuredPackage(source)
  await runMutation('remove', source, sink, async () => {
    await backupPiSettings()
    await runPiCommand(['remove', source, '--no-approve'], {
      timeoutMs: MUTATION_TIMEOUT_MS,
      kind: 'remove',
      source,
      sink
    })
    const packageName = npmSourceParts(source)?.name
    if (packageName) latestVersionCache.delete(packageName)
  })
}

export async function setPiPluginEnabled(
  source: string,
  enabled: boolean,
  sink?: PiPluginEventSink
): Promise<void> {
  await runMutation('toggle', source, sink, async () => {
    const { settingsPath } = piPaths()
    const snapshot = await readSettingsSnapshot()
    if (!Array.isArray(snapshot.settings.packages))
      throw new Error('settings.json 的 packages 不是数组')
    const index = snapshot.settings.packages.findIndex((entry) => {
      if (typeof entry === 'string') return entry === source
      return isPlainObject(entry) && entry.source === source
    })
    if (index < 0) throw new Error(`未找到已配置插件：${source}`)

    const current = snapshot.settings.packages[index]
    const state =
      typeof current === 'string'
        ? 'enabled'
        : isPlainObject(current) && typeof current.source === 'string'
          ? loadState(current as PackageObject)
          : 'custom'
    if (state === 'custom') {
      throw new Error('该插件使用了自定义资源过滤，请在原始配置中调整')
    }
    if ((enabled && state === 'enabled') || (!enabled && state === 'disabled')) return

    if (enabled) {
      if (typeof current === 'string') return
      const next = { ...current }
      delete next.autoload
      snapshot.settings.packages[index] = next
    } else {
      snapshot.settings.packages[index] =
        typeof current === 'string'
          ? { source: current, autoload: false }
          : { ...current, autoload: false }
    }

    const latestRaw = await readTextFile(settingsPath)
    if (latestRaw !== snapshot.raw) throw new Error('Pi 配置已被外部修改，请刷新后重试')
    await writeTextFileSafe(settingsPath, `${JSON.stringify(snapshot.settings, null, 2)}\n`)
  })
}

export async function getPiPluginPath(source: string): Promise<string> {
  const result = await listPiPlugins(false)
  const plugin = result.plugins.find((item) => item.source === source)
  if (!plugin?.installedPath || !existsSync(plugin.installedPath)) {
    throw new Error(`找不到插件安装目录：${source}`)
  }
  return plugin.installedPath
}

export async function getPiLocalExtensionPath(path: string): Promise<string> {
  const result = await listPiPlugins(false)
  const target = normalizedPath(path)
  const extension = result.localExtensions.find((item) => normalizedPath(item.path) === target)
  if (!extension) throw new Error('该本地扩展不在 Pi 的受管目录或配置中')
  return extension.path
}
