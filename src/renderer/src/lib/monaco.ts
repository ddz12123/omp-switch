export type MonacoLanguage = 'json' | 'yaml' | 'markdown' | 'plaintext'
export type MonacoModule = typeof import('monaco-editor/editor/editor.api.js')

let workerSetup: Promise<void> | null = null
let monacoPromise: Promise<MonacoModule> | null = null
const languagePromises = new Map<MonacoLanguage, Promise<void>>()

/**
 * Monaco 只在编辑器真正挂载时加载；避免入口 bundle 引入全部语言和 TS/HTML/CSS worker。
 * 当前应用只需要 JSON、YAML、Markdown 与纯文本。
 */
async function setupWorkers(): Promise<void> {
  if (!workerSetup) {
    workerSetup = Promise.all([
      import('monaco-editor/editor/editor.worker.js?worker'),
      import('monaco-editor/language/json/json.worker.js?worker')
    ])
      .then(([editorWorkerModule, jsonWorkerModule]) => {
        const EditorWorker = editorWorkerModule.default
        const JsonWorker = jsonWorkerModule.default
        const target = self as typeof self & {
          MonacoEnvironment?: {
            getWorker(workerId: string, label: string): Worker
          }
        }

        target.MonacoEnvironment = {
          getWorker(_workerId: string, label: string): Worker {
            if (label === 'json') return new JsonWorker()
            return new EditorWorker()
          }
        }
      })
      .catch((error) => {
        workerSetup = null
        throw error
      })
  }
  return workerSetup
}

function loadLanguage(language: MonacoLanguage): Promise<void> {
  const existing = languagePromises.get(language)
  if (existing) return existing

  let promise: Promise<unknown>
  switch (language) {
    case 'json':
      promise = import('monaco-editor/language/json/monaco.contribution.js')
      break
    case 'yaml':
      promise = import('monaco-editor/languages/definitions/yaml/register.js')
      break
    case 'markdown':
      promise = import('monaco-editor/languages/definitions/markdown/register.js')
      break
    default:
      promise = Promise.resolve()
  }

  const ready = promise
    .then(() => undefined)
    .catch((error) => {
      languagePromises.delete(language)
      throw error
    })
  languagePromises.set(language, ready)
  return ready
}

export async function loadMonaco(language: MonacoLanguage): Promise<MonacoModule> {
  await setupWorkers()
  monacoPromise ??= import('monaco-editor/editor/editor.api.js').catch((error) => {
    monacoPromise = null
    throw error
  })
  const monaco = await monacoPromise
  await loadLanguage(language)
  return monaco
}
