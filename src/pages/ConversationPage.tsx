import { collection, doc, limitToLast, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { ImagePlus, Lock, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../api'
import { AppShell } from '../components/AppShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Button, Notice, TextAreaField } from '../components/ui'
import { db } from '../firebase'
import { type DeviceRecord, useDevice } from '../messages/DeviceProvider'
import { MessageBubble, type StoredMessage } from '../messages/MessageBubble'
import { conversationIdFor, isConversationUnread, useMessages } from '../messages/MessagesProvider'
import { MESSAGE_PHOTOS_MAX, MESSAGE_TEXT_MAX, NoRecipientDeviceError, sendMessage } from '../messages/messaging'
import { useUserByUsername } from '../profile/useUser'
import { useBlocks } from '../social/BlocksProvider'
import { ReportDialog } from '../social/ReportDialog'

const KNOWN_DEVICES_KEY = (conversationId: string) => `hearth.knownDevices.${conversationId}`

// 1 対 1 のやり取り（F-60〜F-64、F-102、F-103、F-105）
export function ConversationPage({ me }: { me: string }) {
  const { username = '' } = useParams()
  const user = useUserByUsername(username)

  if (user === undefined) return <AppShell title="メッセージ"><p role="status" className="text-muted">読み込み中…</p></AppShell>
  if (user === null || user.uid === me) {
    return (
      <AppShell title="メッセージ">
        <p className="rounded-2xl bg-surface p-6">@{username} という人は見つかりません。</p>
      </AppShell>
    )
  }
  return <Conversation key={user.uid} me={me} other={user.uid} otherName={user.profile.displayName} otherUsername={user.profile.username} />
}

function Conversation({ me, other, otherName, otherUsername }: { me: string, other: string, otherName: string, otherUsername: string }) {
  const conversationId = conversationIdFor(me, other)
  const { state: deviceState, ensure, acknowledgeNew } = useDevice()
  const { conversations } = useMessages()
  const { blocked } = useBlocks()
  const [messages, setMessages] = useState<StoredMessage[] | null>(null)
  const [newDevices, setNewDevices] = useState<DeviceRecord[]>([])
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [unsending, setUnsending] = useState<StoredMessage | null>(null)
  const [reporting, setReporting] = useState<{ message: StoredMessage, text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => ensure(), [ensure])

  // やり取りの文書ができてから読む（ないうちは読む権限がなく、読み込みが止まってしまうため）
  const conversation = useMemo(() => conversations?.find((item) => item.id === conversationId), [conversations, conversationId])
  const exists = conversation !== undefined
  useEffect(() => {
    if (!exists) return
    return onSnapshot(
      query(collection(db, 'conversations', conversationId, 'messages'), orderBy('createdAt', 'asc'), limitToLast(100)),
      (snapshot) => setMessages(snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StoredMessage)),
      () => setMessages([]),
    )
  }, [conversationId, exists])
  const shown = exists ? messages : conversations === null ? null : []

  // 相手の端末が増えたら知らせる（F-105）。運営者が偽の端末を紛れ込ませても気付けるようにするため
  useEffect(() => onSnapshot(collection(db, 'users', other, 'devices'), (snapshot) => {
    const devices = snapshot.docs.map((document) => ({ deviceId: document.id, ...document.data() }) as DeviceRecord)
    const stored = localStorage.getItem(KNOWN_DEVICES_KEY(conversationId))
    const ids = devices.map((device) => device.deviceId)
    // はじめて見たとき、または相手がまだ端末を持っていなかったときは、知らせずに覚えるだけにする（最初の端末は怪しくない）
    if (stored === null || (JSON.parse(stored) as string[]).length === 0) {
      localStorage.setItem(KNOWN_DEVICES_KEY(conversationId), JSON.stringify(ids))
      return
    }
    const known = new Set(JSON.parse(stored) as string[])
    setNewDevices(devices.filter((device) => !known.has(device.deviceId)))
  }), [conversationId, other])

  function acknowledgeDevices() {
    const stored = new Set(JSON.parse(localStorage.getItem(KNOWN_DEVICES_KEY(conversationId)) ?? '[]') as string[])
    for (const device of newDevices) stored.add(device.deviceId)
    localStorage.setItem(KNOWN_DEVICES_KEY(conversationId), JSON.stringify([...stored]))
    setNewDevices([])
  }

  // 開いている間に来たメッセージは、読んだことにする（F-62）
  // 同じ最新のメッセージに対しては 1 回だけ書く
  const markedFor = useRef<number | null>(null)
  useEffect(() => {
    const last = conversation?.lastMessageAt?.toMillis() ?? null
    if (conversation && last !== null && isConversationUnread(conversation, me) && markedFor.current !== last) {
      markedFor.current = last
      void updateDoc(doc(db, 'conversations', conversationId), { [`lastReadAt.${me}`]: serverTimestamp() }).catch(() => {})
    }
  }, [conversation, conversationId, me])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [shown?.length])

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    const room = MESSAGE_PHOTOS_MAX - files.length
    if (picked.length > room) setError(`写真は 1 回に ${MESSAGE_PHOTOS_MAX} 枚まで送れます。先頭の ${room} 枚だけを加えました。`)
    setFiles([...files, ...picked.slice(0, room)])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (deviceState.status !== 'ready') return
    const value = text.trim()
    if (!value && files.length === 0) {
      setError('メッセージか写真を入れてください。')
      return
    }
    if (value.length > MESSAGE_TEXT_MAX) {
      setError(`メッセージは ${MESSAGE_TEXT_MAX} 文字までにしてください。`)
      return
    }
    setError(null)
    setProgress('暗号化しています…')
    try {
      await sendMessage(me, deviceState.device, other, value, files, setProgress)
      setText('')
      setFiles([])
    } catch (caught) {
      if (caught instanceof NoRecipientDeviceError) {
        setError(`${otherName}さんは、まだメッセージの画面を一度も開いていないため、送れません。${otherName}さんがメッセージの画面を開くと、送れるようになります。`)
      } else if (caught instanceof ApiError && caught.code === 'photo_limit') {
        setError('写真の上限（1,000 枚）に達しているため、写真を送れません。')
      } else {
        setError('送れませんでした。もう一度お試しください。')
      }
    }
    setProgress(null)
  }

  async function unsend() {
    if (!unsending) return
    setBusy(true)
    try {
      await api(`/api/conversations/${conversationId}/messages/${unsending.id}`, { method: 'DELETE' })
    } catch {
      setError('取り消せませんでした。もう一度お試しください。')
    }
    setBusy(false)
    setUnsending(null)
  }

  const isBlocked = blocked?.has(other) ?? false
  // この端末を登録する前のメッセージがあるときだけ、「前のメッセージは読めません」と知らせる（F-103）
  const hasOlderMessages = deviceState.status === 'ready'
    && (shown ?? []).some((message) => message.createdAt && message.createdAt.toMillis() < deviceState.device.createdAt)

  return (
    <AppShell title={`${otherName}さんとのメッセージ`}>
      <div className="flex flex-col gap-4">
        <p className="flex items-start gap-2 text-note text-muted">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          メッセージは、送る前にこの端末で暗号化します。読めるのは {otherName}さんとあなたの端末だけで、運営者にも読めません。
        </p>
        <p className="text-note"><Link to={`/users/${otherUsername}`} className="text-accent-text underline underline-offset-4">{otherName}さんのプロフィール</Link></p>

        {deviceState.status === 'error' && <Notice tone="error">この端末の鍵を用意できませんでした。ページを読み込み直してください。</Notice>}
        {deviceState.status === 'ready' && !deviceState.persisted && (
          <Notice tone="info">このブラウザは、しばらく使わないと保存したデータを消すことがあります。消えると、それまでのメッセージをこの端末で読めなくなります。</Notice>
        )}
        {deviceState.status === 'ready' && deviceState.isNew && hasOlderMessages && (
          <Notice tone="info">
            <p>この端末でメッセージを使うのは、はじめてです。この端末では、これより前のメッセージは読めません。ほかの端末では、これまでどおり読めます。</p>
            <Button variant="secondary" className="mt-2" onClick={acknowledgeNew}>分かりました</Button>
          </Notice>
        )}
        {newDevices.length > 0 && (
          <Notice tone="info">
            <p>{otherName}さんの端末が増えました（{newDevices.map((device) => device.label).join('、')}）。{otherName}さんが新しい端末を使い始めたのでなければ、気を付けてください。</p>
            <Button variant="secondary" className="mt-2" onClick={acknowledgeDevices}>確認しました</Button>
          </Notice>
        )}

        <section aria-label="メッセージ" className="flex flex-col gap-3">
          {(shown === null || deviceState.status === 'loading') && <p role="status" className="text-muted">読み込み中…</p>}
          {shown && shown.length === 0 && <p className="text-muted">まだメッセージはありません。</p>}
          {shown && shown.length > 0 && deviceState.status === 'ready' && (
            <ol className="flex flex-col gap-3">
              {shown.map((message) => (
                <MessageBubble
                  key={message.id}
                  conversationId={conversationId}
                  message={message}
                  device={deviceState.device}
                  isMine={message.sender === me}
                  onUnsend={() => setUnsending(message)}
                  onReport={(plain) => setReporting({ message, text: plain })}
                />
              ))}
            </ol>
          )}
          <div ref={bottom} />
        </section>

        {error && <Notice tone="error">{error}</Notice>}
        {isBlocked ? (
          <Notice tone="info">{otherName}さんをブロックしているため、メッセージを送れません。</Notice>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
            <TextAreaField label="メッセージ" value={text} maxLength={MESSAGE_TEXT_MAX} rows={3} onChange={(event) => setText(event.target.value)} />
            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="flex min-h-11 items-center gap-2 rounded-full bg-bg pl-3 text-note">
                    {file.name}
                    <button type="button" onClick={() => setFiles(files.filter((_, i) => i !== index))} className="flex size-11 items-center justify-center rounded-full hover:bg-divider">
                      <X aria-hidden className="size-4" /><span className="sr-only">{file.name} を取り除く</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {files.length < MESSAGE_PHOTOS_MAX && (
                <>
                  <input id="message-photos" type="file" accept="image/jpeg,image/png,image/heic,image/heif" multiple onChange={pickFiles} className="peer sr-only" />
                  <label htmlFor="message-photos" className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 font-bold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                    <ImagePlus aria-hidden className="size-5" />写真（{MESSAGE_PHOTOS_MAX} 枚まで）
                  </label>
                </>
              )}
              <Button type="submit" busy={progress !== null || deviceState.status !== 'ready'}>{progress ?? '送る'}</Button>
            </div>
            {progress && <p role="status" className="sr-only">{progress}</p>}
          </form>
        )}
      </div>
      <ConfirmDialog
        open={unsending !== null}
        onOpenChange={(open) => !open && setUnsending(null)}
        title="このメッセージの送信を取り消しますか？"
        confirmLabel="取り消す"
        busy={busy}
        onConfirm={unsend}
      >
        <p>{otherName}さんの画面からも消えます。写真も消えます。</p>
      </ConfirmDialog>
      {reporting && (
        <ReportDialog
          me={me}
          target={{
            type: 'message',
            path: `conversations/${conversationId}/messages/${reporting.message.id}`,
            user: other,
            label: `${otherName}さんのメッセージ`,
            content: reporting.text,
          }}
          onClose={() => setReporting(null)}
        />
      )}
    </AppShell>
  )
}
