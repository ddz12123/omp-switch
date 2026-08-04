import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Trash2
} from 'lucide-react'
import type {
  AgentId,
  RemoteSkillsResult,
  SkillInfo,
  SkillRepo,
  SkillsShSkill
} from '@shared/types'
import { errorMessage, useApp } from '../stores/app'
import { cn } from '../lib/utils'
import { AgentIcon } from '../components/AgentIcon'
import ConfirmDialog from '../components/ConfirmDialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/select'

/** 单个仓库的拉取结果：成功为技能列表，失败记错误文案 */
type RepoResult = RemoteSkillsResult | { error: string }

/** 远程技能对应的本地安装目录名（与主进程 installSkills 的规则一致） */
function remoteDirName(repo: string, path: string): string {
  return path === '' ? repo.split('/')[1] : path.split('/').pop()!
}

/** 已安装技能的来源查看链接：优先精确到分支/子目录，缺分支时退回仓库首页 */
function skillRepoUrl(skill: SkillInfo): string | null {
  if (!skill.repo) return null
  if (!skill.branch) return `https://github.com/${skill.repo}`
  return `https://github.com/${skill.repo}/tree/${skill.branch}${skill.path ? `/${skill.path}` : ''}`
}

/** 编辑单个仓库的小弹框：改地址/分支，保存时重新校验 */
function EditRepoDialog({
  repo,
  onClose
}: {
  repo: SkillRepo
  onClose: () => void
}): React.JSX.Element {
  const { addSkillRepo, removeSkillRepo } = useApp()
  const [input, setInput] = useState(repo.repo)
  const [branch, setBranch] = useState(repo.branch ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    if (!input.trim() || saving) return
    setSaving(true)
    try {
      // 重新校验并归一化，仓库名变了就替换旧记录
      const res = await window.api.fetchRepoSkills(input, branch.trim() || undefined)
      if (res.repo !== repo.repo) removeSkillRepo(repo.repo)
      addSkillRepo({ repo: res.repo, branch: branch.trim() || undefined })
      toast.success(`已保存仓库 ${res.repo}（发现 ${res.skills.length} 个技能）`)
      onClose()
    } catch (error) {
      toast.error(`保存失败：${errorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑仓库</DialogTitle>
          <DialogDescription>修改仓库地址或分支，保存时会重新校验仓库</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            placeholder="owner/repo 或 GitHub 链接"
            autoFocus
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            placeholder="分支（可选，留空用默认分支）"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !input.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 管理技能仓库页面：顶部添加表单 + 仓库列表，编辑走小弹框 */
function RepoManagerView({ onBack }: { onBack: () => void }): React.JSX.Element {
  const { skillsRepos, addSkillRepo, removeSkillRepo } = useApp()
  const [input, setInput] = useState('')
  const [branch, setBranch] = useState('')
  const [adding, setAdding] = useState(false)
  /** 正在编辑的仓库（打开编辑弹框） */
  const [editing, setEditing] = useState<SkillRepo | null>(null)
  /** 待删除确认的仓库名 */
  const [removing, setRemoving] = useState<string | null>(null)

  const handleAdd = async (): Promise<void> => {
    if (!input.trim() || adding) return
    setAdding(true)
    try {
      // 先拉一次做校验，同时把输入归一化成 owner/repo
      const res = await window.api.fetchRepoSkills(input, branch.trim() || undefined)
      const exists = skillsRepos.some((r) => r.repo === res.repo)
      addSkillRepo({ repo: res.repo, branch: branch.trim() || undefined })
      toast.success(
        `${exists ? '已更新仓库' : '已添加仓库'} ${res.repo}（发现 ${res.skills.length} 个技能）`
      )
      setInput('')
      setBranch('')
    } catch (error) {
      toast.error(`添加仓库失败：${errorMessage(error)}`)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0 rounded-full"
          title="返回 Skills 管理"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <div>
          <h2 className="text-lg font-semibold">管理技能仓库</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            添加 GitHub 仓库后，可在「技能仓库」里挑选其中的技能安装
          </p>
        </div>
      </div>

      <div className="flex max-w-2xl shrink-0 gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
          placeholder="owner/repo 或 GitHub 链接"
          autoFocus
        />
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
          placeholder="分支（可选）"
          className="w-32 shrink-0"
        />
        <Button onClick={() => void handleAdd()} disabled={adding || !input.trim()}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />}
          添加
        </Button>
      </div>

      {/* 仓库列表区滚动，上方表头/表单固定 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {skillsRepos.length === 0 ? (
          <div className="text-muted-foreground max-w-2xl rounded-xl border border-dashed py-12 text-center text-sm">
            还没有添加仓库，试试 anthropics/skills
          </div>
        ) : (
          <div className="flex max-w-2xl flex-col gap-2">
            {skillsRepos.map((repo) => (
              <div
                key={repo.repo}
                className="bg-card flex items-center gap-2.5 rounded-xl border border-black/[0.06] px-4 py-2.5 shadow-xs dark:border-white/[0.08]"
              >
                <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{repo.repo}</span>
                {repo.branch && (
                  <Badge variant="secondary" className="font-mono text-[10px]">
                    {repo.branch}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-7"
                  title="在浏览器中打开仓库"
                  onClick={() => void window.api.openExternal(`https://github.com/${repo.repo}`)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground size-7"
                  title="编辑仓库"
                  onClick={() => setEditing(repo)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-7"
                  title="移除仓库（不影响已安装技能）"
                  onClick={() => setRemoving(repo.repo)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <EditRepoDialog repo={editing} onClose={() => setEditing(null)} />}

      {removing && (
        <ConfirmDialog
          title={`移除仓库「${removing}」？`}
          description="仅从技能仓库列表中移除，不影响已安装的技能。"
          onConfirm={() => removeSkillRepo(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

/** skills.sh 公共注册表搜索面板：发现技能，安装仍复用 GitHub 仓库流程 */
function SkillsShPanel({
  leading,
  installedDirs,
  onInstalled,
  installing,
  setInstalling
}: {
  /** 渲染在搜索行最前面的元素（来源切换分段） */
  leading: React.ReactNode
  installedDirs: Set<string>
  onInstalled: () => void
  /** 正在安装的技能 key（页级共享，非 null 时全局锁定安装按钮） */
  installing: string | null
  setInstalling: React.Dispatch<React.SetStateAction<string | null>>
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  /** null 表示还没搜索过 */
  const [items, setItems] = useState<SkillsShSkill[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [uninstalling, setUninstalling] = useState<{ name: string; dir: string } | null>(null)

  // promise 链写法：setState 都在回调里，避免 effect 中同步 setState
  const search = useCallback(
    (q: string): Promise<void> =>
      Promise.resolve()
        .then(() => {
          setSearching(true)
        })
        .then(() => window.api.searchSkillsSh(q))
        .then((res) => setItems(res))
        .catch((error: unknown) => {
          toast.error(`skills.sh 搜索失败：${errorMessage(error)}`)
        })
        .finally(() => setSearching(false)),
    []
  )

  // 首次进入自动拉一次热门榜（空关键词）
  useEffect(() => {
    void search('')
  }, [search])

  const handleInstall = async (item: SkillsShSkill): Promise<void> => {
    // source 不是 owner/repo 的（如域名来源）没有 GitHub 仓库可下载
    if (!item.source.includes('/')) {
      toast.error('该技能不在 GitHub 仓库中，请点「查看」到 skills.sh 了解安装方式')
      return
    }
    const key = `${item.source}/${item.skillId}`
    setInstalling(key)
    try {
      // 通过来源仓库扫描定位技能目录，再走现有 zipball 安装流程
      const res = await window.api.fetchRepoSkills(item.source)
      const match = res.skills.find((s) => remoteDirName(res.repo, s.path) === item.skillId)
      if (!match) throw new Error(`在 ${item.source} 中未找到技能 ${item.skillId}`)
      await window.api.installSkills(res.repo, res.branch, [match.path])
      toast.success('安装成功，去「已安装」里按需同步到各 Agent')
      onInstalled()
    } catch (error) {
      toast.error(`安装失败：${errorMessage(error)}`)
    } finally {
      setInstalling(null)
    }
  }

  const handleUninstall = async (skill: { name: string; dir: string }): Promise<void> => {
    try {
      await window.api.deleteSkill(skill.dir)
      toast.success(`已卸载技能 ${skill.name}`)
      onInstalled()
    } catch (error) {
      toast.error(`卸载失败：${errorMessage(error)}`)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-2">
        {leading}
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search(query)}
            placeholder="搜索 skills.sh 公共注册表（回车搜索，空关键词看热门）"
            className="pl-8"
          />
        </div>
        <Button disabled={searching} onClick={() => void search(query)}>
          {searching ? <Loader2 className="animate-spin" /> : <Search />}
          搜索
        </Button>
      </div>

      {/* 结果区滚动，搜索行固定 */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {items === null && (
          <div className="text-muted-foreground py-16 text-center text-sm">正在加载热门技能…</div>
        )}

        {items !== null && items.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
            没有找到匹配的技能，换个关键词试试
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {(items ?? []).map((item) => {
            const key = `${item.source}/${item.skillId}`
            const installed = installedDirs.has(item.skillId)
            const busy = installing === key
            return (
              <div
                key={key}
                className="bg-card flex flex-col rounded-xl border border-black/[0.06] p-4 shadow-xs dark:border-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                  {installed && (
                    <Badge className="shrink-0 border-transparent bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                      已安装
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="min-w-0 shrink truncate font-mono text-[10px]"
                  >
                    {item.source}
                  </Badge>
                  <span
                    className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]"
                    title="skills.sh 统计的安装量"
                  >
                    <Download className="size-3" />
                    {item.installs.toLocaleString()}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    title="在浏览器中打开 skills.sh 详情页"
                    onClick={() => void window.api.openExternal(`https://www.skills.sh/${key}`)}
                  >
                    <ExternalLink />
                    查看
                  </Button>
                  <div className="flex-1" />
                  {installed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setUninstalling({ name: item.name, dir: item.skillId })}
                    >
                      <Trash2 />
                      卸载
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={installing !== null}
                      onClick={() => void handleInstall(item)}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Download />}
                      安装
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {uninstalling && (
        <ConfirmDialog
          title={`卸载技能「${uninstalling.name}」？`}
          description="会先取消它在所有 Agent 的同步，再从中央存储目录删除，且不可恢复。"
          onConfirm={() => void handleUninstall(uninstalling)}
          onClose={() => setUninstalling(null)}
        />
      )}
    </div>
  )
}

/** 技能仓库 tab：聚合各仓库的技能卡片，支持搜索与仓库筛选 */
function BrowseTab({
  installedDirs,
  onInstalled,
  onManageRepos,
  installing,
  setInstalling
}: {
  installedDirs: Set<string>
  onInstalled: () => void
  /** 进入仓库管理页面 */
  onManageRepos: () => void
  /** 正在安装的技能 key（页级共享，非 null 时全局锁定安装按钮） */
  installing: string | null
  setInstalling: React.Dispatch<React.SetStateAction<string | null>>
}): React.JSX.Element {
  const { skillsRepos } = useApp()
  /** 技能来源：自己添加的 GitHub 仓库 / skills.sh 公共注册表 */
  const [sourceTab, setSourceTab] = useState<'repos' | 'sh'>('repos')
  const [results, setResults] = useState<Record<string, RepoResult>>({})
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [repoFilter, setRepoFilter] = useState('all')
  /** 待卸载确认的卡片 */
  const [uninstalling, setUninstalling] = useState<{ name: string; dir: string } | null>(null)

  // 仓库列表变化时重新拉取；promise 链写法避免 effect 中同步 setState
  const reposKey = skillsRepos.map((r) => `${r.repo}@${r.branch ?? ''}`).join(',')
  const load = useCallback((): Promise<void> => {
    const repos = useApp.getState().skillsRepos
    return Promise.resolve()
      .then(() => {
        setLoading(true)
      })
      .then(() =>
        Promise.all(
          repos.map((r) =>
            window.api
              .fetchRepoSkills(r.repo, r.branch)
              .then((res): [string, RepoResult] => [r.repo, res])
              .catch((error: unknown): [string, RepoResult] => [
                r.repo,
                { error: errorMessage(error) }
              ])
          )
        )
      )
      .then((entries) => setResults(Object.fromEntries(entries)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
    // reposKey 变化（添加/删除仓库）时重新聚合
  }, [load, reposKey])

  const handleInstall = async (repo: string, branch: string, path: string): Promise<void> => {
    const key = `${repo}:${path}`
    setInstalling(key)
    try {
      await window.api.installSkills(repo, branch, [path])
      toast.success('安装成功，去「已安装」里按需同步到各 Agent')
      onInstalled()
    } catch (error) {
      toast.error(`安装失败：${errorMessage(error)}`)
    } finally {
      setInstalling(null)
    }
  }

  const handleUninstall = async (skill: { name: string; dir: string }): Promise<void> => {
    try {
      await window.api.deleteSkill(skill.dir)
      toast.success(`已卸载技能 ${skill.name}`)
      onInstalled()
    } catch (error) {
      toast.error(`卸载失败：${errorMessage(error)}`)
    }
  }

  // 聚合 + 过滤出要展示的卡片
  const cards = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const list: { repo: string; branch: string; path: string; name: string; desc?: string }[] = []
    for (const [repo, result] of Object.entries(results)) {
      if ('error' in result) continue
      if (repoFilter !== 'all' && repo !== repoFilter) continue
      for (const skill of result.skills) {
        if (
          kw &&
          !skill.name.toLowerCase().includes(kw) &&
          !(skill.description ?? '').toLowerCase().includes(kw) &&
          !skill.path.toLowerCase().includes(kw)
        ) {
          continue
        }
        list.push({
          repo,
          branch: result.branch,
          path: skill.path,
          name: skill.name,
          desc: skill.description
        })
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [results, keyword, repoFilter])

  const errors = Object.entries(results).filter(
    (entry): entry is [string, { error: string }] => 'error' in entry[1]
  )

  // 来源切换分段：两种模式下都渲染在搜索行最前面
  const sourceSwitcher = (
    <div className="bg-muted flex shrink-0 rounded-lg p-0.5">
      {(
        [
          { id: 'repos', label: '仓库' },
          { id: 'sh', label: 'skills.sh' }
        ] as const
      ).map((s) => (
        <button
          type="button"
          key={s.id}
          onClick={() => setSourceTab(s.id)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            sourceTab === s.id
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  )

  if (sourceTab === 'sh') {
    return (
      <SkillsShPanel
        leading={sourceSwitcher}
        installedDirs={installedDirs}
        onInstalled={onInstalled}
        installing={installing}
        setInstalling={setInstalling}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-2">
        {sourceSwitcher}
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索技能名称 / 描述"
            className="pl-8"
          />
        </div>
        <Select value={repoFilter} onValueChange={setRepoFilter}>
          <SelectTrigger className="w-52 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部仓库</SelectItem>
            {skillsRepos.map((r) => (
              <SelectItem key={r.repo} value={r.repo}>
                {r.repo}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" title="重新拉取仓库" onClick={() => void load()}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
        <Button variant="outline" size="sm" onClick={onManageRepos}>
          <FolderGit2 />
          管理仓库
        </Button>
      </div>

      {/* 结果区滚动，工具栏固定 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6">
        {/* 拉取失败的仓库逐个提示，不阻塞其他仓库展示 */}
        {errors.map(([repo, result]) => (
          <div
            key={repo}
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
          >
            {repo} 拉取失败：{result.error}
          </div>
        ))}

        {skillsRepos.length === 0 && (
          <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-sm">
            还没有添加技能仓库
            <Button size="sm" onClick={onManageRepos}>
              <Plus />
              添加仓库
            </Button>
          </div>
        )}

        {skillsRepos.length > 0 && loading && Object.keys(results).length === 0 && (
          <div className="text-muted-foreground py-16 text-center text-sm">正在拉取仓库技能…</div>
        )}

        {skillsRepos.length > 0 && !loading && cards.length === 0 && errors.length === 0 && (
          <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
            没有匹配的技能
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {cards.map((card) => {
            const key = `${card.repo}:${card.path}`
            const dir = remoteDirName(card.repo, card.path)
            const installed = installedDirs.has(dir)
            const busy = installing === key
            return (
              <div
                key={key}
                className="bg-card flex flex-col rounded-xl border border-black/[0.06] p-4 shadow-xs dark:border-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{card.name}</span>
                  {installed && (
                    <Badge className="shrink-0 border-transparent bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400">
                      已安装
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                  {card.path && (
                    <span className="text-muted-foreground/70 truncate font-mono text-[11px]">
                      {card.path}
                    </span>
                  )}
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                    {card.repo}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-2 line-clamp-3 min-h-[3lh] text-xs leading-relaxed">
                  {card.desc || '暂无描述'}
                </p>
                <div className="mt-3 flex items-center gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    title="在浏览器中查看该技能的仓库页面"
                    onClick={() =>
                      void window.api.openExternal(
                        `https://github.com/${card.repo}/tree/${card.branch}${card.path ? `/${card.path}` : ''}`
                      )
                    }
                  >
                    <ExternalLink />
                    查看
                  </Button>
                  <div className="flex-1" />
                  {installed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setUninstalling({ name: card.name, dir })}
                    >
                      <Trash2 />
                      卸载
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={installing !== null}
                      onClick={() => void handleInstall(card.repo, card.branch, card.path)}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Download />}
                      安装
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {uninstalling && (
        <ConfirmDialog
          title={`卸载技能「${uninstalling.name}」？`}
          description="会先取消它在所有 Agent 的同步，再从中央存储目录删除，且不可恢复。"
          onConfirm={() => void handleUninstall(uninstalling)}
          onClose={() => setUninstalling(null)}
        />
      )}
    </div>
  )
}

const TABS = [
  { id: 'installed', label: '已安装' },
  { id: 'browse', label: '技能仓库' }
] as const

type TabId = (typeof TABS)[number]['id']

export default function SkillsPage({ onBack }: { onBack?: () => void }): React.JSX.Element {
  const { statuses, agentOrder } = useApp()
  const [tab, setTab] = useState<TabId>('installed')
  /** 是否处于「管理仓库」子页面 */
  const [managingRepos, setManagingRepos] = useState(false)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<SkillInfo | null>(null)
  /** 正在切换同步的 "dir/agent"，防止连点 */
  const [toggling, setToggling] = useState<string | null>(null)
  /** 检查更新后，有更新的技能目录名集合 */
  const [updates, setUpdates] = useState<Set<string>>(new Set())
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  /** 正在更新的技能目录名，防止连点 */
  const [updating, setUpdating] = useState<string | null>(null)
  /** 手动刷新中（仅按钮转圈，不遮整列表） */
  const [refreshing, setRefreshing] = useState(false)
  /** 正在安装的技能 key，提到页级：切 tab/来源不丢，且非 null 时全局锁定所有安装按钮 */
  const [installing, setInstalling] = useState<string | null>(null)

  // promise 链写法：setState 都在回调里，避免 effect 中同步 setState
  const load = useCallback(
    (): Promise<void> =>
      window.api
        .listSkills()
        .then((result) => {
          setSkills(result.skills)
          // 顺带刷新设置页展示的目录
          useApp.setState({ skillsDir: result.dir })
        })
        .catch((error: unknown) => {
          toast.error(`读取技能列表失败：${errorMessage(error)}`)
        })
        .finally(() => setLoading(false)),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = async (
    skill: SkillInfo,
    agentId: AgentId,
    enabled: boolean
  ): Promise<void> => {
    const key = `${skill.dir}/${agentId}`
    setToggling(key)
    try {
      await window.api.setSkillSync(skill.dir, agentId, enabled)
      await load()
    } catch (error) {
      toast.error(`${enabled ? '同步' : '取消同步'}失败：${errorMessage(error)}`)
    } finally {
      setToggling(null)
    }
  }

  const handleDelete = async (skill: SkillInfo): Promise<void> => {
    try {
      await window.api.deleteSkill(skill.dir)
      toast.success(`已删除技能 ${skill.name}`)
      await load()
    } catch (error) {
      toast.error(`删除失败：${errorMessage(error)}`)
    }
  }

  const handleRefresh = (): void => {
    setRefreshing(true)
    void load().finally(() => setRefreshing(false))
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setCheckingUpdates(true)
    try {
      const dirs = await window.api.checkSkillUpdates()
      setUpdates(new Set(dirs))
      toast.success(dirs.length ? `发现 ${dirs.length} 个技能有更新` : '所有技能都是最新的')
    } catch (error) {
      toast.error(`检查更新失败：${errorMessage(error)}`)
    } finally {
      setCheckingUpdates(false)
    }
  }

  const handleUpdate = async (skill: SkillInfo): Promise<void> => {
    setUpdating(skill.dir)
    try {
      await window.api.updateSkill(skill.dir)
      toast.success(`已更新技能 ${skill.name}`)
      setUpdates((prev) => {
        const next = new Set(prev)
        next.delete(skill.dir)
        return next
      })
      await load()
    } catch (error) {
      toast.error(`更新失败：${errorMessage(error)}`)
    } finally {
      setUpdating(null)
    }
  }

  const installedDirs = useMemo(() => new Set(skills.map((s) => s.dir)), [skills])

  // 仓库管理是独立子页面（带返回按钮），返回后回到技能仓库 tab
  if (managingRepos) {
    return (
      <RepoManagerView
        onBack={() => {
          setManagingRepos(false)
          setTab('browse')
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            title="返回"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">Skills 管理</h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              技能统一存在中央目录，通过开关同步到各 Agent 的全局技能目录
            </p>
          </div>
        </div>
        {/* 分段 tab：已安装 / 技能仓库 */}
        <div className="bg-muted flex shrink-0 rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 已安装专属工具栏：左侧计数 + 右侧操作，与分段 tab 分行避免拥挤换行 */}
      {tab === 'installed' && (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">
            {!loading && `共 ${skills.length} 个技能`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              title="在资源管理器中打开技能目录"
              onClick={() => void window.api.showSkillsDirInFolder()}
            >
              <FolderOpen />
              打开目录
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="重新扫描"
              disabled={refreshing}
              onClick={() => handleRefresh()}
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="检查所有已安装技能是否有更新"
              disabled={checkingUpdates || skills.length === 0}
              onClick={() => void handleCheckUpdates()}
            >
              {checkingUpdates ? <Loader2 className="animate-spin" /> : <RotateCw />}
              检查更新
            </Button>
          </div>
        </div>
      )}

      {tab === 'browse' && (
        <BrowseTab
          installedDirs={installedDirs}
          onInstalled={() => void load()}
          onManageRepos={() => setManagingRepos(true)}
          installing={installing}
          setInstalling={setInstalling}
        />
      )}

      {tab === 'installed' && (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {loading && (
            <div className="text-muted-foreground py-16 text-center text-sm">加载中…</div>
          )}

          {!loading && skills.length === 0 && (
            <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
              还没有任何技能。切到「技能仓库」添加仓库后挑选安装，
              <br />
              或把含 SKILL.md 的技能目录放进中央存储目录后刷新。
            </div>
          )}

          {/* 卡片网格：与技能仓库卡片同款风格 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {skills.map((skill) => (
              <div
                key={skill.dir}
                className="bg-card flex flex-col rounded-xl border border-black/[0.06] p-4 shadow-xs dark:border-white/[0.08]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-semibold" title={skill.name}>
                      {skill.name}
                    </span>
                    {updates.has(skill.dir) && (
                      <Badge className="shrink-0 border-transparent bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400">
                        有更新
                      </Badge>
                    )}
                  </div>
                  {skill.repo && (
                    <Badge
                      variant="secondary"
                      className="min-w-0 shrink truncate font-mono text-[10px]"
                      title="来源仓库"
                    >
                      {skill.repo}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground mt-2 line-clamp-2 min-h-[2lh] text-xs leading-relaxed">
                  {skill.description || '暂无描述'}
                </p>

                {/* 底栏：各 Agent 同步开关 + 删除 */}
                <div className="mt-3 flex items-center gap-4 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
                  {agentOrder.map((agentId) => {
                    const status = statuses.find((s) => s.id === agentId)
                    const synced = skill.agents.includes(agentId)
                    const busy = toggling === `${skill.dir}/${agentId}`
                    return (
                      <div
                        key={agentId}
                        className="flex items-center gap-1.5"
                        title={
                          status && !status.installed
                            ? `未检测到 ${status.label}，无法同步`
                            : `${synced ? '取消同步到' : '同步到'} ${status?.label ?? agentId}`
                        }
                      >
                        <AgentIcon agent={agentId} className="size-4.5" />
                        <Switch
                          checked={synced}
                          disabled={busy || (status ? !status.installed : false)}
                          onCheckedChange={(checked) => void handleToggle(skill, agentId, checked)}
                        />
                      </div>
                    )
                  })}
                  <div className="flex-1" />
                  {skillRepoUrl(skill) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-foreground size-7 shrink-0"
                      title="查看来源仓库"
                      onClick={() => void window.api.openExternal(skillRepoUrl(skill)!)}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  )}
                  {updates.has(skill.dir) && (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={updating === skill.dir}
                      title="更新到最新版本"
                      onClick={() => void handleUpdate(skill)}
                    >
                      {updating === skill.dir ? <Loader2 className="animate-spin" /> : <Download />}
                      更新
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-7 shrink-0"
                    title="删除技能（会同时取消所有同步）"
                    onClick={() => setDeleting(skill)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title={`删除技能「${deleting.name}」？`}
          description="会先取消它在所有 Agent 的同步，再从中央存储目录删除，且不可恢复。"
          onConfirm={() => void handleDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
