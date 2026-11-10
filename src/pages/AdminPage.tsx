import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, type Timestamp, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Notice } from '../components/ui'
import { db } from '../firebase'
import { formatPostTime } from '../posts/format'
import type { Profile } from '../profile/useMyProfile'

// 運営者の画面（F-90〜F-93）。運営者の印（admin）を持つ人だけが開ける

type Member = Profile & { uid: string }
type Report = {
  id: string
  reporter: string
  targetType: 'post' | 'comment' | 'user' | 'message'
  targetPath: string
  targetUser: string
  reason: string
  detail: string
  messageContent?: string
  status: 'open' | 'resolved'
  createdAt: Timestamp | null
}
type AdminInvite = { id: string, status: string, createdBy: string | null, usedBy: string | null, createdAt: string | null }
type AdminState = {
  config: { memberCap: number, memberCount: number, invitesEnabled: boolean, invitesBlocked: string[] }
  invites: AdminInvite[]
}

const REASON_LABEL: Record<string, string> = {
  spam: 'スパム・宣伝',
  harassment: '嫌がらせ・いじめ',
  inappropriate: '不適切な写真や文章',
  privacy: '他人の個人情報や、許可のない写真',
  other: 'その他',
}
const TARGET_LABEL = { post: '投稿', comment: 'コメント', user: '利用者', message: 'メッセージ' }

// label はボタンの言葉、done は終わったときの知らせ
type Pending = { title: string, body: string, label: string, done: string, danger: boolean, run: () => Promise<void> }

export function AdminPage({ me }: { me: string }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [reports, setReports] = useState<Report[] | null>(null)
  const [state, setState] = useState<AdminState | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success', text: string } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [showResolved, setShowResolved] = useState(false)

  const loadMembers = useCallback(async () => {
    const snapshot = await getDocs(collection(db, 'users'))
    setMembers(snapshot.docs.map((document) => ({ uid: document.id, ...document.data() }) as Member))
  }, [])

  const loadState = useCallback(async () => {
    setState(await api<AdminState>('/api/admin/state'))
  }, [])

  useEffect(() => {
    loadMembers().catch(() => setMessage({ tone: 'error', text: '利用者の一覧を読み込めませんでした。' }))
    loadState().catch(() => setMessage({ tone: 'error', text: '招待の記録を読み込めませんでした。' }))
  }, [loadMembers, loadState])

  useEffect(() => onSnapshot(
    query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200)),
    (snapshot) => setReports(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as Report)),
    () => setMessage({ tone: 'error', text: '通報を読み込めませんでした。' }),
  ), [])

  const byUid = useMemo(() => new Map((members ?? []).map((member) => [member.uid, member])), [members])
  const nameOf = (uid: string | null) => (uid ? byUid.get(uid)?.displayName ?? '（不明・退会した人）' : '運営者')

  async function confirmPending() {
    if (!pending) return
    setBusy(true)
    try {
      await pending.run()
      setMessage({ tone: 'success', text: pending.done })
    } catch {
      setMessage({ tone: 'error', text: `「${pending.label}」ができませんでした。もう一度お試しください。` })
    }
    setBusy(false)
    setPending(null)
  }

  const suspend = (member: Member, next: boolean): Pending => ({
    title: next ? `${member.displayName}さんのアカウントを止めますか？` : `${member.displayName}さんのアカウントを戻しますか？`,
    body: next
      ? 'ログインできなくなり、投稿がだれにも見えなくなります。すでに開いている画面は、最長 1 時間ほど写真を表示できることがあります。あとから戻せます。'
      : 'ログインできるようになり、投稿がまた見えるようになります。',
    label: next ? 'アカウントを止める' : 'アカウントを戻す',
    done: next ? `${member.displayName}さんのアカウントを止めました。` : `${member.displayName}さんのアカウントを戻しました。`,
    danger: next,
    run: async () => {
      await api(`/api/admin/users/${member.uid}/suspension`, { method: next ? 'PUT' : 'DELETE' })
      await loadMembers()
    },
  })

  const blockInvites = (member: Member, next: boolean): Pending => ({
    title: next ? `${member.displayName}さんの招待を止めますか？` : `${member.displayName}さんの招待を許しますか？`,
    body: next ? 'この人は新しい招待を作れなくなります。作ってある未使用の招待も使えなくなります。' : 'この人は、また招待を作れるようになります。',
    label: next ? '招待を止める' : '招待を許す',
    done: next ? `${member.displayName}さんの招待を止めました。` : `${member.displayName}さんの招待を許しました。`,
    danger: next,
    run: async () => {
      await api('/api/admin/invite-settings', { method: 'POST', body: JSON.stringify({ uid: member.uid, blocked: next }) })
      await loadState()
    },
  })

  const toggleInvites = (next: boolean): Pending => ({
    title: next ? '招待を再開しますか？' : '招待をすべて止めますか？',
    body: next ? '利用者が、また招待を作れるようになります。' : 'だれも新しい招待を作れず、作ってある未使用の招待でも登録できなくなります。',
    label: next ? '招待を再開する' : '招待をすべて止める',
    done: next ? '招待を再開しました。' : '招待をすべて止めました。',
    danger: !next,
    run: async () => {
      await api('/api/admin/invite-settings', { method: 'POST', body: JSON.stringify({ invitesEnabled: next }) })
      await loadState()
    },
  })

  const resolve = (report: Report, next: 'open' | 'resolved') =>
    updateDoc(doc(db, 'reports', report.id), { status: next, handledBy: me, handledAt: serverTimestamp() })

  const removeTarget = (report: Report): Pending => ({
    title: `通報された${TARGET_LABEL[report.targetType]}を削除しますか？`,
    body: '削除したものは元に戻せません。削除した後、通報は対応済みにします。',
    label: `${TARGET_LABEL[report.targetType]}を削除`,
    done: `${TARGET_LABEL[report.targetType]}を削除し、通報を対応済みにしました。`,
    danger: true,
    run: async () => {
      if (report.targetType === 'post') {
        // もう消えているときは、そのまま対応済みにする
        await api(`/api/${report.targetPath}`, { method: 'DELETE' }).catch((error) => {
          if (!(error instanceof ApiError && error.code === 'not_found')) throw error
        })
      } else {
        await deleteDoc(doc(db, report.targetPath))
      }
      await resolve(report, 'resolved')
    },
  })

  function targetLink(report: Report): string | null {
    if (report.targetType === 'user') {
      const member = byUid.get(report.targetUser)
      return member ? `/users/${member.username}` : null
    }
    const postId = report.targetPath.split('/')[1]
    return postId ? `/posts/${postId}` : null
  }

  const visibleReports = (reports ?? []).filter((report) => showResolved || report.status === 'open')
  const openCount = (reports ?? []).filter((report) => report.status === 'open').length

  return (
    <AppShell title="運営者の画面">
      <div className="flex flex-col gap-8">
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <section aria-labelledby="reports-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="reports-heading" className="text-subtitle font-bold">通報（未対応 {openCount} 件）</h2>
            <label className="flex min-h-11 items-center gap-2 text-note">
              <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} className="size-5 accent-accent" />
              対応済みも表示する
            </label>
          </div>
          {!reports && <p role="status" className="text-muted">読み込み中…</p>}
          {reports && visibleReports.length === 0 && <p className="rounded-2xl bg-surface p-6 text-muted">未対応の通報はありません。</p>}
          {visibleReports.length > 0 && (
            <ul className="flex flex-col gap-3">
              {visibleReports.map((report) => {
                const link = targetLink(report)
                const target = byUid.get(report.targetUser)
                const date = report.createdAt?.toDate()
                return (
                  <li key={report.id} className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
                    <p className="text-note text-muted">
                      {report.status === 'resolved' ? '対応済み' : '未対応'}
                      {date && <> ・ {formatPostTime(date)}</>}
                      {' ・ '}通報した人: {nameOf(report.reporter)}
                    </p>
                    <p>
                      <span className="font-bold">{TARGET_LABEL[report.targetType]}</span>（{nameOf(report.targetUser)}さん）・理由: <span className="font-bold">{REASON_LABEL[report.reason] ?? report.reason}</span>
                    </p>
                    {report.messageContent !== undefined && (
                      <div className="flex flex-col gap-1">
                        <p className="text-note text-muted">通報した人が添えたメッセージの内容（運営者には暗号文しか見えないため、本人が読んだものを添えています）</p>
                        <p className="whitespace-pre-wrap break-words rounded-lg border border-border p-3">{report.messageContent || '（文字なし）'}</p>
                      </div>
                    )}
                    {report.detail && <p className="whitespace-pre-wrap break-words rounded-lg bg-bg p-3">{report.detail}</p>}
                    <div className="flex flex-wrap gap-2">
                      {link && <Link to={link} className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-note font-bold hover:bg-bg">対象を見る</Link>}
                      {report.status === 'open' && (report.targetType === 'post' || report.targetType === 'comment') && (
                        <Button variant="secondary" className="text-note" onClick={() => setPending(removeTarget(report))}>
                          {TARGET_LABEL[report.targetType]}を削除
                        </Button>
                      )}
                      {report.status === 'open' && target && target.status === 'active' && target.uid !== me && (
                        <Button variant="secondary" className="text-note" onClick={() => setPending(suspend(target, true))}>アカウントを止める</Button>
                      )}
                      <Button
                        variant="secondary"
                        className="text-note"
                        onClick={() => {
                          setMessage(null)
                          resolve(report, report.status === 'open' ? 'resolved' : 'open').catch(() => setMessage({ tone: 'error', text: '状態を変えられませんでした。' }))
                        }}
                      >
                        {report.status === 'open' ? '対応済みにする' : '未対応に戻す'}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="invite-settings" className="flex flex-col gap-3 rounded-2xl bg-surface p-6">
          <h2 id="invite-settings" className="text-subtitle font-bold">招待と利用者数</h2>
          {!state && <p role="status" className="text-muted">読み込み中…</p>}
          {state && (
            <>
              <p>利用者数: <span className="font-bold">{state.config.memberCount}</span> / {state.config.memberCap} 人</p>
              <p>招待: <span className="font-bold">{state.config.invitesEnabled ? '受け付けている' : '止めている'}</span></p>
              <div>
                <Button variant="secondary" onClick={() => setPending(toggleInvites(!state.config.invitesEnabled))}>
                  {state.config.invitesEnabled ? '招待をすべて止める' : '招待を再開する'}
                </Button>
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="members-heading" className="flex flex-col gap-3">
          <h2 id="members-heading" className="text-subtitle font-bold">利用者（{members?.length ?? '…'} 人）</h2>
          {members && state && (
            <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
              {members.map((member) => {
                const inviter = state.invites.find((invite) => invite.usedBy === member.uid)
                const invitesBlocked = state.config.invitesBlocked.includes(member.uid)
                return (
                  <li key={member.uid} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider p-4 last:border-b-0">
                    <div className="flex min-w-0 flex-col">
                      <span>
                        <Link to={`/users/${member.username}`} className="font-bold hover:underline">{member.displayName}</Link>
                        <span className="ml-2 text-note text-muted">@{member.username}</span>
                        {member.status === 'suspended' && <span className="ml-2 rounded-full bg-error px-2 text-note font-bold text-surface">停止中</span>}
                        {invitesBlocked && <span className="ml-2 rounded-full bg-divider px-2 text-note font-bold">招待停止</span>}
                      </span>
                      <span className="text-note text-muted">招待した人: {inviter ? nameOf(inviter.createdBy) : '（記録なし）'}</span>
                    </div>
                    {member.uid !== me && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" className="text-note" onClick={() => setPending(blockInvites(member, !invitesBlocked))}>
                          {invitesBlocked ? '招待を許す' : '招待を止める'}
                        </Button>
                        <Button variant="secondary" className="text-note" onClick={() => setPending(suspend(member, member.status !== 'suspended'))}>
                          {member.status === 'suspended' ? 'アカウントを戻す' : 'アカウントを止める'}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="invite-log" className="flex flex-col gap-3">
          <h2 id="invite-log" className="text-subtitle font-bold">招待の記録</h2>
          {state && state.invites.length === 0 && <p className="text-muted">招待はまだありません。</p>}
          {state && state.invites.length > 0 && (
            <div className="overflow-x-auto rounded-2xl bg-surface">
              <table className="w-full text-left text-note">
                <thead>
                  <tr className="border-b border-divider">
                    <th scope="col" className="p-3">作った日</th>
                    <th scope="col" className="p-3">招待した人</th>
                    <th scope="col" className="p-3">状態</th>
                    <th scope="col" className="p-3">登録した人</th>
                  </tr>
                </thead>
                <tbody>
                  {state.invites.map((invite) => (
                    <tr key={invite.id} className="border-b border-divider last:border-b-0">
                      <td className="p-3">{invite.createdAt ? new Date(invite.createdAt).toLocaleDateString('ja-JP') : ''}</td>
                      <td className="p-3">{nameOf(invite.createdBy)}</td>
                      <td className="p-3">{{ open: '未使用', used: '使用済み', expired: '期限切れ', revoked: '取り消し' }[invite.status] ?? invite.status}</td>
                      <td className="p-3">{invite.usedBy ? nameOf(invite.usedBy) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ''}
        confirmLabel={pending?.label ?? ''}
        danger={pending?.danger ?? true}
        busy={busy}
        onConfirm={confirmPending}
      >
        <p>{pending?.body}</p>
      </ConfirmDialog>
    </AppShell>
  )
}
