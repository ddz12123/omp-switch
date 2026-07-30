import { copyFile, mkdir, readFile, rename, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname } from 'path'

/** 读取文本文件，不存在时返回 null */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 安全写入：写前把旧文件备份为 `<file>.bak`，
 * 再通过「临时文件 + rename」原子替换，避免写一半损坏配置。
 */
export async function writeTextFileSafe(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (existsSync(path)) {
    await copyFile(path, `${path}.bak`)
  }
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, path)
}
