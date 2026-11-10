import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase'

export type Profile = {
  username: string
  displayName: string
  bio: string
  iconPhotoId: string | null
  status: 'active' | 'suspended'
}

// 自分のプロフィール。まだ作っていないときは null、読み込み中は undefined
export function useMyProfile(uid: string): { profile: Profile | null | undefined, error: Error | null } {
  const [state, setState] = useState<{ uid: string, profile: Profile | null, error: Error | null } | null>(null)

  useEffect(() => onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => setState({ uid, profile: snapshot.exists() ? snapshot.data() as Profile : null, error: null }),
    (error) => setState({ uid, profile: null, error }),
  ), [uid])

  if (state?.uid !== uid) return { profile: undefined, error: null }
  return { profile: state.profile, error: state.error }
}
