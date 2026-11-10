import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'

// 通知（F-95〜F-98）。画面の切り替えの数（読んでいない数）と、通知の一覧が使う

export type NotificationType = 'like' | 'comment' | 'follow' | 'inviteUsed'

export type HearthNotification = {
  id: string
  type: NotificationType
  actor: string
  postId?: string
  createdAt: Timestamp | null
}

const KEEP_DAYS = 90 // F-97
const MAX_ITEMS = 100

type NotificationsState = {
  loaded: boolean
  notifications: HearthNotification[]
  lastRead: Timestamp | null
  unread: number
  markAllRead: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsState | null>(null)

export function isUnread(notification: HearthNotification, lastRead: Timestamp | null): boolean {
  if (!notification.createdAt) return false
  return !lastRead || notification.createdAt.toMillis() > lastRead.toMillis()
}

export function NotificationsProvider({ me, children }: { me: string, children: ReactNode }) {
  const [items, setItems] = useState<{ me: string, list: HearthNotification[] } | null>(null)
  const [lastRead, setLastRead] = useState<{ me: string, value: Timestamp | null } | null>(null)
  const [blocked, setBlocked] = useState<{ me: string, set: Set<string> } | null>(null)

  // 90 日より前の通知は出さない（消すのは定時の実行）
  useEffect(() => {
    const since = Timestamp.fromMillis(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000)
    return onSnapshot(
      query(collection(db, 'users', me, 'notifications'), where('createdAt', '>', since), orderBy('createdAt', 'desc'), limit(MAX_ITEMS)),
      (snapshot) => setItems({ me, list: snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as HearthNotification) }),
      () => setItems({ me, list: [] }),
    )
  }, [me])

  useEffect(() => onSnapshot(
    doc(db, 'userPrivate', me),
    (snapshot) => setLastRead({ me, value: (snapshot.data()?.lastReadNotificationsAt as Timestamp | undefined) ?? null }),
    () => setLastRead({ me, value: null }),
  ), [me])

  // ブロックした相手からの通知は出さない（F-98）
  useEffect(() => onSnapshot(
    collection(db, 'users', me, 'blocks'),
    (snapshot) => setBlocked({ me, set: new Set(snapshot.docs.map((document) => document.id)) }),
    () => setBlocked({ me, set: new Set() }),
  ), [me])

  const markAllRead = useCallback(async () => {
    await updateDoc(doc(db, 'userPrivate', me), { lastReadNotificationsAt: serverTimestamp() })
  }, [me])

  const value = useMemo<NotificationsState>(() => {
    const loaded = items?.me === me && lastRead?.me === me && blocked?.me === me
    const read = lastRead?.me === me ? lastRead.value : null
    const notifications = loaded ? items!.list.filter((notification) => !blocked!.set.has(notification.actor)) : []
    return {
      loaded,
      notifications,
      lastRead: read,
      unread: notifications.filter((notification) => isUnread(notification, read)).length,
      markAllRead,
    }
  }, [items, lastRead, blocked, me, markAllRead])

  return <NotificationsContext value={value}>{children}</NotificationsContext>
}

export function useNotifications(): NotificationsState {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('NotificationsProvider の中で使ってください')
  return value
}
