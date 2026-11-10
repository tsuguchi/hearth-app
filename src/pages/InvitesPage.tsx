import { Copy, Share2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Notice } from '../components/ui'
import { UserLink } from '../components/UserLink'
import { useProfiles } from '../profile/useProfiles'

type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'
type Invite = { id: string, status: InviteStatus, createdAt: string | null, expiresAt: string | null, usedBy: string | null, usedAt: string | null }
type InviteList = { invites: Invite[], canInvite: boolean, reason: string | null }

const REASONS: Record<string, string> = {
  invites_closed: 'いまは運営者が新しい招待を止めています。',
  invites_blocked: 'あなたの招待は、運営者によって止められています。',
  member_cap: '利用者数が上限（50 人）に達しているため、いまは招待できません。',
  invite_limit: 'まだ使われていない招待が 5 件あります。使われるか、取り消すと、新しく作れます。',
}

const STATUS_LABEL: Record<InviteStatus, string> = { open: '未使用', used: '使用済み', expired: '期限切れ', revoked: '取り消し' }

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

// 招待（F-10〜F-12）。リンクは作ったときに一度だけ出す（運営者のデータベースにも残らない）
export function InvitesPage() {
  const [data, setData] = useState<InviteList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ url: string, expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState<Invite | null>(null)
  const profiles = useProfiles((data?.invites ?? []).flatMap((invite) => (invite.usedBy ? [invite.usedBy] : [])))

  const load = useCallback(async () => {
    try {
      setData(await api<InviteList>('/api/invites'))
    } catch {
      setError('招待の一覧を読み込めませんでした。ページを読み込み直してください。')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const result = await api<{ token: string, expiresAt: string }>('/api/invites', { method: 'POST' })
      setCreated({ url: `${window.location.origin}/join#${result.token}`, expiresAt: result.expiresAt })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError && REASONS[caught.code] ? REASONS[caught.code] : '招待を作れませんでした。もう一度お試しください。')
    }
    setBusy(false)
  }

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
    } catch {
      setError('コピーできませんでした。リンクを選んでコピーしてください。')
    }
  }

  async function share() {
    if (!created) return
    try {
      await navigator.share({ title: 'ハースへの招待', text: 'ハースに招待します。このリンクから登録してください（7 日間有効）。', url: created.url })
    } catch {
      // 共有をやめたときも、ここに来る
    }
  }

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    try {
      await api(`/api/invites/${revoking.id}`, { method: 'DELETE' })
      await load()
    } catch {
      setError('取り消せませんでした。もう一度お試しください。')
    }
    setRevoking(null)
    setBusy(false)
  }

  return (
    <AppShell title="招待">
      <div className="flex flex-col gap-6">
        <section aria-labelledby="new-invite" className="flex flex-col gap-4 rounded-2xl bg-surface p-6">
          <h2 id="new-invite" className="text-subtitle font-bold">招待のリンクを作る</h2>
          <p>ハースは、招待を受けた人だけが登録できます。リンク 1 つで登録できるのは 1 人で、作ってから 7 日間使えます。だれを招待したかは、運営者に記録されます。</p>
          {error && <Notice tone="error">{error}</Notice>}
          {data && !data.canInvite && data.reason && <Notice tone="info">{REASONS[data.reason] ?? 'いまは招待を作れません。'}</Notice>}
          {created && (
            <div className="flex flex-col gap-3 rounded-xl border-2 border-success p-4">
              <p className="font-bold" role="status">招待のリンクができました。このリンクは今だけ表示されます。コピーして、招待したい人に渡してください。</p>
              <label htmlFor="invite-url" className="text-note text-muted">招待のリンク（{formatDate(created.expiresAt)} まで有効）</label>
              <input id="invite-url" readOnly value={created.url} onFocus={(event) => event.target.select()} className="min-h-12 rounded-lg border border-border bg-bg px-3 text-note" />
              <div className="flex flex-wrap gap-3">
                <Button onClick={copy}><Copy aria-hidden className="size-5" />{copied ? 'コピーしました' : 'リンクをコピー'}</Button>
                {'share' in navigator && <Button variant="secondary" onClick={share}><Share2 aria-hidden className="size-5" />共有する</Button>}
              </div>
            </div>
          )}
          <div>
            <Button busy={busy} aria-disabled={data ? !data.canInvite || undefined : true} onClick={() => data?.canInvite && create()}>
              {busy ? '作っています…' : '招待のリンクを作る'}
            </Button>
          </div>
        </section>

        <section aria-labelledby="my-invites" className="flex flex-col gap-3">
          <h2 id="my-invites" className="text-subtitle font-bold">作った招待</h2>
          {!data && !error && <p role="status" className="text-muted">読み込み中…</p>}
          {data && data.invites.length === 0 && <p className="text-muted">まだ招待を作っていません。</p>}
          {data && data.invites.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
              {data.invites.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider p-4 last:border-b-0">
                  <div className="flex flex-col">
                    <span>
                      <span className={`mr-2 rounded-full px-2 text-note font-bold ${invite.status === 'open' ? 'bg-accent text-on-accent' : 'bg-divider text-text'}`}>
                        {STATUS_LABEL[invite.status]}
                      </span>
                      {invite.status === 'used' && invite.usedBy ? <><UserLink profile={profiles.get(invite.usedBy)} /> さんが登録</> : null}
                      {invite.status === 'open' && `${formatDate(invite.expiresAt)} まで有効`}
                    </span>
                    <span className="text-note text-muted">{formatDate(invite.createdAt)} に作成</span>
                  </div>
                  {invite.status === 'open' && (
                    <Button variant="secondary" className="text-note" onClick={() => setRevoking(invite)}>取り消す</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="この招待を取り消しますか？"
        confirmLabel="取り消す"
        busy={busy}
        onConfirm={revoke}
      >
        <p>取り消した招待のリンクでは、登録できなくなります。</p>
      </ConfirmDialog>
    </AppShell>
  )
}
