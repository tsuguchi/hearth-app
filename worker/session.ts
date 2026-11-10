import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose'
import { type Env, usesEmulator } from './env'

// ログインの確かめ（Firebase の ID トークン）と、写真を見るための cookie

export type Caller = { uid: string, admin: boolean }

const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

// ID トークンを確かめ、利用者（member の印があり、メールアドレスの確認が済んだ人）なら、その人を返す
export async function verifyMember(env: Env, idToken: string): Promise<Caller | null> {
  let payload: JWTPayload
  const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
  try {
    if (usesEmulator(env)) {
      // Emulator のトークンには署名がない。Emulator につないでいるときだけ、中身をそのまま読む
      payload = decodeJwt(idToken)
      if (payload.iss !== issuer || payload.aud !== env.FIREBASE_PROJECT_ID) return null
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null
    } else {
      payload = (await jwtVerify(idToken, GOOGLE_KEYS, { issuer, audience: env.FIREBASE_PROJECT_ID })).payload
    }
  } catch {
    return null
  }
  if (typeof payload.sub !== 'string' || payload.member !== true || payload.email_verified !== true) return null
  return { uid: payload.sub, admin: payload.admin === true }
}

// リクエストの Authorization: Bearer から、呼んだ人を確かめる
export async function callerFrom(env: Env, request: Request): Promise<Caller | null> {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  return verifyMember(env, header.slice('Bearer '.length))
}

export const SESSION_COOKIE = 'hearth_session'
export const SESSION_SECONDS = 60 * 60

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET が設定されていないか、短すぎます')
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

// cookie の中身は「uid と期限」に署名を付けたもの。Firestore を読まずに確かめられる
export async function createSessionValue(env: Env, uid: string, now = Date.now()): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ uid, exp: Math.floor(now / 1000) + SESSION_SECONDS })))
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), encoder.encode(payload)))
  return `${payload}.${base64url(signature)}`
}

export async function readSessionValue(env: Env, value: string, now = Date.now()): Promise<string | null> {
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(env), fromBase64url(signature), encoder.encode(payload))
    if (!valid) return null
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { uid?: unknown, exp?: unknown }
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp * 1000 < now) return null
    return data.uid
  } catch {
    return null
  }
}

export function sessionCookieHeader(value: string, secure: boolean): string {
  // 写真の URL（/photos/）にだけ送る。JavaScript からは読めない
  return `${SESSION_COOKIE}=${value}; Path=/photos; Max-Age=${SESSION_SECONDS}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`
}

export function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie') ?? ''
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}
