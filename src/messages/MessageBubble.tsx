import { type Timestamp } from 'firebase/firestore'
import { AlertTriangle, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MoreMenu } from '../components/MoreMenu'
import { formatPostTime } from '../posts/format'
import type { EncryptedMessage, MessageContext } from './crypto'
import type { StoredDevice } from './deviceStore'
import { type DecryptedMessage, decryptedPhotoUrl, decryptMessage } from './messaging'

export type StoredMessage = EncryptedMessage & { id: string, createdAt: Timestamp | null }

function EncryptedImage({ photoId, iv, index, contentKey, context }: { photoId: string, iv: string, index: number, contentKey: CryptoKey, context: MessageContext }) {
  const [state, setState] = useState<{ photoId: string, url: string | null, failed: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    decryptedPhotoUrl(photoId, iv, index, contentKey, context)
      .then((url) => !cancelled && setState({ photoId, url, failed: false }))
      .catch(() => !cancelled && setState({ photoId, url: null, failed: true }))
    return () => {
      cancelled = true
    }
  }, [photoId, iv, index, contentKey, context])

  const current = state?.photoId === photoId ? state : null
  if (current?.failed) return <p className="rounded-lg bg-divider p-3 text-note">写真を読み込めませんでした。</p>
  if (!current?.url) return <div role="status" aria-label="写真を読み込み中" className="aspect-square w-48 animate-pulse rounded-lg bg-divider" />
  return <img src={current.url} alt={`メッセージの写真 ${index + 1} 枚目`} className="max-h-80 rounded-lg object-contain" />
}

// 1 件のメッセージ。この端末で読める形に戻してから出す（F-61、F-102）
export function MessageBubble({ conversationId, message, device, isMine, onUnsend, onReport }: {
  conversationId: string
  message: StoredMessage
  device: StoredDevice
  isMine: boolean
  onUnsend: () => void
  onReport: (text: string) => void
}) {
  const [result, setResult] = useState<{ id: string, value: DecryptedMessage } | null>(null)

  useEffect(() => {
    let cancelled = false
    decryptMessage(conversationId, message.id, message, device).then((value) => !cancelled && setResult({ id: message.id, value }))
    return () => {
      cancelled = true
    }
  }, [conversationId, message, device])

  const decrypted = result?.id === message.id ? result.value : null
  const date = message.createdAt?.toDate()
  const menu = isMine
    ? [{ label: '送信を取り消す', onSelect: onUnsend, danger: true }]
    : decrypted?.status === 'ok' ? [{ label: 'このメッセージを通報', onSelect: () => onReport(decrypted.text) }] : []

  return (
    <li className={`flex items-end gap-1 ${isMine ? 'flex-row-reverse' : ''}`}>
      <div className={`flex max-w-[80%] flex-col gap-2 rounded-2xl px-4 py-2 ${isMine ? 'bg-accent text-on-accent' : 'bg-surface'}`}>
        {!decrypted && <p role="status">読み込み中…</p>}
        {decrypted?.status === 'unreadable' && (
          <p className="flex items-center gap-2"><Lock aria-hidden className="size-4 shrink-0" />この端末では読めません</p>
        )}
        {decrypted?.status === 'broken' && (
          <p className="flex items-center gap-2 font-bold"><AlertTriangle aria-hidden className="size-4 shrink-0" />このメッセージは確かめられないため、表示しません</p>
        )}
        {decrypted?.status === 'ok' && (
          <>
            {decrypted.text && <p className="whitespace-pre-wrap break-words">{decrypted.text}</p>}
            {message.photos.map((photo, index) => (
              <EncryptedImage key={photo.id} photoId={photo.id} iv={photo.iv} index={index} contentKey={decrypted.contentKey} context={decrypted.context} />
            ))}
            {!decrypted.verified && <p className="text-note">送った端末の登録が外されているため、送り主を確かめられません。</p>}
          </>
        )}
        {date && <time dateTime={date.toISOString()} className="text-note">{formatPostTime(date)}</time>}
      </div>
      <MoreMenu label="このメッセージの操作" items={menu} />
    </li>
  )
}
