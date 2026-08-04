import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'

interface NodeError extends Error {
  code?: string
}

export function isNodeErrorWithCode(error: unknown, code: string): error is NodeError {
  return error instanceof Error && 'code' in error && (error as NodeError).code === code
}

/** 读取文本文件；只有文件确实不存在（ENOENT）时返回 null，其余 I/O 错误原样抛出。 */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null
    throw error
  }
}

export interface SafeWriteOptions {
  /** 写入前是否把现有文件复制为 `<file>.bak`，默认 true。 */
  backup?: boolean
}

/**
 * 安全写入：默认先把旧文件备份为 `<file>.bak`，再通过同目录临时文件 + rename
 * 原子替换。临时文件使用随机后缀，写入或替换失败时会尽力清理。
 */
export async function writeTextFileSafe(
  path: string,
  content: string,
  options: SafeWriteOptions = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })

  if (options.backup !== false) {
    try {
      await copyFile(path, `${path}.bak`)
    } catch (error) {
      if (!isNodeErrorWithCode(error, 'ENOENT')) throw error
    }
  }

  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, path)
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}
