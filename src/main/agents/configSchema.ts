import type { ConfigFieldGroup } from '../../shared/types'

/**
 * pi / omp 全局配置的可视化字段清单（schema 驱动）。
 * 只覆盖高频字段；未覆盖字段用「原始配置编辑」兜底。
 * key 支持点路径，写回时只改对应路径，未知字段原样保留。
 */

/** omp 内置主题（dark.json / light.json + defaults/*.json），与源码 defaultThemes 对齐 */
const OMP_THEMES = [
  'titanium',
  'light',
  'dark',
  'alabaster',
  'amethyst',
  'anthracite',
  'basalt',
  'birch',
  'dark-abyss',
  'dark-arctic',
  'dark-aurora',
  'dark-catppuccin',
  'dark-cavern',
  'dark-copper',
  'dark-cosmos',
  'dark-cyberpunk',
  'dark-dracula',
  'dark-eclipse',
  'dark-ember',
  'dark-equinox',
  'dark-forest',
  'dark-github',
  'dark-gruvbox',
  'dark-lavender',
  'dark-lunar',
  'dark-midnight',
  'dark-monochrome',
  'dark-monokai',
  'dark-nebula',
  'dark-nord',
  'dark-ocean',
  'dark-one',
  'dark-poimandres',
  'dark-rainforest',
  'dark-reef',
  'dark-retro',
  'dark-rose-pine',
  'dark-sakura',
  'dark-slate',
  'dark-solarized',
  'dark-solstice',
  'dark-starfall',
  'dark-sunset',
  'dark-swamp',
  'dark-synthwave',
  'dark-taiga',
  'dark-terminal',
  'dark-tokyo-night',
  'dark-tundra',
  'dark-twilight',
  'dark-volcanic',
  'graphite',
  'light-arctic',
  'light-aurora-day',
  'light-canyon',
  'light-catppuccin',
  'light-cirrus',
  'light-coral',
  'light-cyberpunk',
  'light-dawn',
  'light-dunes',
  'light-eucalyptus',
  'light-forest',
  'light-frost',
  'light-github',
  'light-glacier',
  'light-gruvbox',
  'light-haze',
  'light-honeycomb',
  'light-lagoon',
  'light-lavender',
  'light-meadow',
  'light-mint',
  'light-monochrome',
  'light-ocean',
  'light-one',
  'light-opal',
  'light-orchard',
  'light-paper',
  'light-poimandres',
  'light-prism',
  'light-retro',
  'light-sand',
  'light-savanna',
  'light-solarized',
  'light-soleil',
  'light-sunset',
  'light-synthwave',
  'light-tokyo-night',
  'light-wetland',
  'light-zenith',
  'limestone',
  'mahogany',
  'marble',
  'obsidian',
  'onyx',
  'pearl',
  'porcelain',
  'quartz',
  'sandstone'
]

export const PI_CONFIG_SCHEMA: ConfigFieldGroup[] = [
  {
    id: 'basic',
    label: '基础',
    desc: '写入 ~/.pi/agent/settings.json 根级字段',
    fields: [
      {
        key: 'theme',
        type: 'select',
        label: '主题',
        desc: '内置 dark/light；自定义主题放 ~/.pi/agent/themes 后用主题名填写；light/dark 组合（斜杠）表示跟随终端明暗自动切换',
        options: ['dark', 'light'],
        allowCustom: true
      },
      {
        key: 'shellPath',
        type: 'path',
        label: 'Shell 路径',
        desc: '覆盖 bash 工具使用的 shell 二进制（如 D:\\git\\Git\\bin\\bash.exe）',
        placeholder: 'D:\\git\\Git\\bin\\bash.exe'
      },
      {
        key: 'shellCommandPrefix',
        type: 'string',
        label: '命令前缀',
        desc: '每条 bash 命令前附加的前缀（如 shopt -s expand_aliases）'
      },
      {
        key: 'defaultProjectTrust',
        type: 'select',
        label: '项目信任默认值',
        options: ['always', 'never', 'ask']
      },
      {
        key: 'externalEditor',
        type: 'path',
        label: '外部编辑器',
        desc: 'ask 等弹框使用的编辑器命令'
      },
      {
        key: 'npmCommand',
        type: 'array',
        label: 'npm 命令',
        desc: 'npm 安装/查询使用的 argv，逗号分隔（如 mise,exec,node@20,--,npm）',
        placeholder: 'npm'
      },
      {
        key: 'quietStartup',
        type: 'boolean',
        label: '安静启动',
        desc: '启动时不显示版本检查等横幅'
      }
    ]
  }
]

export const OMP_CONFIG_SCHEMA: ConfigFieldGroup[] = [
  {
    id: 'appearance',
    label: '外观',
    desc: 'TUI 主题（写入 config.yml 的 theme 段）',
    fields: [
      {
        key: 'theme.dark',
        type: 'select',
        label: '深色主题',
        desc: '终端为暗色时使用的主题，默认 titanium；自定义主题放 ~/.omp/agent/themes',
        options: OMP_THEMES,
        allowCustom: true
      },
      {
        key: 'theme.light',
        type: 'select',
        label: '浅色主题',
        desc: '终端为亮色时使用的主题，默认 light',
        options: OMP_THEMES,
        allowCustom: true
      },
      {
        key: 'symbolPreset',
        type: 'select',
        label: '符号集',
        options: ['unicode', 'nerd', 'ascii']
      },
      {
        key: 'colorBlindMode',
        type: 'boolean',
        label: '色盲模式',
        desc: '调整 diff 红绿对比，便于色弱识别'
      }
    ]
  },
  {
    id: 'general',
    label: '通用',
    desc: '通知与 ask 交互',
    fields: [
      {
        key: 'completion.notify',
        type: 'select',
        label: '完成通知',
        desc: '会话/任务完成时发桌面通知',
        options: ['on', 'off']
      },
      {
        key: 'error.notify',
        type: 'select',
        label: '错误通知',
        desc: '出错时发桌面通知',
        options: ['on', 'off']
      },
      {
        key: 'ask.notify',
        type: 'select',
        label: 'ask 等待通知',
        desc: 'ask 工具等待输入时发终端通知',
        options: ['on', 'off']
      },
      { key: 'ask.timeout', type: 'number', label: 'ask 超时（秒）', desc: '0 = 不超时' }
    ]
  },
  {
    id: 'tools',
    label: '工具与审批',
    desc: '工具执行前的批准策略',
    fields: [
      {
        key: 'tools.approvalMode',
        type: 'select',
        label: '审批模式',
        desc: 'always-ask 全部询问；write 自动批准读与写；yolo 全部自动批准',
        options: ['always-ask', 'write', 'yolo']
      },
      { key: 'tools.maxTimeout', type: 'number', label: '工具最大超时（秒）', desc: '0 = 不限制' }
    ]
  },
  {
    id: 'shell',
    label: 'Shell',
    desc: 'bash 工具行为',
    fields: [
      { key: 'bash.enabled', type: 'boolean', label: '启用 bash 工具' },
      {
        key: 'shellPath',
        type: 'path',
        label: 'Shell 路径',
        desc: '覆盖 bash 使用的 shell（rc 快照与 ! 命令场景）',
        enabledWhen: 'bash.enabled'
      },
      {
        key: 'bash.autoBackground.enabled',
        type: 'boolean',
        label: '自动后台化',
        desc: '长命令自动转入后台任务'
      },
      {
        key: 'bash.autoBackground.thresholdMs',
        type: 'number',
        label: '自动后台阈值（毫秒）',
        desc: '超过该时长未结束的命令自动后台化'
      }
    ]
  },
  {
    id: 'edit',
    label: '编辑与读取',
    fields: [
      {
        key: 'edit.mode',
        type: 'select',
        label: '编辑模式',
        options: ['hashline', 'apply_patch', 'patch', 'replace']
      },
      {
        key: 'read.defaultLimit',
        type: 'number',
        label: 'read 默认行数',
        desc: 'read 工具不带选择器时的默认行数'
      }
    ]
  },
  {
    id: 'compaction',
    label: '上下文压缩',
    fields: [
      { key: 'compaction.enabled', type: 'boolean', label: '启用压缩' },
      {
        key: 'compaction.strategy',
        type: 'select',
        label: '压缩策略',
        options: ['context-full', 'handoff', 'shake', 'snapcompact', 'off']
      }
    ]
  },
  {
    id: 'eval',
    label: 'Eval 与 Python',
    fields: [
      { key: 'eval.py', type: 'boolean', label: '启用 Python eval' },
      { key: 'eval.js', type: 'boolean', label: '启用 JS eval' },
      {
        key: 'python.interpreter',
        type: 'path',
        label: 'Python 解释器路径',
        desc: '留空自动检测',
        enabledWhen: 'eval.py'
      }
    ]
  }
]

/** 按点路径从对象取值（不存在返回 undefined） */
export function getByPath(root: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = root
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}
