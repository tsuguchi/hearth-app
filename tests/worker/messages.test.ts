import { beforeEach, describe, expect, it } from 'vitest'
import { getDocument } from '../../worker/firestore'
import { conversationMembers, deleteMessage, messagePhotoKey, serveMessagePhoto, uploadMessagePhoto } from '../../worker/messages'
import { createSessionValue, SESSION_COOKIE } from '../../worker/session'
import { bucket, clearEmulators, createMember, env, setDocuments } from '../helpers'

beforeEach(async () => {
  await clearEmulators()
  await setDocuments({ 'config/app': { messagesEnabled: true } })
})

function form(conversationId: string, size = 200): FormData {
  const data = new FormData()
  data.set('conversationId', conversationId)
  data.set('file', new Blob([new Uint8Array(size).fill(7)]), 'photo.bin')
  return data
}

async function pair() {
  const a = await createMember('alice')
  const b = await createMember('bob')
  const members = [a.uid, b.uid].sort()
  return { a, b, conversationId: members.join('_') }
}

describe('やり取りの ID', () => {
  it('並べ替えた 2 人の uid で、呼んだ人が入っているときだけ受け付ける', () => {
    expect(conversationMembers('alice_bob', 'alice')).toEqual(['alice', 'bob'])
    expect(conversationMembers('alice_bob', 'carol')).toBeNull()
    expect(conversationMembers('bob_alice', 'alice')).toBeNull()
    expect(conversationMembers('alice', 'alice')).toBeNull()
    expect(conversationMembers('alice_bob_carol', 'alice')).toBeNull()
  })
})

describe('メッセージの写真', () => {
  it('暗号化した写真を受け取り、枚数に数え、やり取りの 2 人にだけ返す', async () => {
    const { a, b, conversationId } = await pair()
    const carol = await createMember('carol')
    const result = await uploadMessagePhoto(env, { uid: a.uid, admin: false }, form(conversationId))
    if (!result.ok) throw new Error(result.error)
    expect(result.value.photoCount).toBe(1)
    expect(bucket.objects.get(messagePhotoKey(result.value.id))?.customMetadata?.members).toBe(conversationId.replace('_', ','))

    const url = `https://hearth.test/photos/${result.value.id}/message`
    const request = async (uid: string) => new Request(url, { headers: { cookie: `${SESSION_COOKIE}=${await createSessionValue(env, uid)}` } })
    expect((await serveMessagePhoto(env, await request(b.uid), result.value.id)).status).toBe(200)
    expect((await serveMessagePhoto(env, await request(carol.uid), result.value.id)).status).toBe(404)
    expect((await serveMessagePhoto(env, new Request(url), result.value.id)).status).toBe(401)
  })

  it('自分の入っていないやり取りには送れない', async () => {
    const { conversationId } = await pair()
    const carol = await createMember('carol')
    expect(await uploadMessagePhoto(env, { uid: carol.uid, admin: false }, form(conversationId))).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('運営者がメッセージを止めているときは受け取らない', async () => {
    const { a, conversationId } = await pair()
    await setDocuments({ 'config/app': { messagesEnabled: false } })
    expect(await uploadMessagePhoto(env, { uid: a.uid, admin: false }, form(conversationId))).toMatchObject({ ok: false, error: 'messages_disabled' })
  })

  it('大きすぎる写真は受け取らない', async () => {
    const { a, conversationId } = await pair()
    expect(await uploadMessagePhoto(env, { uid: a.uid, admin: false }, form(conversationId, 7 * 1024 * 1024))).toMatchObject({ ok: false, error: 'too_large' })
  })
})

describe('メッセージの取り消し', () => {
  it('送った人は取り消せ、写真も消えて枚数が減る。相手は取り消せない', async () => {
    const { a, b, conversationId } = await pair()
    const photo = await uploadMessagePhoto(env, { uid: a.uid, admin: false }, form(conversationId))
    if (!photo.ok) throw new Error(photo.error)
    await setDocuments({
      [`conversations/${conversationId}`]: { members: conversationId.split('_') },
      [`conversations/${conversationId}/messages/m1`]: { sender: a.uid, photos: [{ id: photo.value.id, iv: 'iv' }] },
    })

    expect(await deleteMessage(env, { uid: b.uid, admin: false }, conversationId, 'm1')).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await deleteMessage(env, { uid: a.uid, admin: false }, conversationId, 'm1')).toEqual({ ok: true, value: null })
    expect(await getDocument(env, `conversations/${conversationId}/messages/m1`)).toBeNull()
    expect(await getDocument(env, `photos/${photo.value.id}`)).toBeNull()
    expect(bucket.objects.size).toBe(0)
    expect((await getDocument(env, `userPrivate/${a.uid}`))?.photoCount).toBe(0)
  })
})
