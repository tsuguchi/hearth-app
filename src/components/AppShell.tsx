import { Bell, Home, type LucideIcon, MessageCircle, PlusSquare, Search, Settings, ShieldCheck, Ticket, UserRound } from 'lucide-react'
import { type ReactNode, useEffect } from 'react'
import { Link, NavLink } from 'react-router'
import { EmulatorBanner } from './AuthLayout'
import { useAuth } from '../auth/context'
import { useMessages } from '../messages/MessagesProvider'
import { useNotifications } from '../notifications/NotificationsProvider'
import { Logo } from './ui'

type NavItem = { to: string, label: string, shortLabel?: string, icon: LucideIcon }

// スマホでは画面の下に 5 つ、パソコンでは左に縦に並べる（DESIGN.md の 4 章）
const MAIN_ITEMS: NavItem[] = [
  // スマホの下の切り替えは幅が狭いので、短い名前を使う
  { to: '/', label: 'タイムライン', shortLabel: 'ホーム', icon: Home },
  { to: '/search', label: '検索', icon: Search },
  { to: '/new', label: '投稿', icon: PlusSquare },
  { to: '/notifications', label: '通知', icon: Bell },
  { to: '/messages', label: 'メッセージ', icon: MessageCircle },
]
const SUB_ITEMS: NavItem[] = [
  { to: '/me', label: 'プロフィール', icon: UserRound },
  { to: '/invites', label: '招待', icon: Ticket },
  { to: '/settings', label: '設定', icon: Settings },
]
// 運営者にだけ出す
const ADMIN_ITEM: NavItem = { to: '/admin', label: '運営者の画面', icon: ShieldCheck }

function navClass(isActive: boolean, layout: 'bottom' | 'side'): string {
  const base = layout === 'bottom'
    ? 'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-note leading-tight whitespace-nowrap'
    : 'flex min-h-11 items-center gap-3 rounded-full px-4 text-body'
  return `${base} ${isActive ? 'font-bold text-accent-text' : 'text-muted hover:text-text'}`
}

// 読んでいない数（F-96）。色だけに頼らず数字で示す。読み上げ用の「未読 3 件」は、名前の後ろに別に置く
function Badge({ count, layout }: { count: number, layout: 'bottom' | 'side' }) {
  if (count === 0) return null
  return (
    <span aria-hidden className={`rounded-full bg-accent px-1.5 text-note leading-5 font-bold text-on-accent ${layout === 'bottom' ? 'absolute -top-1 left-1/2 ml-1' : 'ml-auto'}`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

function NavItems({ items, layout }: { items: NavItem[], layout: 'bottom' | 'side' }) {
  const { unread: unreadNotifications } = useNotifications()
  const { unread: unreadMessages } = useMessages()
  // 読んでいない数を出す画面（F-96）
  const counts: Record<string, number> = { '/notifications': unreadNotifications, '/messages': unreadMessages }
  return items.map(({ to, label, shortLabel, icon: Icon }) => (
    <li key={to} className={layout === 'bottom' ? 'flex-1' : ''}>
      <NavLink to={to} end={to === '/'} className={({ isActive }) => navClass(isActive, layout)}>
        {({ isActive }) => (
          <>
            <span className="relative">
              <Icon aria-hidden className="size-6 shrink-0" strokeWidth={isActive ? 2.5 : 1.75} />
              {layout === 'bottom' && <Badge count={counts[to] ?? 0} layout="bottom" />}
            </span>
            <span>{layout === 'bottom' ? shortLabel ?? label : label}</span>
            {(counts[to] ?? 0) > 0 && <span className="sr-only">（未読 {counts[to]} 件）</span>}
            {layout === 'side' && <Badge count={counts[to] ?? 0} layout="side" />}
          </>
        )}
      </NavLink>
    </li>
  ))
}

export function AppShell({ title, children }: { title: string, children: ReactNode }) {
  const { isAdmin } = useAuth()
  const subItems = isAdmin ? [...SUB_ITEMS, ADMIN_ITEM] : SUB_ITEMS
  useEffect(() => {
    document.title = `${title}｜ハース`
  }, [title])

  return (
    <div className="min-h-dvh">
      <EmulatorBanner />
      <div className="desktop:flex">
        {/* パソコン: 左の切り替え */}
        <nav aria-label="画面の切り替え" className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-divider px-3 py-6 desktop:flex">
          <Link to="/" className="px-4 text-title"><Logo /></Link>
          <ul className="flex flex-col gap-1">
            <NavItems items={MAIN_ITEMS} layout="side" />
          </ul>
          <ul className="mt-auto flex flex-col gap-1">
            <NavItems items={subItems} layout="side" />
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {/* スマホ: 上の帯。プロフィールと設定はここから */}
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-divider bg-bg/95 px-4 py-2 desktop:hidden">
            <Link to="/" className="text-subtitle"><Logo /></Link>
            <nav aria-label="自分のページ">
              <ul className="flex gap-1">
                {subItems.map(({ to, label, icon: Icon }) => (
                  <li key={to}>
                    <NavLink to={to} aria-label={label} className={({ isActive }) => `flex size-11 items-center justify-center rounded-full ${isActive ? 'text-accent-text' : 'text-muted hover:text-text'}`}>
                      <Icon aria-hidden className="size-6" />
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </header>

          <main className="mx-auto max-w-150 px-4 pt-6 pb-28 desktop:pb-10">
            <h1 className="text-title font-bold">{title}</h1>
            <div className="mt-6">{children}</div>
          </main>
        </div>
      </div>

      {/* スマホ: 下の切り替え */}
      <nav aria-label="画面の切り替え" className="fixed inset-x-0 bottom-0 z-10 border-t border-divider bg-surface pb-[env(safe-area-inset-bottom)] desktop:hidden">
        <ul className="flex px-1">
          <NavItems items={MAIN_ITEMS} layout="bottom" />
        </ul>
      </nav>
    </div>
  )
}
