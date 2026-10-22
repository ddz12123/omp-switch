import { ArrowRight, Check } from 'lucide-react'
import type { AgentId, Provider } from '@shared/types'
import { agentLabel, otherAgentOf, pickCoreProvider } from '../lib/providerTransfer'
import { AgentIcon } from './AgentIcon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Button } from './ui/button'

/** 上下文大小展示：1000000 → 1M，200000 → 200k */
function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

interface CopyProviderDialogProps {
  /** 源 Agent（当前页面所在 Agent） */
  from: AgentId
  /** 要复制的供应商名 */
  name: string
  /** 该供应商的配置 */
  provider: Provider
  /** 该供应商记录的官网地址（存在应用配置里，空串 = 没有） */
  website: string
  /** 目标侧最终使用的名字（重名时已自动加 -copy 后缀） */
  resolvedName: string
  onCopy: () => Promise<void>
  onClose: () => void
}

/**
 * 单个供应商「复制到其他 Agent」确认框。
 * 展示会被复制过去的内容（api / Base URL / API Key / 官网 / 模型），
 * 让用户在写盘前确认一眼。
 */
export default function CopyProviderDialog({
  from,
  name,
  provider,
  website,
  resolvedName,
  onCopy,
  onClose
}: CopyProviderDialogProps): React.JSX.Element {
  const target = otherAgentOf(from)
  const core = pickCoreProvider(provider)
  const models = core.models ?? []
  const renamed = resolvedName !== name

  const rows: Array<[string, string]> = [
    ['API 类型', core.api ?? '（未设置）'],
    ['Base URL', core.baseUrl ?? '（未设置）'],
    ['API Key', core.apiKey ? '已填写' : '（未设置）'],
    // 官网不在 CLI 配置里，但会一并迁移到目标侧的记录中
    ...(website ? [['官网', website] as [string, string]] : []),
    ['模型', `${models.length} 个`]
  ]

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle>复制到 {agentLabel(target)}</DialogTitle>
          <DialogDescription>
            把「{name}」的供应商信息、模型{website ? '和官网' : ''}复制到 {agentLabel(target)}，
            {agentLabel(target)} 现有供应商不受影响。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {/* 源 → 目标 */}
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <AgentIcon agent={from} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{name}</span>
            <ArrowRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <AgentIcon agent={target} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{resolvedName}</span>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono">{value}</dd>
              </div>
            ))}
          </dl>

          {models.length > 0 && (
            <div className="flex flex-col gap-1.5 text-xs">
              <span className="text-muted-foreground">
                模型清单（仅带 id / 名称 / 上下文大小 / 最大输出 / 输入类型）
              </span>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="bg-muted/50 flex items-center gap-2 rounded px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{model.id}</span>
                    {model.name && model.name !== model.id && (
                      <span className="text-muted-foreground max-w-24 truncate">{model.name}</span>
                    )}
                    {model.contextWindow !== undefined && (
                      <span className="text-muted-foreground shrink-0 font-mono">
                        {formatContext(model.contextWindow)}
                      </span>
                    )}
                    {model.maxTokens !== undefined && (
                      <span className="text-muted-foreground shrink-0 font-mono" title="最大输出">
                        ↳{formatContext(model.maxTokens)}
                      </span>
                    )}
                    {model.input && model.input.length > 0 && (
                      <span className="text-muted-foreground shrink-0">
                        {model.input.join('+')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {renamed && (
            <p className="text-muted-foreground text-xs">
              {agentLabel(target)} 已有同名供应商，将保存为{' '}
              <span className="font-mono">{resolvedName}</span>，不覆盖原有配置。
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-2 pb-1">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={() => void onCopy()}>
            <Check aria-hidden="true" />
            复制到 {agentLabel(target)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
