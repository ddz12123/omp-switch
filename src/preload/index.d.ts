import type { PreloadApi } from '../shared/api'

declare global {
  interface Window {
    api: PreloadApi
  }
}
