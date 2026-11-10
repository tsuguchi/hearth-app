import { FirebaseError } from 'firebase/app'
import { EmailAuthProvider, reauthenticateWithCredential, signOut } from 'firebase/auth'
import { type FormEvent, useState } from 'react'
import { api } from '../api'
import { AppShell } from '../components/AppShell'
import { Button, CheckboxField, Notice, TextField } from '../components/ui'
import { auth } from '../firebase'
import { deleteDevice } from '../messages/deviceStore'

export const ACCOUNT_DELETED_KEY = 'hearth.accountDeleted'

// アカウントの削除（F-06）。間違えて消さないよう、パスワードを入れ直してもらう
export function DeleteAccountPage({ uid }: { uid: string }) {
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [errors, setErrors] = useState<{ password?: string, understood?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = {
      password: password ? undefined : 'ログインのパスワードを入力してください。',
      understood: understood ? undefined : '消えるものを確かめたら、チェックを入れてください。',
    }
    setErrors(found)
    setFailure(null)
    if (found.password || found.understood) return

    const user = auth.currentUser
    if (!user?.email) return
    setBusy(true)
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
    } catch (error) {
      const code = error instanceof FirebaseError ? error.code : ''
      setErrors({ password: code === 'auth/too-many-requests' ? '試行が多すぎます。しばらく待ってから、もう一度お試しください。' : 'パスワードが違います。' })
      setBusy(false)
      return
    }
    try {
      await api('/api/account', { method: 'DELETE' })
    } catch {
      setFailure('削除できませんでした。もう一度お試しください。何度も失敗するときは、運営者にお問い合わせください。')
      setBusy(false)
      return
    }
    // この端末に置いたメッセージの鍵も消す
    await deleteDevice(uid).catch(() => {})
    // アドレスをはじめの画面にしてからログアウトする。ログインの画面が「削除しました」と知らせる
    // （読み込み直すと、知らせの印を読む前の画面で消してしまうため、読み込み直さない）
    sessionStorage.setItem(ACCOUNT_DELETED_KEY, '1')
    window.history.replaceState(null, '', '/')
    await signOut(auth).catch(() => {})
  }

  return (
    <AppShell title="アカウントを削除">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-surface p-6">
        <div className="flex flex-col gap-2">
          <p className="font-bold">アカウントを削除すると、次のものがすべて消え、元に戻せません。</p>
          <ul className="list-disc pl-6">
            <li>プロフィール、投稿と写真、ほかの人の投稿に書いたコメントといいね</li>
            <li>あなたの投稿に付いたコメントといいね（ほかの人が書いたものも含む）</li>
            <li>フォロー・フォロワー、ブロック、通知</li>
            <li>メッセージのやり取り（相手の側からも消えます）と、メッセージの写真</li>
            <li>使われていない招待のリンク</li>
          </ul>
          <p className="text-note text-muted">あなたがだれを招待したかの記録と、あなたが送った通報は、運営のために残ります（通報した人の名前は、相手には知らされていません）。</p>
        </div>
        {failure && <Notice tone="error">{failure}</Notice>}
        <TextField
          label="ログインのパスワード"
          support="本人であることを確かめるため、もう一度入力してください。"
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <CheckboxField
          label="消えるものを確かめました。元に戻せないことを理解しました"
          checked={understood}
          error={errors.understood}
          onChange={(event) => setUnderstood(event.target.checked)}
        />
        <div>
          <Button type="submit" busy={busy} className="bg-error text-surface">{busy ? '削除しています…' : 'アカウントを削除する'}</Button>
        </div>
      </form>
    </AppShell>
  )
}
