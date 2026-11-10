import { beforeEach, describe, expect, it } from 'vitest'
import { deleteMyAccount } from '../../worker/account'
import { findDocuments, getDocument } from '../../worker/firestore'
import { createInvite } from '../../worker/invites'
import { join } from '../../worker/join'
import { messagePhotoKey, uploadMessagePhoto } from '../../worker/messages'
import { photoKey, uploadPhoto } from '../../worker/photos'
import { createPost } from '../../worker/posts'
import { bucket, clearEmulators, countAccounts, createMember, env, lookupAccount, photoForm, setDocuments } from '../helpers'

beforeEach(async () => {
  await clearEmulators()
  await setDocuments({ 'config/app': { memberCap: 50, memberCount: 2, invitesEnabled: true, invitesBlocked: [], messagesEnabled: true } })
})

function messagePhotoForm(conversationId: string): FormData {
  const form = new FormData()
  form.set('conversationId', conversationId)
  form.set('file', new Blob([new Uint8Array(100).fill(1)]), 'photo.bin')
  return form
}

async function post(uid: string): Promise<{ postId: string, photoId: string }> {
  const photo = await uploadPhoto(env, { uid, admin: false }, photoForm())
  if (!photo.ok) throw new Error(photo.error)
  const created = await createPost(env, { uid, admin: false }, { caption: '', photos: [{ id: photo.value.id, alt: '' }] })
  if (!created.ok) throw new Error(created.error)
  return { postId: created.value.id, photoId: photo.value.id }
}

describe('アカウントの削除', () => {
  it('その人のデータをすべて消し、ほかの人のデータは残す', async () => {
    const alice = await createMember('alice')
    const bob = await createMember('bob')
    const a = alice.uid
    const b = bob.uid
    const conversationId = [a, b].sort().join('_')
    await setDocuments({
      [`users/${a}`]: { username: 'alice', displayName: 'alice', bio: '', iconPhotoId: null, status: 'active' },
      [`usernames/alice`]: { uid: a },
      [`users/${b}`]: { username: 'bob', displayName: 'bob', bio: '', iconPhotoId: null, status: 'active' },
      [`usernames/bob`]: { uid: b },
    })

    const alicePost = await post(a)
    const bobPost = await post(b)
    const aliceMessagePhoto = await uploadMessagePhoto(env, { uid: a, admin: false }, messagePhotoForm(conversationId))
    const bobMessagePhoto = await uploadMessagePhoto(env, { uid: b, admin: false }, messagePhotoForm(conversationId))
    if (!aliceMessagePhoto.ok || !bobMessagePhoto.ok) throw new Error('写真を用意できませんでした')
    const unused = await createInvite(env, { uid: a, admin: false })
    const used = await createInvite(env, { uid: a, admin: false })
    if (!unused.ok || !used.ok) throw new Error('招待を用意できませんでした')
    const carol = await join(env, { token: used.value.token, email: 'carol@example.com', password: 'carol-password', adult: true })
    if (!carol.ok) throw new Error(carol.error)

    await setDocuments({
      // bob が alice の投稿に、alice が bob の投稿に、コメントといいね
      [`posts/${alicePost.postId}/comments/c-bob`]: { author: b, text: 'bob から' },
      [`posts/${alicePost.postId}/likes/${b}`]: { createdAt: new Date() },
      [`posts/${bobPost.postId}/comments/c-alice`]: { author: a, text: 'alice から' },
      [`posts/${bobPost.postId}/comments/c-bob2`]: { author: b, text: 'bob 自身' },
      [`posts/${bobPost.postId}/likes/${a}`]: { createdAt: new Date() },
      // フォロー・ブロック・通知
      [`follows/${a}_${b}`]: { follower: a, followee: b },
      [`follows/${b}_${a}`]: { follower: b, followee: a },
      [`users/${a}/blocks/someone`]: { createdAt: new Date() },
      [`users/${b}/blocks/${a}`]: { createdAt: new Date() },
      [`users/${a}/notifications/n1`]: { type: 'follow', actor: b },
      [`users/${b}/notifications/follow_${a}`]: { type: 'follow', actor: a },
      [`users/${b}/notifications/other`]: { type: 'follow', actor: 'someone' },
      // やり取りとメッセージ、端末
      [`conversations/${conversationId}`]: { members: [a, b].sort() },
      [`conversations/${conversationId}/messages/m1`]: { sender: a, photos: [{ id: aliceMessagePhoto.value.id, iv: 'iv' }] },
      [`conversations/${conversationId}/messages/m2`]: { sender: b, photos: [{ id: bobMessagePhoto.value.id, iv: 'iv' }] },
      [`users/${a}/devices/d1`]: { label: 'test' },
    })
    const bobCountBefore = Number((await getDocument(env, `userPrivate/${b}`))?.photoCount)
    const memberCountBefore = Number((await getDocument(env, 'config/app'))?.memberCount)

    expect(await deleteMyAccount(env, { uid: a, admin: false })).toEqual({ ok: true, value: null })

    // alice のものは消える
    for (const path of [
      `users/${a}`, `userPrivate/${a}`, 'usernames/alice',
      `posts/${alicePost.postId}`, `posts/${alicePost.postId}/comments/c-bob`, `posts/${alicePost.postId}/likes/${b}`,
      `posts/${bobPost.postId}/comments/c-alice`, `posts/${bobPost.postId}/likes/${a}`,
      `follows/${a}_${b}`, `follows/${b}_${a}`, `users/${a}/blocks/someone`, `users/${b}/blocks/${a}`,
      `users/${a}/notifications/n1`, `users/${b}/notifications/follow_${a}`,
      `conversations/${conversationId}`, `conversations/${conversationId}/messages/m1`, `conversations/${conversationId}/messages/m2`,
      `users/${a}/devices/d1`, `photos/${alicePost.photoId}`, `photos/${aliceMessagePhoto.value.id}`, `photos/${bobMessagePhoto.value.id}`,
    ]) {
      expect(await getDocument(env, path), path).toBeNull()
    }
    expect(bucket.objects.has(photoKey(alicePost.photoId, 'full'))).toBe(false)
    expect(bucket.objects.has(messagePhotoKey(aliceMessagePhoto.value.id))).toBe(false)
    expect(bucket.objects.has(messagePhotoKey(bobMessagePhoto.value.id))).toBe(false)
    expect(await lookupAccount(a)).toBeUndefined()

    // bob のものは残る。やり取りの中の bob の写真は消えるので、bob の枚数が減る
    expect(await getDocument(env, `users/${b}`)).not.toBeNull()
    expect(await getDocument(env, `posts/${bobPost.postId}`)).not.toBeNull()
    expect(await getDocument(env, `posts/${bobPost.postId}/comments/c-bob2`)).not.toBeNull()
    expect(await getDocument(env, `users/${b}/notifications/other`)).not.toBeNull()
    expect(bucket.objects.has(photoKey(bobPost.photoId, 'full'))).toBe(true)
    expect(Number((await getDocument(env, `userPrivate/${b}`))?.photoCount)).toBe(bobCountBefore - 1)
    expect(await lookupAccount(b)).toBeDefined()

    // 使われた招待は記録として残り、使われていない招待は消える。利用者数が 1 減る
    const remaining = await findDocuments(env, 'invites', 'createdBy', a)
    expect(remaining.map((invite) => invite.fields.usedBy)).toEqual([carol.uid])
    expect(Number((await getDocument(env, 'config/app'))?.memberCount)).toBe(memberCountBefore - 1)
    expect(await countAccounts()).toBe(2)
  })
})
