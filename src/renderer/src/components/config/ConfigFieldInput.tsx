import type { ConfigFieldDef } from '@shared/types'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { errorMessage } from '../../stores/app'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import Combobox from '../ui/combobox'

interface ConfigFieldInputProps {
  field: ConfigFieldDef
  /** 当前值（未设置时为 undefined） */
  value: unknown
  /** 依赖未满足（父开关关闭）时禁用输入 */
  disabled?: boolean
  onChange: (value: unknown) => void
}

/** array 字段在表单里用逗号分隔文本编辑 */
function arrayToText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : ''
}

function textToArray(text: string): string[] | undefined {
  const items = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return items.length > 0 ? items : undefined
}

/** 路径字段：输入框 + 系统文件选择按钮 */
function PathInput({
  value,
  placeholder,
  disabled,
  onChange
}: {
  value: unknown
  placeholder?: string
  disabled?: boolean
  onChange: (value: unknown) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <Input
        value={typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        title="选择文件"
        disabled={disabled}
        onClick={() => {
          void window.api
            .pickConfigFilePath()
            .then((picked) => {
              if (picked !== null) onChange(picked)
            })
            .catch((error) => toast.error(`选择文件失败：${errorMessage(error)}`))
        }}
      >
        <FolderOpen />
      </Button>
    </div>
  )
}

/** 按字段类型渲染单个配置输入；依赖未满足时整体禁用 */
export default function ConfigFieldInput({
  field,
  value,
  disabled,
  onChange
}: ConfigFieldInputProps): React.JSX.Element {
  switch (field.type) {
    case 'boolean':
      return <Switch checked={value === true} disabled={disabled} onCheckedChange={onChange} />
    case 'select':
      return (
        <Combobox
          value={typeof value === 'string' ? value : null}
          options={field.options ?? []}
          allowCustom={field.allowCustom}
          disabled={disabled}
          onChange={(v) => onChange(v === null ? undefined : v)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          value={typeof value === 'number' ? value : ''}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.trim()
            onChange(raw === '' ? undefined : Number(raw))
          }}
        />
      )
    case 'secret':
      return (
        <Input
          type="password"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'array':
      return (
        <Input
          value={arrayToText(value)}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(textToArray(e.target.value))}
        />
      )
    case 'path':
      return (
        <PathInput
          value={value}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={onChange}
        />
      )
    default:
      return (
        <Input
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}
