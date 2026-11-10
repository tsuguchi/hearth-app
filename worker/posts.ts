import { type Env } from './env'
import { beginTransaction, commit, type Fields, getDocument, getDocuments, listDocumentIds, rollback, type Write } from './firestore'
import { deletePhotoObjects } from './photos'
import { fail, ok, type Result } from './result'
import { type Caller } from './session'

// 投稿を作る・消す（F-20〜F-25、DATA_MODEL.md の 3.4）

export const CAPTION_MAX = 2000
export const ALT_MAX = 500
export const PHOTOS_PER_POST = 10
const MAX_TAGS = 30
const TAG_MAX = 50

// 説明文の「#言葉」をタグとして取り出す。大文字・小文字や全角・半角の違いはそろえる
export function extractTags(caption: string): string[] {
  const tags = new Set<string>()
  for (const match of caption.normalize('NFKC').matchAll(/#([^\s#]+)/gu)) {
    const tag = match[1].replace(/[.,!?。、！？」』）)]+$/u, '').toLowerCase()
    if (tag && tag.length <= TAG_MAX) tags.add(tag)
    if (tags.size >= MAX_TAGS) break
  }
  return [...tags]
}

type PostInput = { caption: string, photos: { id: string, alt: string }[] }

function parsePostInput(body: unknown): PostInput | null {
  if (typeof body !== 'object' || body === null) return null
  const { caption, photos } = body as Record<string, unknown>
  if (typeof caption !== 'string' || caption.length > CAPTION_MAX) return null
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > PHOTOS_PER_POST) return null
  const parsed: { id: string, alt: string }[] = []
  for (const photo of photos) {
    if (typeof photo !== 'object' || photo === null) return null
    const { id, alt } = photo as Record<string, unknown>
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof alt !== 'string' || alt.length > ALT_MAX) return null
    parsed.push({ id, alt: alt.trim() })
  }
  if (new Set(parsed.map((photo) => photo.id)).size !== parsed.length) return null
  return { caption: caption.trim(), photos: parsed }
}

export async function createPost(env: Env, caller: Caller, body: unknown, now = new Date()): Promise<Result<{ id: string }>> {
  const input = parsePostInput(body)
  if (!input) return fail(400, 'invalid_input')

  const id = crypto.randomUUID()
  const transaction = await beginTransaction(env)
  const photos = await getDocuments(env, input.photos.map((photo) => `photos/${photo.id}`), transaction)
  // 自分が送った、まだどこにも使っていない投稿用の写真だけを使える
  const usable = photos.every((photo) => photo && photo.owner === caller.uid && photo.kind === 'post' && photo.parentId === null)
  if (!usable) {
    await rollback(env, transaction)
    return fail(400, 'invalid_photos')
  }

  const writes: Write[] = [
    {
      kind: 'set',
      path: `posts/${id}`,
      mustNotExist: true,
      fields: {
        author: caller.uid,
        caption: input.caption,
        tags: extractTags(input.caption),
        photos: input.photos.map((photo, index) => ({
          id: photo.id,
          width: photos[index]!.width,
          height: photos[index]!.height,
          alt: photo.alt,
        })),
        hidden: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    ...input.photos.map((photo): Write => ({ kind: 'update', path: `photos/${photo.id}`, fields: { parentId: id } })),
  ]
  await commit(env, writes, transaction)
  return ok({ id })
}

// 投稿を消す（F-24）。投稿した人と運営者だけができる。コメント・いいね・写真も一緒に消す
export async function deletePost(env: Env, caller: Caller, postId: string): Promise<Result<null>> {
  if (!/^[0-9a-f-]{36}$/.test(postId)) return fail(404, 'not_found')

  const [comments, likes] = await Promise.all([
    listDocumentIds(env, `posts/${postId}/comments`),
    listDocumentIds(env, `posts/${postId}/likes`),
  ])
  const transaction = await beginTransaction(env)
  const post = await getDocument(env, `posts/${postId}`, transaction)
  if (!post) {
    await rollback(env, transaction)
    return fail(404, 'not_found')
  }
  if (post.author !== caller.uid && !caller.admin) {
    await rollback(env, transaction)
    return fail(403, 'forbidden')
  }

  const author = post.author as string
  const photoIds = (post.photos as Fields[]).map((photo) => photo.id as string)
  const authorPrivate = await getDocument(env, `userPrivate/${author}`, transaction)
  const writes: Write[] = [
    { kind: 'delete', path: `posts/${postId}` },
    ...photoIds.map((id): Write => ({ kind: 'delete', path: `photos/${id}` })),
    ...comments.map((id): Write => ({ kind: 'delete', path: `posts/${postId}/comments/${id}` })),
    ...likes.map((id): Write => ({ kind: 'delete', path: `posts/${postId}/likes/${id}` })),
  ]
  if (authorPrivate) {
    writes.push({
      kind: 'update',
      path: `userPrivate/${author}`,
      fields: { photoCount: Math.max(0, Number(authorPrivate.photoCount ?? 0) - photoIds.length) },
    })
  }
  await commit(env, writes, transaction)
  await deletePhotoObjects(env, photoIds)
  return ok(null)
}
