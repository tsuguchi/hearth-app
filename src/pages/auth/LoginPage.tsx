import { FirebaseError } from 'firebase/app'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Notice, TextField, TextLink } from '../../components/ui'
import { auth } from '../../firebase'
import { ACCOUNT_DELETED_KEY } from '../DeleteAccountPage'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // アカウントを削除した直後は、その旨を一度だけ知らせる
  // （開発中の StrictMode では初期値の関数が 2 回呼ばれるので、ここでは読むだけにし、消すのは表示した後にする）
  const [deleted] = useState(() => sessionStorage.getItem(ACCOUNT_DELETED_KEY) === '1')
  useEffect(() => {
    if (deleted) sessionStorage.removeItem(ACCOUNT_DELETED_KEY)
  }, [deleted])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('メールアドレスとパスワードを入力してください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (caught) {
      setError(loginErrorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="ログイン">
      <p>ハースは、招待を受けた人だけが使える写真の共有の場です。はじめての方は、届いた招待のリンクから登録してください。</p>
      {deleted && <Notice tone="success">アカウントを削除しました。これまでご利用いただき、ありがとうございました。</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <TextField label="メールアドレス" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <TextField label="パスワード" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" busy={busy}>{busy ? 'ログインしています…' : 'ログイン'}</Button>
      </form>
      <p><TextLink to="/reset-password">パスワードを忘れたとき</TextLink></p>
    </AuthLayout>
  )
}

function loginErrorMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : ''
  if (code === 'auth/invalid-credential' || code === 'auth/invalid-email' || code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    return 'メールアドレスかパスワードが違います。'
  }
  if (code === 'auth/user-disabled') return 'このアカウントは止められています。運営者にお問い合わせください。'
  if (code === 'auth/too-many-requests') return 'ログインの試行が多すぎます。しばらく待ってから、もう一度お試しください。'
  if (code === 'auth/network-request-failed') return 'インターネットにつながっていないようです。接続を確かめてください。'
  return 'ログインできませんでした。もう一度お試しください。'
}
