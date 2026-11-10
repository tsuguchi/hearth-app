import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { Button } from './ui'

// 取り消せない操作の前に確かめるダイアログ。読み上げとキーボードの動きは Radix に任せる
export function ConfirmDialog({ open, onOpenChange, title, children, confirmLabel, busy, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lg">
          <Dialog.Title className="text-subtitle font-bold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div>{children}</div>
          </Dialog.Description>
          <div className="flex flex-wrap justify-end gap-3">
            <Dialog.Close asChild>
              <Button variant="secondary">やめる</Button>
            </Dialog.Close>
            <Button busy={busy} onClick={onConfirm} className="bg-error text-surface">{confirmLabel}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
