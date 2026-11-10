import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { db } from '../firebase'

// 自分がフォローしている人の一覧。タイムラインの「フォロー中」とフォローのボタンが使う。読み込み中は null
type FollowingState = { me: string, following: Set<string> | null }

const FollowingContext = createContext<FollowingState | null>(null)

export function FollowingProvider({ me, children }: { me: string, children: ReactNode }) {
  const [state, setState] = useState<{ me: string, following: Set<string> } | null>(null)

  useEffect(() => onSnapshot(
    query(collection(db, 'follows'), where('follower', '==', me)),
    (snapshot) => setState({ me, following: new Set(snapshot.docs.map((document) => document.data().followee as string)) }),
    () => setState({ me, following: new Set() }),
  ), [me])

  const value = { me, following: state?.me === me ? state.following : null }
  return <FollowingContext value={value}>{children}</FollowingContext>
}

export function useFollowing(): FollowingState {
  const value = useContext(FollowingContext)
  if (!value) throw new Error('FollowingProvider の中で使ってください')
  return value
}
