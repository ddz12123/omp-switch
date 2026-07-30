import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'

interface ConfirmDialogProps {
  title: string
  description?: string
  /** 确认按钮文案，默认「删除」 */
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}

/** 通用二次确认弹框（destructive 语境：删除/移除） */
export default function ConfirmDialog({
  title,
  description,
  confirmLabel = '删除',
  onConfirm,
  onClose
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
