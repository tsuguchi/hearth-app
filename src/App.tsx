import type { User } from 'firebase/auth'
import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/context'
import { AuthLayout, Loading } from './components/AuthLayout'
import { Notice } from './components/ui'
import { JoinPage } from './pages/auth/JoinPage'
import { LoginPage } from './pages/auth/LoginPage'
import { NotMemberPage } from './pages/auth/NotMemberPage'
import { ProfileSetupPage } from './pages/auth/ProfileSetupPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage'
import { NewPostPage } from './pages/NewPostPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PostPage } from './pages/PostPage'
import { ProfileEditPage } from './pages/ProfileEditPage'
import { ProfilePage } from './pages/ProfilePage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'
import { TimelinePage } from './pages/TimelinePage'
import { PhotoSession } from './photos/PhotoSession'
import { FollowingProvider } from './social/FollowingProvider'
import { NotificationsProvider } from './notifications/NotificationsProvider'
import { useMyProfile } from './profile/useMyProfile'

// ログイン → メールアドレスの確認 → 利用者の印の確認 → プロフィールを決める → ハースの画面、の順に進める
export default function App() {
  const { loading, user, isMember } = useAuth()

  if (loading) return <Loading />
  if (!user) {
    return (
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  if (!user.emailVerified) return <VerifyEmailPage user={user} />
  if (!isMember) return <NotMemberPage />
  return <MemberApp user={user} />
}

function MemberApp({ user }: { user: User }) {
  const { profile, error } = useMyProfile(user.uid)

  if (error) {
    return (
      <AuthLayout title="読み込めませんでした">
        <Notice tone="error">プロフィールを読み込めませんでした。ページを読み込み直してください。</Notice>
      </AuthLayout>
    )
  }
  if (profile === undefined) return <Loading />
  if (profile === null) return <ProfileSetupPage uid={user.uid} />

  return (
    <PhotoSession>
      <FollowingProvider me={user.uid}>
        <NotificationsProvider me={user.uid}>
          <Routes>
            <Route path="/" element={<TimelinePage />} />
            <Route path="/search" element={<PlaceholderPage title="検索" description="ユーザー名・表示名で人を、タグで投稿を探せます。" />} />
            <Route path="/new" element={<NewPostPage uid={user.uid} />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<PlaceholderPage title="メッセージ" description="1 対 1 で、文字と写真を送り合えます。中身は運営者にも読めないよう暗号化します。" />} />
            <Route path="/me" element={<Navigate to={`/users/${profile.username}`} replace />} />
            <Route path="/users/:username" element={<ProfilePage />} />
            <Route path="/posts/:postId" element={<PostPage me={user.uid} />} />
            <Route path="/settings/profile" element={<ProfileEditPage uid={user.uid} profile={profile} />} />
            <Route path="/settings" element={<SettingsPage uid={user.uid} profile={profile} email={user.email} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </NotificationsProvider>
      </FollowingProvider>
    </PhotoSession>
  )
}
