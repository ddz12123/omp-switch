import type { IpcMainEvent, IpcMainInvokeEvent, WebFrameMain } from 'electron'
import { fileURLToPath } from 'url'
import { normalize, resolve } from 'path'

let trustedRendererUrl: URL | null = null

function sameFilePath(left: URL, right: URL): boolean {
  const normalizeFile = (value: URL): string => {
    const path = normalize(resolve(fileURLToPath(value)))
    return process.platform === 'win32' ? path.toLowerCase() : path
  }
  return normalizeFile(left) === normalizeFile(right)
}

/** Configure the single top-level renderer entry that may use privileged IPC. */
export function configureTrustedRendererUrl(rawUrl: string): void {
  trustedRendererUrl = new URL(rawUrl)
}

/** Only regular HTTP(S) links may leave the application. */
export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

/** Restrict top-level navigation to the configured renderer entry/origin. */
export function isTrustedRendererUrl(rawUrl: string): boolean {
  if (!trustedRendererUrl) return false
  try {
    const candidate = new URL(rawUrl)
    if (trustedRendererUrl.protocol === 'file:') {
      return candidate.protocol === 'file:' && sameFilePath(candidate, trustedRendererUrl)
    }
    return (
      candidate.protocol === trustedRendererUrl.protocol &&
      candidate.origin === trustedRendererUrl.origin &&
      candidate.pathname === trustedRendererUrl.pathname
    )
  } catch {
    return false
  }
}

export function isTrustedRendererFrame(frame: WebFrameMain | null): boolean {
  return frame !== null && frame.parent === null && isTrustedRendererUrl(frame.url)
}

/** Reusable guard for privileged ipcMain handlers. */
export function assertTrustedIpcSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  if (!isTrustedRendererFrame(event.senderFrame) || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Rejected IPC message from an untrusted renderer frame')
  }
}
