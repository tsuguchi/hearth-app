import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context'
import { AppShell } from '../components/AppShell'
import { Button, Notice } from '../components/ui'
import { PostCard } from '../posts/PostCard'
import { useFeed } from '../posts/useFeed'
import { useProfiles } from '../profile/useProfiles'
import { useFollowing } from '../social/FollowingProvider'

type FeedMode = 'following' | 'all'
const MODE_KEY = 'hearth.timeline'

// タイムライン。「フォロー中」（F-30）と「みんな」（F-31）を切り替える。最後に選んだ方を覚えておく
export function TimelinePage() {
  const { isAdmin } = useAuth()
  const { me, following } = useFollowing()
  const [mode, setMode] = useState<FeedMode>(() => (localStorage.getItem(MODE_KEY) === 'following' ? 'following' : 'all'))

  function choose(next: FeedMode) {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
  }

  // 「フォロー中」には、自分の投稿も含める
  const authors = useMemo(
    () => (mode === 'all' ? null : following === null ? undefined : [me, ...following]),
    [mode, following, me],
  )

  return (
    <AppShell title="タイムライン">
      <div className="flex flex-col gap-6">
        <div role="group" aria-label="表示する投稿" className="flex gap-1 self-start rounded-full bg-surface p-1">
          {([['following', 'フォロー中'], ['all', 'みんな']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => choose(value)}
              className={`min-h-11 rounded-full px-5 font-bold ${mode === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {authors === undefined ? <p role="status" className="text-center text-muted">読み込み中…</p> : (
          <Feed key={mode} authors={authors} me={me} isAdmin={isAdmin} mode={mode} onShowAll={() => choose('all')} />
        )}
      </div>
    </AppShell>
  )
}

function Feed({ authors, me, isAdmin, mode, onShowAll }: {
  authors: string[] | null
  me: string
  isAdmin: boolean
  mode: FeedMode
  onShowAll: () => void
}) {
  const { posts, status, hasMore, loadMore, remove } = useFeed(authors)
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
  }, [hasMore, loadMore])

  return (
    <>
      {posts.length === 0 && status === 'idle' && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-6">
          {mode === 'following' ? (
            <>
              <p>フォローしている人の投稿は、まだありません。</p>
              <p>「みんな」で投稿を見て、気になる人をフォローしてみましょう。</p>
              <div><Button variant="secondary" onClick={onShowAll}>「みんな」を見る</Button></div>
            </>
          ) : (
            <>
              <p>まだ投稿がありません。</p>
              <p><Link to="/new" className="text-accent-text underline underline-offset-4">最初の写真を投稿する</Link></p>
            </>
          )}
        </div>
      )}
      {posts.map((post) => (
        <PostCard key={post.id} post={post} author={profiles.get(post.author)} me={me} isAdmin={isAdmin} onDeleted={() => remove(post.id)} />
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
    </>
  )
}
