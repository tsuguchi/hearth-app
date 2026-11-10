import type { User } from 'firebase/auth'
import { createContext, useContext } from 'react'

export type AuthState = {
  loading: boolean
  user: User | null
  // ログインの証明書に「利用者」の印（member）があるか。招待で登録した人だけが持つ
  isMember: boolean
  // メールアドレスの確認の後などに、証明書を取り直して印を読み直す
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider の中で使ってください')
  return value
}
