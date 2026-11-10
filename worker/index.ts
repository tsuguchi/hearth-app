import { type Env } from './env'
import { join, type JoinErrorCode } from './join'

// API の入口。画面のファイルは Cloudflare の静的アセットが返し、/api/* と /photos/* だけがここに来る

const STATUS: Record<JoinErrorCode, number> = {
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null
  const text = await request.text()
  if (text.length > 10_000) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/join' && request.method === 'POST') {
        const result = await join(env, await readJson(request))
        return result.ok ? json({ ok: true }) : json({ error: result.error }, STATUS[result.error])
      }
      return json({ error: 'not_found' }, 404)
    } catch (error) {
      console.error(error)
      return json({ error: 'server_error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
