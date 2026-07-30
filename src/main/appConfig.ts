import { homedir } from 'os'
import { join } from 'path'
import { rm } from 'fs/promises'
import type { AppConfig } from '../shared/types'
import { readTextFile, writeTextFileSafe } from './lib/fileio'

/**
 * 本应用自身的配置目录（与 CLI 的 ~/.omp、~/.pi 分离）。
 * 默认 ~/.omp-switch；用户可自定义目录，自定义路径记录在默认目录的
 * config-dir 指针文件里（指针必须在固定位置，否则启动时无从查找）。
 */
export const DEFAULT_CONFIG_DIR = join(homedir(), '.omp-switch')
const POINTER_PATH = join(DEFAULT_CONFIG_DIR, 'config-dir')

let cachedDir: string | null = null

/** 解析实际配置目录：有指针用指针，否则用默认目录 */
async function resolveConfigDir(): Promise<string> {
  if (cachedDir) return cachedDir
  const pointer = (await readTextFile(POINTER_PATH))?.trim()
  cachedDir = pointer || DEFAULT_CONFIG_DIR
  return cachedDir
}

/** 当前配置目录（skills 默认存储位置等派生路径用） */
export async function getConfigDir(): Promise<string> {
  return resolveConfigDir()
}

export async function getAppConfigPath(): Promise<string> {
  return join(await resolveConfigDir(), 'config.json')
}

export async function readAppConfig(): Promise<AppConfig> {
  const raw = await readTextFile(await getAppConfigPath())
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as AppConfig) : {}
  } catch {
    // 损坏的 JSON 不阻塞启动；写入时会连同 .bak 一起覆盖
    return {}
  }
}

export async function writeAppConfig(config: AppConfig): Promise<void> {
  await writeTextFileSafe(await getAppConfigPath(), `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * 更改配置目录：把当前配置写入新目录，再更新指针。
 * 旧目录的文件保留不删（用户数据，宁多勿删）。返回新的 config.json 路径。
 */
export async function changeConfigDir(newDir: string): Promise<string> {
  const config = await readAppConfig()
  cachedDir = newDir
  const path = join(newDir, 'config.json')
  await writeTextFileSafe(path, `${JSON.stringify(config, null, 2)}\n`)
  if (newDir === DEFAULT_CONFIG_DIR) {
    // 改回默认位置就不需要指针了
    await rm(POINTER_PATH, { force: true })
  } else {
    await writeTextFileSafe(POINTER_PATH, `${newDir}\n`)
  }
  return path
}
