import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import type { Profile } from './useMyProfile'

export type UserResult = { uid: string, profile: Profile }

// ユーザー名から、その人の uid とプロフィールを読む。見つからないときは null、読み込み中は undefined
export function useUserByUsername(username: string): UserResult | null | undefined {
  const [state, setState] = useState<{ username: string, result: UserResult | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const entry = await getDoc(doc(db, 'usernames', username))
      const uid = entry.data()?.uid as string | undefined
      if (!uid) return null
      const user = await getDoc(doc(db, 'users', uid))
      return user.exists() ? { uid, profile: user.data() as Profile } : null
    }
    load()
      .catch(() => null)
      .then((result) => !cancelled && setState({ username, result }))
    return () => {
      cancelled = true
    }
  }, [username])

  return state?.username === username ? state.result : undefined
}
