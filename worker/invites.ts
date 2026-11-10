import { type Env } from './env'
import { commit, type Fields, findDocuments, getDocument } from './firestore'
import { sha256Hex } from './join'
import { fail, ok, type Result } from './result'
import { type Caller } from './session'

// 利用者による招待（F-10〜F-13）。招待の文字列はここで一度だけ返し、Firestore にはハッシュだけを残す

export const INVITE_DAYS = 7 // F-11
export const OPEN_INVITE_LIMIT = 5 // F-12
const DAY = 24 * 60 * 60 * 1000

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'

export function inviteStatus(fields: Fields, now: Date): InviteStatus {
  if (fields.revokedAt) return 'revoked'
  if (fields.usedBy) return 'used'
  if (!(fields.expiresAt instanceof Date) || fields.expiresAt <= now) return 'expired'
  return 'open'
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export type InviteSummary = {
  id: string
  status: InviteStatus
  createdAt: string | null
  expiresAt: string | null
  usedBy: string | null
  usedAt: string | null
}

function summarize(id: string, fields: Fields, now: Date): InviteSummary {
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null)
  return {
    id,
    status: inviteStatus(fields, now),
    createdAt: iso(fields.createdAt),
    expiresAt: iso(fields.expiresAt),
    usedBy: typeof fields.usedBy === 'string' ? fields.usedBy : null,
    usedAt: iso(fields.usedAt),
  }
}

// 招待を作れるかどうかと、その理由
async function checkCanInvite(env: Env, caller: Caller, mine: { fields: Fields }[], now: Date): Promise<string | null> {
  const config = await getDocument(env, 'config/app')
  if (!config || config.invitesEnabled !== true) return 'invites_closed'
  const blocked = Array.isArray(config.invitesBlocked) ? config.invitesBlocked : []
  if (blocked.includes(caller.uid)) return 'invites_blocked'
  if (Number(config.memberCount ?? 0) >= Number(config.memberCap ?? 0)) return 'member_cap'
  if (mine.filter((invite) => inviteStatus(invite.fields, now) === 'open').length >= OPEN_INVITE_LIMIT) return 'invite_limit'
  return null
}

export async function listMyInvites(env: Env, caller: Caller, now = new Date()): Promise<Result<{ invites: InviteSummary[], canInvite: boolean, reason: string | null }>> {
  const mine = await findDocuments(env, 'invites', 'createdBy', caller.uid)
  const reason = await checkCanInvite(env, caller, mine, now)
  const invites = mine
    .map((invite) => summarize(invite.id, invite.fields, now))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return ok({ invites, canInvite: reason === null, reason })
}

export async function createInvite(env: Env, caller: Caller, now = new Date()): Promise<Result<{ token: string, expiresAt: string }>> {
  const mine = await findDocuments(env, 'invites', 'createdBy', caller.uid)
  const reason = await checkCanInvite(env, caller, mine, now)
  if (reason) return fail(403, reason)

  const token = randomToken()
  const expiresAt = new Date(now.getTime() + INVITE_DAYS * DAY)
  await commit(env, [{
    kind: 'set',
    path: `invites/${await sha256Hex(token)}`,
    mustNotExist: true,
    fields: { createdBy: caller.uid, createdAt: now, expiresAt, usedBy: null, usedAt: null, revokedAt: null },
  }])
  return ok({ token, expiresAt: expiresAt.toISOString() })
}

// 使われる前の招待を取り消す（F-11）。作った人と運営者だけ
export async function revokeInvite(env: Env, caller: Caller, id: string, now = new Date()): Promise<Result<null>> {
  if (!/^[0-9a-f]{64}$/.test(id)) return fail(404, 'not_found')
  const invite = await getDocument(env, `invites/${id}`)
  if (!invite) return fail(404, 'not_found')
  if (invite.createdBy !== caller.uid && !caller.admin) return fail(403, 'forbidden')
  if (inviteStatus(invite, now) !== 'open') return fail(409, 'not_open')
  await commit(env, [{ kind: 'update', path: `invites/${id}`, fields: { revokedAt: now } }])
  return ok(null)
}
