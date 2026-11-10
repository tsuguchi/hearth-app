import * as Dialog from '@radix-ui/react-dialog'
import { collection, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, type QueryDocumentSnapshot, startAfter, where } from 'firebase/firestore'
import { UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { MoreMenu } from '../components/MoreMenu'
import { Button, Notice } from '../components/ui'
import { UserLink } from '../components/UserLink'
import { db } from '../firebase'
import { photoUrl, type Post } from '../posts/types'
import { useProfiles } from '../profile/useProfiles'
import { useUserByUsername } from '../profile/useUser'
import { block, unblock, useBlocks } from '../social/BlocksProvider'
import { FollowButton } from '../social/FollowButton'
import { ReportDialog } from '../social/ReportDialog'
import { useFollowing } from '../social/FollowingProvider'

const PAGE_SIZE = 30

// プロフィールの画面（F-33）。投稿の一覧、投稿数・フォロー数・フォロワー数、フォローのボタン
export function ProfilePage() {
  const { username = '' } = useParams()
  const user = useUserByUsername(username)
  const { me } = useFollowing()
  const { blocked } = useBlocks()
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'block' | 'unblock' | 'report' | null>(null)
  const [busy, setBusy] = useState(false)

  if (user === undefined) {
    return <AppShell title="プロフィール"><p role="status" className="text-muted">読み込み中…</p></AppShell>
  }
  if (user === null) {
    return (
      <AppShell title="プロフィール">
        <div className="rounded-2xl bg-surface p-6">
          <p>@{username} という人は見つかりません。ユーザー名が変わったか、退会した可能性があります。</p>
        </div>
      </AppShell>
    )
  }

  const { uid, profile } = user
  const isMe = uid === me
  const isBlocked = blocked?.has(uid) ?? false

  async function changeBlock(next: boolean) {
    setBusy(true)
    try {
      await (next ? block(me, uid) : unblock(me, uid))
    } catch {
      setError(next ? 'ブロックできませんでした。もう一度お試しください。' : 'ブロックを解除できませんでした。もう一度お試しください。')
    }
    setBusy(false)
    setDialog(null)
  }
  return (
    <AppShell title={profile.displayName}>
      <div className="flex flex-col gap-6">
        <section aria-label="プロフィール" className="flex flex-col gap-4 rounded-2xl bg-surface p-6">
          <div className="flex items-center gap-4">
            <span aria-hidden className="flex size-16 shrink-0 items-center justify-center rounded-full bg-divider text-muted">
              <UserRound className="size-9" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-note text-muted">@{profile.username}</p>
                {!isMe && (
                  <MoreMenu
                    label={`${profile.displayName}さんへの操作`}
                    items={[
                      isBlocked
                        ? { label: 'ブロックを解除', onSelect: () => setDialog('unblock') }
                        : { label: 'ブロックする', onSelect: () => setDialog('block'), danger: true },
                      { label: '通報する', onSelect: () => setDialog('report') },
                    ]}
                  />
                )}
              </div>
              {isMe ? (
                <Link to="/settings/profile" className="mt-1 inline-flex min-h-11 items-center rounded-full border border-border px-4 text-note font-bold hover:bg-bg">
                  プロフィールを編集
                </Link>
              ) : (
                <div className="mt-1"><FollowButton target={uid} name={profile.displayName} onError={setError} /></div>
              )}
            </div>
          </div>
          {profile.bio && <p className="whitespace-pre-wrap break-words">{profile.bio}</p>}
          {error && <Notice tone="error">{error}</Notice>}
          <Counts uid={uid} />
        </section>
        {isBlocked ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface p-6">
            <p>{profile.displayName}さんをブロックしています。この人の投稿・コメント・通知は、あなたの画面に出ません。</p>
            <div><Button variant="secondary" onClick={() => setDialog('unblock')}>ブロックを解除する</Button></div>
          </div>
        ) : (
          <PostGrid uid={uid} name={profile.displayName} />
        )}
      </div>
      <ConfirmDialog
        open={dialog === 'block'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`${profile.displayName}さんをブロックしますか？`}
        confirmLabel="ブロックする"
        busy={busy}
        onConfirm={() => changeBlock(true)}
      >
        <ul className="list-disc pl-5">
          <li>お互いのフォローが外れ、この人はあなたをフォロー・コメント・いいねできなくなります。</li>
          <li>この人の投稿・コメント・通知は、あなたの画面に出なくなります。</li>
          <li>ブロックしたことは、相手には知らされません。あとから解除できます。</li>
        </ul>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'unblock'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`${profile.displayName}さんのブロックを解除しますか？`}
        confirmLabel="解除する"
        danger={false}
        busy={busy}
        onConfirm={() => changeBlock(false)}
      >
        <p>この人の投稿などが、また画面に出るようになります。外れたフォローは戻りません。</p>
      </ConfirmDialog>
      {dialog === 'report' && (
        <ReportDialog
          me={me}
          target={{ type: 'user', path: `users/${uid}`, user: uid, label: `${profile.displayName}さん` }}
          onClose={() => setDialog(null)}
        />
      )}
    </AppShell>
  )
}

// 投稿数・フォロー数・フォロワー数。フォロー・フォロワーは押すと一覧を開く。
// フォローの数は、変わったらすぐ画面に出るよう、文書の変化を受け取って数える（利用者は 50 人までなので件数は小さい）
function Counts({ uid }: { uid: string }) {
  const [posts, setPosts] = useState<{ uid: string, value: number } | null>(null)
  const [following, setFollowing] = useState<{ uid: string, value: number } | null>(null)
  const [followers, setFollowers] = useState<{ uid: string, value: number } | null>(null)
  const [list, setList] = useState<'following' | 'followers' | null>(null)

  useEffect(() => {
    let cancelled = false
    getCountFromServer(query(collection(db, 'posts'), where('author', '==', uid), where('hidden', '==', false)))
      .then((snapshot) => !cancelled && setPosts({ uid, value: snapshot.data().count }))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [uid])

  useEffect(() => onSnapshot(
    query(collection(db, 'follows'), where('follower', '==', uid)),
    (snapshot) => setFollowing({ uid, value: snapshot.size }),
    () => {},
  ), [uid])

  useEffect(() => onSnapshot(
    query(collection(db, 'follows'), where('followee', '==', uid)),
    (snapshot) => setFollowers({ uid, value: snapshot.size }),
    () => {},
  ), [uid])

  const current = {
    posts: posts?.uid === uid ? posts.value : undefined,
    following: following?.uid === uid ? following.value : undefined,
    followers: followers?.uid === uid ? followers.value : undefined,
  }
  const item = (label: string, value: number | undefined) => (
    <>
      <span className="font-bold text-text">{value ?? '…'}</span>
      <span className="text-note text-muted">{label}</span>
    </>
  )
  const cell = 'flex min-h-11 w-full flex-col items-center justify-center rounded-lg'

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 text-center">
        <li className={cell}>{item('投稿', current?.posts)}</li>
        <li>
          <button type="button" onClick={() => setList('following')} className={`${cell} hover:bg-bg`}>
            {item('フォロー', current?.following)}
            <span className="sr-only">。一覧を開く</span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setList('followers')} className={`${cell} hover:bg-bg`}>
            {item('フォロワー', current?.followers)}
            <span className="sr-only">。一覧を開く</span>
          </button>
        </li>
      </ul>
      {list && <FollowListDialog uid={uid} kind={list} onClose={() => setList(null)} />}
    </>
  )
}

function FollowListDialog({ uid, kind, onClose }: { uid: string, kind: 'following' | 'followers', onClose: () => void }) {
  const [uids, setUids] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const profiles = useProfiles(uids ?? [])
  const title = kind === 'following' ? 'フォローしている人' : 'フォロワー'

  useEffect(() => {
    const field = kind === 'following' ? 'follower' : 'followee'
    getDocs(query(collection(db, 'follows'), where(field, '==', uid), limit(200)))
      .then((snapshot) => setUids(snapshot.docs.map((document) => document.data()[kind === 'following' ? 'followee' : 'follower'] as string)))
      .catch(() => setFailed(true))
  }, [uid, kind])

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 flex max-h-[80dvh] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-subtitle font-bold">{title}</Dialog.Title>
            <Dialog.Close className="flex size-11 items-center justify-center rounded-full text-muted hover:text-text">
              <X aria-hidden className="size-6" />
              <span className="sr-only">閉じる</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}の一覧です。</Dialog.Description>
          {failed && <p role="alert" className="text-error">読み込めませんでした。</p>}
          {!failed && uids === null && <p role="status">読み込み中…</p>}
          {uids && uids.length === 0 && <p className="text-muted">まだいません。</p>}
          {uids && uids.length > 0 && (
            <ul className="flex flex-col gap-2 overflow-y-auto">
              {uids.map((id) => {
                const profile = profiles.get(id)
                return (
                  <li key={id} className="flex min-h-11 items-center gap-2">
                    <UserLink profile={profile} onClick={onClose} />
                    {profile && <span className="text-note text-muted">@{profile.username}</span>}
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

// その人の投稿の一覧。角を丸めた正方形の小さな画像を並べる（DESIGN.md の 5 章）
function PostGrid({ uid, name }: { uid: string, name: string }) {
  const [state, setState] = useState<{ uid: string, posts: Post[], cursor: QueryDocumentSnapshot | null, hasMore: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (after: QueryDocumentSnapshot | null, previous: Post[]) => {
    setLoading(true)
    try {
      const constraints = [where('author', '==', uid), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(PAGE_SIZE)]
      const snapshot = await getDocs(after ? query(collection(db, 'posts'), ...constraints, startAfter(after)) : query(collection(db, 'posts'), ...constraints))
      const posts = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Post)
      setState({ uid, posts: [...previous, ...posts], cursor: snapshot.docs.at(-1) ?? after, hasMore: snapshot.docs.length === PAGE_SIZE })
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setLoading(false)
  }, [uid])

  useEffect(() => {
    void load(null, [])
  }, [load])

  const current = state?.uid === uid ? state : null

  return (
    <section aria-labelledby="posts-heading" className="flex flex-col gap-3">
      <h2 id="posts-heading" className="text-subtitle font-bold">投稿</h2>
      {failed && <Notice tone="error">投稿を読み込めませんでした。</Notice>}
      {!current && !failed && <p role="status" className="text-muted">読み込み中…</p>}
      {current && current.posts.length === 0 && <p className="text-muted">まだ投稿はありません。</p>}
      {current && current.posts.length > 0 && (
        <ul className="grid grid-cols-3 gap-1 desktop:gap-2">
          {current.posts.map((post) => {
            const first = post.photos[0]
            return (
              <li key={post.id}>
                <Link to={`/posts/${post.id}`} className="relative block aspect-square overflow-hidden rounded-lg bg-divider">
                  <img
                    src={photoUrl(first.id, 'thumb')}
                    alt={first.alt || `${name}さんの投稿の写真（説明なし）`}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                  {post.photos.length > 1 && (
                    <span className="absolute top-1 right-1 rounded-full bg-surface/90 px-2 text-note font-bold text-text">
                      {post.photos.length}<span className="sr-only"> 枚</span>
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {current?.hasMore && (
        <div className="flex justify-center">
          <Button variant="secondary" busy={loading} onClick={() => void load(current.cursor, current.posts)}>さらに読み込む</Button>
        </div>
      )}
    </section>
  )
}
