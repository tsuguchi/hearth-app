import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import type { Profile } from './useMyProfile'

// 投稿した人のプロフィールを読む。一度読んだ人は、画面を開いている間は覚えておく
const cache = new Map<string, Promise<Profile | null>>()

function load(uid: string): Promise<Profile | null> {
  let pending = cache.get(uid)
  if (!pending) {
    pending = getDoc(doc(db, 'users', uid))
      .then((snapshot) => (snapshot.exists() ? snapshot.data() as Profile : null))
      .catch(() => {
        cache.delete(uid)
        return null
      })
    cache.set(uid, pending)
  }
  return pending
}

export function useProfiles(uids: string[]): Map<string, Profile | null> {
  const [profiles, setProfiles] = useState(new Map<string, Profile | null>())
  const key = [...new Set(uids)].sort().join(',')

  useEffect(() => {
    let cancelled = false
    const ids = key ? key.split(',') : []
    Promise.all(ids.map(async (uid) => [uid, await load(uid)] as const)).then((entries) => {
      if (!cancelled) setProfiles(new Map(entries))
    })
    return () => {
      cancelled = true
    }
  }, [key])

  return profiles
}
