import { beforeEach, describe, expect, it } from 'vitest'
import { getDocument } from '../../worker/firestore'
import { join, sha256Hex } from '../../worker/join'
import { clearEmulators, countAccounts, env, lookupAccount, setDocuments } from '../helpers'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'
const NOW = new Date('2026-11-10T03:00:00Z')
const DAY = 24 * 60 * 60 * 1000

async function seed({ invite = {}, config = {} }: { invite?: Record<string, unknown>, config?: Record<string, unknown> } = {}) {
  await setDocuments({
    'config/app': { memberCap: 50, memberCount: 1, invitesEnabled: true, invitesBlocked: [], ...config } as never,
    [`invites/${await sha256Hex(TOKEN)}`]: {
      createdBy: 'inviter-uid',
      createdAt: new Date(NOW.getTime() - DAY),
      expiresAt: new Date(NOW.getTime() + 6 * DAY),
      usedBy: null,
      usedAt: null,
      revokedAt: null,
      ...invite,
    } as never,
  })
}

const input = { token: TOKEN, email: 'new@example.com', password: 'correct-horse', adult: true }

describe('招待による登録', () => {
  beforeEach(clearEmulators)

  it('有効な招待なら、利用者の印を付けたアカウントを作り、招待を使った状態にする', async () => {
    await seed()
    const result = await join(env, input, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const account = await lookupAccount(result.uid)
    expect(account?.email).toBe('new@example.com')
    expect(JSON.parse(account?.customAttributes ?? '{}')).toEqual({ member: true })

    const invite = await getDocument(env, `invites/${await sha256Hex(TOKEN)}`)
    expect(invite?.usedBy).toBe(result.uid)
    expect((await getDocument(env, 'config/app'))?.memberCount).toBe(2)

    const privateDoc = await getDocument(env, `userPrivate/${result.uid}`)
    expect(privateDoc).toMatchObject({ photoCount: 0, invitedBy: 'inviter-uid' })
  })

  it('同じ招待は 2 回使えない', async () => {
    await seed()
    expect((await join(env, input, NOW)).ok).toBe(true)
    expect(await join(env, { ...input, email: 'second@example.com' }, NOW)).toEqual({ ok: false, error: 'invite_used' })
    expect(await countAccounts()).toBe(1)
  })

  it.each([
    ['期限が切れた招待', { invite: { expiresAt: new Date(NOW.getTime() - 1) } }, 'invite_expired'],
    ['取り消した招待', { invite: { revokedAt: NOW } }, 'invalid_invite'],
    ['運営者が招待を止めている', { config: { invitesEnabled: false } }, 'invites_closed'],
    ['招待した人が招待を止められている', { config: { invitesBlocked: ['inviter-uid'] } }, 'invites_closed'],
    ['利用者数が上限に達している', { config: { memberCount: 50 } }, 'member_cap'],
  ] as const)('%sでは登録できない', async (_, options, error) => {
    await seed(options as never)
    expect(await join(env, input, NOW)).toEqual({ ok: false, error })
    expect(await countAccounts()).toBe(0)
  })

  it('ない招待では登録できない', async () => {
    await seed()
    expect(await join(env, { ...input, token: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }, NOW)).toEqual({ ok: false, error: 'invalid_invite' })
  })

  it('18 歳以上の確認がないと登録できない', async () => {
    await seed()
    expect(await join(env, { ...input, adult: false }, NOW)).toEqual({ ok: false, error: 'adult_required' })
  })

  it('短いパスワードでは登録できない', async () => {
    await seed()
    expect(await join(env, { ...input, password: 'short' }, NOW)).toEqual({ ok: false, error: 'weak_password' })
  })

  it('入力の形が正しくないときは登録できない', async () => {
    await seed()
    expect(await join(env, { ...input, email: 'not-an-email' }, NOW)).toEqual({ ok: false, error: 'invalid_input' })
    expect(await join(env, { ...input, token: 'short' }, NOW)).toEqual({ ok: false, error: 'invalid_input' })
    expect(await join(env, null, NOW)).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('登録済みのメールアドレスでは登録できず、招待は使われないまま残る', async () => {
    await seed()
    await setDocuments({ [`invites/${await sha256Hex('another-token-0123456789ab')}`]: {
      createdBy: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + DAY), usedBy: null, usedAt: null, revokedAt: null,
    } })
    expect((await join(env, { ...input, token: 'another-token-0123456789ab' }, NOW)).ok).toBe(true)

    expect(await join(env, input, NOW)).toEqual({ ok: false, error: 'email_exists' })
    const invite = await getDocument(env, `invites/${await sha256Hex(TOKEN)}`)
    expect(invite?.usedBy).toBeNull()
  })
})
