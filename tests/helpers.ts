import { type Env, type PhotoBucket } from '../worker/env'
import { commit, type Fields } from '../worker/firestore'

// テストは npm test（firebase emulators:exec）の中で動き、Emulator の場所は環境変数で渡される
export const PROJECT_ID = 'demo-hearth'
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9199'
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8180'

// R2 の代わりに、手元のメモリに写真を置く模造品
export class FakeBucket implements PhotoBucket {
  readonly objects = new Map<string, { bytes: ArrayBuffer, customMetadata?: Record<string, string> }>()

  async put(key: string, value: ArrayBuffer, options?: { customMetadata?: Record<string, string> }) {
    this.objects.set(key, { bytes: value, customMetadata: options?.customMetadata })
    return {}
  }

  async get(key: string) {
    const object = this.objects.get(key)
    if (!object) return null
    return { body: new Response(object.bytes).body!, httpEtag: '"test"', customMetadata: object.customMetadata }
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key)
  }
}

export const bucket = new FakeBucket()

export const env: Env = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
  FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  PHOTOS: bucket,
}

// Emulator のアカウントと Firestore のデータ、模造品の R2 の写真をすべて消す
export async function clearEmulators(): Promise<void> {
  bucket.objects.clear()
  await fetch(`http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
}

export async function setDocuments(documents: Record<string, Fields>): Promise<void> {
  await commit(env, Object.entries(documents).map(([path, fields]) => ({ kind: 'set' as const, path, fields })))
}

export async function lookupAccount(uid: string): Promise<{ email: string, customAttributes?: string } | undefined> {
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  })
  const data = await response.json() as { users?: { email: string, customAttributes?: string }[] }
  return data.users?.[0]
}

export async function countAccounts(): Promise<number> {
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ returnUserInfo: false }),
  })
  const data = await response.json() as { recordsCount?: string }
  return Number(data.recordsCount ?? 0)
}

async function adminAuth(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}

// テスト用の利用者を作り、その人の ID トークンを返す（招待による登録の後と同じ状態）
export async function createMember(
  name: string,
  { claims = { member: true }, emailVerified = true }: { claims?: Record<string, unknown>, emailVerified?: boolean } = {},
): Promise<{ uid: string, idToken: string }> {
  const email = `${name}@example.com`
  const password = 'test-password'
  const { localId: uid } = await adminAuth('/accounts', { email, password }) as { localId: string }
  await adminAuth('/accounts:update', { localId: uid, customAttributes: JSON.stringify(claims), emailVerified })
  await setDocuments({ [`userPrivate/${uid}`]: { photoCount: 0, invitedBy: null } })
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const { idToken } = await response.json() as { idToken: string }
  return { uid, idToken }
}

// JPEG の先頭の形をした、テスト用の小さなデータ
export function fakeJpeg(size = 100): Blob {
  const bytes = new Uint8Array(size)
  bytes.set([0xff, 0xd8, 0xff, 0xe0])
  return new Blob([bytes], { type: 'image/jpeg' })
}

export function photoForm(fields: Partial<Record<'kind' | 'width' | 'height', string>> = {}, full = fakeJpeg(), thumb = fakeJpeg(50)): FormData {
  const form = new FormData()
  form.set('kind', fields.kind ?? 'post')
  form.set('width', fields.width ?? '1200')
  form.set('height', fields.height ?? '800')
  form.set('full', full)
  form.set('thumb', thumb)
  return form
}
