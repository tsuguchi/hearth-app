import { type Env } from './env'
import { getAccessToken } from './google'

// Firebase Authentication の管理用の REST API（Identity Toolkit）

export class IdentityError extends Error {
  readonly code: string
  constructor(code: string) {
    super(`Firebase Authentication: ${code}`)
    this.code = code
  }
}

function baseUrl(env: Env): string {
  const origin = env.FIREBASE_AUTH_EMULATOR_HOST
    ? `http://${env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com'
  return `${origin}/v1/projects/${env.FIREBASE_PROJECT_ID}`
}

async function call(env: Env, path: string, body: unknown): Promise<unknown> {
  const token = await getAccessToken(env)
  const response = await fetch(`${baseUrl(env)}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) return response.json()
  const data = await response.json().catch(() => ({})) as { error?: { message?: string } }
  // message は「EMAIL_EXISTS」や「WEAK_PASSWORD : ...」の形
  throw new IdentityError((data.error?.message ?? `HTTP_${response.status}`).split(' ')[0])
}

// アカウントを作り、uid を返す。利用者自身による登録を止めていても、管理者としてなら作れる
export async function createAccount(env: Env, email: string, password: string): Promise<string> {
  const data = await call(env, '/accounts', { email, password, emailVerified: false }) as { localId: string }
  return data.localId
}

export async function setCustomClaims(env: Env, uid: string, claims: Record<string, unknown>): Promise<void> {
  await call(env, '/accounts:update', { localId: uid, customAttributes: JSON.stringify(claims) })
}

export async function deleteAccount(env: Env, uid: string): Promise<void> {
  await call(env, '/accounts:delete', { localId: uid })
}
