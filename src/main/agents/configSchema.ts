import { OMP_EFFORT_LEVELS, type ConfigFieldGroup } from '../../shared/types'
import { getByPath } from '../lib/paths'
import {
  AUTOCOMPLETE_MAX_VISIBLE_FIELD,
  FOLLOW_UP_MODE_FIELD,
  HIDE_THINKING_BLOCK_FIELD,
  STEERING_MODE_FIELD,
  TREE_FILTER_MODE_FIELD
} from './commonFields'

/**
 * pi / omp 全局配置的可视化字段清单（schema 驱动）。
 * 只覆盖高频字段；未覆盖字段用「原始配置编辑」兜底。
 * key 支持点路径，写回时只改对应路径，未知字段原样保留。
 *
 * 字段清单对照版本（升级 CLI 时手工核对）：
 * - pi：@earendil-works/pi-coding-agent 1.1.x，共 55 个顶层键
 * - omp：@oh-my-pi/pi-coding-agent 18.8.x，权威清单共 537 键，此处只收高频项
 */

/** pi 内置主题（theme 目录下的 dark/light + system 伪主题） */
const PI_THEMES = ['system', 'dark', 'light']

/** omp 内置主题（pi-tui theme/defaults/*.json + 根级 dark.json / light.json），与 defaultThemes 对齐 */
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
  'dark-celestial',
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
  'dark-neon-noir',
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

/** omp composer.shape 可选值（扩展可注册更多，故允许自定义） */
const OMP_COMPOSER_SHAPES = ['band', 'box', 'claude', 'pi', 'borderless', 'rule', 'field', 'rail']

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
        desc: 'system 跟随终端配色；自定义主题放 ~/.pi/agent/themes 后用主题名填写；light/dark 组合（斜杠）表示跟随终端明暗自动切换',
        options: PI_THEMES,
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
        desc: '含项目级配置的目录首次启动时是否询问（仅全局配置生效）',
        options: ['always', 'never', 'ask'],
        allowCustom: true
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
  },
  {
    id: 'model',
    label: '模型与思考',
    desc: '默认模型/思考等级在「模型切换」页维护',
    fields: [
      {
        key: 'enabledModels',
        type: 'array',
        label: '可用模型',
        desc: '启动可选 / 可循环切换的模型模式列表，逗号分隔；留空 = 全部可用',
        placeholder: 'provider/model, provider/*'
      },
      HIDE_THINKING_BLOCK_FIELD,
      {
        key: 'showCacheMissNotices',
        type: 'boolean',
        label: '缓存提示',
        desc: '提示缓存未命中、缓存预热、压缩与供应商恢复'
      },
      {
        key: 'cacheWarming',
        type: 'select',
        label: '缓存预热',
        desc: 'streaming 运行中预热；idle 运行间隙也预热；off 关闭',
        options: ['off', 'streaming', 'idle'],
        allowCustom: true
      }
    ]
  },
  {
    id: 'interaction',
    label: '交互',
    fields: [
      STEERING_MODE_FIELD,
      FOLLOW_UP_MODE_FIELD,
      {
        key: 'doubleEscapeAction',
        type: 'select',
        label: '双击 Escape',
        desc: '输入框为空时双击 Escape 的行为',
        options: ['tree', 'fork', 'none'],
        allowCustom: true
      },
      TREE_FILTER_MODE_FIELD,
      AUTOCOMPLETE_MAX_VISIBLE_FIELD,
      {
        key: 'showHardwareCursor',
        type: 'boolean',
        label: '使用终端光标',
        desc: '用终端原生光标替代自绘光标（输入法场景更稳）'
      }
    ]
  },
  {
    id: 'display',
    label: '终端与显示',
    fields: [
      {
        key: 'tuiMode',
        type: 'select',
        label: '界面模式',
        options: ['fullscreen', 'regular'],
        allowCustom: true
      },
      {
        key: 'fullscreenExitOutput',
        type: 'select',
        label: '退出全屏输出',
        desc: '退出全屏模式时打印的内容',
        options: ['transcript', 'resume-hint'],
        allowCustom: true
      },
      {
        key: 'fullscreenScrollbar',
        type: 'select',
        label: '全屏滚动条',
        options: ['auto', 'always', 'hidden'],
        allowCustom: true
      },
      {
        key: 'fullscreenCopyOnSelect',
        type: 'boolean',
        label: '选中即复制',
        desc: '全屏模式下选中文本自动复制'
      },
      { key: 'editorPaddingX', type: 'number', label: '编辑器左右边距', desc: '0 - 3 单元格' },
      { key: 'outputPad', type: 'number', label: '输出左右边距', desc: '0 或 1' },
      {
        key: 'terminal.showImages',
        type: 'boolean',
        label: '显示行内图片',
        desc: '终端支持时渲染图片'
      },
      {
        key: 'terminal.imageWidthCells',
        type: 'number',
        label: '图片宽度（单元格）',
        enabledWhen: 'terminal.showImages'
      },
      { key: 'images.autoResize', type: 'boolean', label: '图片自动缩放', desc: '发送前缩到 2000x2000 以内' },
      { key: 'images.blockImages', type: 'boolean', label: '禁止发送图片' },
      {
        key: 'markdown.mermaid',
        type: 'select',
        label: 'Mermaid 渲染',
        options: ['off', 'final', 'streaming'],
        allowCustom: true
      }
    ]
  },
  {
    id: 'session',
    label: '会话与压缩',
    fields: [
      {
        key: 'sessionDir',
        type: 'path',
        label: '会话目录',
        desc: '会话文件存储目录，支持相对路径；PI_CODING_AGENT_SESSION_DIR 会覆盖它'
      },
      { key: 'compaction.enabled', type: 'boolean', label: '启用自动压缩' },
      {
        key: 'compaction.reserveTokens',
        type: 'number',
        label: '压缩预留 token',
        desc: '给模型回复预留的 token，默认 16384',
        enabledWhen: 'compaction.enabled'
      },
      {
        key: 'compaction.keepRecentTokens',
        type: 'number',
        label: '保留近期 token',
        desc: '不做摘要直接保留的近期 token，默认 20000',
        enabledWhen: 'compaction.enabled'
      },
      { key: 'branchSummary.skipPrompt', type: 'boolean', label: '分支摘要免询问' }
    ]
  },
  {
    id: 'network',
    label: '网络与重试',
    fields: [
      {
        key: 'transport',
        type: 'select',
        label: '传输方式',
        desc: '支持多种传输的供应商优先使用的协议',
        options: ['auto', 'sse', 'websocket', 'websocket-cached'],
        allowCustom: true
      },
      {
        key: 'httpProxy',
        type: 'string',
        label: 'HTTP 代理',
        desc: '如 http://127.0.0.1:7890；仅全局配置生效',
        placeholder: 'http://127.0.0.1:7890'
      },
      {
        key: 'httpIdleTimeoutMs',
        type: 'number',
        label: 'HTTP 空闲超时（毫秒）',
        desc: '0 = 不限制，默认 300000'
      },
      {
        key: 'websocketConnectTimeoutMs',
        type: 'number',
        label: 'WebSocket 连接超时（毫秒）',
        desc: '0 = 不限制，默认 15000'
      },
      { key: 'retry.enabled', type: 'boolean', label: '启用自动重试' },
      {
        key: 'retry.maxRetries',
        type: 'number',
        label: '最大重试次数',
        desc: '默认 3',
        enabledWhen: 'retry.enabled'
      },
      {
        key: 'retry.baseDelayMs',
        type: 'number',
        label: '重试基准间隔（毫秒）',
        desc: '默认 2000',
        enabledWhen: 'retry.enabled'
      },
      {
        key: 'retry.maxAgentDelayMs',
        type: 'number',
        label: '重试最大间隔（毫秒）',
        desc: '默认 60000',
        enabledWhen: 'retry.enabled'
      }
    ]
  },
  {
    id: 'tools',
    label: '工具与资源',
    desc: 'Package / Skills / 规则的管理在各自页面',
    fields: [
      {
        key: 'defaultTools',
        type: 'array',
        label: '默认启用工具',
        desc: '逗号分隔；+名称 增加、-名称 移除（相对默认集）；留空 = read/bash/edit/write',
        placeholder: 'read, bash, edit, write'
      },
      {
        key: 'codemode.mode',
        type: 'select',
        label: 'Codemode 模式',
        desc: 'on：脚本可调用已声明工具；only：工具只通过 codemode 暴露',
        options: ['on', 'only'],
        allowCustom: true
      },
      { key: 'enableSkillCommands', type: 'boolean', label: '技能注册为命令', desc: '/skill:name' }
    ]
  },
  {
    id: 'updates',
    label: '更新与隐私',
    fields: [
      { key: 'collapseChangelog', type: 'boolean', label: '精简更新日志' },
      {
        key: 'enableInstallTelemetry',
        type: 'boolean',
        label: '安装/更新遥测',
        desc: '匿名安装统计与供应商归属头部，不影响更新检查'
      },
      { key: 'enableAnalytics', type: 'boolean', label: '分析数据共享' }
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
        options: ['unicode', 'nerd', 'ascii'],
        allowCustom: true
      },
      {
        key: 'colorBlindMode',
        type: 'boolean',
        label: '色盲模式',
        desc: '调整 diff 红绿对比，便于色弱识别'
      },
      {
        key: 'composer.shape',
        type: 'select',
        label: '输入框样式',
        desc: '输入框与状态栏的框体样式，默认 band（扩展可注册更多）',
        options: OMP_COMPOSER_SHAPES,
        allowCustom: true
      },
      { key: 'display.showTokenUsage', type: 'boolean', label: '显示 token 用量' },
      { key: 'terminal.showImages', type: 'boolean', label: '显示行内图片' }
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
        options: ['on', 'off'],
        allowCustom: true
      },
      {
        key: 'error.notify',
        type: 'select',
        label: '错误通知',
        desc: '出错时发桌面通知',
        options: ['on', 'off'],
        allowCustom: true
      },
      {
        key: 'ask.notify',
        type: 'select',
        label: 'ask 等待通知',
        desc: 'ask 工具等待输入时发终端通知',
        options: ['on', 'off'],
        allowCustom: true
      },
      {
        key: 'ask.timeout',
        type: 'number',
        label: 'ask 超时（秒）',
        desc: '超时后自动选推荐项，0 = 不超时'
      }
    ]
  },
  {
    id: 'interaction',
    label: '交互与启动',
    fields: [
      STEERING_MODE_FIELD,
      FOLLOW_UP_MODE_FIELD,
      {
        key: 'interruptMode',
        type: 'select',
        label: '打断时机',
        desc: 'steering 消息何时打断正在执行的工具',
        options: ['immediate', 'wait'],
        allowCustom: true
      },
      {
        key: 'doubleEscapeAction',
        type: 'select',
        label: '双击 Escape',
        options: ['rewind', 'tree', 'none'],
        allowCustom: true
      },
      TREE_FILTER_MODE_FIELD,
      { key: 'tui.vimMode', type: 'boolean', label: 'Vim 编辑模式' },
      AUTOCOMPLETE_MAX_VISIBLE_FIELD,
      { key: 'autoResume', type: 'boolean', label: '自动恢复会话', desc: '启动时恢复当前目录最近会话' },
      { key: 'startup.quiet', type: 'boolean', label: '安静启动' },
      { key: 'startup.checkUpdate', type: 'boolean', label: '启动检查更新' },
      {
        key: 'update.channel',
        type: 'select',
        label: '更新通道',
        options: ['stable', 'canary'],
        allowCustom: true
      }
    ]
  },
  {
    id: 'model',
    label: '模型与思考',
    desc: 'defaultThinkingLevel 是角色未指定思考深度时的兜底值；各角色等级在「模型切换」页',
    fields: [
      {
        key: 'defaultThinkingLevel',
        type: 'select',
        label: '默认思考等级',
        desc: 'auto 按模型能力自动裁定',
        options: [...OMP_EFFORT_LEVELS],
        allowCustom: true
      },
      HIDE_THINKING_BLOCK_FIELD,
      { key: 'expandThinkingBlocks', type: 'boolean', label: '展开思考块' },
      { key: 'proseOnlyThinking', type: 'boolean', label: '思考只保留文字', desc: '省略代码块' },
      { key: 'omitThinking', type: 'boolean', label: '请求省略思考摘要' },
      { key: 'externalThinking', type: 'boolean', label: '外部思考（私有草稿）' },
      { key: 'temperature', type: 'number', label: 'Temperature', desc: '-1 = 用供应商默认' },
      { key: 'topP', type: 'number', label: 'Top P', desc: '-1 = 用供应商默认' },
      {
        key: 'modelRoleStorage',
        type: 'select',
        label: '角色保存位置',
        desc: '模型选择器里改的角色写到全局还是项目配置（本工具只写全局）',
        options: ['global', 'project'],
        allowCustom: true
      }
    ]
  },
  {
    id: 'retry',
    label: '重试与回退',
    fields: [
      { key: 'retry.enabled', type: 'boolean', label: '启用自动重试' },
      { key: 'retry.baseDelayMs', type: 'number', label: '重试基准间隔（毫秒）' },
      { key: 'retry.maxRetries', type: 'number', label: '最大重试次数', desc: '默认 10' },
      { key: 'retry.maxDelayMs', type: 'number', label: '重试最大间隔（毫秒）', desc: '默认 300000' },
      { key: 'retry.modelFallback', type: 'boolean', label: '允许回退模型' },
      { key: 'retry.usageAwareFallback', type: 'boolean', label: '按用量回退' }
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
        options: ['always-ask', 'write', 'yolo'],
        allowCustom: true
      },
      { key: 'tools.maxTimeout', type: 'number', label: '工具最大超时（秒）', desc: '0 = 不限制' },
      {
        key: 'tools.xdev',
        type: 'boolean',
        label: 'xd:// 工具发现',
        desc: '把不常用工具挂到 xd:// 设备上按需发现，减小每次请求的工具 schema'
      },
      { key: 'grep.enabled', type: 'boolean', label: 'grep 工具' },
      { key: 'glob.enabled', type: 'boolean', label: 'glob 工具' },
      { key: 'fetch.enabled', type: 'boolean', label: 'read 抓取 URL' },
      { key: 'web_search.enabled', type: 'boolean', label: '联网搜索工具' },
      { key: 'todo.enabled', type: 'boolean', label: 'todo 工具' },
      { key: 'checkpoint.enabled', type: 'boolean', label: '检查点/回退工具' },
      { key: 'lsp.enabled', type: 'boolean', label: 'LSP 工具' },
      {
        key: 'mcp.enableProjectConfig',
        type: 'boolean',
        label: '加载项目级 MCP 配置',
        desc: '读取项目根目录 .mcp.json / mcp.json'
      }
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
        desc: '超过该时长未结束的命令自动后台化',
        enabledWhen: 'bash.autoBackground.enabled'
      },
      {
        key: 'bash.allowCompoundCommands',
        type: 'boolean',
        label: '允许 && 复合命令',
        desc: '逐条评估 && 链'
      },
      {
        key: 'bash.direnv',
        type: 'select',
        label: 'direnv 自动加载',
        desc: 'auto 自动加载仓库 .envrc（需 direnv allow）',
        options: ['auto', 'off'],
        allowCustom: true
      },
      {
        key: 'shellMinimizer.enabled',
        type: 'boolean',
        label: '精简命令输出',
        desc: '压缩 git/npm/cargo 等冗长输出再交给模型'
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
        options: ['hashline', 'apply_patch', 'patch', 'replace', 'sloppy'],
        allowCustom: true
      },
      { key: 'edit.fuzzyMatch', type: 'boolean', label: '模糊匹配', desc: '容忍空白差异' },
      {
        key: 'read.defaultLimit',
        type: 'number',
        label: 'read 默认行数',
        desc: 'read 工具不带选择器时的默认行数'
      },
      { key: 'readLineNumbers', type: 'boolean', label: '默认带行号' },
      { key: 'lsp.diagnosticsOnEdit', type: 'boolean', label: '编辑后返回诊断' },
      { key: 'lsp.formatOnWrite', type: 'boolean', label: '写入后格式化' }
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
      },
      {
        key: 'python.kernelMode',
        type: 'select',
        label: 'Python 内核',
        desc: 'session 跨调用复用内核；per-call 每次新建',
        options: ['session', 'per-call'],
        allowCustom: true,
        enabledWhen: 'eval.py'
      }
    ]
  },
  {
    id: 'compaction',
    label: '上下文压缩',
    desc: '旧版 compaction.strategy 已迁移为 methodOrder，不再写入',
    fields: [
      { key: 'compaction.enabled', type: 'boolean', label: '启用压缩' },
      {
        key: 'compaction.methodOrder',
        type: 'array',
        label: '压缩方法顺序',
        desc: '逗号分隔，按序回退：remote/snapcompact/handoff/shake/soft；空数组 = 关闭自动压缩',
        placeholder: 'remote, snapcompact, handoff, shake, soft',
        enabledWhen: 'compaction.enabled'
      },
      {
        key: 'compaction.thresholdPercent',
        type: 'number',
        label: '压缩阈值（百分比）',
        desc: '-1 = 用默认（按预留 token 计算）',
        enabledWhen: 'compaction.enabled'
      },
      {
        key: 'compaction.reserveTokens',
        type: 'number',
        label: '压缩预留 token',
        desc: '默认由模型上下文推导',
        enabledWhen: 'compaction.enabled'
      },
      {
        key: 'compaction.keepRecentTokens',
        type: 'number',
        label: '保留近期 token',
        desc: '不做摘要直接保留的近期 token，默认 20000',
        enabledWhen: 'compaction.enabled'
      },
      { key: 'compaction.asyncEnabled', type: 'boolean', label: '异步压缩', desc: '接近阈值时后台预摘要' },
      { key: 'branchSummary.enabled', type: 'boolean', label: '分支摘要', desc: '离开分支时提示摘要' },
      { key: 'ttsr.enabled', type: 'boolean', label: 'TTSR 规则', desc: '流式输出命中规则时打断' },
      {
        key: 'contextPromotion.enabled',
        type: 'boolean',
        label: '超长自动升档模型',
        desc: '上下文溢出时换大上下文模型而非压缩'
      },
      {
        key: 'workspace.additionalDirectories',
        type: 'array',
        label: '附加工作目录',
        desc: '逗号分隔，作为额外根目录加入每个会话'
      }
    ]
  },
  {
    id: 'tasks',
    label: '任务与技能',
    fields: [
      { key: 'task.maxConcurrency', type: 'number', label: '子代理并发上限', desc: '0 = 不限' },
      { key: 'task.maxRecursionDepth', type: 'number', label: '子代理嵌套层数', desc: '-1 = 不限' },
      { key: 'task.isolation.enabled', type: 'boolean', label: '子代理隔离副本' },
      { key: 'plan.enabled', type: 'boolean', label: '计划模式' },
      { key: 'goal.enabled', type: 'boolean', label: '目标模式' },
      { key: 'skills.enableSkillCommands', type: 'boolean', label: '技能注册为命令', desc: '/skill:name' }
    ]
  },
  {
    id: 'services',
    label: '服务与隐私',
    fields: [
      {
        key: 'memory.backend',
        type: 'select',
        label: '记忆后端',
        desc: 'off 关闭；local 本地摘要；mnemopi 本地 SQLite；hindsight 远端；sharpshooter',
        options: ['off', 'local', 'hindsight', 'mnemopi', 'sharpshooter'],
        allowCustom: true
      },
      { key: 'exa.enabled', type: 'boolean', label: 'Exa 搜索' },
      {
        key: 'searxng.endpoint',
        type: 'string',
        label: 'SearXNG 地址',
        desc: '自建 SearXNG 实例地址，用于联网搜索',
        placeholder: 'https://searx.example.com'
      },
      { key: 'secrets.enabled', type: 'boolean', label: '脱敏密钥', desc: '发送前混淆已配置的密钥' },
      {
        key: 'telemetry.otlpExportEnabled',
        type: 'boolean',
        label: 'OTLP 遥测导出',
        desc: '通过 OTEL_* 端点导出 traces/logs/metrics'
      },
      {
        key: 'disabledProviders',
        type: 'array',
        label: '禁用供应商',
        desc: '逗号分隔，命中后不再加载这些供应商'
      }
    ]
  }
]

export { getByPath }
