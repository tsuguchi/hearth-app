import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { db } from '../firebase'

// 自分がブロックした人の一覧（F-80、F-81）。ブロックした人の投稿・コメント・通知は、自分の画面に出さない。
// ブロックされた側には知らせないので、相手の画面では何も変わらない（DATA_MODEL.md の 3.5）
type BlocksState = { blocked: Set<string> | null }

const BlocksContext = createContext<BlocksState | null>(null)

export function BlocksProvider({ me, children }: { me: string, children: ReactNode }) {
  const [state, setState] = useState<{ me: string, blocked: Set<string> } | null>(null)

  useEffect(() => onSnapshot(
    collection(db, 'users', me, 'blocks'),
    (snapshot) => setState({ me, blocked: new Set(snapshot.docs.map((document) => document.id)) }),
    () => setState({ me, blocked: new Set() }),
  ), [me])

  return <BlocksContext value={{ blocked: state?.me === me ? state.blocked : null }}>{children}</BlocksContext>
}

export function useBlocks(): BlocksState {
  const value = useContext(BlocksContext)
  if (!value) throw new Error('BlocksProvider の中で使ってください')
  return value
}

// ブロックする。お互いのフォローも外す（あるものだけ。ないものを消そうとすると Security Rules が断るため）
export async function block(me: string, target: string): Promise<void> {
  const [mine, theirs] = await Promise.all([
    getDoc(doc(db, 'follows', `${me}_${target}`)),
    getDoc(doc(db, 'follows', `${target}_${me}`)),
  ])
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', me, 'blocks', target), { createdAt: serverTimestamp() })
  if (mine.exists()) batch.delete(mine.ref)
  if (theirs.exists()) batch.delete(theirs.ref)
  await batch.commit()
}

export async function unblock(me: string, target: string): Promise<void> {
  await deleteDoc(doc(db, 'users', me, 'blocks', target))
}
