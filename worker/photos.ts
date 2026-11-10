import { type Env } from './env'
import { beginTransaction, commit, getDocument, rollback } from './firestore'
import { fail, ok, type Result } from './result'
import { type Caller, readCookie, readSessionValue, SESSION_COOKIE } from './session'

// 写真の受け取りと配信（DATA_MODEL.md の 3.3、5 章、6 章）。
// 写真はブラウザの中で縮め、位置情報などを取り除いてから（F-22、F-23）、元の画像と小さな画像の 2 つを送ってくる

export const PHOTO_LIMIT = 1000 // F-26
const FULL_MAX_BYTES = 5 * 1024 * 1024
const THUMB_MAX_BYTES = 1024 * 1024
const MAX_SIDE = 4096
const KINDS = ['post'] as const // 24 時間で消える投稿・メッセージ・アイコンは、作るときに足す

export function photoKey(id: string, variant: 'full' | 'thumb'): string {
  return `photos/${id}/${variant}.jpg`
}

// JPEG かどうかを、先頭の 3 バイトで確かめる
function isJpeg(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength))
  return head.length === 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
}

function toInt(value: ReturnType<FormData['get']>): number {
  return typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : 0
}

export async function uploadPhoto(env: Env, caller: Caller, form: FormData, now = new Date()): Promise<Result<{ id: string, photoCount: number }>> {
  const kind = form.get('kind')
  const width = toInt(form.get('width'))
  const height = toInt(form.get('height'))
  const full = form.get('full')
  const thumb = form.get('thumb')
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return fail(400, 'invalid_input')
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return fail(400, 'invalid_input')
  if (!(full instanceof Blob) || !(thumb instanceof Blob)) return fail(400, 'invalid_input')
  if (full.size > FULL_MAX_BYTES || thumb.size > THUMB_MAX_BYTES) return fail(413, 'too_large')

  const [fullBytes, thumbBytes] = await Promise.all([full.arrayBuffer(), thumb.arrayBuffer()])
  if (!isJpeg(fullBytes) || !isJpeg(thumbBytes)) return fail(415, 'not_jpeg')

  const id = crypto.randomUUID()
  const privatePath = `userPrivate/${caller.uid}`
  const transaction = await beginTransaction(env)
  const userPrivate = await getDocument(env, privatePath, transaction)
  const count = Number(userPrivate?.photoCount ?? 0)
  if (!userPrivate || count >= PHOTO_LIMIT) {
    await rollback(env, transaction)
    return userPrivate ? fail(403, 'photo_limit') : fail(403, 'not_member')
  }

  const metadata = { customMetadata: { owner: caller.uid, kind }, httpMetadata: { contentType: 'image/jpeg' } }
  await Promise.all([
    env.PHOTOS.put(photoKey(id, 'full'), fullBytes, metadata),
    env.PHOTOS.put(photoKey(id, 'thumb'), thumbBytes, metadata),
  ])
  try {
    await commit(env, [
      { kind: 'update', path: privatePath, fields: { photoCount: count + 1 } },
      {
        kind: 'set',
        path: `photos/${id}`,
        mustNotExist: true,
        fields: { owner: caller.uid, kind, parentId: null, bytes: full.size + thumb.size, width, height, createdAt: now },
      },
    ], transaction)
  } catch (error) {
    // 記録できなかった写真は、R2 からも消す
    await env.PHOTOS.delete([photoKey(id, 'full'), photoKey(id, 'thumb')])
    throw error
  }
  return ok({ id, photoCount: count + 1 })
}

const ID_PATTERN = /^[0-9a-f-]{36}$/

// /photos/{id}/{full|thumb} を、写真を見るための cookie を確かめてから返す
export async function servePhoto(env: Env, request: Request, id: string, variant: string): Promise<Response> {
  const session = readCookie(request, SESSION_COOKIE)
  const uid = session ? await readSessionValue(env, session) : null
  if (!uid) return new Response('ログインが必要です', { status: 401 })
  if (!ID_PATTERN.test(id) || (variant !== 'full' && variant !== 'thumb')) return new Response('見つかりません', { status: 404 })

  const object = await env.PHOTOS.get(photoKey(id, variant))
  if (!object) return new Response('見つかりません', { status: 404 })
  // 写真の中身は変わらない（直すときは別の ID になる）ので、長く手元に置いてよい。ほかの人とは共有させない
  return new Response(object.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  })
}

export async function deletePhotoObjects(env: Env, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await env.PHOTOS.delete(ids.flatMap((id) => [photoKey(id, 'full'), photoKey(id, 'thumb')]))
}
