import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { api } from '../api'
import { db } from '../firebase'
import { processImage } from '../photos/processImage'
import {
  createContentKey, decryptBody, decryptPhoto, type EncryptedMessage, encryptMessage, encryptPhoto, type MessageContext,
  openContentKey, type PlainMessage, type Recipient, UnreadableMessageError, verifyMessage,
} from './crypto'
import type { DeviceRecord } from './DeviceProvider'
import type { StoredDevice } from './deviceStore'
import { conversationIdFor } from './MessagesProvider'

export const MESSAGE_TEXT_MAX = 1000 // F-60
export const MESSAGE_PHOTOS_MAX = 4 // F-60

export async function listDevices(uid: string): Promise<DeviceRecord[]> {
  const snapshot = await getDocs(collection(db, 'users', uid, 'devices'))
  return snapshot.docs.map((document) => ({ deviceId: document.id, ...document.data() }) as DeviceRecord)
}

// メッセージを送る（F-60、F-61、F-101）。
// 相手のすべての端末と、自分のすべての端末（この端末も含む）に向けて暗号化する
export async function sendMessage(me: string, device: StoredDevice, other: string, text: string, files: File[], onProgress: (message: string) => void): Promise<void> {
  const conversationId = conversationIdFor(me, other)
  const conversationRef = doc(db, 'conversations', conversationId)
  const messageRef = doc(collection(conversationRef, 'messages'))
  const context: MessageContext = { conversationId, messageId: messageRef.id, sender: me, senderDevice: device.deviceId }

  const [theirDevices, myDevices, existing] = await Promise.all([listDevices(other), listDevices(me), getDoc(conversationRef)])
  if (theirDevices.length === 0) throw new NoRecipientDeviceError()
  const recipients: Recipient[] = [...theirDevices, ...myDevices].map((record) => ({ deviceId: record.deviceId, encPublicKey: record.encPublicKey }))

  const contentKey = await createContentKey()
  const photos = []
  for (const [index, file] of files.entries()) {
    onProgress(`写真を暗号化して送っています（${index + 1} / ${files.length}）…`)
    const processed = await processImage(file)
    const encrypted = await encryptPhoto(contentKey, context, index, await processed.full.arrayBuffer())
    const form = new FormData()
    form.set('conversationId', conversationId)
    form.set('file', new Blob([encrypted.data]), 'photo.bin')
    const uploaded = await api<{ id: string }>('/api/message-photos', { method: 'POST', body: form })
    photos.push({ id: uploaded.id, iv: encrypted.iv })
  }

  onProgress('送っています…')
  const message = await encryptMessage(contentKey, context, { text }, photos, recipients, device.signingPrivateKey)
  const batch = writeBatch(db)
  if (existing.exists()) {
    batch.update(conversationRef, { lastMessageAt: serverTimestamp(), [`lastReadAt.${me}`]: serverTimestamp() })
  } else {
    batch.set(conversationRef, {
      members: [me, other].sort(),
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastReadAt: { [me]: serverTimestamp() },
    })
  }
  batch.set(messageRef, { ...message, createdAt: serverTimestamp() })
  await batch.commit()
}

// 相手がまだメッセージを一度も開いておらず、鍵（端末）がないとき
export class NoRecipientDeviceError extends Error {}

export type DecryptedMessage =
  | { status: 'ok', text: string, verified: boolean, contentKey: CryptoKey, context: MessageContext }
  | { status: 'unreadable' } // この端末あてでない（F-102）
  | { status: 'broken' } // 書き換えられているなど、読めない

// 送った端末の公開鍵（署名を確かめる）。一度読んだものは覚えておく
const signKeys = new Map<string, Promise<JsonWebKey | null>>()

function senderSignKey(uid: string, deviceId: string): Promise<JsonWebKey | null> {
  const key = `${uid}/${deviceId}`
  let pending = signKeys.get(key)
  if (!pending) {
    pending = getDoc(doc(db, 'users', uid, 'devices', deviceId))
      .then((snapshot) => (snapshot.exists() ? snapshot.data().signPublicKey as JsonWebKey : null))
      .catch(() => null)
    signKeys.set(key, pending)
  }
  return pending
}

const decrypted = new Map<string, Promise<DecryptedMessage>>()

export function decryptMessage(conversationId: string, messageId: string, message: EncryptedMessage, device: StoredDevice): Promise<DecryptedMessage> {
  const key = `${conversationId}/${messageId}/${device.deviceId}`
  let pending = decrypted.get(key)
  if (!pending) {
    pending = (async (): Promise<DecryptedMessage> => {
      const context: MessageContext = { conversationId, messageId, sender: message.sender, senderDevice: message.senderDevice }
      try {
        const contentKey = await openContentKey(context, message, device.deviceId, device.encryptionPrivateKey)
        const plain: PlainMessage = await decryptBody(contentKey, context, message)
        // 送った端末の登録が消えているときは、署名を確かめられない（verified: false）
        const signKey = await senderSignKey(message.sender, message.senderDevice)
        const verified = signKey ? await verifyMessage(context, message, signKey) : false
        if (signKey && !verified) return { status: 'broken' }
        return { status: 'ok', text: plain.text, verified, contentKey, context }
      } catch (error) {
        if (error instanceof UnreadableMessageError && !message.keys[device.deviceId]) return { status: 'unreadable' }
        return { status: 'broken' }
      }
    })()
    decrypted.set(key, pending)
  }
  return pending
}

const photoUrls = new Map<string, Promise<string>>()

// 暗号化した写真を受け取り、この端末で戻して、表示用の URL にする
export function decryptedPhotoUrl(photoId: string, iv: string, index: number, contentKey: CryptoKey, context: MessageContext): Promise<string> {
  let pending = photoUrls.get(photoId)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(`/photos/${photoId}/message`)
      if (!response.ok) throw new Error(`写真を受け取れませんでした（${response.status}）`)
      const plain = await decryptPhoto(contentKey, context, index, iv, await response.arrayBuffer())
      return URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }))
    })()
    pending.catch(() => photoUrls.delete(photoId))
    photoUrls.set(photoId, pending)
  }
  return pending
}
