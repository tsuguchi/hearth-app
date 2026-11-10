import { collection, getCountFromServer, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore'
import { MessageCircle } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, TextAreaField } from '../components/ui'
import { UserLink } from '../components/UserLink'
import { db } from '../firebase'
import { formatPostTime } from '../posts/format'
import { useProfiles } from '../profile/useProfiles'
import { addComment, COMMENT_MAX, deleteComment } from './actions'
import { useBlocks } from './BlocksProvider'
import { ReportDialog } from './ReportDialog'

type Comment = { id: string, author: string, text: string, createdAt: Timestamp | null }

// コメント（F-42、F-43）。数を出し、開くと一覧と入力欄を出す
export function Comments({ me, postId, postAuthor, isAdmin, onError }: {
  me: string
  postId: string
  postAuthor: string
  isAdmin: boolean
  onError: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<{ postId: string, value: number } | null>(null)
  const regionId = useId()

  useEffect(() => {
    if (open) return
    let cancelled = false
    getCountFromServer(collection(db, 'posts', postId, 'comments'))
      .then((snapshot) => !cancelled && setCount({ postId, value: snapshot.data().count }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [postId, open])

  const total = count?.postId === postId ? count.value : null

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 items-center gap-2 self-start rounded-full px-2 text-note text-muted hover:text-text"
      >
        <MessageCircle aria-hidden className="size-6" />
        {open ? 'コメントを閉じる' : total === null ? 'コメント' : total === 0 ? 'コメントを書く' : `コメント ${total} 件`}
      </button>
      {open && (
        <CommentList
          id={regionId}
          me={me}
          postId={postId}
          postAuthor={postAuthor}
          isAdmin={isAdmin}
          onCount={(value) => setCount({ postId, value })}
          onError={onError}
        />
      )}
    </div>
  )
}

function CommentList({ id, me, postId, postAuthor, isAdmin, onCount, onError }: {
  id: string
  me: string
  postId: string
  postAuthor: string
  isAdmin: boolean
  onCount: (count: number) => void
  onError: (message: string) => void
}) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Comment | null>(null)
  const [reporting, setReporting] = useState<Comment | null>(null)
  const { blocked } = useBlocks()
  const profiles = useProfiles((comments ?? []).map((comment) => comment.author))
  // 親から渡される関数は描くたびに変わるので、読み込みをやり直さないよう参照で持つ
  const callbacks = useRef({ onCount, onError })
  useEffect(() => {
    callbacks.current = { onCount, onError }
  })

  useEffect(() => onSnapshot(
    query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'asc')),
    (snapshot) => {
      const next = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Comment)
      setComments(next)
      callbacks.current.onCount(next.length)
    },
    () => callbacks.current.onError('コメントを読み込めませんでした。'),
  ), [postId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value) {
      setInputError('コメントを入力してください。')
      return
    }
    if (value.length > COMMENT_MAX) {
      setInputError(`${COMMENT_MAX} 文字までにしてください。`)
      return
    }
    setInputError(null)
    setBusy(true)
    try {
      await addComment(me, postId, postAuthor, value)
      setText('')
    } catch {
      setInputError('コメントを送れませんでした。もう一度お試しください。')
    }
    setBusy(false)
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteComment(me, postId, postAuthor, deleting.id, deleting.author)
    } catch {
      onError('コメントを削除できませんでした。もう一度お試しください。')
    }
    setDeleting(null)
    setBusy(false)
  }

  return (
    <section id={id} aria-label="コメント" className="flex flex-col gap-4 border-t border-divider pt-3">
      {comments === null && <p role="status" className="text-muted">読み込み中…</p>}
      {comments && comments.length === 0 && <p className="text-muted">まだコメントはありません。</p>}
      {comments && comments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {/* ブロックした人のコメントは出さない（F-80） */}
          {comments.filter((comment) => !blocked?.has(comment.author)).map((comment) => {
            const profile = profiles.get(comment.author)
            const date = comment.createdAt?.toDate()
            const canDelete = comment.author === me || postAuthor === me || isAdmin
            return (
              <li key={comment.id} className="flex flex-col gap-1">
                <p className="text-note">
                  <UserLink profile={profile} />
                  {date && <time dateTime={date.toISOString()} className="ml-2 text-muted">{formatPostTime(date)}</time>}
                </p>
                <p className="whitespace-pre-wrap break-words">{comment.text}</p>
                <div className="flex gap-4">
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setDeleting(comment)}
                      className="min-h-11 rounded-full text-note text-muted underline underline-offset-4 hover:text-error"
                    >
                      削除<span className="sr-only">（{profile?.displayName ?? ''}さんのコメント）</span>
                    </button>
                  )}
                  {comment.author !== me && (
                    <button
                      type="button"
                      onClick={() => setReporting(comment)}
                      className="min-h-11 rounded-full text-note text-muted underline underline-offset-4 hover:text-text"
                    >
                      通報<span className="sr-only">（{profile?.displayName ?? ''}さんのコメント）</span>
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <TextAreaField
          label="コメントを書く"
          value={text}
          maxLength={COMMENT_MAX}
          error={inputError}
          rows={2}
          className="[&_textarea]:min-h-16"
          onChange={(event) => setText(event.target.value)}
        />
        <div>
          <Button type="submit" busy={busy}>{busy ? '送っています…' : 'コメントする'}</Button>
        </div>
      </form>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(value) => !value && setDeleting(null)}
        title="このコメントを削除しますか？"
        confirmLabel="削除する"
        busy={busy}
        onConfirm={confirmDelete}
      >
        <p>削除したコメントは元に戻せません。</p>
      </ConfirmDialog>
      {reporting && (
        <ReportDialog
          me={me}
          target={{
            type: 'comment',
            path: `posts/${postId}/comments/${reporting.id}`,
            user: reporting.author,
            label: `${profiles.get(reporting.author)?.displayName ?? ''}さんのコメント`,
          }}
          onClose={() => setReporting(null)}
        />
      )}
    </section>
  )
}
