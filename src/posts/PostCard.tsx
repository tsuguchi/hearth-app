import { UserRound } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MoreMenu, type MoreMenuItem } from '../components/MoreMenu'
import { Notice } from '../components/ui'
import { UserLink } from '../components/UserLink'
import type { Profile } from '../profile/useMyProfile'
import { Comments } from '../social/Comments'
import { FollowButton } from '../social/FollowButton'
import { LikeButton } from '../social/LikeButton'
import { ReportDialog } from '../social/ReportDialog'
import { CaptionText } from './CaptionText'
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
  const [reporting, setReporting] = useState(false)
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

  // 自分の投稿は削除、ほかの人の投稿は通報。運営者はほかの人の投稿も削除できる
  const menu: MoreMenuItem[] = isMine
    ? [{ label: 'この投稿を削除', onSelect: () => setConfirming(true), danger: true }]
    : [
        { label: 'この投稿を通報', onSelect: () => setReporting(true) },
        ...(isAdmin ? [{ label: '運営者として削除', onSelect: () => setConfirming(true), danger: true }] : []),
      ]

  return (
    <article aria-labelledby={`post-${post.id}-author`} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
      <header className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-divider text-muted">
          <UserRound className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p id={`post-${post.id}-author`} className="truncate"><UserLink profile={author} /></p>
          <p className="truncate text-note text-muted">
            {author && <span>@{author.username}</span>}
            {date && <> ・ <time dateTime={date.toISOString()}>{formatPostTime(date)}</time></>}
          </p>
        </div>
        <FollowButton target={post.author} name={name} onError={setError} />
        <MoreMenu label={`${name}さんの投稿の操作`} items={menu} />
      </header>
      <PhotoCarousel photos={post.photos} fallbackAlt={`${name}さんの写真`} />
      <div className="-my-1 flex items-center gap-1">
        <LikeButton me={me} postId={post.id} author={post.author} onError={setError} />
      </div>
      {post.caption && <CaptionText text={post.caption} />}
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
      {reporting && (
        <ReportDialog
          me={me}
          target={{ type: 'post', path: `posts/${post.id}`, user: post.author, label: `${name}さんの投稿` }}
          onClose={() => setReporting(false)}
        />
      )}
    </article>
  )
}
