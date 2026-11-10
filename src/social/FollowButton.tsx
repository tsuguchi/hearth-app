import { useState } from 'react'
import { Button } from '../components/ui'
import { follow, unfollow } from './actions'
import { useBlocks } from './BlocksProvider'
import { useFollowing } from './FollowingProvider'

// フォローする・やめる（F-40）。相手の承認は要らない
export function FollowButton({ target, name, onError }: { target: string, name: string, onError: (message: string) => void }) {
  const { me, following } = useFollowing()
  const { blocked } = useBlocks()
  const [busy, setBusy] = useState(false)
  // ブロックした人はフォローできない（F-80）
  if (target === me || following === null || blocked === null || blocked.has(target)) return null
  const isFollowing = following.has(target)

  async function toggle() {
    setBusy(true)
    try {
      await (isFollowing ? unfollow(me, target) : follow(me, target))
    } catch {
      onError(isFollowing ? 'フォローをやめられませんでした。もう一度お試しください。' : 'フォローできませんでした。もう一度お試しください。')
    }
    setBusy(false)
  }

  return (
    <Button
      variant={isFollowing ? 'secondary' : 'primary'}
      busy={busy}
      onClick={toggle}
      className="px-4 text-note"
    >
      {isFollowing ? 'フォロー中' : 'フォローする'}
      <span className="sr-only">（{name}さん）</span>
    </Button>
  )
}
