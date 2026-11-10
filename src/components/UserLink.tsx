import { Link } from 'react-router'
import type { Profile } from '../profile/useMyProfile'

// 人の表示名。プロフィールの画面へのリンクにする
export function UserLink({ profile, className = '', onClick }: { profile: Profile | null | undefined, className?: string, onClick?: () => void }) {
  if (!profile) return <span className={`font-bold ${className}`}>{profile === null ? '（退会した人）' : '…'}</span>
  return (
    <Link to={`/users/${profile.username}`} onClick={onClick} className={`font-bold hover:underline hover:underline-offset-4 ${className}`}>
      {profile.displayName}
    </Link>
  )
}
