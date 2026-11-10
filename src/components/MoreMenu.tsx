import * as Menu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'

export type MoreMenuItem = { label: string, onSelect: () => void, danger?: boolean }

// 「その他の操作」のメニュー（削除・通報・ブロックなど）。キーボードと読み上げの動きは Radix に任せる
export function MoreMenu({ label, items }: { label: string, items: MoreMenuItem[] }) {
  if (items.length === 0) return null
  return (
    <Menu.Root>
      <Menu.Trigger className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-bg hover:text-text">
        <MoreHorizontal aria-hidden className="size-6" />
        <span className="sr-only">{label}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-20 min-w-48 rounded-xl border border-divider bg-surface p-1 shadow-lg">
          {items.map((item) => (
            <Menu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={`flex min-h-11 cursor-pointer items-center rounded-lg px-3 outline-none data-highlighted:bg-bg ${item.danger ? 'text-error' : 'text-text'}`}
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}
