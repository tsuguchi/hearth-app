import { collection, limit, onSnapshot, orderBy, query, type Timestamp, where } from 'firebase/firestore'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import { useBlocks } from '../social/BlocksProvider'

// 自分のやり取りの一覧と、読んでいないやり取りの数（F-62、F-96）

export type Conversation = {
  id: string
  members: string[]
  lastMessageAt: Timestamp | null
  lastReadAt: Record<string, Timestamp | null>
}

type MessagesState = { conversations: Conversation[] | null, unread: number }

const MessagesContext = createContext<MessagesState | null>(null)

export function conversationIdFor(a: string, b: string): string {
  return [a, b].sort().join('_')
}

export function otherMemberOf(conversation: Conversation, me: string): string {
  return conversation.members.find((member) => member !== me) ?? me
}

export function isConversationUnread(conversation: Conversation, me: string): boolean {
  const last = conversation.lastMessageAt
  const read = conversation.lastReadAt?.[me]
  if (!last) return false
  return !read || last.toMillis() > read.toMillis()
}

export function MessagesProvider({ me, children }: { me: string, children: ReactNode }) {
  const { blocked } = useBlocks()
  const [state, setState] = useState<{ me: string, list: Conversation[] } | null>(null)

  useEffect(() => onSnapshot(
    query(collection(db, 'conversations'), where('members', 'array-contains', me), orderBy('lastMessageAt', 'desc'), limit(100)),
    // サーバーの日時が決まる前（書いた直後）は、見込みの日時を使う。null のままだと「読んでいない」と誤って数えてしまうため
    (snapshot) => setState({ me, list: snapshot.docs.map((document) => ({ id: document.id, ...document.data({ serverTimestamps: 'estimate' }) }) as Conversation) }),
    () => setState({ me, list: [] }),
  ), [me])

  const value = useMemo<MessagesState>(() => {
    if (state?.me !== me) return { conversations: null, unread: 0 }
    // ブロックした相手とのやり取りは出さない
    const conversations = state.list.filter((conversation) => !blocked?.has(otherMemberOf(conversation, me)))
    return { conversations, unread: conversations.filter((conversation) => isConversationUnread(conversation, me)).length }
  }, [state, me, blocked])

  return <MessagesContext value={value}>{children}</MessagesContext>
}

export function useMessages(): MessagesState {
  const value = useContext(MessagesContext)
  if (!value) throw new Error('MessagesProvider の中で使ってください')
  return value
}
