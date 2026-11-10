import { collection, getDocs, limit, orderBy, query, type QueryConstraint, type QueryDocumentSnapshot, Timestamp, where } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import type { Post } from './types'

const PAGE_SIZE = 12
// Firestore の「in」で一度に指定できる数
const IN_LIMIT = 30

function toPost(snapshot: QueryDocumentSnapshot): Post {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    author: data.author,
    caption: data.caption,
    tags: data.tags ?? [],
    photos: data.photos,
    createdAt: data.createdAt ?? null,
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

// 1 ページ分を読む。authors を渡すと、その人たちの投稿だけを読む（30 人ごとに分けて読み、新しい順に並べ直す）
async function fetchPage(authors: string[] | null, before: Timestamp | null): Promise<{ posts: Post[], hasMore: boolean }> {
  const base: QueryConstraint[] = [where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
  if (before) base.unshift(where('createdAt', '<', before))
  const groups = authors === null ? [null] : chunks(authors, IN_LIMIT)
  const snapshots = await Promise.all(groups.map((group) =>
    getDocs(query(collection(db, 'posts'), ...(group ? [where('author', 'in', group)] : []), ...base))))
  const posts = snapshots
    .flatMap((snapshot) => snapshot.docs.map(toPost))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0))
  return {
    posts: posts.slice(0, PAGE_SIZE),
    hasMore: posts.length > PAGE_SIZE || snapshots.some((snapshot) => snapshot.docs.length === PAGE_SIZE),
  }
}

// タイムライン。authors が null なら「みんな」（F-31）、配列なら「フォロー中」（F-30）。
// 新しい順に並べ、下まで見ると続きを読み込む（F-32）
export function useFeed(authors: string[] | null) {
  const [posts, setPosts] = useState<Post[]>([])
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [hasMore, setHasMore] = useState(true)
  const generation = useRef(0)
  const loading = useRef(false)
  const key = authors === null ? '*' : [...authors].sort().join(',')

  const loadPage = useCallback(async (reset: boolean, current: Post[]) => {
    if (loading.current && !reset) return
    loading.current = true
    const mine = ++generation.current
    setStatus('loading')
    try {
      const list = key === '*' ? null : key ? key.split(',') : []
      const before = reset ? null : current.at(-1)?.createdAt ?? null
      const page = list && list.length === 0 ? { posts: [], hasMore: false } : await fetchPage(list, before)
      // 読み込みの途中で表示を切り替えたときは、古い結果を捨てる
      if (mine !== generation.current) return
      setPosts([...(reset ? [] : current), ...page.posts])
      setHasMore(page.hasMore)
      setStatus('idle')
    } catch {
      if (mine === generation.current) setStatus('error')
    } finally {
      if (mine === generation.current) loading.current = false
    }
  }, [key])

  useEffect(() => {
    // 表示を切り替えたとき（「フォロー中」⇔「みんな」、フォローの増減）に、最初のページから読み直す
    void loadPage(true, [])
  }, [loadPage])

  const loadMore = useCallback(() => loadPage(false, posts), [loadPage, posts])
  const remove = useCallback((id: string) => setPosts((current) => current.filter((post) => post.id !== id)), [])

  return { posts, status, hasMore, loadMore, remove }
}
