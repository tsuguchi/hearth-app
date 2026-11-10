import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { type FormEvent, useState } from 'react'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Notice, TextField } from '../../components/ui'
import { db } from '../../firebase'

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
export const DISPLAY_NAME_MAX = 30

// はじめてのログインで、ユーザー名と表示名を決める（F-05）
export function ProfileSetupPage({ uid }: { uid: string }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [errors, setErrors] = useState<{ username?: string, displayName?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = username.trim()
    const display = displayName.trim()
    const found = {
      username: USERNAME_PATTERN.test(name) ? undefined : '英小文字・数字・「_」で、3〜20 文字にしてください。',
      displayName: display.length >= 1 && display.length <= DISPLAY_NAME_MAX ? undefined : `1〜${DISPLAY_NAME_MAX} 文字で入力してください。`,
    }
    setErrors(found)
    setFailure(null)
    if (found.username || found.displayName) return

    setBusy(true)
    try {
      if ((await getDoc(doc(db, 'usernames', name))).exists()) {
        setErrors({ username: 'このユーザー名は、ほかの人が使っています。別のものにしてください。' })
        setBusy(false)
        return
      }
      const batch = writeBatch(db)
      batch.set(doc(db, 'users', uid), {
        username: name, displayName: display, bio: '', iconPhotoId: null, status: 'active', createdAt: serverTimestamp(),
      })
      batch.set(doc(db, 'usernames', name), { uid })
      await batch.commit()
      // 保存できると、プロフィールの読み込みが変わって、ハースの画面に進む
    } catch {
      setFailure('保存できませんでした。ユーザー名をほかの人が同時に使った可能性があります。別のユーザー名で、もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="プロフィールを決める">
      <p>ハースの中で、あなたを見分けるための名前を決めます。どちらもあとから変えられます。</p>
      {failure && <Notice tone="error">{failure}</Notice>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <TextField
          label="ユーザー名"
          support="英小文字・数字・「_」で 3〜20 文字。ほかの人と同じものは使えません（例: haru_photo）。"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          error={errors.username}
          onChange={(event) => setUsername(event.target.value.toLowerCase())}
        />
        <TextField
          label="表示名"
          support={`投稿やコメントに出る名前。${DISPLAY_NAME_MAX} 文字まで（例: はる）。`}
          autoComplete="nickname"
          value={displayName}
          error={errors.displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Button type="submit" busy={busy}>{busy ? '保存しています…' : '保存してはじめる'}</Button>
      </form>
    </AuthLayout>
  )
}
