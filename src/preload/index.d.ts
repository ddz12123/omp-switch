import { ElectronAPI } from '@electron-toolkit/preload'
import type { PreloadApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: PreloadApi
  }
}
