import { useMemo, useState } from 'react'
import { FileCode, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { EFFORT_LEVELS, OMP_KNOWN_ROLES, type RoleAssignment } from '@shared/types'
import { modelKey, parseModelRef } from '@shared/modelRef'
import { useApp } from '../stores/app'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import ConfirmDialog from '../components/ConfirmDialog'
import AddRoleDialog from '../components/AddRoleDialog'
import ConfigFileDialog from '../components/ConfigFileDialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '../components/ui/select'

/** Radix Select 不允许空字符串 value，用哨兵值表示「无思考等级」 */
const EFFORT_NONE = '__none__'

interface ModelOption {
  /** provider/model（无 provider 时为原文），同时作为 Select value */
  key: string
  label: string
  assignment: Pick<RoleAssignment, 'provider' | 'model'>
}

export default function SwitchPage(): React.JSX.Element {
  const { agent, statuses, providers, switchState, saveSwitch, reload } = useApp()

  const multiRole = statuses.find((s) => s.id === agent)?.multiRole ?? agent === 'omp'
  /** 添加角色弹框开关 */
  const [addOpen, setAddOpen] = useState(false)
  /** 待移除的角色名（非 null 时显示确认弹框） */
  const [removingRole, setRemovingRole] = useState<string | null>(null)
  /** 原始配置文件编辑弹框开关 */
  const [rawOpen, setRawOpen] = useState(false)

  /** 候选模型：来自各供应商配置，按 provider 分组 */
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>()
    const seen = new Set<string>()
    const push = (group: string, option: ModelOption): void => {
      if (seen.has(option.key)) return
      seen.add(option.key)
      const list = map.get(group) ?? []
      list.push(option)
      map.set(group, list)
    }
    for (const [name, provider] of Object.entries(providers)) {
      for (const model of provider.models ?? []) {
        if (!model.id) continue
        push(name, {
          key: `${name}/${model.id}`,
          label: model.id,
          assignment: { provider: name, model: model.id }
        })
      }
    }
    return map
  }, [providers])

  /** key → assignment 反查表（含分组外的当前值兜底） */
  const optionIndex = useMemo(() => {
    const index = new Map<string, Pick<RoleAssignment, 'provider' | 'model'>>()
    for (const options of groups.values()) {
      for (const option of options) index.set(option.key, option.assignment)
    }
    return index
  }, [groups])

  const roles = Object.entries(switchState.roles)

  const updateRole = (role: string, assignment: RoleAssignment): void => {
    void saveSwitch({ ...switchState, roles: { ...switchState.roles, [role]: assignment } })
  }

  const handleModelChange = (role: string, key: string): void => {
    const current = switchState.roles[role]
    const target = optionIndex.get(key) ?? parseModelRef(key)
    updateRole(role, { ...target, effort: current?.effort })
  }

  const handleEffortChange = (role: string, value: string): void => {
    const current = switchState.roles[role]
    if (!current) return
    const next = { ...current }
    if (value === EFFORT_NONE) {
      delete next.effort
    } else {
      next.effort = value
    }
    updateRole(role, next)
  }

  const removeRole = (role: string): void => {
    const next = { ...switchState.roles }
    delete next[role]
    void saveSwitch({ ...switchState, roles: next })
  }

  const addRole = (role: string): void => {
    const trimmed = role.trim()
    if (!trimmed || switchState.roles[trimmed]) return
    // 初始值沿用 default 的模型，没有则取第一个候选
    const fallback = optionIndex.values().next().value
    const base = switchState.roles.default ?? fallback
    if (!base) return
    updateRole(trimmed, { provider: base.provider, model: base.model })
  }

  const missingKnownRoles = OMP_KNOWN_ROLES.filter((r) => !switchState.roles[r])

  const renderRow = (role: string, assignment: RoleAssignment): React.JSX.Element => {
    const currentKey = modelKey(assignment)
    const known = optionIndex.has(currentKey)
    return (
      <div
        key={role}
        className="bg-card flex items-center gap-3 rounded-xl border border-black/[0.06] px-5 py-4 shadow-xs transition-shadow duration-200 hover:shadow-sm dark:border-white/[0.08]"
      >
        <div className="w-28 shrink-0">
          <span className="font-mono text-sm font-medium">{multiRole ? role : 'default'}</span>
          {role === 'default' && (
            <Badge variant="secondary" className="ml-2 px-1.5 text-[10px]">
              默认
            </Badge>
          )}
        </div>

        <Select value={currentKey} onValueChange={(v) => handleModelChange(role, v)}>
          <SelectTrigger className="min-w-0 flex-1 font-mono text-sm">
            <SelectValue placeholder="选择模型" />
          </SelectTrigger>
          <SelectContent>
            {/* 当前值不在候选中也要可见，避免展示成空 */}
            {!known && currentKey && (
              <SelectGroup>
                <SelectLabel>当前值（未在候选中）</SelectLabel>
                <SelectItem value={currentKey} className="font-mono text-sm">
                  {currentKey}
                </SelectItem>
              </SelectGroup>
            )}
            {[...groups.entries()].map(([group, options]) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {options.map((option) => (
                  <SelectItem key={option.key} value={option.key} className="font-mono text-sm">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={assignment.effort ?? EFFORT_NONE}
          onValueChange={(v) => handleEffortChange(role, v)}
        >
          <SelectTrigger className="w-32 shrink-0 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EFFORT_NONE}>无</SelectItem>
            {EFFORT_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {multiRole && role !== 'default' ? (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive/80 hover:text-destructive size-8 shrink-0"
            onClick={() => setRemovingRole(role)}
          >
            <Trash2 />
          </Button>
        ) : (
          <div className="size-8 shrink-0" />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          模型切换
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {multiRole
              ? '按角色分配模型，写入 ~/.omp/agent/config.yml'
              : '默认模型，写入 ~/.pi/agent/settings.json'}
          </span>
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void window.api.showConfigInFolder(agent, 'switch')}
          >
            <FolderOpen />
            打开配置目录
          </Button>
          <Button variant="outline" onClick={() => setRawOpen(true)}>
            <FileCode />
            编辑配置文件
          </Button>
          {multiRole ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus />
              添加角色
            </Button>
          ) : (
            !switchState.roles.default && (
              <Button onClick={() => addRole('default')}>
                <Plus />
                设置默认模型
              </Button>
            )
          )}
        </div>
      </div>

      {roles.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
          {multiRole ? '还没有配置任何角色，点击右上角「添加角色」' : '尚未配置默认模型'}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* default 始终排在最前 */}
          {roles
            .sort(([a], [b]) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)))
            .map(([role, assignment]) => renderRow(role, assignment))}
        </div>
      )}

      {addOpen && (
        <AddRoleDialog
          knownRoles={missingKnownRoles}
          exists={(role) => !!switchState.roles[role]}
          onAdd={addRole}
          onClose={() => setAddOpen(false)}
        />
      )}

      {removingRole && (
        <ConfirmDialog
          title={`移除角色「${removingRole}」？`}
          description="仅从配置中移除该角色的模型映射，不会删除供应商或模型。"
          confirmLabel="移除"
          onConfirm={() => removeRole(removingRole)}
          onClose={() => setRemovingRole(null)}
        />
      )}

      {rawOpen && (
        <ConfigFileDialog
          agent={agent}
          kind="switch"
          title="编辑模型切换配置文件"
          onSaved={() => void reload()}
          onClose={() => setRawOpen(false)}
        />
      )}
    </div>
  )
}
