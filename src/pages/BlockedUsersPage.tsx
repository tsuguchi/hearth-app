import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { Button, Notice } from '../components/ui'
import { UserLink } from '../components/UserLink'
import { useProfiles } from '../profile/useProfiles'
import { unblock, useBlocks } from '../social/BlocksProvider'

// ブロックした人の一覧（F-81）。ここから解除できる
export function BlockedUsersPage({ me }: { me: string }) {
  const { blocked } = useBlocks()
  const uids = blocked ? [...blocked] : []
  const profiles = useProfiles(uids)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function release(uid: string) {
    setBusy(uid)
    setError(null)
    try {
      await unblock(me, uid)
    } catch {
      setError('ブロックを解除できませんでした。もう一度お試しください。')
    }
    setBusy(null)
  }

  return (
    <AppShell title="ブロックした人">
      <div className="flex flex-col gap-4">
        <p>ブロックした人の投稿・コメント・通知は、あなたの画面に出ません。ブロックしたことは、相手には知らされません。</p>
        {error && <Notice tone="error">{error}</Notice>}
        {blocked === null && <p role="status" className="text-muted">読み込み中…</p>}
        {blocked && uids.length === 0 && <p className="rounded-2xl bg-surface p-6 text-muted">ブロックしている人はいません。</p>}
        {uids.length > 0 && (
          <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
            {uids.map((uid) => {
              const profile = profiles.get(uid)
              return (
                <li key={uid} className="flex items-center justify-between gap-3 border-b border-divider p-4 last:border-b-0">
                  <span className="min-w-0">
                    <UserLink profile={profile} />
                    {profile && <span className="ml-2 text-note text-muted">@{profile.username}</span>}
                  </span>
                  <Button variant="secondary" busy={busy === uid} onClick={() => release(uid)} className="text-note">
                    解除<span className="sr-only">（{profile?.displayName ?? ''}さん）</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
