import { signOut } from 'firebase/auth'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/ui'
import { auth } from '../firebase'
import { PHOTO_LIMIT } from '../posts/types'
import type { Profile } from '../profile/useMyProfile'
import { usePhotoCount } from '../profile/usePhotoCount'

export function SettingsPage({ uid, profile, email }: { uid: string, profile: Profile, email: string | null }) {
  const photoCount = usePhotoCount(uid)
  return (
    <AppShell title="設定">
      <div className="flex flex-col gap-6">
        <section aria-labelledby="account-heading" className="rounded-2xl bg-surface p-6">
          <h2 id="account-heading" className="text-subtitle font-bold">アカウント</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted">ユーザー名</dt>
            <dd>@{profile.username}</dd>
            <dt className="text-muted">表示名</dt>
            <dd>{profile.displayName}</dd>
            <dt className="text-muted">メールアドレス</dt>
            <dd className="break-all">{email}</dd>
            <dt className="text-muted">写真の枚数</dt>
            <dd>{photoCount === null ? '読み込み中…' : `${photoCount} / ${PHOTO_LIMIT} 枚`}</dd>
          </dl>
        </section>
        <div>
          <Button variant="secondary" onClick={() => signOut(auth)}>ログアウト</Button>
        </div>
      </div>
    </AppShell>
  )
}
