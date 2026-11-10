import { onIdTokenChanged, type User } from 'firebase/auth'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { auth } from '../firebase'
import { AuthContext } from './context'

type State = { loading: boolean, user: User | null, isMember: boolean }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ loading: true, user: null, isMember: false })

  // 証明書が変わるたびに（ログイン・ログアウト・取り直し）、印を読み直す
  useEffect(() => onIdTokenChanged(auth, async (user) => {
    if (!user) {
      setState({ loading: false, user: null, isMember: false })
      return
    }
    const token = await user.getIdTokenResult()
    setState({ loading: false, user, isMember: token.claims.member === true })
  }), [])

  const refresh = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return
    await user.reload()
    // reload では証明書が変わらないので、取り直して onIdTokenChanged を動かす
    await user.getIdToken(true)
  }, [])

  return (
    <AuthContext value={{ loading: state.loading, user: state.user, isMember: state.isMember, refresh }}>
      {children}
    </AuthContext>
  )
}
