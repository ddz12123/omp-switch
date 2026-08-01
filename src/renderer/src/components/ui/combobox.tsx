import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from './command'

interface ComboboxProps {
  /** 当前值；null = 未设置 */
  value: string | null
  options: string[]
  /** 允许输入并选择 options 之外的值 */
  allowCustom?: boolean
  /** 未设置选项的文案 */
  unsetLabel?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  onChange: (value: string | null) => void
}

/** 可搜索下拉：按钮 + 弹出列表 + 输入过滤；顶部固定「未设置」（选择后回传 null） */
export default function Combobox({
  value,
  options,
  allowCustom = false,
  unsetLabel = '未设置',
  searchPlaceholder = '搜索…',
  emptyText = '无匹配项',
  disabled,
  onChange
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const pick = (next: string | null): void => {
    onChange(next)
    setOpen(false)
  }

  const normalized = query.trim().toLowerCase()
  const filtered =
    normalized === '' ? options : options.filter((o) => o.toLowerCase().includes(normalized))
  const customValue = query.trim()
  const canCreate =
    allowCustom && customValue !== '' && !options.some((option) => option === customValue)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-mono text-sm"
        >
          <span className="truncate">{value ?? unsetLabel}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={unsetLabel} onSelect={() => pick(null)}>
                <Check className={cn('size-4', value === null ? 'opacity-100' : 'opacity-0')} />
                {unsetLabel}
              </CommandItem>
              {filtered.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => pick(option)}
                  className="font-mono"
                >
                  <Check className={cn('size-4', value === option ? 'opacity-100' : 'opacity-0')} />
                  {option}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem value={customValue} onSelect={() => pick(customValue)}>
                  使用「{customValue}」
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
