import type { PreloadApi } from '../shared/api'

/**
 * 渲染进程可调用的 API 契约统一由 PreloadApi 声明：
 * 会话模块新增的 sessionTranscript 对应主进程 IPC 通道 sessions:transcript，
 * 类型随 PreloadApi 自动生效。
 */
declare global {
  interface Window {
    api: PreloadApi
  }
}
