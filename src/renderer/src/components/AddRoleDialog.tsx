import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface AddRoleDialogProps {
  /** 尚未配置的已知角色，作为快捷选项 */
  knownRoles: string[]
  exists: (role: string) => boolean
  onAdd: (role: string) => void
  onClose: () => void
}

/** 添加角色弹框：常用角色一键填入，或输入自定义角色名 */
export default function AddRoleDialog({
  knownRoles,
  exists,
  onAdd,
  onClose
}: AddRoleDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = name.trim()
  const duplicate = trimmed !== '' && exists(trimmed)
  const valid = trimmed !== '' && !duplicate

  const submit = (): void => {
    if (!valid) return
    onAdd(trimmed)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        // 聚焦输入框但不全选（Radix 默认行为会全选文本）
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader>
          <DialogTitle>添加角色</DialogTitle>
          <DialogDescription>新角色初始沿用 default 的模型，添加后可再调整</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="role-name">角色名</Label>
            <Input
              id="role-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="如 plan"
              className="font-mono"
              aria-invalid={duplicate}
            />
            {duplicate && <span className="text-destructive text-xs">已存在同名角色</span>}
          </div>

          {knownRoles.length > 0 && (
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground text-xs">常用角色</Label>
              <div className="flex flex-wrap gap-1.5">
                {knownRoles.map((role) => (
                  <Button
                    key={role}
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-full px-3 font-mono text-xs"
                    onClick={() => setName(role)}
                  >
                    {role}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!valid} onClick={submit}>
            <Plus />
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
