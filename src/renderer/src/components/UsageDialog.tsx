import { useState } from 'react'
import { Play, Save } from 'lucide-react'
import type { Provider, UsageQueryConfig } from '@shared/types'
import { toast } from 'sonner'
import { errorMessage } from '../stores/app'
import { fetchUsageQuery, getUsageQuery, setUsageQuery, USAGE_PRESETS } from '../lib/usageQueries'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface UsageDialogProps {
  agent: 'pi' | 'omp'
  name: string
  provider: Provider
  onClose: () => void
}

const PRESET_LABELS: Record<UsageQueryConfig['preset'], string> = {
  custom: '自定义',
  general: '通用模板',
  newapi: 'NewAPI'
}

const SCRIPT_EXAMPLE = `({
  request: {
    url: "{{baseUrl}}/api/usage",
    method: "POST",
    headers: {
      "Authorization": "Bearer {{apiKey}}",
      "User-Agent": "omp-switch/1.0"
    }
  },
  extractor: function (response) {
    return {
      isValid: !response.error,
      remaining: response.balance,
      unit: "USD"
    }
  }
})`

function validate(query: UsageQueryConfig): string | null {
  if (
    !Number.isInteger(query.timeoutSeconds) ||
    query.timeoutSeconds < 1 ||
    query.timeoutSeconds > 120
  ) {
    return '超时时间必须是 1 到 120 的整数秒'
  }
  if (
    !Number.isInteger(query.intervalMinutes) ||
    query.intervalMinutes < 0 ||
    query.intervalMinutes > 1440
  ) {
    return '自动查询间隔必须是 0 到 1440 的整数分钟'
  }
  if (query.enabled && !query.script.trim()) return '启用用量查询前请填写提取器代码'
  return null
}

function testSuccessMessage(extracted: unknown): string {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) return '测试成功'
  const value = extracted as Record<string, unknown>
  if (value.isValid === false)
    return value.invalidMessage ? `测试失败：${value.invalidMessage}` : '测试失败：账户无效'
  const remaining = value.remaining
  if (typeof remaining !== 'number' && typeof remaining !== 'string') return '测试成功'
  const unit = typeof value.unit === 'string' && value.unit ? ` ${value.unit}` : ''
  return `测试成功！剩余：${remaining}${unit}`
}

export default function UsageDialog({
  agent,
  name,
  provider,
  onClose
}: UsageDialogProps): React.JSX.Element {
  const [query, setQuery] = useState<UsageQueryConfig>(() => getUsageQuery(agent, name, provider))
  const [testing, setTesting] = useState(false)

  const setField = <K extends keyof UsageQueryConfig>(key: K, value: UsageQueryConfig[K]): void => {
    setQuery((current) => ({ ...current, [key]: value }))
  }

  const choosePreset = (preset: UsageQueryConfig['preset']): void => {
    setQuery((current) => ({ ...current, preset, script: USAGE_PRESETS[preset] }))
  }

  const test = async (): Promise<void> => {
    const issue = validate(query)
    if (issue) {
      toast.error(issue, { position: 'top-center' })
      return
    }
    setTesting(true)
    try {
      const result = await fetchUsageQuery(query, provider)
      const message = testSuccessMessage(result.extracted)
      if (message.startsWith('测试失败：')) toast.error(message, { position: 'top-center' })
      else toast.success(message, { position: 'top-center' })
    } catch (reason) {
      toast.error(`测试失败：${errorMessage(reason)}`, { position: 'top-center' })
    } finally {
      setTesting(false)
    }
  }
  const save = (): void => {
    const issue = validate(query)
    if (issue) {
      toast.error(issue, { position: 'top-center' })
      return
    }
    setUsageQuery(agent, name, query)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[84vh] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>配置用量查询 · {name}</DialogTitle>
          <DialogDescription>配置仅保存在本应用；测试会发送脚本中定义的请求。</DialogDescription>
        </DialogHeader>

        <div className="-mr-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-4 pb-4">
          <div className="flex items-center justify-between rounded-xl border p-4">
            <Label htmlFor="usage-enabled" className="text-base">
              启用用量查询
            </Label>
            <Switch
              id="usage-enabled"
              checked={query.enabled}
              onCheckedChange={(value) => setField('enabled', value)}
            />
          </div>

          <section className="space-y-4 rounded-xl border p-5">
            <div>
              <h3 className="font-semibold">预设模板</h3>
              <p className="text-muted-foreground mt-1 text-xs">选择模板会替换当前提取器代码。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['custom', 'general', 'newapi'] as const).map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={query.preset === preset ? 'default' : 'outline'}
                  onClick={() => choosePreset(preset)}
                >
                  {PRESET_LABELS[preset]}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="usage-key">API Key（可选）</Label>
                <Input
                  id="usage-key"
                  type="password"
                  value={query.apiKey ?? ''}
                  onChange={(event) => setField('apiKey', event.target.value)}
                  placeholder="留空使用供应商 API Key"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="usage-base">请求地址基址（可选）</Label>
                <Input
                  id="usage-base"
                  value={query.baseUrl ?? ''}
                  onChange={(event) => setField('baseUrl', event.target.value)}
                  placeholder="留空使用供应商 Base URL"
                  className="font-mono"
                />
              </div>
              {query.preset === 'newapi' && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="usage-token">Access Token</Label>
                    <Input
                      id="usage-token"
                      type="password"
                      value={query.accessToken ?? ''}
                      onChange={(event) => setField('accessToken', event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="usage-user">用户 ID</Label>
                    <Input
                      id="usage-user"
                      value={query.userId ?? ''}
                      onChange={(event) => setField('userId', event.target.value)}
                    />
                  </div>
                </>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="usage-timeout">超时时间（秒）</Label>
                <Input
                  id="usage-timeout"
                  type="number"
                  min="1"
                  max="120"
                  value={query.timeoutSeconds}
                  onChange={(event) => setField('timeoutSeconds', Number(event.target.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="usage-interval">自动查询间隔（分钟，0 表示关闭）</Label>
                <Input
                  id="usage-interval"
                  type="number"
                  min="0"
                  max="1440"
                  value={query.intervalMinutes}
                  onChange={(event) => setField('intervalMinutes', Number(event.target.value))}
                />
              </div>
            </div>
          </section>

          <section className="grid min-h-96 gap-2 rounded-xl border p-5">
            <div>
              <Label htmlFor="usage-script">提取器代码</Label>
              <p className="text-muted-foreground mt-1 text-xs">
                可使用 {'{{apiKey}}'}、{'{{baseUrl}}'}、{'{{accessToken}}'} 和 {'{{userId}}'}
                。返回对象可包含 remaining、used、total、unit 等字段。
              </p>
            </div>
            <textarea
              id="usage-script"
              value={query.script}
              onChange={(event) => setField('script', event.target.value)}
              spellCheck={false}
              className="bg-muted/40 min-h-72 w-full resize-y rounded-lg border p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2"
              aria-label="用量查询提取器代码"
            />
          </section>

          <section className="space-y-3 rounded-xl border p-5 text-xs">
            <h3 className="text-sm font-semibold">脚本编写说明</h3>
            <div>
              <p className="mb-1 font-medium">配置格式：</p>
              <pre className="bg-muted overflow-x-auto rounded-lg border p-3 font-mono leading-5 whitespace-pre">
                {SCRIPT_EXAMPLE}
              </pre>
            </div>
            <div className="space-y-1">
              <p className="font-medium">extractor 返回格式（所有字段均为可选）：</p>
              <ul className="text-muted-foreground list-disc space-y-0.5 pl-4">
                <li>
                  <code>isValid</code>：布尔值，套餐是否有效
                </li>
                <li>
                  <code>invalidMessage</code>：字符串，失败原因说明（当 isValid 为 false 时显示）
                </li>
                <li>
                  <code>remaining</code>：数字，剩余额度
                </li>
                <li>
                  <code>unit</code>：字符串，单位（如 “USD”）
                </li>
                <li>
                  <code>planName</code>：字符串，套餐名称
                </li>
                <li>
                  <code>total</code>：数字，总额度
                </li>
                <li>
                  <code>used</code>：数字，已用额度
                </li>
                <li>
                  <code>extra</code>：字符串，扩展字段，可自由补充需要展示的文本
                </li>
              </ul>
            </div>
            <div className="text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">提示：</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  变量 {'{{apiKey}}'}、{'{{baseUrl}}'}、{'{{accessToken}}'} 和 {'{{userId}}'}{' '}
                  会自动替换
                </li>
                <li>extractor 函数支持现代 JavaScript 的 ES2020+ 语法</li>
                <li>整个配置必须用 () 包裹，形成对象字面量表达式</li>
              </ul>
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" variant="outline" onClick={() => void test()} disabled={testing}>
            <Play />
            {testing ? '测试中…' : '测试脚本'}
          </Button>
          <Button type="button" onClick={save}>
            <Save />
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
