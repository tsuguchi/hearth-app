import { type Env } from './env'
import { getAccessToken } from './google'

// Firestore の REST API を使う小さな部品。Workers では Firebase の Admin SDK が動かないため

export type Value = null | boolean | number | string | Date | Value[] | { [key: string]: Value }
export type Fields = Record<string, Value>

export class FirestoreError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function databasePath(env: Env): string {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`
}

function baseUrl(env: Env): string {
  const origin = env.FIRESTORE_EMULATOR_HOST ? `http://${env.FIRESTORE_EMULATOR_HOST}` : 'https://firestore.googleapis.com'
  return `${origin}/v1/${databasePath(env)}`
}

// 文書の場所（例 "invites/abc"）を、REST API が使う名前にする
function documentName(env: Env, path: string): string {
  return `${databasePath(env)}/documents/${path}`
}

async function call(env: Env, method: string, url: string, body?: unknown): Promise<Response> {
  const token = await getAccessToken(env)
  return fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function expectOk(response: Response): Promise<unknown> {
  if (response.ok) return response.json()
  const text = await response.text()
  throw new FirestoreError(response.status, `Firestore: ${response.status} ${text}`)
}

function encodeValue(value: Value): unknown {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  return { mapValue: { fields: encodeFields(value) } }
}

function encodeFields(fields: Fields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]))
}

type Encoded = {
  nullValue?: null
  booleanValue?: boolean
  integerValue?: string
  doubleValue?: number
  stringValue?: string
  timestampValue?: string
  arrayValue?: { values?: Encoded[] }
  mapValue?: { fields?: Record<string, Encoded> }
}

function decodeValue(value: Encoded): Value {
  if (value.booleanValue !== undefined) return value.booleanValue
  if (value.integerValue !== undefined) return Number(value.integerValue)
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.stringValue !== undefined) return value.stringValue
  if (value.timestampValue !== undefined) return new Date(value.timestampValue)
  if (value.arrayValue !== undefined) return (value.arrayValue.values ?? []).map(decodeValue)
  if (value.mapValue !== undefined) return decodeFields(value.mapValue.fields ?? {})
  return null
}

function decodeFields(fields: Record<string, Encoded>): Fields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

// 文書をまとめて読む。ないものは null。transaction を渡すと、その中で読む
// （Emulator では、トランザクションの中で 1 件ずつ読む GET が止まってしまうため、まとめて読む API を使う）
export async function getDocuments(env: Env, paths: string[], transaction?: string): Promise<(Fields | null)[]> {
  const names = paths.map((path) => documentName(env, path))
  const results = await expectOk(await call(env, 'POST', `${baseUrl(env)}/documents:batchGet`, {
    documents: names,
    ...(transaction ? { transaction } : {}),
  })) as { found?: { name: string, fields?: Record<string, Encoded> }, missing?: string }[]
  const byName = new Map<string, Fields>()
  for (const result of results) {
    if (result.found) byName.set(result.found.name, decodeFields(result.found.fields ?? {}))
  }
  return names.map((name) => byName.get(name) ?? null)
}

export async function getDocument(env: Env, path: string, transaction?: string): Promise<Fields | null> {
  const [document] = await getDocuments(env, [path], transaction)
  return document
}

export async function beginTransaction(env: Env): Promise<string> {
  const data = await expectOk(await call(env, 'POST', `${baseUrl(env)}/documents:beginTransaction`, {})) as { transaction: string }
  return data.transaction
}

export async function rollback(env: Env, transaction: string): Promise<void> {
  await call(env, 'POST', `${baseUrl(env)}/documents:rollback`, { transaction })
}

export type Write =
  | { kind: 'set', path: string, fields: Fields, mustNotExist?: boolean }
  | { kind: 'update', path: string, fields: Fields }
  | { kind: 'delete', path: string }

function toRestWrite(env: Env, write: Write): unknown {
  const name = documentName(env, write.path)
  switch (write.kind) {
    case 'set':
      return {
        update: { name, fields: encodeFields(write.fields) },
        ...(write.mustNotExist ? { currentDocument: { exists: false } } : {}),
      }
    case 'update':
      return {
        update: { name, fields: encodeFields(write.fields) },
        updateMask: { fieldPaths: Object.keys(write.fields) },
        currentDocument: { exists: true },
      }
    case 'delete':
      return { delete: name }
  }
}

// まとめて書く。transaction を渡すと、その中で読んだ文書がほかで変わっていたときは失敗する
export async function commit(env: Env, writes: Write[], transaction?: string): Promise<void> {
  await expectOk(await call(env, 'POST', `${baseUrl(env)}/documents:commit`, {
    writes: writes.map((write) => toRestWrite(env, write)),
    ...(transaction ? { transaction } : {}),
  }))
}
