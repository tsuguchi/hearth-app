import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Notice } from '../components/ui'
import { db } from '../firebase'
import type { DeviceRecord } from '../messages/DeviceProvider'
import { loadDevice } from '../messages/deviceStore'
import { formatPostTime } from '../posts/format'

// メッセージの端末の一覧（F-104）。使わなくなった端末を外すと、それ以降はその端末に向けて暗号化しない
export function DevicesPage({ me }: { me: string }) {
  const [devices, setDevices] = useState<DeviceRecord[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [removing, setRemoving] = useState<DeviceRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onSnapshot(
    collection(db, 'users', me, 'devices'),
    (snapshot) => setDevices(snapshot.docs.map((document) => ({ deviceId: document.id, ...document.data() }) as DeviceRecord)),
    () => setError('端末の一覧を読み込めませんでした。'),
  ), [me])

  useEffect(() => {
    loadDevice(me).then((device) => setCurrent(device?.deviceId ?? null)).catch(() => setCurrent(null))
  }, [me])

  async function remove() {
    if (!removing) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'users', me, 'devices', removing.deviceId))
    } catch {
      setError('外せませんでした。もう一度お試しください。')
    }
    setBusy(false)
    setRemoving(null)
  }

  return (
    <AppShell title="メッセージの端末">
      <div className="flex flex-col gap-4">
        <p>メッセージは、ここに並んでいる端末に向けて暗号化します。端末ごとに鍵があり、新しい端末では、それより前のメッセージは読めません。使わなくなった端末は外してください。</p>
        {error && <Notice tone="error">{error}</Notice>}
        {devices === null && <p role="status" className="text-muted">読み込み中…</p>}
        {devices && devices.length === 0 && <p className="rounded-2xl bg-surface p-6 text-muted">まだ端末はありません。メッセージの画面を開くと、この端末が登録されます。</p>}
        {devices && devices.length > 0 && (
          <ul className="flex flex-col overflow-hidden rounded-2xl bg-surface">
            {[...devices].sort((a, b) => (b.lastSeenAt?.toMillis() ?? 0) - (a.lastSeenAt?.toMillis() ?? 0)).map((device) => {
              const isCurrent = device.deviceId === current
              const lastSeen = device.lastSeenAt?.toDate()
              const created = device.createdAt?.toDate()
              return (
                <li key={device.deviceId} className="flex flex-wrap items-center justify-between gap-3 border-b border-divider p-4 last:border-b-0">
                  <div className="flex flex-col">
                    <span className="font-bold">
                      {device.label}
                      {isCurrent && <span className="ml-2 rounded-full bg-accent px-2 text-note text-on-accent">この端末</span>}
                    </span>
                    <span className="text-note text-muted">
                      {created && <>登録: {created.toLocaleDateString('ja-JP')}</>}
                      {lastSeen && <> ・ 最後に使った日: {formatPostTime(lastSeen)}</>}
                    </span>
                  </div>
                  {!isCurrent && (
                    <Button variant="secondary" className="text-note" onClick={() => setRemoving(device)}>
                      外す<span className="sr-only">（{device.label}）</span>
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`「${removing?.label ?? ''}」を外しますか？`}
        confirmLabel="外す"
        busy={busy}
        onConfirm={remove}
      >
        <p>この端末には、これからのメッセージが届かなくなります。もう一度その端末でメッセージを開くと、新しい端末として登録され、それより前のメッセージは読めません。</p>
      </ConfirmDialog>
    </AppShell>
  )
}
