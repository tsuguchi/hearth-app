import { collection, getDocs } from 'firebase/firestore'
import { Lock, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { TextField } from '../components/ui'
import { db } from '../firebase'
import { isConversationUnread, otherMemberOf, useMessages } from '../messages/MessagesProvider'
import { formatPostTime } from '../posts/format'
import type { Profile } from '../profile/useMyProfile'
import { useProfiles } from '../profile/useProfiles'
import { useBlocks } from '../social/BlocksProvider'

type Member = Profile & { uid: string }

// やり取りの一覧（F-62）。新しい順に並べ、読んでいないものに印を付ける。中身は暗号化しているので、一覧には出さない
export function MessagesPage({ me }: { me: string }) {
  const { conversations } = useMessages()
  const profiles = useProfiles((conversations ?? []).map((conversation) => otherMemberOf(conversation, me)))

  return (
    <AppShell title="メッセージ">
      <div className="flex flex-col gap-6">
        <p className="flex items-start gap-2 text-note text-muted">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          メッセージは暗号化され、あなたと相手の端末でしか読めません。運営者にも読めません。
        </p>
        <NewConversation me={me} />
        <section aria-labelledby="conversations-heading" className="flex flex-col gap-3">
          <h2 id="conversations-heading" className="text-subtitle font-bold">やり取り</h2>
          {conversations === null && <p role="status" className="text-muted">読み込み中…</p>}
          {conversations && conversations.length === 0 && <p className="rounded-2xl bg-surface p-6 text-muted">まだやり取りはありません。</p>}
          {conversations && conversations.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
              {conversations.map((conversation) => {
                const profile = profiles.get(otherMemberOf(conversation, me))
                const unread = isConversationUnread(conversation, me)
                const date = conversation.lastMessageAt?.toDate()
                if (!profile) return null
                return (
                  <li key={conversation.id} className="border-b border-divider last:border-b-0">
                    <Link to={`/messages/${profile.username}`} className="flex items-center gap-3 p-4 hover:bg-bg">
                      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-divider text-muted">
                        <UserRound className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate ${unread ? 'font-bold' : ''}`}>{profile.displayName}</span>
                        <span className="block truncate text-note text-muted">
                          @{profile.username}{date && <> ・ {formatPostTime(date)}</>}
                        </span>
                      </span>
                      {unread && (
                        <span className="rounded-full bg-accent px-2 text-note font-bold text-on-accent">新着</span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  )
}

// 新しく送る相手を探す（利用者は 50 人までなので、全員を読んで絞り込む）
function NewConversation({ me }: { me: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [term, setTerm] = useState('')
  const { blocked } = useBlocks()

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then((snapshot) => setMembers(snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }) as Member)))
      .catch(() => setMembers([]))
  }, [])

  const results = useMemo(() => {
    const needle = term.trim().normalize('NFKC').toLowerCase().replace(/^@/, '')
    if (!needle || !members) return []
    return members
      .filter((member) => member.uid !== me && member.status === 'active' && !blocked?.has(member.uid))
      .filter((member) => member.username.includes(needle) || member.displayName.normalize('NFKC').toLowerCase().includes(needle))
      .slice(0, 10)
  }, [members, term, me, blocked])

  return (
    <section aria-labelledby="new-heading" className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <h2 id="new-heading" className="text-subtitle font-bold">新しくメッセージを送る</h2>
      <TextField label="送る相手" support="ユーザー名か表示名の一部を入れてください。" type="search" value={term} onChange={(event) => setTerm(event.target.value)} />
      {term.trim() && members && results.length === 0 && <p className="text-muted">見つかりませんでした。</p>}
      {results.length > 0 && (
        <ul className="flex flex-col">
          {results.map((member) => (
            <li key={member.uid}>
              <Link to={`/messages/${member.username}`} className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-bg">
                <span className="font-bold">{member.displayName}</span>
                <span className="text-note text-muted">@{member.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
