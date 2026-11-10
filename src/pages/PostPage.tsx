import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/context'
import { AppShell } from '../components/AppShell'
import { db } from '../firebase'
import { PostCard } from '../posts/PostCard'
import type { Post } from '../posts/types'
import { useProfiles } from '../profile/useProfiles'

// 1 件の投稿の画面（通知やプロフィールの一覧から開く）
export function PostPage({ me }: { me: string }) {
  const { postId = '' } = useParams()
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<{ postId: string, post: Post | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'posts', postId))
      .then((snapshot) => (snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as Post : null))
      .catch(() => null)
      .then((post) => !cancelled && setState({ postId, post }))
    return () => {
      cancelled = true
    }
  }, [postId])

  const post = state?.postId === postId ? state.post : undefined
  const profiles = useProfiles(post ? [post.author] : [])

  return (
    <AppShell title="投稿">
      {post === undefined && <p role="status" className="text-muted">読み込み中…</p>}
      {post === null && (
        <div className="rounded-2xl bg-surface p-6">
          <p>この投稿は見つかりません。削除された可能性があります。</p>
          <p className="mt-2"><Link to="/" className="text-accent-text underline underline-offset-4">タイムラインへ</Link></p>
        </div>
      )}
      {post && <PostCard post={post} author={profiles.get(post.author)} me={me} isAdmin={isAdmin} onDeleted={() => navigate('/')} />}
    </AppShell>
  )
}
