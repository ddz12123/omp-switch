import { useState } from 'react'
import { LogOut, Minimize2 } from 'lucide-react'
import { useApp } from '../stores/app'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface CloseConfirmDialogProps {
  onClose: () => void
}

/** 点窗口关闭按钮时的二次确认：最小化到托盘 or 直接退出 */
export default function CloseConfirmDialog({
  onClose
}: CloseConfirmDialogProps): React.JSX.Element {
  const setCloseBehavior = useApp((s) => s.setCloseBehavior)
  const [remember, setRemember] = useState(false)

  const choose = (action: 'minimize' | 'quit'): void => {
    if (remember) setCloseBehavior(action)
    window.api.closeAction(action)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>关闭窗口</DialogTitle>
          <DialogDescription>
            最小化到托盘后可从托盘菜单快速切换模型或重新打开窗口
          </DialogDescription>
        </DialogHeader>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="accent-primary size-4"
          />
          记住我的选择，不再询问（可在设置中修改）
        </label>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => choose('quit')}>
              <LogOut />
              直接退出
            </Button>
            <Button onClick={() => choose('minimize')}>
              <Minimize2 />
              最小化到托盘
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
