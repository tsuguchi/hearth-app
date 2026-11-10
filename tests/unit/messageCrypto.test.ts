import { describe, expect, it } from 'vitest'
import {
  createContentKey, decryptBody, decryptPhoto, type EncryptedMessage, encryptMessage, encryptPhoto, generateDeviceKeys,
  type MessageContext, openContentKey, UnreadableMessageError, verifyMessage,
} from '../../src/messages/crypto'

const context: MessageContext = { conversationId: 'alice_bob', messageId: 'm1', sender: 'alice', senderDevice: 'alice-phone' }

async function setup() {
  const alicePhone = await generateDeviceKeys()
  const alicePc = await generateDeviceKeys()
  const bobPhone = await generateDeviceKeys()
  const stranger = await generateDeviceKeys()
  const recipients = [
    { deviceId: 'alice-phone', encPublicKey: alicePhone.encPublicKey },
    { deviceId: 'alice-pc', encPublicKey: alicePc.encPublicKey },
    { deviceId: 'bob-phone', encPublicKey: bobPhone.encPublicKey },
  ]
  const contentKey = await createContentKey()
  const photoBytes = new TextEncoder().encode('JPEG のつもりのデータ').buffer
  const photo = await encryptPhoto(contentKey, context, 0, photoBytes)
  const message = await encryptMessage(contentKey, context, { text: 'こんにちは' }, [{ id: 'p1', iv: photo.iv }], recipients, alicePhone.signing.privateKey)
  return { alicePhone, alicePc, bobPhone, stranger, message, photo }
}

async function read(message: EncryptedMessage, deviceId: string, keys: Awaited<ReturnType<typeof generateDeviceKeys>>, ctx = context) {
  const contentKey = await openContentKey(ctx, message, deviceId, keys.encryption.privateKey)
  return decryptBody(contentKey, ctx, message)
}

describe('メッセージの暗号化', () => {
  it('相手の端末も、自分のほかの端末も、送った端末も読める', async () => {
    const { alicePhone, alicePc, bobPhone, message } = await setup()
    expect(await read(message, 'bob-phone', bobPhone)).toEqual({ text: 'こんにちは' })
    expect(await read(message, 'alice-pc', alicePc)).toEqual({ text: 'こんにちは' })
    expect(await read(message, 'alice-phone', alicePhone)).toEqual({ text: 'こんにちは' })
  })

  it('暗号文に本文がそのまま入っていない', async () => {
    const { message } = await setup()
    expect(JSON.stringify(message)).not.toContain('こんにちは')
  })

  it('宛先に入っていない端末は読めない（F-102）', async () => {
    const { stranger, message } = await setup()
    await expect(read(message, 'stranger', stranger)).rejects.toBeInstanceOf(UnreadableMessageError)
  })

  it('ほかの端末あての包んだ鍵を、自分の端末の ID に付け替えても読めない', async () => {
    const { stranger, message } = await setup()
    const moved = { ...message, keys: { ...message.keys, stranger: message.keys['bob-phone'] } }
    await expect(read(moved, 'stranger', stranger)).rejects.toBeInstanceOf(UnreadableMessageError)
  })

  it('別のやり取りやメッセージに写されると読めない', async () => {
    const { bobPhone, message } = await setup()
    await expect(read(message, 'bob-phone', bobPhone, { ...context, conversationId: 'bob_mallory' })).rejects.toBeInstanceOf(UnreadableMessageError)
    await expect(read(message, 'bob-phone', bobPhone, { ...context, messageId: 'm2' })).rejects.toBeInstanceOf(UnreadableMessageError)
  })

  it('暗号文を書き換えると読めない', async () => {
    const { bobPhone, message } = await setup()
    const bytes = Uint8Array.from(atob(message.ct), (char) => char.charCodeAt(0))
    bytes[0] ^= 1
    await expect(read({ ...message, ct: btoa(String.fromCharCode(...bytes)) }, 'bob-phone', bobPhone)).rejects.toBeInstanceOf(UnreadableMessageError)
  })

  it('写真も読め、ほかの写真の番号では読めない', async () => {
    const { bobPhone, message, photo } = await setup()
    const contentKey = await openContentKey(context, message, 'bob-phone', bobPhone.encryption.privateKey)
    const plain = await decryptPhoto(contentKey, context, 0, photo.iv, photo.data)
    expect(new TextDecoder().decode(plain)).toBe('JPEG のつもりのデータ')
    await expect(decryptPhoto(contentKey, context, 1, photo.iv, photo.data)).rejects.toBeInstanceOf(UnreadableMessageError)
  })
})

describe('メッセージの署名', () => {
  it('送った端末の公開鍵で確かめられる', async () => {
    const { alicePhone, message } = await setup()
    expect(await verifyMessage(context, message, alicePhone.signPublicKey)).toBe(true)
  })

  it('ほかの端末の鍵では通らない（なりすましを見分ける）', async () => {
    const { stranger, message } = await setup()
    expect(await verifyMessage(context, message, stranger.signPublicKey)).toBe(false)
  })

  it('宛先の端末を足したり、中身を書き換えたりすると通らない', async () => {
    const { alicePhone, message } = await setup()
    const added = { ...message, keys: { ...message.keys, stranger: message.keys['bob-phone'] } }
    expect(await verifyMessage(context, added, alicePhone.signPublicKey)).toBe(false)
    expect(await verifyMessage(context, { ...message, photos: [] }, alicePhone.signPublicKey)).toBe(false)
    expect(await verifyMessage({ ...context, sender: 'mallory' }, message, alicePhone.signPublicKey)).toBe(false)
  })
})
