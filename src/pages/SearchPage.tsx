import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { Hash, Search, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Button, Notice, TextField } from '../components/ui'
import { db } from '../firebase'
import { normalizeTag } from '../posts/CaptionText'
import { photoUrl, type Post } from '../posts/types'
import type { Profile } from '../profile/useMyProfile'
import { useBlocks } from '../social/BlocksProvider'

type Mode = 'people' | 'tag'
type Member = Profile & { uid: string }

const RESULT_LIMIT = 60

function fold(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

// 検索（F-70〜F-72）。人はユーザー名・表示名で、投稿はタグで探す。説明文の全文は探さない。
// 利用者は 50 人までなので、人は全員を一度読み、画面の中で絞り込む
export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const mode: Mode = params.has('tag') ? 'tag' : 'people'
  const term = mode === 'tag' ? params.get('tag') ?? '' : params.get('q') ?? ''
  const [input, setInput] = useState(term)
  const [prevTerm, setPrevTerm] = useState(term)

  // URL が変わったとき（タグのリンクから来たときなど）は、入力欄もそろえる
  if (term !== prevTerm) {
    setPrevTerm(term)
    setInput(term)
  }

  function choose(next: Mode) {
    setParams(next === 'tag' ? { tag: '' } : { q: '' })
    setInput('')
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = mode === 'tag' ? normalizeTag(input) : input.trim()
    setParams(mode === 'tag' ? { tag: value } : { q: value })
  }

  return (
    <AppShell title="検索">
      <div className="flex flex-col gap-6">
        <div role="group" aria-label="探すもの" className="flex gap-1 self-start rounded-full bg-surface p-1">
          {([['people', '人'], ['tag', 'タグ']] as const).map(([value, label]) => (
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
        <form role="search" onSubmit={submit} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <TextField
            label={mode === 'tag' ? 'タグ' : 'ユーザー名か表示名'}
            support={mode === 'tag' ? '「#」はなくてもかまいません（例: 紅葉）。' : '名前の一部でも探せます（例: はる）。'}
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div>
            <Button type="submit"><Search aria-hidden className="size-5" />探す</Button>
          </div>
        </form>
        {mode === 'people' ? <PeopleResults term={term} /> : <TagResults tag={normalizeTag(term)} />}
      </div>
    </AppShell>
  )
}

function PeopleResults({ term }: { term: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [failed, setFailed] = useState(false)
  const { blocked } = useBlocks()

  useEffect(() => {
    getDocs(query(collection(db, 'users'), limit(200)))
      .then((snapshot) => setMembers(snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }) as Member)))
      .catch(() => setFailed(true))
  }, [])

  const results = useMemo(() => {
    if (!members || !term.trim()) return []
    const needle = fold(term.trim()).replace(/^@/, '')
    return members
      .filter((member) => member.status === 'active' && !blocked?.has(member.uid))
      .filter((member) => fold(member.username).includes(needle) || fold(member.displayName).includes(needle))
      .slice(0, RESULT_LIMIT)
  }, [members, term, blocked])

  if (failed) return <Notice tone="error">読み込めませんでした。ページを読み込み直してください。</Notice>
  if (!term.trim()) return null
  if (!members) return <p role="status" className="text-muted">探しています…</p>

  return (
    <section aria-labelledby="people-results" className="flex flex-col gap-3">
      <h2 id="people-results" className="text-subtitle font-bold">「{term}」に合う人（{results.length} 人）</h2>
      {results.length === 0 && <p className="text-muted">見つかりませんでした。別の言葉で探してみてください。</p>}
      {results.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
          {results.map((member) => (
            <li key={member.uid} className="border-b border-divider last:border-b-0">
              <Link to={`/users/${member.username}`} className="flex items-center gap-3 p-4 hover:bg-bg">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-divider text-muted">
                  <UserRound className="size-6" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-bold">{member.displayName}</span>
                  <span className="block truncate text-note text-muted">@{member.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TagResults({ tag }: { tag: string }) {
  const [state, setState] = useState<{ tag: string, posts: Post[] | null, failed: boolean } | null>(null)
  const { blocked } = useBlocks()

  useEffect(() => {
    if (!tag) return
    let cancelled = false
    getDocs(query(collection(db, 'posts'), where('tags', 'array-contains', tag), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(RESULT_LIMIT)))
      .then((snapshot) => !cancelled && setState({ tag, posts: snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Post), failed: false }))
      .catch(() => !cancelled && setState({ tag, posts: null, failed: true }))
    return () => {
      cancelled = true
    }
  }, [tag])

  if (!tag) return null
  const current = state?.tag === tag ? state : null
  if (current?.failed) return <Notice tone="error">読み込めませんでした。ページを読み込み直してください。</Notice>
  if (!current?.posts) return <p role="status" className="text-muted">探しています…</p>
  const posts = current.posts.filter((post) => !blocked?.has(post.author))

  return (
    <section aria-labelledby="tag-results" className="flex flex-col gap-3">
      <h2 id="tag-results" className="flex items-center gap-1 text-subtitle font-bold">
        <Hash aria-hidden className="size-5" />
        {tag} の投稿（{posts.length} 件）
      </h2>
      {posts.length === 0 && <p className="text-muted">このタグの投稿は見つかりませんでした。</p>}
      {posts.length > 0 && (
        <ul className="grid grid-cols-3 gap-1 desktop:gap-2">
          {posts.map((post) => (
            <li key={post.id}>
              <Link to={`/posts/${post.id}`} className="block aspect-square overflow-hidden rounded-lg bg-divider">
                <img src={photoUrl(post.photos[0].id, 'thumb')} alt={post.photos[0].alt || '投稿の写真（説明なし）'} loading="lazy" className="size-full object-cover" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
