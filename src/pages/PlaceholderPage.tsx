import { AppShell } from '../components/AppShell'

// まだ作っていない画面
export function PlaceholderPage({ title, description }: { title: string, description: string }) {
  return (
    <AppShell title={title}>
      <div className="rounded-2xl bg-surface p-6">
        <p>{description}</p>
        <p className="mt-2 text-note text-muted">この画面は準備中です。</p>
      </div>
    </AppShell>
  )
}
