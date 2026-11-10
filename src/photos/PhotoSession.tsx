import { type ReactNode, useEffect, useState } from 'react'
import { api } from '../api'
import { Loading } from '../components/AuthLayout'

// 写真を見るための cookie（1 時間）をもらい、切れる前に取り直す。
// 写真は <img> でそのまま読み込むので、cookie ができるまで中身を出さない
const REFRESH_MS = 45 * 60 * 1000

export function PhotoSession({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        await api('/api/session', { method: 'POST' })
        if (!cancelled) setReady(true)
      } catch {
        // 取れなかったときも画面は出す（写真だけが読み込めない）。次の取り直しで回復する
        if (!cancelled) setReady(true)
      }
    }
    void refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return ready ? children : <Loading />
}
