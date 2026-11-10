// メッセージの暗号化（DATA_MODEL.md の 4 章）。ブラウザ標準の Web Crypto API だけを使う。
// - 中身（文字と写真）は、メッセージごとの鍵（AES-256-GCM）で暗号化する
// - その鍵を、宛先の端末ごとに包む。使い捨ての鍵の組（ECDH P-256）と端末の公開鍵から HKDF-SHA256 で包むための鍵を作る
// - 全体に、送った端末の鍵（ECDSA P-256）で署名する。運営者が偽のメッセージを差し込めないようにするため
// この部品は画面にもサーバーにも依存しない（テストは Node.js で動かす）

export const MESSAGE_VERSION = 1

export type WrappedKey = { iv: string, ct: string }
export type EncryptedPhoto = { id: string, iv: string }

export type EncryptedMessage = {
  v: number
  sender: string
  senderDevice: string
  epk: string // 使い捨ての公開鍵（raw の base64）
  keys: Record<string, WrappedKey> // 端末の ID → 包んだ中身の鍵
  iv: string
  ct: string // 暗号化した本文（JSON）
  photos: EncryptedPhoto[]
  sig: string
}

export type Recipient = { deviceId: string, encPublicKey: JsonWebKey }
export type MessageContext = { conversationId: string, messageId: string, sender: string, senderDevice: string }

const subtle = globalThis.crypto.subtle
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

// 暗号化の追加データ（AAD）。やり取り・メッセージ・送った人に結び付け、別の場所へ写されても読めないようにする
function aad(context: MessageContext, part: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`hearth-msg-v${MESSAGE_VERSION}|${context.conversationId}|${context.messageId}|${context.sender}|${context.senderDevice}|${part}`)
}

// 端末の鍵の組を作る。秘密鍵は取り出せない形にする（F-100）
export async function generateDeviceKeys(): Promise<{
  encryption: CryptoKeyPair
  signing: CryptoKeyPair
  encPublicKey: JsonWebKey
  signPublicKey: JsonWebKey
}> {
  const encryption = await subtle.generateKey(ECDH, false, ['deriveBits']) as CryptoKeyPair
  const signing = await subtle.generateKey(ECDSA, false, ['sign', 'verify']) as CryptoKeyPair
  return {
    encryption,
    signing,
    encPublicKey: await subtle.exportKey('jwk', encryption.publicKey),
    signPublicKey: await subtle.exportKey('jwk', signing.publicKey),
  }
}

// 使い捨ての秘密鍵と相手の公開鍵から、その端末の中身の鍵を包むための鍵を作る
async function wrappingKey(privateKey: CryptoKey, publicKey: CryptoKey, context: MessageContext, deviceId: string): Promise<CryptoKey> {
  const shared = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const base = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('hearth-msg-wrap'), info: aad(context, `key|${deviceId}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// 署名する中身。項目の順を決めて、JSON にする
function signedBytes(context: MessageContext, message: Omit<EncryptedMessage, 'sig'>): Uint8Array<ArrayBuffer> {
  const keys = Object.keys(message.keys).sort().map((deviceId) => [deviceId, message.keys[deviceId].iv, message.keys[deviceId].ct])
  return encoder.encode(JSON.stringify([
    message.v, context.conversationId, context.messageId, context.sender, context.senderDevice,
    message.epk, message.iv, message.ct, keys, message.photos.map((photo) => [photo.id, photo.iv]),
  ]))
}

export type PlainMessage = { text: string }

// 写真は、先に暗号化して Workers に送る。送った後の ID を encryptMessage に渡す
export async function createContentKey(): Promise<CryptoKey> {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function encryptPhoto(contentKey: CryptoKey, context: MessageContext, index: number, bytes: ArrayBuffer): Promise<{ iv: string, data: ArrayBuffer }> {
  const iv = randomBytes(12)
  const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context, `photo|${index}`) }, contentKey, bytes)
  return { iv: toBase64(iv), data }
}

export async function encryptMessage(
  contentKey: CryptoKey,
  context: MessageContext,
  plain: PlainMessage,
  photos: EncryptedPhoto[],
  recipients: Recipient[],
  signingKey: CryptoKey,
): Promise<EncryptedMessage> {
  const iv = randomBytes(12)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context, 'body') }, contentKey, encoder.encode(JSON.stringify(plain)))
  const rawKey = await subtle.exportKey('raw', contentKey)

  const ephemeral = await subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair
  const keys: Record<string, WrappedKey> = {}
  for (const recipient of recipients) {
    const publicKey = await subtle.importKey('jwk', recipient.encPublicKey, ECDH, false, [])
    const wrapKey = await wrappingKey(ephemeral.privateKey, publicKey, context, recipient.deviceId)
    const keyIv = randomBytes(12)
    keys[recipient.deviceId] = { iv: toBase64(keyIv), ct: toBase64(await subtle.encrypt({ name: 'AES-GCM', iv: keyIv }, wrapKey, rawKey)) }
  }

  const unsigned: Omit<EncryptedMessage, 'sig'> = {
    v: MESSAGE_VERSION,
    sender: context.sender,
    senderDevice: context.senderDevice,
    epk: toBase64(await subtle.exportKey('raw', ephemeral.publicKey)),
    keys,
    iv: toBase64(iv),
    ct: toBase64(ct),
    photos,
  }
  const sig = await subtle.sign(SIGN, signingKey, signedBytes(context, unsigned))
  return { ...unsigned, sig: toBase64(sig) }
}

export class UnreadableMessageError extends Error {}

// 署名を確かめる
export async function verifyMessage(context: MessageContext, message: EncryptedMessage, senderSignKey: JsonWebKey): Promise<boolean> {
  // 文書に書かれた送り主・端末が、確かめる側の想定と違えば通さない
  if (message.sender !== context.sender || message.senderDevice !== context.senderDevice) return false
  const key = await subtle.importKey('jwk', senderSignKey, ECDSA, false, ['verify'])
  const { sig, ...unsigned } = message
  return subtle.verify(SIGN, key, fromBase64(sig), signedBytes(context, unsigned))
}

// 自分の端末あてに包まれた中身の鍵を取り出す。この端末あてでないときは UnreadableMessageError（F-102）
export async function openContentKey(context: MessageContext, message: EncryptedMessage, deviceId: string, devicePrivateKey: CryptoKey): Promise<CryptoKey> {
  const wrapped = message.keys[deviceId]
  if (!wrapped) throw new UnreadableMessageError('この端末あてのメッセージではありません')
  try {
    const epk = await subtle.importKey('raw', fromBase64(message.epk), ECDH, false, [])
    const wrapKey = await wrappingKey(devicePrivateKey, epk, context, deviceId)
    const raw = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(wrapped.iv) }, wrapKey, fromBase64(wrapped.ct))
    return subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
  } catch {
    throw new UnreadableMessageError('中身の鍵を取り出せませんでした')
  }
}

export async function decryptBody(contentKey: CryptoKey, context: MessageContext, message: EncryptedMessage): Promise<PlainMessage> {
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(message.iv), additionalData: aad(context, 'body') }, contentKey, fromBase64(message.ct))
    return JSON.parse(decoder.decode(plain)) as PlainMessage
  } catch {
    throw new UnreadableMessageError('本文を読めませんでした')
  }
}

export async function decryptPhoto(contentKey: CryptoKey, context: MessageContext, index: number, iv: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    return await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: aad(context, `photo|${index}`) }, contentKey, data)
  } catch {
    throw new UnreadableMessageError('写真を読めませんでした')
  }
}
