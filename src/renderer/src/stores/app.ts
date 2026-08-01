import { create } from 'zustand'
import { toast } from 'sonner'
import type {
  AgentId,
  AgentStatus,
  AppConfig,
  ProviderMap,
  SkillRepo,
  SkillSyncMode,
  SwitchState
} from '@shared/types'
import { AGENT_IDS } from '@shared/types'
import { applyTheme, getStoredTheme, storeTheme, type Theme } from '../lib/theme'
import { getCloseBehavior, storeCloseBehavior, type CloseBehavior } from '../lib/closeBehavior'

export type PageId =
  'providers' | 'switch' | 'config' | 'rules' | 'skills' | 'mcp' | 'sessions' | 'settings'

/** 全屏「全局页」：与 Agent 无关，进入后隐藏侧边栏与切换器，仅保留返回按钮 */
export const GLOBAL_PAGES: PageId[] = ['skills', 'mcp', 'sessions', 'settings']

interface AppState {
  agent: AgentId
  page: PageId
  /** 从全局页「返回」时回到的基础页（进入全局页前最近所在的基础页） */
  returnPage: PageId
  theme: Theme
  closeBehavior: CloseBehavior
  /** 供应商官网映射（key: "agent/供应商名"），存本应用配置文件 */
  websites: Record<string, string>
  /** ~/.omp-switch/config.json 的实际路径（设置页展示） */
  appConfigPath: string
  /** 主界面 Agent 的展示顺序（含隐藏项，供设置页排序） */
  agentOrder: AgentId[]
  /** 主界面不展示的 Agent */
  hiddenAgents: AgentId[]
  /** 技能中央存储目录（解析后的绝对路径，懒加载） */
  skillsDir: string
  /** 技能同步方式，默认软链接 */
  skillsSyncMode: SkillSyncMode
  /** 已添加的技能仓库（存 config.json 的 skills.repos） */
  skillsRepos: SkillRepo[]
  /** 用户手动添加的会话目录（存 config.json 的 sessions.customDirs） */
  sessionsCustomDirs: string[]
  statuses: AgentStatus[]
  providers: ProviderMap
  switchState: SwitchState
  loading: boolean
  error: string | null

  setPage: (page: PageId) => void
  setAgent: (agent: AgentId) => void
  setTheme: (theme: Theme) => void
  setCloseBehavior: (value: CloseBehavior) => void
  updateWebsites: (websites: Record<string, string>) => void
  /** 弹目录选择框，把配置迁移到用户选的目录 */
  changeAppConfigDir: () => Promise<void>
  /** 拖拽排序后提交新的显示顺序 */
  setAgentOrder: (order: AgentId[]) => void
  /** 主界面显示/隐藏某个 Agent，至少保留一个可见 */
  setAgentHidden: (id: AgentId, hidden: boolean) => void
  /** 懒解析技能存储目录（默认目录场景下首次进相关页面时调用） */
  ensureSkillsDir: () => Promise<void>
  /** 弹目录选择框迁移技能存储位置 */
  changeSkillsDir: () => Promise<void>
  /** 切换技能同步方式并重建所有已同步项 */
  setSkillsSyncMode: (mode: SkillSyncMode) => Promise<void>
  /** 添加/更新技能仓库（按 repo 名去重） */
  addSkillRepo: (repo: SkillRepo) => void
  /** 移除技能仓库（不影响已安装技能） */
  removeSkillRepo: (repo: string) => void
  /** 弹目录选择框添加自定义会话目录（写入 config.json 的 sessions.customDirs） */
  addSessionCustomDir: () => Promise<void>
  /** 移除某个手动添加的会话目录 */
  removeSessionCustomDir: (dir: string) => Promise<void>
  init: () => Promise<void>
  reload: () => Promise<void>
  saveProviders: (map: ProviderMap, notice?: string) => Promise<boolean>
  saveSwitch: (state: SwitchState, notice?: string) => Promise<boolean>
  clearError: () => void
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  // IPC 异常带有 "Error invoking remote method 'xx':" 前缀，去掉噪音
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** 配置文件原始内容，写回时保留未知字段（如后续的 skills/mcp 配置） */
let fileConfig: AppConfig = {}

/** 把当前偏好合并进配置文件整体写回（失败仅提示，不回滚 UI），返回落盘 promise */
function persistAppConfig(): Promise<void> {
  const { theme, closeBehavior, websites, agentOrder, hiddenAgents } = useApp.getState()
  fileConfig = {
    ...fileConfig,
    theme,
    closeBehavior,
    websites,
    agents: { order: agentOrder, hidden: hiddenAgents }
  }
  return window.api.writeAppConfig(fileConfig).catch((error) => {
    toast.error(`应用配置保存失败：${errorMessage(error)}`)
  })
}

/** 归一化目录路径用于比较（Windows 大小写不敏感、统一分隔符、去尾斜杠） */
function normalizeDir(p: string): string {
  return p
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/** 归一化配置里的顺序：去掉未知项，补上缺失项（新增 Agent 自动追加到末尾） */
function normalizeAgentOrder(order: unknown): AgentId[] {
  const known = Array.isArray(order)
    ? (order.filter((id) => AGENT_IDS.includes(id as AgentId)) as AgentId[])
    : []
  return [...new Set([...known, ...AGENT_IDS])]
}

/** 历史版本官网映射存 localStorage，读出来做一次性迁移 */
function readLegacyWebsites(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem('omp-switch:websites') ?? '{}') as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export const useApp = create<AppState>((set, get) => ({
  agent: 'omp',
  page: 'providers',
  returnPage: 'providers',
  theme: getStoredTheme(),
  closeBehavior: getCloseBehavior(),
  websites: {},
  appConfigPath: '',
  agentOrder: [...AGENT_IDS],
  hiddenAgents: [],
  skillsDir: '',
  skillsSyncMode: 'symlink',
  skillsRepos: [],
  sessionsCustomDirs: [],
  statuses: [],
  providers: {},
  switchState: { roles: {} },
  loading: false,
  error: null,

  setPage: (page) =>
    set((state) => ({
      page,
      // 记录最近所在的基础页，供全局页「返回」回到原处（顶栏导航与侧边栏设置入口通用）
      returnPage: GLOBAL_PAGES.includes(page) ? state.returnPage : page
    })),

  setTheme: (theme) => {
    storeTheme(theme)
    applyTheme(theme)
    set({ theme })
    persistAppConfig()
  },

  setCloseBehavior: (value) => {
    storeCloseBehavior(value)
    set({ closeBehavior: value })
    persistAppConfig()
  },

  updateWebsites: (websites) => {
    set({ websites })
    persistAppConfig()
  },

  changeAppConfigDir: async () => {
    try {
      const path = await window.api.changeAppConfigDir()
      if (!path) return // 用户取消
      set({ appConfigPath: path })
      // 未自定义技能目录时，默认路径跟随配置目录变化，重新解析
      if (!fileConfig.skills?.dir) {
        set({ skillsDir: '' })
        void get().ensureSkillsDir()
      }
      toast.success('配置存储位置已更改')
    } catch (error) {
      toast.error(`更改存储位置失败：${errorMessage(error)}`)
    }
  },

  setAgentOrder: (order) => {
    // 防御：拖拽提交的顺序必须与现有集合一致
    if (order.length !== get().agentOrder.length) return
    set({ agentOrder: order })
    persistAppConfig()
  },

  setAgentHidden: (id, hidden) => {
    const { hiddenAgents, agentOrder, agent } = get()
    const next = hidden ? [...new Set([...hiddenAgents, id])] : hiddenAgents.filter((a) => a !== id)
    const visible = agentOrder.filter((a) => !next.includes(a))
    if (visible.length === 0) {
      toast.error('至少保留一个 Agent 显示在主界面')
      return
    }
    set({ hiddenAgents: next })
    // 隐藏的是当前选中项 → 切到第一个可见的
    if (hidden && agent === id) get().setAgent(visible[0])
    persistAppConfig()
  },

  ensureSkillsDir: async () => {
    if (get().skillsDir) return
    try {
      const { dir } = await window.api.listSkills()
      set({ skillsDir: dir })
    } catch {
      // 目录解析失败不打扰用户，进入 Skills 页时会再报具体错误
    }
  },

  changeSkillsDir: async () => {
    try {
      const dir = await window.api.changeSkillsDir()
      if (!dir) return // 用户取消
      set({ skillsDir: dir })
      // 自定义目录写入 config，主进程之后按 config 解析
      fileConfig = { ...fileConfig, skills: { ...fileConfig.skills, dir } }
      persistAppConfig()
      toast.success('技能存储位置已更改')
    } catch (error) {
      toast.error(`更改技能存储位置失败：${errorMessage(error)}`)
    }
  },

  setSkillsSyncMode: async (mode) => {
    const previous = get().skillsSyncMode
    if (mode === previous) return
    set({ skillsSyncMode: mode })
    try {
      // 先重建所有已同步项，成功后再持久化，避免半途失败时配置与磁盘不一致
      await window.api.resyncSkills(mode)
      fileConfig = { ...fileConfig, skills: { ...fileConfig.skills, syncMode: mode } }
      persistAppConfig()
      toast.success(mode === 'symlink' ? '已切换为软链接同步' : '已切换为文件复制同步')
    } catch (error) {
      set({ skillsSyncMode: previous })
      toast.error(`切换同步方式失败：${errorMessage(error)}`)
    }
  },

  addSkillRepo: (repo) => {
    const next = [...get().skillsRepos.filter((r) => r.repo !== repo.repo), repo]
    next.sort((a, b) => a.repo.localeCompare(b.repo))
    set({ skillsRepos: next })
    fileConfig = { ...fileConfig, skills: { ...fileConfig.skills, repos: next } }
    persistAppConfig()
  },

  removeSkillRepo: (repo) => {
    const next = get().skillsRepos.filter((r) => r.repo !== repo)
    set({ skillsRepos: next })
    fileConfig = { ...fileConfig, skills: { ...fileConfig.skills, repos: next } }
    persistAppConfig()
  },

  addSessionCustomDir: async () => {
    try {
      const dir = await window.api.addSessionDir()
      if (!dir) return // 用户取消
      if (get().sessionsCustomDirs.includes(dir)) {
        toast.info('该会话目录已在列表中')
        return
      }
      const next = [...get().sessionsCustomDirs, dir]
      set({ sessionsCustomDirs: next })
      fileConfig = { ...fileConfig, sessions: { ...fileConfig.sessions, customDirs: next } }
      await persistAppConfig()
      toast.success('已添加会话目录')
    } catch (error) {
      toast.error(`添加会话目录失败：${errorMessage(error)}`)
    }
  },

  removeSessionCustomDir: async (dir) => {
    const target = normalizeDir(dir)
    const next = get().sessionsCustomDirs.filter((d) => normalizeDir(d) !== target)
    set({ sessionsCustomDirs: next })
    fileConfig = { ...fileConfig, sessions: { ...fileConfig.sessions, customDirs: next } }
    await persistAppConfig()
  },

  setAgent: (agent) => {
    if (agent === get().agent) return
    set({ agent, providers: {}, switchState: { roles: {} }, error: null })
    void get().reload()
  },

  init: async () => {
    // 本应用配置：文件为准；文件缺失的字段从 localStorage 迁移（历史版本）
    try {
      const { path, config } = await window.api.readAppConfig()
      fileConfig = config
      const theme = config.theme ?? getStoredTheme()
      const closeBehavior = config.closeBehavior ?? getCloseBehavior()
      const websites = config.websites ?? readLegacyWebsites()
      const agentOrder = normalizeAgentOrder(config.agents?.order)
      let hiddenAgents = (config.agents?.hidden ?? []).filter((id) => agentOrder.includes(id))
      // 配置异常导致全部隐藏时兜底：全部显示
      if (hiddenAgents.length >= agentOrder.length) hiddenAgents = []
      const skillsDir = config.skills?.dir ?? ''
      const skillsSyncMode: SkillSyncMode = config.skills?.syncMode === 'copy' ? 'copy' : 'symlink'
      // 防御：过滤掉配置里结构异常的仓库项
      const skillsRepos = (config.skills?.repos ?? []).filter(
        (r): r is SkillRepo => typeof r?.repo === 'string' && r.repo.trim() !== ''
      )
      const sessionsCustomDirs = (config.sessions?.customDirs ?? []).filter(
        (d): d is string => typeof d === 'string' && d.trim() !== ''
      )
      set({
        theme,
        closeBehavior,
        websites,
        agentOrder,
        hiddenAgents,
        skillsDir,
        skillsSyncMode,
        skillsRepos,
        sessionsCustomDirs,
        appConfigPath: path
      })
      applyTheme(theme)
      // localStorage 只作下次启动的首屏镜像
      storeTheme(theme)
      storeCloseBehavior(closeBehavior)
      // 未自定义目录时异步解析默认路径供设置页展示
      if (!skillsDir) void get().ensureSkillsDir()
      // 文件里缺字段（首次运行/迁移）时补写一次
      if (
        config.theme !== theme ||
        config.closeBehavior !== closeBehavior ||
        config.websites === undefined ||
        config.agents === undefined
      ) {
        persistAppConfig()
      }
    } catch (error) {
      toast.error(`应用配置读取失败：${errorMessage(error)}`)
    }

    try {
      const statuses = await window.api.agentsStatus()
      set({ statuses })
      // 当前选中项被隐藏，或未安装且存在已安装项时，按显示顺序重选
      const { agentOrder, hiddenAgents, agent } = get()
      const visible = agentOrder.filter((id) => !hiddenAgents.includes(id))
      const installed = visible.find((id) => statuses.find((s) => s.id === id)?.installed)
      if (!visible.includes(agent)) {
        set({ agent: installed ?? visible[0] })
      } else if (installed && !statuses.find((s) => s.id === agent)?.installed) {
        set({ agent: installed })
      }
    } catch (error) {
      set({ error: errorMessage(error) })
    }
    await get().reload()
  },

  reload: async () => {
    const { agent } = get()
    set({ loading: true })
    try {
      const [providers, switchState] = await Promise.all([
        window.api.readProviders(agent),
        window.api.readSwitch(agent)
      ])
      // 异步返回时 agent 可能已切走，丢弃过期数据
      if (get().agent !== agent) return
      set({ providers, switchState, error: null })
    } catch (error) {
      set({ error: errorMessage(error) })
    } finally {
      set({ loading: false })
    }
  },

  saveProviders: async (map, notice = '已保存供应商配置') => {
    const { agent } = get()
    try {
      await window.api.writeProviders(agent, map)
      set({ providers: map })
      get().clearError()
      toast.success(notice)
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    }
  },

  saveSwitch: async (state, notice = '已切换') => {
    const { agent } = get()
    const previous = get().switchState
    set({ switchState: state })
    try {
      await window.api.writeSwitch(agent, state)
      get().clearError()
      toast.success(notice)
      return true
    } catch (error) {
      set({ switchState: previous })
      toast.error(errorMessage(error))
      return false
    }
  },

  clearError: () => set({ error: null })
}))
