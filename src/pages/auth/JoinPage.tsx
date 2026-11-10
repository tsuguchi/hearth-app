import { sendEmailVerification, signInWithEmailAndPassword } from 'firebase/auth'
import { type FormEvent, useState } from 'react'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, CheckboxField, Notice, TextField, TextLink } from '../../components/ui'
import { auth } from '../../firebase'

const PASSWORD_MIN_LENGTH = 8

// 招待のリンク（/join#招待の文字列）から登録する（F-01、F-02）。
// 招待の文字列は # の後ろにあるので、Web サーバーには送られず、ログにも残らない
export function JoinPage() {
  const [token] = useState(() => window.location.hash.slice(1))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [adult, setAdult] = useState(false)
  const [errors, setErrors] = useState<{ email?: string, password?: string, adult?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!token) {
    return (
      <AuthLayout title="招待のリンクが必要です">
        <p>ハースに登録するには、利用者から届いた招待のリンクを開いてください。リンクは最後まで（「#」の後ろも含めて）そのまま開く必要があります。</p>
        <p><TextLink to="/">ログインの画面へ</TextLink></p>
      </AuthLayout>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : 'メールアドレスを正しく入力してください（例: hearth@example.com）。',
      password: password.length >= PASSWORD_MIN_LENGTH ? undefined : `パスワードは ${PASSWORD_MIN_LENGTH} 文字以上にしてください。`,
      adult: adult ? undefined : 'ハースは 18 歳以上の方だけが使えます。',
    }
    setErrors(found)
    setFailure(null)
    if (found.email || found.password || found.adult) return

    setBusy(true)
    try {
      const response = await fetch('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, email: email.trim(), password, adult }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        setFailure(joinErrorMessage(data.error))
        setBusy(false)
        return
      }
      // 招待の文字列を、アドレス欄と履歴から消す
      window.history.replaceState(null, '', '/')
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
      await sendEmailVerification(credential.user)
      // この後は、ログインの状態が変わって、メールアドレスの確認の画面に進む
    } catch {
      setFailure('登録できませんでした。インターネットの接続を確かめて、もう一度お試しください。')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="ハースに登録する">
      <p>招待を受けて、ハースのアカウントを作ります。登録したメールアドレスに確認のメールを送ります。</p>
      {failure && <Notice tone="error">{failure}</Notice>}
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <TextField
          label="メールアドレス"
          type="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="パスワード"
          support={`${PASSWORD_MIN_LENGTH} 文字以上。ほかのサービスと同じものは避けてください。`}
          type="password"
          autoComplete="new-password"
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <CheckboxField label="18 歳以上です" checked={adult} error={errors.adult} onChange={(event) => setAdult(event.target.checked)} />
        <p className="text-note">「登録する」を押すと、<TextLink to="/terms">利用規約</TextLink>と<TextLink to="/privacy">プライバシーポリシー</TextLink>に同意したことになります。</p>
        <Button type="submit" busy={busy}>{busy ? '登録しています…' : '登録する'}</Button>
      </form>
    </AuthLayout>
  )
}

function joinErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_invite':
      return 'この招待のリンクは使えません。招待してくれた人に、新しいリンクを作ってもらってください。'
    case 'invite_used':
      return 'この招待のリンクは、もう使われています。招待してくれた人に、新しいリンクを作ってもらってください。'
    case 'invite_expired':
      return 'この招待のリンクは期限（7 日）が切れています。招待してくれた人に、新しいリンクを作ってもらってください。'
    case 'invites_closed':
      return 'いまは新しい登録を受け付けていません。招待してくれた人にお問い合わせください。'
    case 'member_cap':
      return '登録できる人数の上限に達しているため、いまは登録できません。'
    case 'email_exists':
      return 'このメールアドレスは、もう登録されています。ログインの画面からログインしてください。'
    case 'weak_password':
      return `パスワードは ${PASSWORD_MIN_LENGTH} 文字以上にしてください。`
    case 'adult_required':
      return 'ハースは 18 歳以上の方だけが使えます。'
    case 'conflict':
      return 'ほかの登録と重なりました。もう一度「登録する」を押してください。'
    default:
      return '登録できませんでした。もう一度お試しください。'
  }
}
