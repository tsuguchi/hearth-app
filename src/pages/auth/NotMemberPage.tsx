import { signOut } from 'firebase/auth'
import { AuthLayout } from '../../components/AuthLayout'
import { Button } from '../../components/ui'
import { auth } from '../../firebase'

// ログインできたが「利用者」の印がないとき。止められたアカウントもここに来る
export function NotMemberPage() {
  return (
    <AuthLayout title="ハースを使えません">
      <p>このアカウントは、いまハースを使えない状態です。招待のリンクから登録したのにこの画面が出るときや、心当たりがないときは、運営者にお問い合わせください。</p>
      <Button variant="secondary" onClick={() => signOut(auth)}>ログアウト</Button>
    </AuthLayout>
  )
}
