import { type ReactNode, useEffect } from 'react'
import { usesEmulator } from '../firebase'
import { Logo } from './ui'

// ログインや登録など、利用者の画面に入る前の画面の枠
export function AuthLayout({ title, children }: { title: string, children: ReactNode }) {
  useEffect(() => {
    document.title = `${title}｜ハース`
  }, [title])

  return (
    <>
      <EmulatorBanner />
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-10">
        <p className="text-center text-title"><Logo /></p>
        <div className="flex flex-col gap-6 rounded-2xl bg-surface p-6 shadow-sm">
          <h1 className="text-title font-bold">{title}</h1>
          {children}
        </div>
      </main>
    </>
  )
}

// 本番と見分けられるよう、練習用の Firebase（Emulator）につないでいるときだけ出す
export function EmulatorBanner() {
  if (!usesEmulator) return null
  return (
    <p className="bg-accent px-4 py-1 text-center text-note font-bold text-on-accent">
      練習用（Emulator）につないでいます。本番のデータではありません。
    </p>
  )
}

export function Loading() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p role="status">読み込み中…</p>
    </main>
  )
}
