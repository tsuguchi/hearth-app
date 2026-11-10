import { type Env } from './env'
import { commit, findDocuments, getDocument, listDocuments, type Write } from './firestore'
import { getCustomClaims, setAccountDisabled, setCustomClaims } from './identity'
import { type InviteSummary, inviteStatus } from './invites'
import { fail, ok, type Result } from './result'
import { type Caller } from './session'

// 運営者だけが使える処理（F-15、F-90〜F-93）。呼ぶ前に caller.admin を確かめる

type AdminInvite = InviteSummary & { createdBy: string | null }

export async function adminState(env: Env, now = new Date()): Promise<Result<{
  config: { memberCap: number, memberCount: number, invitesEnabled: boolean, invitesBlocked: string[] }
  invites: AdminInvite[]
}>> {
  const [config, invites] = await Promise.all([getDocument(env, 'config/app'), listDocuments(env, 'invites')])
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null)
  return ok({
    config: {
      memberCap: Number(config?.memberCap ?? 0),
      memberCount: Number(config?.memberCount ?? 0),
      invitesEnabled: config?.invitesEnabled === true,
      invitesBlocked: Array.isArray(config?.invitesBlocked) ? config.invitesBlocked as string[] : [],
    },
    // 招待の記録（F-13）。だれがだれを招待したか
    invites: invites
      .map(({ id, fields }) => ({
        id,
        status: inviteStatus(fields, now),
        createdBy: typeof fields.createdBy === 'string' ? fields.createdBy : null,
        createdAt: iso(fields.createdAt),
        expiresAt: iso(fields.expiresAt),
        usedBy: typeof fields.usedBy === 'string' ? fields.usedBy : null,
        usedAt: iso(fields.usedAt),
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  })
}

function parseBody(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : null
}

// 招待を全体で止める・再開する、特定の人の招待を止める・許す（F-15）
export async function updateInviteSettings(env: Env, body: unknown): Promise<Result<null>> {
  const input = parseBody(body)
  if (!input) return fail(400, 'invalid_input')
  const config = await getDocument(env, 'config/app')
  if (!config) return fail(404, 'not_found')
  const fields: Record<string, boolean | string[]> = {}
  if (typeof input.invitesEnabled === 'boolean') fields.invitesEnabled = input.invitesEnabled
  if (typeof input.uid === 'string' && typeof input.blocked === 'boolean') {
    const current = new Set(Array.isArray(config.invitesBlocked) ? config.invitesBlocked as string[] : [])
    if (input.blocked) current.add(input.uid)
    else current.delete(input.uid)
    fields.invitesBlocked = [...current]
  }
  if (Object.keys(fields).length === 0) return fail(400, 'invalid_input')
  await commit(env, [{ kind: 'update', path: 'config/app', fields }])
  return ok(null)
}

// アカウントを止める・戻す（F-92）。
// 止めると、ログインできなくし（アカウントの無効化と、出ている証明書の取り消し）、利用者の印を外し、投稿を見えなくする
export async function setSuspended(env: Env, caller: Caller, uid: string, suspended: boolean): Promise<Result<null>> {
  if (uid === caller.uid) return fail(400, 'cannot_suspend_self')
  const user = await getDocument(env, `users/${uid}`)
  const claims = await getCustomClaims(env, uid).catch(() => null)
  if (claims === null) return fail(404, 'not_found')

  await setAccountDisabled(env, uid, suspended)
  await setCustomClaims(env, uid, { ...claims, member: !suspended })

  const posts = await findDocuments(env, 'posts', 'author', uid)
  const writes: Write[] = posts.map((post): Write => ({ kind: 'update', path: `posts/${post.id}`, fields: { hidden: suspended } }))
  if (user) writes.push({ kind: 'update', path: `users/${uid}`, fields: { status: suspended ? 'suspended' : 'active' } })
  // Firestore の 1 回の書き込みは 500 件まで
  for (let index = 0; index < writes.length; index += 450) await commit(env, writes.slice(index, index + 450))
  return ok(null)
}
