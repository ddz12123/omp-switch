import { Script } from 'node:vm'
import type { FetchProviderUsagePayload } from '../shared/api'
import type { ProviderUsageResult } from '../shared/types'

const DEFAULT_TIMEOUT_MS = 15_000

type UsageScript = {
  request: { url: string; method?: string; headers?: Record<string, string>; body?: string }
  extractor: (response: unknown) => unknown
}

function interpolate(script: string, variables: Record<string, string>): string {
  return script.replace(/{{(apiKey|baseUrl|accessToken|userId)}}/g, (_, key: string) =>
    (variables[key] ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  )
}

function parseScript(payload: FetchProviderUsagePayload): UsageScript {
  let parsed: unknown
  try {
    parsed = new Script(`(${interpolate(payload.script, payload.variables)})`).runInNewContext(
      Object.create(null),
      { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } }
    )
  } catch (error) {
    throw new Error(`脚本语法错误：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('脚本必须返回包含 request 和 extractor 的对象')
  const candidate = parsed as Partial<UsageScript>
  if (!candidate.request || typeof candidate.request.url !== 'string' || !candidate.request.url.trim()) {
    throw new Error('脚本 request.url 不能为空')
  }
  if (typeof candidate.extractor !== 'function') throw new Error('脚本必须提供 extractor(response) 函数')
  return candidate as UsageScript
}

/** 在隔离 VM 中解析本地用户脚本，再执行其声明的 HTTP 请求。 */
export async function fetchProviderUsage(
  payload: FetchProviderUsagePayload
): Promise<ProviderUsageResult> {
  const script = parseScript(payload)
  const url = script.request.url.trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('请求地址必须以 http(s):// 开头')
  const timeoutSeconds = payload.timeoutSeconds ?? DEFAULT_TIMEOUT_MS / 1000
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 120) {
    throw new Error('超时时间必须在 1 到 120 秒之间')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  try {
    const response = await fetch(url, {
      method: script.request.method ?? 'GET',
      headers: { Accept: 'application/json', ...script.request.headers },
      body: script.request.body,
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}（${url}）`)
    const data: unknown = await response.json().catch(() => {
      throw new Error(`接口未返回 JSON（${url}）`)
    })
    return { url, data, extracted: script.extractor(data) }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutSeconds}s）：${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
