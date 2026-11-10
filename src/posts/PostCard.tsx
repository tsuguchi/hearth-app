import { Trash2, UserRound } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Notice } from '../components/ui'
import type { Profile } from '../profile/useMyProfile'
import { Comments } from '../social/Comments'
import { FollowButton } from '../social/FollowButton'
import { LikeButton } from '../social/LikeButton'
import { formatPostTime } from './format'
import { PhotoCarousel } from './PhotoCarousel'
import type { Post } from './types'

export function PostCard({ post, author, me, isAdmin, onDeleted }: {
  post: Post
  author: Profile | null | undefined
  me: string
  isAdmin: boolean
  onDeleted: () => void
}) {
  const isMine = post.author === me
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = author?.displayName ?? '（読み込み中）'
  const date = post.createdAt?.toDate()

  async function remove() {
    setBusy(true)
    try {
      await api(`/api/posts/${post.id}`, { method: 'DELETE' })
      setConfirming(false)
      onDeleted()
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'not_found' ? 'この投稿は、もう削除されています。' : '削除できませんでした。もう一度お試しください。')
      setConfirming(false)
      setBusy(false)
    }
  }

  return (
    <article aria-labelledby={`post-${post.id}-author`} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-divider text-muted">
          <UserRound className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p id={`post-${post.id}-author`} className="truncate font-bold">{name}</p>
          <p className="truncate text-note text-muted">
            {author && <span>@{author.username}</span>}
            {date && <> ・ <time dateTime={date.toISOString()}>{formatPostTime(date)}</time></>}
          </p>
        </div>
        <FollowButton target={post.author} name={name} onError={setError} />
        {isMine && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex min-h-11 items-center gap-1 rounded-full px-3 text-note text-muted hover:text-error"
          >
            <Trash2 aria-hidden className="size-5" />
            <span><span className="sr-only">この投稿を</span>削除</span>
          </button>
        )}
      </header>
      <PhotoCarousel photos={post.photos} fallbackAlt={`${name}さんの写真`} />
      <div className="-my-1 flex items-center gap-1">
        <LikeButton me={me} postId={post.id} author={post.author} onError={setError} />
      </div>
      {post.caption && <p className="whitespace-pre-wrap break-words">{post.caption}</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <Comments me={me} postId={post.id} postAuthor={post.author} isAdmin={isAdmin} onError={setError} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="この投稿を削除しますか？"
        confirmLabel="削除する"
        busy={busy}
        onConfirm={remove}
      >
        <p>写真・コメント・いいねも一緒に消え、元に戻せません。</p>
      </ConfirmDialog>
    </article>
  )
}
