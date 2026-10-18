import { OMP_EFFORT_LEVELS, type ConfigFieldGroup } from '../../shared/types'
import { getByPath } from '../lib/paths'
import {
  AUTOCOMPLETE_MAX_VISIBLE_FIELD,
  FOLLOW_UP_MODE_FIELD,
  HIDE_THINKING_BLOCK_FIELD,
  SHOW_HARDWARE_CURSOR_FIELD,
  STEERING_MODE_FIELD,
  TREE_FILTER_MODE_FIELD
} from './commonFields'

/**
 * pi / omp 全局配置的可视化字段清单（schema 驱动）。
 * key 支持点路径，写回时只改对应路径，未知字段原样保留。
 *
 * 字段清单对照版本（升级 CLI 时手工核对）：
 * - pi：@earendil-works/pi-coding-agent 1.3.x，59 个顶层键（含 $schema，即 58 个配置键），
 *   权威来源 https://pi.dev/schemas/settings.schema.json（与 npm 包内 schemas/ 逐字节一致）
 * - omp：@oh-my-pi/pi-coding-agent 18.12.x，权威清单 555 键（`omp config list --json`）；
 *   该命令只给 type 不给枚举取值，选项要对照 dist/cli.js 里
 *   `id:"xxx",type:"enum",values:[...]` 的定义
 *
 * 收录原则：只收「改完能立刻感知」的高频项。内部阈值、细粒度调参、排查用开关
 * （retry.provider 下的超时/重试、compaction 的空闲与回合中压缩阈值、
 * tools.artifactSpillThreshold、topK/minP/presencePenalty 等采样参数）
 * 一律不进表单，走「原始编辑」，否则一页列不完。
 * 值类型为「X | auto」混合的字段（pi fullscreenWheelScrollLines、terminal.hyperlinks）
 * 同样不收，避免写出非法类型值。
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
        desc: 'system 跟随终端配色；自定义主题放 ~/.pi/agent/themes 后填主题名；light/dark 表示跟随明暗自动切换',
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
        key: 'defaultProjectTrust',
        type: 'select',
        label: '项目信任默认值',
        desc: '含项目级配置的目录首次启动时是否询问（仅全局配置生效）',
        options: ['always', 'never', 'ask']
      },
      {
        key: 'quietStartup',
        type: 'boolean',
        label: '安静启动',
        desc: '启动时不显示版本检查等横幅（官方还支持字符串 header = 仅保留头部，需用原始编辑）'
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
        desc: '启动可选 / 可循环切换的模型列表，逗号分隔；留空 = 全部可用',
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
        options: ['off', 'streaming', 'idle']
      },
      {
        key: 'thinkingBudgets.minimal',
        type: 'number',
        label: '思考预算 minimal',
        desc: 'minimal 档思考 token 预算；留空才用内置默认（填 0 会被当成真实预算，不是「默认」）'
      },
      { key: 'thinkingBudgets.low', type: 'number', label: '思考预算 low' },
      { key: 'thinkingBudgets.medium', type: 'number', label: '思考预算 medium' },
      { key: 'thinkingBudgets.high', type: 'number', label: '思考预算 high' }
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
        options: ['tree', 'fork', 'none']
      },
      TREE_FILTER_MODE_FIELD,
      AUTOCOMPLETE_MAX_VISIBLE_FIELD,
      SHOW_HARDWARE_CURSOR_FIELD
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
        desc: 'fullscreen 全屏滚动；regular 传统追加输出',
        options: ['fullscreen', 'regular']
      },
      {
        key: 'fullscreenCopyOnSelect',
        type: 'boolean',
        label: '选中即复制',
        desc: '全屏模式下选中文本自动复制'
      },
      {
        key: 'terminal.showImages',
        type: 'boolean',
        label: '显示行内图片',
        desc: '终端支持时渲染图片'
      },
      { key: 'images.blockImages', type: 'boolean', label: '禁止发送图片' },
      {
        key: 'markdown.mermaid',
        type: 'select',
        label: 'Mermaid 渲染',
        desc: 'off 不渲染；final 只渲染完成的消息；streaming 边输出边渲染',
        options: ['off', 'final', 'streaming']
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
        options: ['auto', 'sse', 'websocket', 'websocket-cached']
      },
      {
        key: 'httpProxy',
        type: 'string',
        label: 'HTTP 代理',
        desc: '如 http://127.0.0.1:7890；仅全局配置生效',
        placeholder: 'http://127.0.0.1:7890'
      },
      { key: 'retry.enabled', type: 'boolean', label: '启用自动重试' },
      {
        key: 'retry.maxRetries',
        type: 'number',
        label: '最大重试次数',
        desc: '默认 3',
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
        options: ['on', 'only']
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
        desc: 'unicode 通用；nerd 需要 Nerd Font；ascii 纯文本',
        options: ['unicode', 'nerd', 'ascii']
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
      {
        key: 'git.enabled',
        type: 'boolean',
        label: 'Git 信息',
        desc: 'TUI 显示分支/状态/PR 并监听仓库变化'
      },
      {
        key: 'display.hideToolActivity',
        type: 'boolean',
        label: '隐藏工具调用',
        desc: '对话记录里不显示模型发起的工具调用与结果'
      },
      {
        key: 'display.smoothStreaming',
        type: 'boolean',
        label: '平滑流式输出',
        desc: '助手文本与工具输入随流平滑显示'
      },
      {
        key: 'display.collapseCompacted',
        type: 'boolean',
        label: '折叠压缩前历史',
        desc: '压缩后的旧历史折叠到摘要分隔线后；关闭则保留完整时间线'
      },
      {
        key: 'tui.renderMermaid',
        type: 'boolean',
        label: 'Mermaid 转字符画',
        desc: '把 Mermaid 代码块渲染成 ASCII 图'
      },
      {
        key: 'tui.renderSvg',
        type: 'boolean',
        label: 'SVG 内联图',
        desc: '邀请模型画 SVG 图，支持的终端内联显示'
      },
      { key: 'terminal.showImages', type: 'boolean', label: '显示行内图片' }
    ]
  },
  {
    id: 'statusLine',
    label: '状态栏',
    desc: '输入框下方的状态栏外观',
    fields: [
      {
        key: 'statusLine.preset',
        type: 'select',
        label: '状态栏预设',
        desc: '预设的段落组合；custom 表示用户自定义段落',
        options: ['default', 'minimal', 'compact', 'full', 'nerd', 'ascii', 'custom'],
        allowCustom: true
      },
      {
        key: 'statusLine.separator',
        type: 'select',
        label: '状态栏分隔符',
        options: ['powerline', 'powerline-thin', 'slash', 'pipe', 'block', 'none', 'ascii']
      },
      {
        key: 'statusLine.contextLine',
        type: 'select',
        label: '上下文进度条',
        desc: '左右段落之间那条线如何反映上下文占用（仅 box 输入框样式）',
        options: ['off', 'percentage', 'annotated', 'embedded']
      }
    ]
  },
  {
    id: 'usage',
    label: '用量与缓存',
    desc: '生成速度、token 用量与提示词缓存',
    fields: [
      {
        key: 'composer.tokenRate',
        type: 'boolean',
        label: '实时生成速度',
        desc: '在会话标题行或输入框旁显示实时 tok/s，回合结束后保留最后一次读数'
      },
      {
        key: 'display.showTokenUsage',
        type: 'boolean',
        label: '显示 token 用量',
        desc: '助手消息上显示本轮 token 用量'
      },
      {
        key: 'display.showTurnTime',
        type: 'boolean',
        label: '显示回合耗时',
        desc: '用量行上显示整轮耗时（含工具调用）'
      },
      {
        key: 'display.cacheMissMarker',
        type: 'boolean',
        label: '缓存未命中标记',
        desc: '某轮请求没命中提示词缓存时，在该轮后画一条分隔线'
      },
      {
        key: 'providers.cacheRetention',
        type: 'select',
        label: '提示词缓存保留',
        desc: '转发给支持的供应商（Anthropic/Bedrock/OpenRouter/OpenAI）；none 关闭缓存',
        options: ['auto', 'short', 'long', 'none']
      },
      {
        key: 'providers.cacheWarming',
        type: 'select',
        label: '缓存预热',
        desc: '缓存快过期时用 1 token 预算重发上次请求续期；streaming 运行中预热，idle 空闲也预热',
        options: ['off', 'streaming', 'idle']
      }
    ]
  },
  {
    id: 'notify',
    label: '通知',
    desc: '会话/错误/等待输入时的桌面与终端提醒',
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
        key: 'doubleEscapeAction',
        type: 'select',
        label: '双击 Escape',
        desc: '输入框为空时双击 Escape 的行为',
        options: ['rewind', 'tree', 'none']
      },
      TREE_FILTER_MODE_FIELD,
      AUTOCOMPLETE_MAX_VISIBLE_FIELD,
      { key: 'tui.vimMode', type: 'boolean', label: 'Vim 编辑模式' },
      {
        key: 'tui.mouse',
        type: 'boolean',
        label: '鼠标点击',
        desc: '捕获主会话鼠标点击，可点选子代理卡片/HUD 行；此时文本选择需 Shift+拖拽'
      },
      SHOW_HARDWARE_CURSOR_FIELD,
      {
        key: 'autoResume',
        type: 'boolean',
        label: '自动恢复会话',
        desc: '启动时恢复当前目录最近会话'
      },
      { key: 'startup.quiet', type: 'boolean', label: '安静启动' },
      { key: 'startup.checkUpdate', type: 'boolean', label: '启动检查更新' }
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
        options: [...OMP_EFFORT_LEVELS]
      },
      HIDE_THINKING_BLOCK_FIELD,
      { key: 'expandThinkingBlocks', type: 'boolean', label: '展开思考块' },
      {
        key: 'temperature',
        type: 'number',
        label: 'Temperature',
        desc: '-1 = 用供应商默认；0 最保守、1 最发散'
      },
      {
        key: 'extendedContext',
        type: 'boolean',
        label: '扩展上下文窗口',
        desc: '支持的模型用更大窗口，可能产生额外计费'
      },
      {
        key: 'skillful',
        type: 'boolean',
        label: '列出可用技能',
        desc: '系统提示列出技能清单；关闭可省上下文，会话内用 /skillful 切换'
      },
      {
        key: 'personality',
        type: 'select',
        label: '沟通风格',
        desc: '渲染进系统提示 personality 段的风格',
        options: ['default', 'friendly', 'pragmatic', 'none']
      },
      {
        key: 'advisor.enabled',
        type: 'boolean',
        label: 'Advisor 评审模型',
        desc: '启用 advisor 角色（第二个模型）逐轮评审并注入意见；需先在「模型切换」页配模型'
      },
      {
        key: 'includeWorkspaceTree',
        type: 'boolean',
        label: '注入目录树',
        desc: '系统提示渲染工作区目录树；注意可能击穿提示词缓存'
      }
    ]
  },
  {
    id: 'retry',
    label: '重试与回退',
    fields: [
      { key: 'retry.enabled', type: 'boolean', label: '启用自动重试' },
      { key: 'retry.maxRetries', type: 'number', label: '最大重试次数', desc: '默认 10' },
      { key: 'retry.modelFallback', type: 'boolean', label: '允许回退模型' },
      {
        key: 'retry.waitForUsageReset',
        type: 'boolean',
        label: '等待用量重置',
        desc: '供应商报告限额耗尽且给出重置时间时，等待到重置再重试（5 小时/周窗口）'
      }
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
      { key: 'web_search.enabled', type: 'boolean', label: '联网搜索工具' },
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
        key: 'shellMinimizer.enabled',
        type: 'boolean',
        label: '精简命令输出',
        desc: '压缩 git/npm/cargo 等冗长输出再交给模型'
      },
      {
        key: 'bash.autoBackground.enabled',
        type: 'boolean',
        label: '长命令自动后台',
        desc: '运行太久的 bash 命令自动转后台任务，结果稍后送达（默认关）'
      },
      {
        key: 'bash.gitGuard',
        type: 'boolean',
        label: 'Git 危险操作保护',
        desc: '拒绝会丢弃或移动共享工作的 git 命令（stash、reset --hard、切换分支等）'
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
        desc: '编辑工具的实现变体，默认 hashline',
        options: ['hashline', 'apply_patch', 'patch', 'replace', 'sloppy']
      },
      { key: 'edit.fuzzyMatch', type: 'boolean', label: '模糊匹配', desc: '容忍空白差异' },
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
      {
        key: 'branchSummary.enabled',
        type: 'boolean',
        label: '分支摘要',
        desc: '离开分支时提示摘要'
      },
      {
        key: 'contextPromotion.enabled',
        type: 'boolean',
        label: '超长自动升档模型',
        desc: '上下文溢出时换大上下文模型而非压缩'
      }
    ]
  },
  {
    id: 'tasks',
    label: '任务与技能',
    fields: [
      { key: 'plan.enabled', type: 'boolean', label: '计划模式' },
      { key: 'goal.enabled', type: 'boolean', label: '目标模式' },
      {
        key: 'skills.enableSkillCommands',
        type: 'boolean',
        label: '技能注册为命令',
        desc: '/skill:name'
      }
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
        key: 'autolearn.enabled',
        type: 'boolean',
        label: '自动总结学习',
        desc: '回合结束后引导模型沉淀经验到记忆与技能'
      },
      {
        key: 'secrets.enabled',
        type: 'boolean',
        label: '脱敏密钥',
        desc: '发送前混淆已配置的密钥'
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
