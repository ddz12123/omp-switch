import { copyFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import type { AppConfig, AppConfigResult } from '../shared/types'
import { readTextFile, writeTextFileSafe } from './lib/fileio'

/**
 * 本应用自身的配置目录（与 CLI 的 ~/.omp、~/.pi 分离）。
 * 默认 ~/.omp-switch；用户可自定义目录，自定义路径记录在默认目录的
 * config-dir 指针文件里（指针必须在固定位置，否则启动时无从查找）。
 */
export const DEFAULT_CONFIG_DIR = join(homedir(), '.omp-switch')
const POINTER_PATH = join(DEFAULT_CONFIG_DIR, 'config-dir')

let cachedDir: string | null = null

export class InvalidAppConfigError extends Error {
  constructor(
    readonly path: string,
    readonly detail: string
  ) {
    super(`应用配置已损坏，已阻止覆盖：${path}\n${detail}`)
    this.name = 'InvalidAppConfigError'
  }
}

function parseAppConfig(raw: string, path: string): AppConfig {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('配置根节点必须是 JSON 对象')
    }
    return parsed as AppConfig
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new InvalidAppConfigError(path, detail)
  }
}

/** 解析实际配置目录：有指针用指针，否则用默认目录。 */
async function resolveConfigDir(): Promise<string> {
  if (cachedDir) return cachedDir
  const pointer = (await readTextFile(POINTER_PATH))?.trim()
  cachedDir = pointer || DEFAULT_CONFIG_DIR
  return cachedDir
}

/** 当前配置目录（skills 默认存储位置等派生路径用）。 */
export async function getConfigDir(): Promise<string> {
  return resolveConfigDir()
}

export async function getAppConfigPath(): Promise<string> {
  return join(await resolveConfigDir(), 'config.json')
}

/**
 * 主进程内部读取：损坏配置会抛错，确保任何依赖应用配置的写操作都不会把它当成空配置。
 */
export async function readAppConfig(): Promise<AppConfig> {
  const path = await getAppConfigPath()
  const raw = await readTextFile(path)
  return raw === null ? {} : parseAppConfig(raw, path)
}

/** Renderer 使用的带恢复状态读取结果。 */
export async function inspectAppConfig(): Promise<AppConfigResult> {
  const path = await getAppConfigPath()
  const raw = await readTextFile(path)
  if (raw === null) return { status: 'missing', path, config: {} }

  try {
    return { status: 'ok', path, config: parseAppConfig(raw, path) }
  } catch (error) {
    if (!(error instanceof InvalidAppConfigError)) throw error

    const backupPath = `${path}.bak`
    const backupRaw = await readTextFile(backupPath)
    let backupAvailable = false
    let backupError: string | undefined
    if (backupRaw !== null) {
      try {
        parseAppConfig(backupRaw, backupPath)
        backupAvailable = true
      } catch (backupParseError) {
        backupError =
          backupParseError instanceof Error ? backupParseError.message : String(backupParseError)
      }
    }

    return {
      status: 'invalid',
      path,
      config: {},
      error: error.detail,
      backupAvailable,
      backupPath: backupRaw === null ? undefined : backupPath,
      backupError
    }
  }
}

/** 正常保存禁止覆盖损坏文件；恢复/重置必须走显式 API。 */
export async function writeAppConfig(config: AppConfig): Promise<void> {
  const path = await getAppConfigPath()
  const current = await readTextFile(path)
  if (current !== null) parseAppConfig(current, path)
  await writeTextFileSafe(path, `${JSON.stringify(config, null, 2)}\n`)
}

function corruptSnapshotPath(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${path}.corrupt-${stamp}-${randomUUID()}`
}

async function preserveCorruptConfig(path: string): Promise<string | null> {
  try {
    const snapshot = corruptSnapshotPath(path)
    await copyFile(path, snapshot)
    return snapshot
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

async function assertInvalidConfigExists(path: string): Promise<void> {
  const raw = await readTextFile(path)
  if (raw === null) throw new Error(`当前应用配置不存在，无法执行损坏配置恢复：${path}`)
  try {
    parseAppConfig(raw, path)
  } catch (error) {
    if (error instanceof InvalidAppConfigError) return
    throw error
  }
  throw new Error('当前应用配置是有效的，无需恢复或重置')
}
/** 从校验通过的 .bak 恢复；当前损坏内容另存为时间戳快照。 */
export async function restoreAppConfigBackup(): Promise<AppConfigResult> {
  const path = await getAppConfigPath()
  await assertInvalidConfigExists(path)
  const backupPath = `${path}.bak`
  const backupRaw = await readTextFile(backupPath)
  if (backupRaw === null) throw new Error(`未找到应用配置备份：${backupPath}`)
  parseAppConfig(backupRaw, backupPath)
  await preserveCorruptConfig(path)
  await writeTextFileSafe(path, backupRaw.endsWith('\n') ? backupRaw : `${backupRaw}\n`, {
    backup: false
  })
  return inspectAppConfig()
}

/** 明确重置损坏配置；重置前保留时间戳快照，避免数据不可恢复。 */
export async function resetInvalidAppConfig(): Promise<AppConfigResult> {
  const path = await getAppConfigPath()
  await assertInvalidConfigExists(path)
  await preserveCorruptConfig(path)
  await writeTextFileSafe(path, '{}\n', { backup: false })
  return inspectAppConfig()
}

/**
 * 更改配置目录：先把配置完整写入目标目录并更新指针，全部成功后才更新进程缓存。
 * 旧目录文件保留不删。
 */
export async function changeConfigDir(newDir: string): Promise<string> {
  const config = await readAppConfig()
  const path = join(newDir, 'config.json')

  const existing = await readTextFile(path)
  if (existing !== null) parseAppConfig(existing, path)
  await writeTextFileSafe(path, `${JSON.stringify(config, null, 2)}\n`)

  if (newDir === DEFAULT_CONFIG_DIR) {
    await rm(POINTER_PATH, { force: true })
  } else {
    await writeTextFileSafe(POINTER_PATH, `${newDir}\n`)
  }

  cachedDir = newDir
  return path
}
