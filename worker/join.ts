import { type Env } from './env'
import { beginTransaction, commit, type Fields, getDocuments, rollback, type Write } from './firestore'
import { createAccount, deleteAccount, IdentityError, setCustomClaims } from './identity'

// 招待による登録（F-01、F-02、F-10〜F-15）。
// 招待と利用者数の上限を確かめてから、アカウントを作り「利用者」の印（member）を付ける

export type JoinErrorCode =
  | 'invalid_input' // 入力の形が正しくない
  | 'adult_required' // 18 歳以上の確認がない
  | 'weak_password' // パスワードが短い
  | 'invalid_invite' // 招待が見つからない・取り消された
  | 'invite_used' // 招待はもう使われた
  | 'invite_expired' // 招待の期限（7 日）が切れた
  | 'invites_closed' // 運営者が招待を止めている
  | 'member_cap' // 利用者数が上限に達した
  | 'email_exists' // メールアドレスはもう登録されている
  | 'conflict' // 同時にほかの登録があった。やり直せば通る

export type JoinResult = { ok: true, uid: string } | { ok: false, error: JoinErrorCode }

export const PASSWORD_MIN_LENGTH = 8
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type JoinInput = { token: string, email: string, password: string, adult: boolean }

function parseInput(input: unknown): JoinInput | null {
  if (typeof input !== 'object' || input === null) return null
  const { token, email, password, adult } = input as Record<string, unknown>
  if (typeof token !== 'string' || typeof email !== 'string' || typeof password !== 'string' || typeof adult !== 'boolean') return null
  const trimmedEmail = email.trim()
  if (!TOKEN_PATTERN.test(token) || !EMAIL_PATTERN.test(trimmedEmail) || trimmedEmail.length > 254 || password.length > 128) return null
  return { token, email: trimmedEmail, password, adult }
}

// 招待と全体の設定から、登録してよいかを決める
function checkInvite(invite: Fields | null, config: Fields | null, now: Date): JoinErrorCode | null {
  if (!invite || invite.revokedAt) return 'invalid_invite'
  if (invite.usedBy) return 'invite_used'
  if (!(invite.expiresAt instanceof Date) || invite.expiresAt <= now) return 'invite_expired'
  if (!config || config.invitesEnabled !== true) return 'invites_closed'
  const blocked = Array.isArray(config.invitesBlocked) ? config.invitesBlocked : []
  if (typeof invite.createdBy === 'string' && blocked.includes(invite.createdBy)) return 'invites_closed'
  if (Number(config.memberCount ?? 0) >= Number(config.memberCap ?? 0)) return 'member_cap'
  return null
}

export async function join(env: Env, body: unknown, now = new Date()): Promise<JoinResult> {
  const input = parseInput(body)
  if (!input) return { ok: false, error: 'invalid_input' }
  if (!input.adult) return { ok: false, error: 'adult_required' }
  if (input.password.length < PASSWORD_MIN_LENGTH) return { ok: false, error: 'weak_password' }

  const invitePath = `invites/${await sha256Hex(input.token)}`
  const transaction = await beginTransaction(env)
  let uid: string | null = null
  try {
    const [invite, config] = await getDocuments(env, [invitePath, 'config/app'], transaction)
    const problem = checkInvite(invite, config, now)
    if (problem) {
      await rollback(env, transaction)
      return { ok: false, error: problem }
    }

    try {
      uid = await createAccount(env, input.email, input.password)
    } catch (error) {
      await rollback(env, transaction)
      if (error instanceof IdentityError) {
        if (error.code === 'EMAIL_EXISTS') return { ok: false, error: 'email_exists' }
        if (error.code === 'WEAK_PASSWORD') return { ok: false, error: 'weak_password' }
        if (error.code === 'INVALID_EMAIL') return { ok: false, error: 'invalid_input' }
      }
      throw error
    }
    await setCustomClaims(env, uid, { member: true })

    const inviter = typeof invite!.createdBy === 'string' ? invite!.createdBy : null
    const writes: Write[] = [
      { kind: 'update', path: invitePath, fields: { usedBy: uid, usedAt: now } },
      { kind: 'update', path: 'config/app', fields: { memberCount: Number(config!.memberCount ?? 0) + 1 } },
      {
        kind: 'set',
        path: `userPrivate/${uid}`,
        mustNotExist: true,
        fields: { photoCount: 0, invitedBy: inviter, adultConfirmedAt: now, lastReadNotificationsAt: now },
      },
    ]
    // 招待した人に知らせる（F-95）。運営者が作った招待（createdBy が null）は知らせない
    if (inviter) {
      writes.push({
        kind: 'set',
        path: `users/${inviter}/notifications/${crypto.randomUUID()}`,
        fields: { type: 'inviteUsed', actor: uid, createdAt: now },
      })
    }
    await commit(env, writes, transaction)
    return { ok: true, uid }
  } catch (error) {
    // 途中で失敗したら、作ったアカウントを消して、招待を使っていない状態に戻す
    if (uid) {
      await deleteAccount(env, uid).catch(() => {})
      return { ok: false, error: 'conflict' }
    }
    throw error
  }
}
