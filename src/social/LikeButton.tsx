import * as Dialog from '@radix-ui/react-dialog'
import { collection, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { Heart, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { useProfiles } from '../profile/useProfiles'
import { like, unlike } from './actions'

// いいね（F-41）。ハートの塗りと数で示す（色だけに頼らない）
export function LikeButton({ me, postId, author, onError }: { me: string, postId: string, author: string, onError: (message: string) => void }) {
  const [liked, setLiked] = useState<{ postId: string, value: boolean } | null>(null)
  const [count, setCount] = useState<{ postId: string, value: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  useEffect(() => onSnapshot(
    doc(db, 'posts', postId, 'likes', me),
    (snapshot) => setLiked({ postId, value: snapshot.exists() }),
    () => setLiked({ postId, value: false }),
  ), [postId, me])

  useEffect(() => {
    let cancelled = false
    getCountFromServer(collection(db, 'posts', postId, 'likes'))
      .then((snapshot) => !cancelled && setCount({ postId, value: snapshot.data().count }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [postId])

  const isLiked = liked?.postId === postId && liked.value
  const total = count?.postId === postId ? count.value : null

  async function toggle() {
    if (busy || liked?.postId !== postId) return
    setBusy(true)
    const next = !isLiked
    try {
      await (next ? like(me, postId, author) : unlike(me, postId, author))
      setCount((current) => current && { postId, value: Math.max(0, current.value + (next ? 1 : -1)) })
    } catch {
      onError(next ? 'いいねできませんでした。もう一度お試しください。' : 'いいねを外せませんでした。もう一度お試しください。')
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center">
      <button
        type="button"
        aria-pressed={isLiked}
        aria-disabled={busy || undefined}
        onClick={toggle}
        className={`flex size-11 items-center justify-center rounded-full hover:bg-bg ${isLiked ? 'text-accent' : 'text-muted hover:text-text'}`}
      >
        <Heart aria-hidden className="size-6" fill={isLiked ? 'currentColor' : 'none'} />
        <span className="sr-only">いいね</span>
      </button>
      {total !== null && (
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-disabled={total === 0 || undefined}
          className="min-h-11 rounded-full px-2 text-note text-muted hover:text-text aria-disabled:pointer-events-none"
        >
          <span className="font-bold text-text">{total}</span> 件<span className="sr-only">のいいね。いいねした人を見る</span>
        </button>
      )}
      {listOpen && <LikersDialog postId={postId} onClose={() => setListOpen(false)} />}
    </div>
  )
}

// いいねした人の一覧（F-41）
function LikersDialog({ postId, onClose }: { postId: string, onClose: () => void }) {
  const [uids, setUids] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const profiles = useProfiles(uids ?? [])

  useEffect(() => {
    getDocs(query(collection(db, 'posts', postId, 'likes'), orderBy('createdAt', 'desc'), limit(100)))
      .then((snapshot) => setUids(snapshot.docs.map((document) => document.id)))
      .catch(() => setFailed(true))
  }, [postId])

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 flex max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-subtitle font-bold">いいねした人</Dialog.Title>
            <Dialog.Close className="flex size-11 items-center justify-center rounded-full text-muted hover:text-text">
              <X aria-hidden className="size-6" />
              <span className="sr-only">閉じる</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">この投稿にいいねした人の一覧です。</Dialog.Description>
          {failed && <p role="alert" className="text-error">読み込めませんでした。</p>}
          {!failed && uids === null && <p role="status">読み込み中…</p>}
          {uids && (
            <ul className="flex flex-col gap-2 overflow-y-auto">
              {uids.map((uid) => {
                const profile = profiles.get(uid)
                return (
                  <li key={uid}>
                    <span className="font-bold">{profile?.displayName ?? '…'}</span>
                    {profile && <span className="ml-2 text-note text-muted">@{profile.username}</span>}
                  </li>
                )
              })}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
