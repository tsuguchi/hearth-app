import { doc, getDoc, writeBatch } from 'firebase/firestore'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Button, Notice, TextAreaField, TextField } from '../components/ui'
import { db } from '../firebase'
import type { Profile } from '../profile/useMyProfile'
import { DISPLAY_NAME_MAX, USERNAME_PATTERN } from './auth/ProfileSetupPage'

const BIO_MAX = 150

// プロフィールの編集（F-05）。ユーザー名を変えるときは、新しい名前の登録と古い名前の削除を一緒に行う
export function ProfileEditPage({ uid, profile }: { uid: string, profile: Profile }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState(profile.username)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [bio, setBio] = useState(profile.bio)
  const [errors, setErrors] = useState<{ username?: string, displayName?: string, bio?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = username.trim()
    const display = displayName.trim()
    const text = bio.trim()
    const found = {
      username: USERNAME_PATTERN.test(name) ? undefined : '英小文字・数字・「_」で、3〜20 文字にしてください。',
      displayName: display.length >= 1 && display.length <= DISPLAY_NAME_MAX ? undefined : `1〜${DISPLAY_NAME_MAX} 文字で入力してください。`,
      bio: text.length <= BIO_MAX ? undefined : `${BIO_MAX} 文字までにしてください。`,
    }
    setErrors(found)
    setFailure(null)
    if (found.username || found.displayName || found.bio) return

    setBusy(true)
    try {
      const changingName = name !== profile.username
      if (changingName && (await getDoc(doc(db, 'usernames', name))).exists()) {
        setErrors({ username: 'このユーザー名は、ほかの人が使っています。別のものにしてください。' })
        setBusy(false)
        return
      }
      const batch = writeBatch(db)
      batch.update(doc(db, 'users', uid), { username: name, displayName: display, bio: text })
      if (changingName) {
        batch.set(doc(db, 'usernames', name), { uid })
        batch.delete(doc(db, 'usernames', profile.username))
      }
      await batch.commit()
      navigate(`/users/${name}`)
    } catch {
      setFailure('保存できませんでした。もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <AppShell title="プロフィールを編集">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-surface p-6">
        {failure && <Notice tone="error">{failure}</Notice>}
        <TextField
          label="ユーザー名"
          support="英小文字・数字・「_」で 3〜20 文字。変えると、前のユーザー名のページは開けなくなります。"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          error={errors.username}
          onChange={(event) => setUsername(event.target.value.toLowerCase())}
        />
        <TextField
          label="表示名"
          support={`${DISPLAY_NAME_MAX} 文字まで。`}
          autoComplete="nickname"
          value={displayName}
          error={errors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <TextAreaField label="自己紹介" value={bio} maxLength={BIO_MAX} error={errors.bio} onChange={(event) => setBio(event.target.value)} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" busy={busy}>{busy ? '保存しています…' : '保存する'}</Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>やめる</Button>
        </div>
      </form>
    </AppShell>
  )
}
