import { type Env } from '../worker/env'
import { commit, type Fields } from '../worker/firestore'

// テストは npm test（firebase emulators:exec）の中で動き、Emulator の場所は環境変数で渡される
export const PROJECT_ID = 'demo-hearth'
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9199'
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8180'

export const env: Env = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
  FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
}

// Emulator のアカウントと Firestore のデータをすべて消す
export async function clearEmulators(): Promise<void> {
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
