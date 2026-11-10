import { beforeEach, describe, expect, it } from 'vitest'
import { getDocument, type Fields } from '../../worker/firestore'
import { PHOTO_LIMIT, photoKey, servePhoto, uploadPhoto } from '../../worker/photos'
import { createPost, deletePost, extractTags } from '../../worker/posts'
import { createSessionValue, readSessionValue, SESSION_COOKIE, verifyMember } from '../../worker/session'
import { bucket, clearEmulators, createMember, env, fakeJpeg, photoForm, setDocuments } from '../helpers'

beforeEach(clearEmulators)

async function upload(uid: string): Promise<string> {
  const result = await uploadPhoto(env, { uid, admin: false }, photoForm())
  if (!result.ok) throw new Error(result.error)
  return result.value.id
}

describe('ログインの確かめ', () => {
  it('利用者の印があり、メールアドレスの確認が済んだ人だけを通す', async () => {
    const member = await createMember('member')
    expect(await verifyMember(env, member.idToken)).toEqual({ uid: member.uid, admin: false })

    const outsider = await createMember('outsider', { claims: {} })
    expect(await verifyMember(env, outsider.idToken)).toBeNull()

    const unverified = await createMember('unverified', { emailVerified: false })
    expect(await verifyMember(env, unverified.idToken)).toBeNull()

    expect(await verifyMember(env, 'not-a-token')).toBeNull()
  })
})

describe('写真を見るための cookie', () => {
  it('署名を確かめ、書き換えや期限切れを弾く', async () => {
    const now = Date.now()
    const value = await createSessionValue(env, 'alice', now)
    expect(await readSessionValue(env, value, now)).toBe('alice')

    const [payload, signature] = value.split('.')
    const forged = `${btoa(JSON.stringify({ uid: 'mallory', exp: 9999999999 })).replace(/=+$/, '')}.${signature}`
    expect(await readSessionValue(env, forged, now)).toBeNull()
    expect(await readSessionValue(env, `${payload}.AAAA`, now)).toBeNull()
    expect(await readSessionValue(env, value, now + 2 * 60 * 60 * 1000)).toBeNull()
  })

  it('cookie がないと写真を返さない', async () => {
    const { uid } = await createMember('alice')
    const id = await upload(uid)
    const url = `https://hearth.test/photos/${id}/full`

    expect((await servePhoto(env, new Request(url), id, 'full')).status).toBe(401)

    const cookie = `${SESSION_COOKIE}=${await createSessionValue(env, uid)}`
    const response = await servePhoto(env, new Request(url, { headers: { cookie } }), id, 'full')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('private')
  })
})

describe('写真の受け取り', () => {
  it('JPEG を R2 に置き、写真の記録を作って枚数を数える', async () => {
    const { uid } = await createMember('alice')
    const result = await uploadPhoto(env, { uid, admin: false }, photoForm())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.photoCount).toBe(1)
    expect(bucket.objects.has(photoKey(result.value.id, 'full'))).toBe(true)
    expect(bucket.objects.has(photoKey(result.value.id, 'thumb'))).toBe(true)
    expect(await getDocument(env, `photos/${result.value.id}`)).toMatchObject({ owner: uid, kind: 'post', parentId: null, width: 1200, height: 800 })
  })

  it('JPEG でないものは受け取らない', async () => {
    const { uid } = await createMember('alice')
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
    expect(await uploadPhoto(env, { uid, admin: false }, photoForm({}, png))).toEqual({ ok: false, status: 415, error: 'not_jpeg' })
  })

  it('大きすぎる写真や、形の正しくない入力は受け取らない', async () => {
    const { uid } = await createMember('alice')
    const caller = { uid, admin: false }
    expect(await uploadPhoto(env, caller, photoForm({}, fakeJpeg(6 * 1024 * 1024)))).toMatchObject({ ok: false, error: 'too_large' })
    expect(await uploadPhoto(env, caller, photoForm({ width: '0' }))).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(await uploadPhoto(env, caller, photoForm({ kind: 'message' }))).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it(`写真が ${PHOTO_LIMIT} 枚に達したら、それ以上は受け取らない`, async () => {
    const { uid } = await createMember('alice')
    await setDocuments({ [`userPrivate/${uid}`]: { photoCount: PHOTO_LIMIT } })
    expect(await uploadPhoto(env, { uid, admin: false }, photoForm())).toEqual({ ok: false, status: 403, error: 'photo_limit' })
    expect(bucket.objects.size).toBe(0)
  })
})

describe('投稿', () => {
  it('自分の写真で投稿でき、タグを取り出し、写真を投稿に結び付ける', async () => {
    const { uid } = await createMember('alice')
    const ids = [await upload(uid), await upload(uid)]
    const result = await createPost(env, { uid, admin: false }, {
      caption: '秋の公園 #紅葉 #Autumn。',
      photos: ids.map((id, index) => ({ id, alt: `写真${index + 1}` })),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const post = await getDocument(env, `posts/${result.value.id}`)
    expect(post).toMatchObject({ author: uid, caption: '秋の公園 #紅葉 #Autumn。', tags: ['紅葉', 'autumn'], hidden: false })
    expect((post!.photos as Fields[]).map((photo) => photo.alt)).toEqual(['写真1', '写真2'])
    expect((await getDocument(env, `photos/${ids[0]}`))?.parentId).toBe(result.value.id)
  })

  it('ほかの人の写真や、ほかの投稿に使った写真では投稿できない', async () => {
    const alice = await createMember('alice')
    const bob = await createMember('bob')
    const bobsPhoto = await upload(bob.uid)
    expect(await createPost(env, { uid: alice.uid, admin: false }, { caption: '', photos: [{ id: bobsPhoto, alt: '' }] }))
      .toMatchObject({ ok: false, error: 'invalid_photos' })

    const photo = await upload(alice.uid)
    expect((await createPost(env, { uid: alice.uid, admin: false }, { caption: '', photos: [{ id: photo, alt: '' }] })).ok).toBe(true)
    expect(await createPost(env, { uid: alice.uid, admin: false }, { caption: '', photos: [{ id: photo, alt: '' }] }))
      .toMatchObject({ ok: false, error: 'invalid_photos' })
  })

  it('写真がない投稿、11 枚以上の投稿、長すぎる説明文は受け取らない', async () => {
    const { uid } = await createMember('alice')
    const caller = { uid, admin: false }
    const id = await upload(uid)
    expect(await createPost(env, caller, { caption: '', photos: [] })).toMatchObject({ ok: false, error: 'invalid_input' })
    const eleven = Array.from({ length: 11 }, (_, index) => ({ id: `00000000-0000-0000-0000-0000000000${String(index).padStart(2, '0')}`, alt: '' }))
    expect(await createPost(env, caller, { caption: '', photos: eleven })).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(await createPost(env, caller, { caption: 'あ'.repeat(2001), photos: [{ id, alt: '' }] })).toMatchObject({ ok: false, error: 'invalid_input' })
  })

  it('投稿した人は消せる。写真の記録・R2 の写真・コメント・いいねも消え、枚数が減る', async () => {
    const { uid } = await createMember('alice')
    const photo = await upload(uid)
    const created = await createPost(env, { uid, admin: false }, { caption: '', photos: [{ id: photo, alt: '' }] })
    if (!created.ok) throw new Error(created.error)
    const postId = created.value.id
    await setDocuments({
      [`posts/${postId}/comments/c1`]: { author: uid, text: 'コメント' },
      [`posts/${postId}/likes/${uid}`]: { createdAt: new Date() },
    })

    expect(await deletePost(env, { uid, admin: false }, postId)).toEqual({ ok: true, value: null })
    expect(await getDocument(env, `posts/${postId}`)).toBeNull()
    expect(await getDocument(env, `posts/${postId}/comments/c1`)).toBeNull()
    expect(await getDocument(env, `posts/${postId}/likes/${uid}`)).toBeNull()
    expect(await getDocument(env, `photos/${photo}`)).toBeNull()
    expect(bucket.objects.size).toBe(0)
    expect((await getDocument(env, `userPrivate/${uid}`))?.photoCount).toBe(0)
  })

  it('ほかの人の投稿は消せないが、運営者は消せる', async () => {
    const alice = await createMember('alice')
    const bob = await createMember('bob')
    const created = await createPost(env, { uid: alice.uid, admin: false }, { caption: '', photos: [{ id: await upload(alice.uid), alt: '' }] })
    if (!created.ok) throw new Error(created.error)

    expect(await deletePost(env, { uid: bob.uid, admin: false }, created.value.id)).toMatchObject({ ok: false, error: 'forbidden' })
    expect(await deletePost(env, { uid: bob.uid, admin: true }, created.value.id)).toEqual({ ok: true, value: null })
  })
})

describe('タグの取り出し', () => {
  it('全角・半角や大文字・小文字をそろえ、重なりと文末の句読点を除く', () => {
    expect(extractTags('#ＣＡＴ と #cat と #猫。#猫')).toEqual(['cat', '猫'])
    expect(extractTags('タグなし')).toEqual([])
    expect(extractTags('#a#b')).toEqual(['a', 'b'])
  })
})
