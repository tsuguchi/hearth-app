import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Button, Notice } from '../components/ui'
import { PostCard } from '../posts/PostCard'
import { useFeed } from '../posts/useFeed'
import { useProfiles } from '../profile/useProfiles'

// タイムライン。いまは「みんな」（F-31）だけ。「フォロー中」（F-30）はフォローの機能と一緒に作る
export function TimelinePage({ uid }: { uid: string }) {
  const { posts, status, hasMore, loadMore, remove } = useFeed()
  const profiles = useProfiles(posts.map((post) => post.author))
  const sentinel = useRef<HTMLDivElement>(null)

  // 一覧の下の端が見えたら、続きを読み込む（F-32）
  useEffect(() => {
    const element = sentinel.current
    if (!element || !hasMore) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore()
    }, { rootMargin: '400px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasMore, loadMore, posts.length])

  return (
    <AppShell title="タイムライン">
      <div className="flex flex-col gap-6">
        {posts.length === 0 && status === 'idle' && (
          <div className="rounded-2xl bg-surface p-6">
            <p>まだ投稿がありません。</p>
            <p className="mt-2"><Link to="/new" className="text-accent-text underline underline-offset-4">最初の写真を投稿する</Link></p>
          </div>
        )}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            author={profiles.get(post.author)}
            isMine={post.author === uid}
            onDeleted={() => remove(post.id)}
          />
        ))}
        {status === 'loading' && <p role="status" className="text-center text-muted">読み込み中…</p>}
        {status === 'error' && (
          <Notice tone="error">
            <p>投稿を読み込めませんでした。</p>
            <Button variant="secondary" className="mt-2" onClick={() => void loadMore()}>もう一度読み込む</Button>
          </Notice>
        )}
        {hasMore && status === 'idle' && (
          // 自動で読み込めないとき（キーボードで操作しているときなど）のためのボタン
          <div ref={sentinel} className="flex justify-center">
            <Button variant="secondary" onClick={() => void loadMore()}>さらに読み込む</Button>
          </div>
        )}
        {!hasMore && posts.length > 0 && <p className="text-center text-note text-muted">これより前の投稿はありません。</p>}
      </div>
    </AppShell>
  )
}
