import * as monaco from 'monaco-editor'
// monaco-editor 0.56+ 的 exports 映射为 `./*` -> `./esm/vs/*`，深路径不能再带 esm/vs 前缀
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'

/**
 * Monaco 编辑器 worker 注册（Vite `?worker` 方式打包，离线可用）。
 * json 文件走 json worker 获得校验/补全；yaml 只有语法高亮，用基础 worker 即可。
 */
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  }
}

export { monaco }
