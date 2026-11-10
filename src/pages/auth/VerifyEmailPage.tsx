import { sendEmailVerification, signOut, type User } from 'firebase/auth'
import { useState } from 'react'
import { useAuth } from '../../auth/context'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Notice } from '../../components/ui'
import { auth } from '../../firebase'

// メールアドレスの確認が済むまで出す（F-03）
export function VerifyEmailPage({ user }: { user: User }) {
  const { refresh } = useAuth()
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info', text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function check() {
    setBusy(true)
    await refresh()
    setBusy(false)
    if (!auth.currentUser?.emailVerified) {
      setMessage({ tone: 'info', text: 'まだ確認が済んでいません。メールのリンクを開いてから、もう一度押してください。' })
    }
  }

  async function resend() {
    setBusy(true)
    try {
      await sendEmailVerification(user)
      setMessage({ tone: 'success', text: '確認のメールを送り直しました。' })
    } catch {
      setMessage({ tone: 'error', text: '送り直せませんでした。しばらく待ってから、もう一度お試しください。' })
    }
    setBusy(false)
  }

  return (
    <AuthLayout title="メールアドレスの確認">
      <p>
        <strong className="break-all">{user.email}</strong> に確認のメールを送りました。
        メールのリンクを開いてから、下の「確認しました」を押してください。
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-col gap-3">
        <Button busy={busy} onClick={check}>確認しました</Button>
        <Button variant="secondary" busy={busy} onClick={resend}>確認のメールを送り直す</Button>
        <Button variant="text" onClick={() => signOut(auth)}>ログアウト</Button>
      </div>
    </AuthLayout>
  )
}
