import { type Env } from './env'
import { beginTransaction, commit, type Fields, getDocument, rollback, type Write } from './firestore'
import { PHOTO_LIMIT } from './photos'
import { fail, ok, type Result } from './result'
import { type Caller, readCookie, readSessionValue, SESSION_COOKIE } from './session'

// メッセージの写真と取り消し（F-60、F-63、DATA_MODEL.md の 4 章・6 章）。
// 写真はブラウザで暗号化されたものを受け取るので、Workers にも運営者にも中身は分からない

const ENCRYPTED_MAX_BYTES = 6 * 1024 * 1024
const UID = '[A-Za-z0-9]{1,128}'

export function messagePhotoKey(id: string): string {
  return `photos/${id}/message.bin`
}

// やり取りの ID（「uid_uid」を並べ替えたもの）から 2 人を取り出す。呼んだ人が入っていなければ null
export function conversationMembers(conversationId: string, uid: string): [string, string] | null {
  const match = conversationId.match(new RegExp(`^(${UID})_(${UID})$`))
  if (!match || match[1] >= match[2]) return null
  const members: [string, string] = [match[1], match[2]]
  return members.includes(uid) ? members : null
}

export async function uploadMessagePhoto(env: Env, caller: Caller, form: FormData, now = new Date()): Promise<Result<{ id: string, photoCount: number }>> {
  const conversationId = form.get('conversationId')
  const file = form.get('file')
  if (typeof conversationId !== 'string' || !(file instanceof Blob)) return fail(400, 'invalid_input')
  const members = conversationMembers(conversationId, caller.uid)
  if (!members) return fail(403, 'forbidden')
  // 運営者がメッセージを止めているときは受け取らない
  if ((await getDocument(env, 'config/app'))?.messagesEnabled !== true) return fail(403, 'messages_disabled')
  if (file.size === 0) return fail(400, 'invalid_input')
  if (file.size > ENCRYPTED_MAX_BYTES) return fail(413, 'too_large')

  const bytes = await file.arrayBuffer()
  const id = crypto.randomUUID()
  const privatePath = `userPrivate/${caller.uid}`
  const transaction = await beginTransaction(env)
  const userPrivate = await getDocument(env, privatePath, transaction)
  const count = Number(userPrivate?.photoCount ?? 0)
  if (!userPrivate || count >= PHOTO_LIMIT) {
    await rollback(env, transaction)
    return userPrivate ? fail(403, 'photo_limit') : fail(403, 'not_member')
  }

  // 配るときに Firestore を読まずに確かめられるよう、やり取りの 2 人を R2 のメタデータに入れる（6 章）
  await env.PHOTOS.put(messagePhotoKey(id), bytes, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { owner: caller.uid, kind: 'message', members: members.join(',') },
  })
  try {
    await commit(env, [
      { kind: 'update', path: privatePath, fields: { photoCount: count + 1 } },
      {
        kind: 'set',
        path: `photos/${id}`,
        mustNotExist: true,
        fields: { owner: caller.uid, kind: 'message', parentId: conversationId, bytes: file.size, width: null, height: null, createdAt: now },
      },
    ], transaction)
  } catch (error) {
    await env.PHOTOS.delete(messagePhotoKey(id))
    throw error
  }
  return ok({ id, photoCount: count + 1 })
}

// 暗号化したままの写真を、やり取りの 2 人にだけ返す
export async function serveMessagePhoto(env: Env, request: Request, id: string): Promise<Response> {
  const session = readCookie(request, SESSION_COOKIE)
  const uid = session ? await readSessionValue(env, session) : null
  if (!uid) return new Response('ログインが必要です', { status: 401 })
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('見つかりません', { status: 404 })
  const object = await env.PHOTOS.get(messagePhotoKey(id))
  const members = object?.customMetadata?.members?.split(',') ?? []
  if (!object || !members.includes(uid)) return new Response('見つかりません', { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': 'application/octet-stream',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: object.httpEtag,
      'x-content-type-options': 'nosniff',
    },
  })
}

// 送ったメッセージを取り消す（F-63）。送った人だけ。写真も消し、写真の枚数を減らす
export async function deleteMessage(env: Env, caller: Caller, conversationId: string, messageId: string): Promise<Result<null>> {
  if (!conversationMembers(conversationId, caller.uid) || !/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) return fail(404, 'not_found')
  const path = `conversations/${conversationId}/messages/${messageId}`
  const transaction = await beginTransaction(env)
  const message = await getDocument(env, path, transaction)
  if (!message) {
    await rollback(env, transaction)
    return fail(404, 'not_found')
  }
  if (message.sender !== caller.uid) {
    await rollback(env, transaction)
    return fail(403, 'forbidden')
  }
  const photoIds = (Array.isArray(message.photos) ? message.photos as Fields[] : [])
    .map((photo) => photo.id)
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id))
  const userPrivate = await getDocument(env, `userPrivate/${caller.uid}`, transaction)
  const writes: Write[] = [
    { kind: 'delete', path },
    ...photoIds.map((id): Write => ({ kind: 'delete', path: `photos/${id}` })),
  ]
  if (userPrivate && photoIds.length > 0) {
    writes.push({ kind: 'update', path: `userPrivate/${caller.uid}`, fields: { photoCount: Math.max(0, Number(userPrivate.photoCount ?? 0) - photoIds.length) } })
  }
  await commit(env, writes, transaction)
  if (photoIds.length > 0) await env.PHOTOS.delete(photoIds.map(messagePhotoKey))
  return ok(null)
}
