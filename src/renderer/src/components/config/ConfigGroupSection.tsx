import type { ConfigFieldGroup } from '@shared/types'
import { cn } from '../../lib/utils'
import ConfigFieldInput from './ConfigFieldInput'

interface ConfigGroupSectionProps {
  group: ConfigFieldGroup
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}

/** 一个分组的卡片：标题 + 说明 + 字段列表（label 左、输入右）；依赖未满足的字段整体置灰 */
export default function ConfigGroupSection({
  group,
  values,
  onChange
}: ConfigGroupSectionProps): React.JSX.Element {
  return (
    <section className="border-border/60 bg-card rounded-xl border p-5">
      <h3 className="text-sm font-semibold">{group.label}</h3>
      {group.desc && <p className="text-muted-foreground mt-0.5 text-xs">{group.desc}</p>}
      <div className="mt-4 flex flex-col gap-4">
        {group.fields.map((field) => {
          // 依赖父开关：父字段不为 true 时禁用（如 bash.enabled 关 → shellPath 不可配）
          const disabled = field.enabledWhen !== undefined && values[field.enabledWhen] !== true
          return (
            <div
              key={field.key}
              className={cn('flex items-center gap-4', disabled && 'opacity-50')}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{field.label}</span>
                  <code className="text-muted-foreground/70 font-mono text-[11px]">
                    {field.key}
                  </code>
                  {disabled && (
                    <span className="text-muted-foreground/60 text-[11px]">
                      （需先启用 {field.enabledWhen}）
                    </span>
                  )}
                </div>
                {field.desc && <p className="text-muted-foreground mt-0.5 text-xs">{field.desc}</p>}
              </div>
              <div className="w-56 shrink-0">
                <ConfigFieldInput
                  field={field}
                  value={values[field.key]}
                  disabled={disabled}
                  onChange={(v) => onChange(field.key, v)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
