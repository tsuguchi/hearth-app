import { importPKCS8, SignJWT } from 'jose'
import { type Env, usesEmulator } from './env'

// Firebase の REST API を管理者として呼ぶための証明書を作る。
// Emulator は「owner」を渡すと Security Rules を通さずに読み書きできる
let cached: { token: string, expiresAt: number } | null = null

export async function getAccessToken(env: Env): Promise<string> {
  if (usesEmulator(env)) return 'owner'
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token
  if (!env.GOOGLE_SERVICE_ACCOUNT) throw new Error('GOOGLE_SERVICE_ACCOUNT が設定されていません')

  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT) as { client_email: string, private_key: string }
  const key = await importPKCS8(account.private_key, 'RS256')
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!response.ok) throw new Error(`Google の証明書を取得できませんでした（${response.status}）`)
  const data = await response.json() as { access_token: string, expires_in: number }
  cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cached.token
}
