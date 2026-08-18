import type { AgentId } from '@shared/types'
import { useApp } from '../stores/app'

function keyOf(agent: AgentId, name: string): string {
  return `${agent}/${name}`
}

/**
 * 供应商用量接口地址存储在本应用配置中，避免把应用专用字段写入 CLI 的模型配置。
 * 空串表示使用标准 OpenAI 兼容地址：<baseUrl>/dashboard/billing/credit_grants。
 */
export function getUsageEndpoint(agent: AgentId, name: string): string {
  return useApp.getState().usageEndpoints[keyOf(agent, name)] ?? ''
}

/** 空串 = 删除自定义接口，查询时回退到标准 OpenAI 兼容地址。 */
export function setUsageEndpoint(agent: AgentId, name: string, url: string): void {
  const endpoints = { ...useApp.getState().usageEndpoints }
  const key = keyOf(agent, name)
  const trimmed = url.trim()
  if (trimmed) endpoints[key] = trimmed
  else delete endpoints[key]
  useApp.getState().updateUsageEndpoints(endpoints)
}

export function renameUsageEndpoint(agent: AgentId, from: string, to: string): void {
  if (from === to) return
  const endpoints = { ...useApp.getState().usageEndpoints }
  const fromKey = keyOf(agent, from)
  const toKey = keyOf(agent, to)
  const url = endpoints[fromKey]
  delete endpoints[fromKey]
  if (url) endpoints[toKey] = url
  useApp.getState().updateUsageEndpoints(endpoints)
}

export function removeUsageEndpoint(agent: AgentId, name: string): void {
  setUsageEndpoint(agent, name, '')
}
