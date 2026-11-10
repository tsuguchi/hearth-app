import { adminState, setSuspended, updateInviteSettings } from './admin'
import { type Env } from './env'
import { getDocument } from './firestore'
import { createInvite, listMyInvites, revokeInvite } from './invites'
import { join, type JoinErrorCode } from './join'
import { servePhoto, uploadPhoto } from './photos'
import { createPost, deletePost } from './posts'
import { type Result } from './result'
import { callerFrom, createSessionValue, sessionCookieHeader } from './session'

// API の入口。画面のファイルは Cloudflare の静的アセットが返し、/api/* と /photos/* だけがここに来る

const JOIN_STATUS: Record<JoinErrorCode, number> = {
  invalid_input: 400,
  adult_required: 400,
  weak_password: 400,
  invalid_invite: 404,
  invite_used: 410,
  invite_expired: 410,
  invites_closed: 403,
  member_cap: 403,
  email_exists: 409,
  conflict: 409,
}

const JSON_LIMIT = 50_000
const UPLOAD_LIMIT = 7 * 1024 * 1024

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function respond<T>(result: Result<T>): Response {
  return result.ok ? json({ ok: true, ...result.value }) : json({ error: result.error }, result.status)
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null
  const text = await request.text()
  if (text.length > JSON_LIMIT) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// 別のサイトから API を呼ばせない。ブラウザが付ける Origin を、自分の URL と比べる
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin')
  return origin === null || origin === url.origin
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const { pathname } = url
  const method = request.method

  const photo = pathname.match(/^\/photos\/([^/]+)\/([^/]+)$/)
  if (photo && method === 'GET') return servePhoto(env, request, photo[1], photo[2])

  if (!pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404)
  if (method !== 'GET' && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403)

  if (pathname === '/api/join' && method === 'POST') {
    const result = await join(env, await readJson(request))
    return result.ok ? json({ ok: true }) : json({ error: result.error }, JOIN_STATUS[result.error])
  }

  // ここから先は、利用者だけが使える
  const caller = await callerFrom(env, request)
  if (!caller) return json({ error: 'unauthorized' }, 401)
  // 止めたアカウントは、出ている証明書が切れる前（最長 1 時間）でも、ここで断る（F-92）
  if ((await getDocument(env, `users/${caller.uid}`))?.status === 'suspended') return json({ error: 'suspended' }, 403)

  if (pathname === '/api/session' && method === 'POST') {
    const value = await createSessionValue(env, caller.uid)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookieHeader(value, url.protocol === 'https:') })
  }

  if (pathname === '/api/photos' && method === 'POST') {
    if (Number(request.headers.get('content-length') ?? 0) > UPLOAD_LIMIT) return json({ error: 'too_large' }, 413)
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return json({ error: 'invalid_input' }, 400)
    }
    return respond(await uploadPhoto(env, caller, form))
  }

  if (pathname === '/api/posts' && method === 'POST') return respond(await createPost(env, caller, await readJson(request)))

  const post = pathname.match(/^\/api\/posts\/([^/]+)$/)
  if (post && method === 'DELETE') return respond(await deletePost(env, caller, post[1]))

  if (pathname === '/api/invites' && method === 'GET') return respond(await listMyInvites(env, caller))
  if (pathname === '/api/invites' && method === 'POST') return respond(await createInvite(env, caller))
  const invite = pathname.match(/^\/api\/invites\/([^/]+)$/)
  if (invite && method === 'DELETE') return respond(await revokeInvite(env, caller, invite[1]))

  // ここから先は、運営者だけが使える
  if (pathname.startsWith('/api/admin/')) {
    if (!caller.admin) return json({ error: 'forbidden' }, 403)
    if (pathname === '/api/admin/state' && method === 'GET') return respond(await adminState(env))
    if (pathname === '/api/admin/invite-settings' && method === 'POST') return respond(await updateInviteSettings(env, await readJson(request)))
    const user = pathname.match(/^\/api\/admin\/users\/([^/]+)\/suspension$/)
    if (user && method === 'PUT') return respond(await setSuspended(env, caller, user[1], true))
    if (user && method === 'DELETE') return respond(await setSuspended(env, caller, user[1], false))
  }

  return json({ error: 'not_found' }, 404)
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env)
    } catch (error) {
      console.error(error)
      return json({ error: 'server_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
