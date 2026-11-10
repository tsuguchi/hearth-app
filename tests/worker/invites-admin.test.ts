import { beforeEach, describe, expect, it } from 'vitest'
import { adminState, setSuspended, updateInviteSettings } from '../../worker/admin'
import { getDocument } from '../../worker/firestore'
import { createInvite, listMyInvites, OPEN_INVITE_LIMIT, revokeInvite } from '../../worker/invites'
import { join, sha256Hex } from '../../worker/join'
import { createPost } from '../../worker/posts'
import { uploadPhoto } from '../../worker/photos'
import { clearEmulators, createMember, env, lookupAccount, photoForm, setDocuments } from '../helpers'

const NOW = new Date('2026-11-10T03:00:00Z')

beforeEach(async () => {
  await clearEmulators()
  await setDocuments({ 'config/app': { memberCap: 50, memberCount: 2, invitesEnabled: true, invitesBlocked: [] } })
})

describe('利用者による招待', () => {
  it('招待を作ると、文字列を一度だけ返し、Firestore にはハッシュだけを残す。その招待で登録できる', async () => {
    const { uid } = await createMember('alice')
    const created = await createInvite(env, { uid, admin: false }, NOW)
    if (!created.ok) throw new Error(created.error)
    const hash = await sha256Hex(created.value.token)
    expect(await getDocument(env, `invites/${hash}`)).toMatchObject({ createdBy: uid, usedBy: null })
    expect(created.value.expiresAt).toBe('2026-11-17T03:00:00.000Z')

    const joined = await join(env, { token: created.value.token, email: 'friend@example.com', password: 'friend-password', adult: true }, NOW)
    expect(joined.ok).toBe(true)
    const list = await listMyInvites(env, { uid, admin: false }, NOW)
    expect(list.ok && list.value.invites[0]).toMatchObject({ id: hash, status: 'used' })
  })

  it(`未使用の招待は ${OPEN_INVITE_LIMIT} 件まで。取り消すと、また作れる`, async () => {
    const { uid } = await createMember('alice')
    const caller = { uid, admin: false }
    for (let index = 0; index < OPEN_INVITE_LIMIT; index++) expect((await createInvite(env, caller, NOW)).ok).toBe(true)
    expect(await createInvite(env, caller, NOW)).toEqual({ ok: false, status: 403, error: 'invite_limit' })

    const list = await listMyInvites(env, caller, NOW)
    if (!list.ok) throw new Error(list.error)
    expect(list.value).toMatchObject({ canInvite: false, reason: 'invite_limit' })
    expect(await revokeInvite(env, caller, list.value.invites[0].id, NOW)).toEqual({ ok: true, value: null })
    expect((await createInvite(env, caller, NOW)).ok).toBe(true)
  })

  it('期限の切れた招待は、未使用の数に入らない', async () => {
    const { uid } = await createMember('alice')
    const caller = { uid, admin: false }
    for (let index = 0; index < OPEN_INVITE_LIMIT; index++) await createInvite(env, caller, NOW)
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000)
    expect((await createInvite(env, caller, later)).ok).toBe(true)
  })

  it('取り消した招待では登録できず、ほかの人の招待は取り消せない', async () => {
    const alice = await createMember('alice')
    const bob = await createMember('bob')
    const created = await createInvite(env, { uid: alice.uid, admin: false }, NOW)
    if (!created.ok) throw new Error(created.error)
    const id = await sha256Hex(created.value.token)

    expect(await revokeInvite(env, { uid: bob.uid, admin: false }, id, NOW)).toMatchObject({ ok: false, error: 'forbidden' })
    expect((await revokeInvite(env, { uid: alice.uid, admin: false }, id, NOW)).ok).toBe(true)
    expect(await revokeInvite(env, { uid: alice.uid, admin: false }, id, NOW)).toMatchObject({ ok: false, error: 'not_open' })
    expect(await join(env, { token: created.value.token, email: 'friend@example.com', password: 'friend-password', adult: true }, NOW))
      .toEqual({ ok: false, error: 'invalid_invite' })
  })

  it('運営者が招待を止めると、全体でも特定の人でも作れない', async () => {
    const alice = await createMember('alice')
    const bob = await createMember('bob')
    await updateInviteSettings(env, { uid: alice.uid, blocked: true })
    expect(await createInvite(env, { uid: alice.uid, admin: false }, NOW)).toMatchObject({ ok: false, error: 'invites_blocked' })
    expect((await createInvite(env, { uid: bob.uid, admin: false }, NOW)).ok).toBe(true)

    await updateInviteSettings(env, { invitesEnabled: false })
    expect(await createInvite(env, { uid: bob.uid, admin: false }, NOW)).toMatchObject({ ok: false, error: 'invites_closed' })
  })

  it('利用者数が上限に達していると、招待を作れない', async () => {
    const { uid } = await createMember('alice')
    await setDocuments({ 'config/app': { memberCap: 50, memberCount: 50, invitesEnabled: true, invitesBlocked: [] } })
    expect(await createInvite(env, { uid, admin: false }, NOW)).toMatchObject({ ok: false, error: 'member_cap' })
  })
})

describe('運営者の処理', () => {
  it('招待の記録で、だれがだれを招待したかが分かる', async () => {
    const { uid } = await createMember('alice')
    const created = await createInvite(env, { uid, admin: false }, NOW)
    if (!created.ok) throw new Error(created.error)
    const joined = await join(env, { token: created.value.token, email: 'friend@example.com', password: 'friend-password', adult: true }, NOW)
    if (!joined.ok) throw new Error(joined.error)

    const state = await adminState(env, NOW)
    expect(state.ok && state.value.invites[0]).toMatchObject({ createdBy: uid, usedBy: joined.uid, status: 'used' })
    expect(state.ok && state.value.config).toMatchObject({ memberCap: 50, memberCount: 3, invitesEnabled: true })
  })

  it('アカウントを止めると、ログインできず、利用者の印が外れ、投稿が見えなくなる。戻すと元に戻る', async () => {
    const admin = await createMember('admin', { claims: { member: true, admin: true } })
    const alice = await createMember('alice')
    await setDocuments({ [`users/${alice.uid}`]: { username: 'alice', displayName: 'alice', bio: '', iconPhotoId: null, status: 'active' } })
    const photo = await uploadPhoto(env, { uid: alice.uid, admin: false }, photoForm())
    if (!photo.ok) throw new Error(photo.error)
    const post = await createPost(env, { uid: alice.uid, admin: false }, { caption: '', photos: [{ id: photo.value.id, alt: '' }] })
    if (!post.ok) throw new Error(post.error)
    const adminCaller = { uid: admin.uid, admin: true }

    expect(await setSuspended(env, adminCaller, alice.uid, true)).toEqual({ ok: true, value: null })
    const account = await lookupAccount(alice.uid) as { customAttributes?: string, disabled?: boolean }
    expect(JSON.parse(account.customAttributes ?? '{}')).toEqual({ member: false })
    expect(account.disabled).toBe(true)
    expect((await getDocument(env, `users/${alice.uid}`))?.status).toBe('suspended')
    expect((await getDocument(env, `posts/${post.value.id}`))?.hidden).toBe(true)

    expect(await setSuspended(env, adminCaller, alice.uid, false)).toEqual({ ok: true, value: null })
    const restored = await lookupAccount(alice.uid) as { customAttributes?: string, disabled?: boolean }
    expect(JSON.parse(restored.customAttributes ?? '{}')).toEqual({ member: true })
    expect(restored.disabled ?? false).toBe(false)
    expect((await getDocument(env, `posts/${post.value.id}`))?.hidden).toBe(false)
  })

  it('自分自身は止められない', async () => {
    const admin = await createMember('admin', { claims: { member: true, admin: true } })
    expect(await setSuspended(env, { uid: admin.uid, admin: true }, admin.uid, true)).toMatchObject({ ok: false, error: 'cannot_suspend_self' })
  })
})
