import { Heart, MessageCircle, UserPlus, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { type HearthNotification, isUnread, useNotifications } from '../notifications/NotificationsProvider'
import { formatPostTime } from '../posts/format'
import type { Profile } from '../profile/useMyProfile'
import { useProfiles } from '../profile/useProfiles'

const ICONS = { like: Heart, comment: MessageCircle, follow: UserPlus, inviteUsed: UserRound }

function describe(notification: HearthNotification, name: string): string {
  switch (notification.type) {
    case 'like':
      return `${name}さんが、あなたの投稿にいいねしました`
    case 'comment':
      return `${name}さんが、あなたの投稿にコメントしました`
    case 'follow':
      return `${name}さんが、あなたをフォローしました`
    case 'inviteUsed':
      return `${name}さんが、あなたの招待で登録しました`
  }
}

function linkFor(notification: HearthNotification, actor: Profile | null | undefined): string | null {
  if ((notification.type === 'like' || notification.type === 'comment') && notification.postId) return `/posts/${notification.postId}`
  return actor ? `/users/${actor.username}` : null
}

// 通知の一覧（F-95）。開いたときに、すべてを読んだことにする。この画面にいる間は、開く前に新しかったものに「新着」を付けたままにする
export function NotificationsPage() {
  const { loaded, notifications, lastRead, markAllRead } = useNotifications()
  const profiles = useProfiles(notifications.map((notification) => notification.actor))
  const [readBefore, setReadBefore] = useState<typeof lastRead | undefined>(undefined)
  const marked = useRef(false)

  useEffect(() => {
    if (!loaded || marked.current) return
    marked.current = true
    // 開く前の「読んだ日時」を覚えてから、読んだことにする
    setReadBefore(lastRead)
    void markAllRead().catch(() => {})
  }, [loaded, lastRead, markAllRead])

  return (
    <AppShell title="通知">
      {!loaded && <p role="status" className="text-muted">読み込み中…</p>}
      {loaded && notifications.length === 0 && (
        <div className="rounded-2xl bg-surface p-6">
          <p>通知はまだありません。</p>
          <p className="mt-2 text-note text-muted">いいね・コメント・フォローされたときや、あなたの招待で人が登録したときに、ここに出ます。90 日たった通知は消えます。</p>
        </div>
      )}
      {loaded && notifications.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
          {notifications.map((notification) => {
            const actor = profiles.get(notification.actor)
            const name = actor?.displayName ?? (actor === null ? '退会した人' : '…')
            const Icon = ICONS[notification.type]
            const fresh = readBefore !== undefined && isUnread(notification, readBefore)
            const date = notification.createdAt?.toDate()
            const to = linkFor(notification, actor)
            const body = (
              <>
                <Icon aria-hidden className={`mt-0.5 size-6 shrink-0 ${notification.type === 'like' ? 'text-accent' : 'text-muted'}`} />
                <span className="flex min-w-0 flex-col">
                  <span className={fresh ? 'font-bold' : ''}>
                    {fresh && <span className="mr-2 rounded-full bg-accent px-2 text-note font-bold text-on-accent">新着<span className="sr-only">：</span></span>}
                    {describe(notification, name)}
                  </span>
                  {date && <time dateTime={date.toISOString()} className="text-note text-muted">{formatPostTime(date)}</time>}
                </span>
              </>
            )
            return (
              <li key={notification.id} className="border-b border-divider last:border-b-0">
                {to ? (
                  <Link to={to} className="flex items-start gap-3 p-4 hover:bg-bg">{body}</Link>
                ) : (
                  <div className="flex items-start gap-3 p-4">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </AppShell>
  )
}
