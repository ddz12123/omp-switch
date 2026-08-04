import { lstat, rename, rm, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, resolve } from 'path'
import { setTimeout as delay } from 'timers/promises'

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function isMissing(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT'
}

function shouldRetryRename(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY')
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(source, target)
      return
    } catch (error) {
      lastError = error
      if (!shouldRetryRename(error) || attempt === 4) throw error
      await delay(25 * 2 ** attempt)
    }
  }
  throw lastError
}

/** Removes a path without following directory symlinks or Windows junctions. */
export async function removePathNoFollow(path: string): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(path)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }

  if (stats.isSymbolicLink()) {
    try {
      await unlink(path)
    } catch (error) {
      if (isMissing(error)) return
      // Directory junctions can require directory-style removal on Windows.
      await rm(path, { recursive: false, force: true })
    }
    return
  }

  if (stats.isDirectory()) {
    await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    return
  }

  await unlink(path).catch((error: unknown) => {
    if (!isMissing(error)) throw error
  })
}

export interface AtomicPathSwap {
  /** Restore the previous target, or remove the newly installed target if none existed. */
  rollback(): Promise<void>
  /** Permanently remove the retained backup after the surrounding transaction commits. */
  finalize(): Promise<void>
}

/**
 * Replaces a file-system path using sibling renames so it works on Windows, where rename cannot
 * overwrite a non-empty directory. The previous target is retained until finalize() is called.
 */
export async function replacePreparedPath(
  preparedPath: string,
  targetPath: string
): Promise<AtomicPathSwap> {
  const prepared = resolve(preparedPath)
  const target = resolve(targetPath)
  if (prepared === target || dirname(prepared) !== dirname(target)) {
    throw new Error('Prepared and target paths must be different siblings')
  }
  if (!(await pathExists(prepared))) {
    throw new Error(`Prepared path does not exist: ${prepared}`)
  }

  const suffix = `${process.pid}-${randomUUID()}`
  const backup = resolve(dirname(target), `.omp-switch-${basename(target)}-backup-${suffix}`)
  const discarded = resolve(dirname(target), `.omp-switch-${basename(target)}-rollback-${suffix}`)
  const hadTarget = await pathExists(target)

  if (hadTarget) await renameWithRetry(target, backup)
  try {
    await renameWithRetry(prepared, target)
  } catch (error) {
    if (hadTarget) {
      try {
        await renameWithRetry(backup, target)
      } catch (restoreError) {
        throw new Error(
          `Failed to install prepared directory and restore the previous directory: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
          { cause: error }
        )
      }
    }
    throw error
  }

  let active = true
  return {
    async rollback(): Promise<void> {
      if (!active) return
      if (!hadTarget) {
        await removePathNoFollow(target)
        active = false
        return
      }

      let movedCurrent = false
      try {
        if (await pathExists(target)) {
          await renameWithRetry(target, discarded)
          movedCurrent = true
        }
        await renameWithRetry(backup, target)
        if (movedCurrent) await removePathNoFollow(discarded)
        active = false
      } catch (error) {
        // If restoration failed after moving the new directory aside, put the new directory back.
        if (movedCurrent && !(await pathExists(target)) && (await pathExists(discarded))) {
          await renameWithRetry(discarded, target).catch(() => {})
        }
        throw error
      }
    },
    async finalize(): Promise<void> {
      if (!active) return
      if (hadTarget) await removePathNoFollow(backup)
      active = false
    }
  }
}
