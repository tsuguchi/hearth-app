import { collection, getDocs, limit, orderBy, query, type QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import type { Post } from './types'

const PAGE_SIZE = 12

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

// 「みんな」のタイムライン（F-31）。新しい順に、下まで見ると続きを読み込む（F-32）
export function useFeed() {
  const [posts, setPosts] = useState<Post[]>([])
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [hasMore, setHasMore] = useState(true)
  const cursor = useRef<QueryDocumentSnapshot | null>(null)
  const loading = useRef(false)

  const loadPage = useCallback(async (reset: boolean) => {
    if (loading.current) return
    loading.current = true
    setStatus('loading')
    try {
      const constraints = [where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
      const after = reset ? null : cursor.current
      const snapshot = await getDocs(after
        ? query(collection(db, 'posts'), ...constraints, startAfter(after))
        : query(collection(db, 'posts'), ...constraints))
      cursor.current = snapshot.docs.at(-1) ?? cursor.current
      setPosts((current) => [...(reset ? [] : current), ...snapshot.docs.map(toPost)])
      setHasMore(snapshot.docs.length === PAGE_SIZE)
      setStatus('idle')
    } catch {
      setStatus('error')
    } finally {
      loading.current = false
    }
  }, [])

  useEffect(() => {
    // 画面を開いたときに、最初のページを読む
    void loadPage(true)
  }, [loadPage])

  const loadMore = useCallback(() => loadPage(false), [loadPage])
  const remove = useCallback((id: string) => setPosts((current) => current.filter((post) => post.id !== id)), [])

  return { posts, status, hasMore, loadMore, remove }
}
