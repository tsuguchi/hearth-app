import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../firebase'

// 今残っている自分の写真の枚数（F-26、F-27）。読み込み中は null
export function usePhotoCount(uid: string): number | null {
  const [state, setState] = useState<{ uid: string, count: number } | null>(null)

  useEffect(() => onSnapshot(
    doc(db, 'userPrivate', uid),
    (snapshot) => setState({ uid, count: Number(snapshot.data()?.photoCount ?? 0) }),
    () => setState(null),
  ), [uid])

  return state?.uid === uid ? state.count : null
}
