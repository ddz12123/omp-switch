import type { ConfigFieldDef } from '../../shared/types'

/**
 * pi 与 omp 同名、同义、同可选值的配置字段。
 * 两个 CLI 同源（都基于 pi-coding-agent），这些键的语义完全一致，
 * 抽出来避免两张表各自维护一份导致升级时只改一边。
 */

/** 队列消息投递方式 */
export const STEERING_MODE_FIELD: ConfigFieldDef = {
  key: 'steeringMode',
  type: 'select',
  label: '队列消息投递',
  desc: '运行中排队消息的投递方式',
  options: ['all', 'one-at-a-time'],
  allowCustom: true
}

/** 一轮结束后追加消息的投递方式 */
export const FOLLOW_UP_MODE_FIELD: ConfigFieldDef = {
  key: 'followUpMode',
  type: 'select',
  label: '追加消息投递',
  options: ['all', 'one-at-a-time'],
  allowCustom: true
}

/** 双击 Escape（输入框为空时）的行为 */
/** /tree 打开时的默认筛选 */
export const TREE_FILTER_MODE_FIELD: ConfigFieldDef = {
  key: 'treeFilterMode',
  type: 'select',
  label: '会话树默认筛选',
  options: ['default', 'no-tools', 'user-only', 'labeled-only', 'all'],
  allowCustom: true
}

/** 自动补全下拉可见条数 */
export const AUTOCOMPLETE_MAX_VISIBLE_FIELD: ConfigFieldDef = {
  key: 'autocompleteMaxVisible',
  type: 'number',
  label: '补全可见条数',
  desc: '3 - 20'
}

/** 隐藏思考块 */
export const HIDE_THINKING_BLOCK_FIELD: ConfigFieldDef = {
  key: 'hideThinkingBlock',
  type: 'boolean',
  label: '隐藏思考块',
  desc: '在对话记录里隐藏思考内容'
}
