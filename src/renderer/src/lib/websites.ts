/**
 * 供应商官网地址。omp/pi 的 CLI 配置里没有这个字段，
 * 写进 models.yml 会污染 CLI 配置，所以存本应用配置文件
 * ~/.omp-switch/config.json 的 websites 字段，key 形如 "omp/<provider>"。
 * 本模块是 store 的薄封装，读写都走 store（store 负责落盘）。
 */

import type { AgentId } from '@shared/types'
import { useApp } from '../stores/app'

function keyOf(agent: AgentId, name: string): string {
  return `${agent}/${name}`
}

export function getWebsite(agent: AgentId, name: string): string {
  return useApp.getState().websites[keyOf(agent, name)] ?? ''
}

/** 空串 = 删除记录 */
export function setWebsite(agent: AgentId, name: string, url: string): void {
  const map = { ...useApp.getState().websites }
  const key = keyOf(agent, name)
  const trimmed = url.trim()
  if (trimmed) {
    map[key] = trimmed
  } else {
    delete map[key]
  }
  useApp.getState().updateWebsites(map)
}

/** 供应商重命名时迁移记录 */
export function renameWebsite(agent: AgentId, from: string, to: string): void {
  if (from === to) return
  const map = { ...useApp.getState().websites }
  const url = map[keyOf(agent, from)]
  delete map[keyOf(agent, from)]
  if (url) map[keyOf(agent, to)] = url
  useApp.getState().updateWebsites(map)
}

export function removeWebsite(agent: AgentId, name: string): void {
  setWebsite(agent, name, '')
}
