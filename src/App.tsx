import type { User } from 'firebase/auth'
import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth/context'
import { AuthLayout, Loading } from './components/AuthLayout'
import { Notice } from './components/ui'
import { JoinPage } from './pages/auth/JoinPage'
import { LegalPage } from './pages/LegalPage'
import { LoginPage } from './pages/auth/LoginPage'
import { NotMemberPage } from './pages/auth/NotMemberPage'
import { ProfileSetupPage } from './pages/auth/ProfileSetupPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage'
import { AdminPage } from './pages/AdminPage'
import { BlockedUsersPage } from './pages/BlockedUsersPage'
import { ConversationPage } from './pages/ConversationPage'
import { DeleteAccountPage } from './pages/DeleteAccountPage'
import { DevicesPage } from './pages/DevicesPage'
import { InvitesPage } from './pages/InvitesPage'
import { MessagesPage } from './pages/MessagesPage'
import { NewPostPage } from './pages/NewPostPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { PostPage } from './pages/PostPage'
import { ProfileEditPage } from './pages/ProfileEditPage'
import { ProfilePage } from './pages/ProfilePage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { TimelinePage } from './pages/TimelinePage'
import { PhotoSession } from './photos/PhotoSession'
import { messagesEnabled } from './features'
import { DeviceProvider } from './messages/DeviceProvider'
import { MessagesProvider } from './messages/MessagesProvider'
import { BlocksProvider } from './social/BlocksProvider'
import { FollowingProvider } from './social/FollowingProvider'
import { NotificationsProvider } from './notifications/NotificationsProvider'
import { useMyProfile } from './profile/useMyProfile'

// ログイン → メールアドレスの確認 → 利用者の印の確認 → プロフィールを決める → ハースの画面、の順に進める
export default function App() {
  return (
    <Routes>
      {/* 利用規約とプライバシーポリシーは、ログインしていなくても読める */}
      <Route path="/terms" element={<LegalPage kind="terms" />} />
      <Route path="/privacy" element={<LegalPage kind="privacy" />} />
      <Route path="*" element={<GatedApp />} />
    </Routes>
  )
}

function GatedApp() {
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
  const { isAdmin } = useAuth()
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
  // 止められたアカウント（F-92）。ログインの証明書が切れる前でも、ここで止める
  if (profile.status === 'suspended') return <NotMemberPage />

  return (
    <PhotoSession>
      <BlocksProvider me={user.uid}>
        <FollowingProvider me={user.uid}>
          <NotificationsProvider me={user.uid}>
            <MessagesProvider me={user.uid}>
              <DeviceProvider me={user.uid}>
                <Routes>
                  <Route path="/" element={<TimelinePage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/new" element={<NewPostPage uid={user.uid} />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  {messagesEnabled && <Route path="/messages" element={<MessagesPage me={user.uid} />} />}
                  {messagesEnabled && <Route path="/messages/:username" element={<ConversationPage me={user.uid} />} />}
                  {messagesEnabled && <Route path="/settings/devices" element={<DevicesPage me={user.uid} />} />}
                  <Route path="/me" element={<Navigate to={`/users/${profile.username}`} replace />} />
                  <Route path="/users/:username" element={<ProfilePage />} />
                  <Route path="/posts/:postId" element={<PostPage me={user.uid} />} />
                  <Route path="/invites" element={<InvitesPage />} />
                  {isAdmin && <Route path="/admin" element={<AdminPage me={user.uid} />} />}
                  <Route path="/settings/delete-account" element={<DeleteAccountPage uid={user.uid} />} />
                  <Route path="/settings/blocks" element={<BlockedUsersPage me={user.uid} />} />
                  <Route path="/settings/profile" element={<ProfileEditPage uid={user.uid} profile={profile} />} />
                  <Route path="/settings" element={<SettingsPage uid={user.uid} profile={profile} email={user.email} />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </DeviceProvider>
            </MessagesProvider>
          </NotificationsProvider>
        </FollowingProvider>
      </BlocksProvider>
    </PhotoSession>
  )
}
