import type { FetchRemoteModelsPayload } from '../shared/api'

const TIMEOUT_MS = 15_000

/**
 * 请求供应商的 /models 接口，返回模型 id 列表。
 * 兼容 OpenAI（{ data: [{ id }] }）与 Anthropic（同构）格式。
 */
export async function fetchRemoteModels(payload: FetchRemoteModelsPayload): Promise<string[]> {
  const base = payload.baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(base)) throw new Error('Base URL 必须以 http(s):// 开头')
  // 末尾已带版本号（如 /v1）直接拼 /models，否则补全 /v1/models
  const url = /\/v\d+$/i.test(base) ? `${base}/models` : `${base}/v1/models`

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (payload.apiKey) {
    headers.Authorization = `Bearer ${payload.apiKey}`
    if (payload.api === 'anthropic-messages') {
      headers['x-api-key'] = payload.apiKey
      headers['anthropic-version'] = '2023-06-01'
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}（${url}）`)
    const body = (await res.json()) as { data?: unknown; models?: unknown }
    const raw = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : []
    const ids = raw
      .map((item) =>
        typeof item === 'string' ? item : ((item as { id?: unknown }).id as string | undefined)
      )
      .filter((id): id is string => typeof id === 'string' && id !== '')
    if (ids.length === 0) throw new Error('接口未返回模型列表，请确认 Base URL 与 API Key')
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`请求超时（${TIMEOUT_MS / 1000}s）：${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
