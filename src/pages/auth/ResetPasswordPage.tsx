import { sendPasswordResetEmail } from 'firebase/auth'
import { type FormEvent, useState } from 'react'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Notice, TextField, TextLink } from '../../components/ui'
import { auth } from '../../firebase'

// パスワードの再設定のメールを送る（F-04）。
// 登録されているかどうかが分からないよう、どちらの場合も同じ知らせを出す
export function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('メールアドレスを正しく入力してください（例: hearth@example.com）。')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch {
      // 登録されていないメールアドレスでも、同じ知らせを出す
    }
    setSent(true)
    setBusy(false)
  }

  return (
    <AuthLayout title="パスワードの再設定">
      {sent ? (
        <Notice tone="success">
          登録されているメールアドレスなら、再設定のメールを送りました。メールのリンクから、新しいパスワードを決めてください。
        </Notice>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <p>登録したメールアドレスに、パスワードを決め直すためのメールを送ります。</p>
          <TextField label="メールアドレス" type="email" autoComplete="email" value={email} error={error} onChange={(event) => setEmail(event.target.value)} />
          <Button type="submit" busy={busy}>{busy ? '送っています…' : '再設定のメールを送る'}</Button>
        </form>
      )}
      <p><TextLink to="/">ログインの画面へ戻る</TextLink></p>
    </AuthLayout>
  )
}
