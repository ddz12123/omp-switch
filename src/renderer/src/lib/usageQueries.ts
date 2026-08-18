import type { AgentId, Provider, ProviderUsageResult, UsageQueryConfig } from '@shared/types'
import { useApp } from '../stores/app'
import { getUsageEndpoint } from './usageEndpoints'

const CUSTOM_SCRIPT = `({
  request: {
    url: "",
    method: "GET",
    headers: {}
  },
  extractor: function (response) {
    return {
      remaining: 0,
      unit: "USD"
    }
  }
})`

const GENERAL_SCRIPT = `({
  request: {
    url: "{{baseUrl}}/user/balance",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}"
    }
  },
  extractor: function (response) {
    return {
      isValid: response.is_active || true,
      remaining: response.balance,
      unit: "USD"
    }
  }
})`

const NEWAPI_SCRIPT = `({
  request: {
    url: "{{baseUrl}}/api/user/self",
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer {{accessToken}}",
      "New-Api-User": "{{userId}}"
    }
  },
  extractor: function (response) {
    if (response.success && response.data) {
      return {
        planName: response.data.group || "默认套餐",
        remaining: response.data.quota / 500000,
        used: response.data.used_quota / 500000,
        total: (response.data.quota + response.data.used_quota) / 500000,
        unit: "USD"
      }
    }
    return { isValid: false, invalidMessage: response.message || "查询失败" }
  }
})`

export const USAGE_PRESETS = {
  custom: CUSTOM_SCRIPT,
  general: GENERAL_SCRIPT,
  newapi: NEWAPI_SCRIPT
} as const

export function defaultUsageQuery(provider: Provider): UsageQueryConfig {
  return {
    enabled: false,
    preset: 'custom',
    baseUrl: provider.baseUrl ?? '',
    timeoutSeconds: 10,
    intervalMinutes: 30,
    script: CUSTOM_SCRIPT
  }
}

function keyOf(agent: AgentId, name: string): string {
  return `${agent}/${name}`
}

export function getUsageQuery(agent: AgentId, name: string, provider: Provider): UsageQueryConfig {
  const saved = useApp.getState().usageQueries[keyOf(agent, name)]
  if (saved) return saved
  const legacyUrl = getUsageEndpoint(agent, name)
  if (!legacyUrl) return defaultUsageQuery(provider)
  return {
    ...defaultUsageQuery(provider),
    preset: 'custom',
    script: `({ request: { url: ${JSON.stringify(legacyUrl)} }, extractor: function (response) { return response } })`
  }
}

export function setUsageQuery(agent: AgentId, name: string, query: UsageQueryConfig): void {
  useApp.getState().updateUsageQueries({
    ...useApp.getState().usageQueries,
    [keyOf(agent, name)]: query
  })
}

/** 以供应商的用量查询配置执行一次请求。 */
export function fetchUsageQuery(
  query: UsageQueryConfig,
  provider: Provider
): Promise<ProviderUsageResult> {
  return window.api.fetchProviderUsage({
    script: query.script,
    variables: {
      apiKey: query.apiKey?.trim() || provider.apiKey?.trim() || '',
      baseUrl: (query.baseUrl?.trim() || provider.baseUrl?.trim() || '').replace(/\/+$/, ''),
      accessToken: query.accessToken?.trim() || '',
      userId: query.userId?.trim() || ''
    },
    timeoutSeconds: query.timeoutSeconds
  })
}
export function removeUsageQuery(agent: AgentId, name: string): void {
  const queries = { ...useApp.getState().usageQueries }
  delete queries[keyOf(agent, name)]
  useApp.getState().updateUsageQueries(queries)
}

export function renameUsageQuery(agent: AgentId, from: string, to: string): void {
  if (from === to) return
  const queries = { ...useApp.getState().usageQueries }
  const query = queries[keyOf(agent, from)]
  delete queries[keyOf(agent, from)]
  if (query) queries[keyOf(agent, to)] = query
  useApp.getState().updateUsageQueries(queries)
}
