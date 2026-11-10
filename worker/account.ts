import { type Env } from './env'
import { commit, getDocument, listDocumentIds, runQuery, type Write } from './firestore'
import { deleteAccount as deleteAuthAccount } from './identity'
import { messagePhotoKey } from './messages'
import { photoKey } from './photos'
import { fail, ok, type Result } from './result'
import { type Caller } from './session'

// アカウントの削除（F-06、DATA_MODEL.md の 7 章）。その人のデータをすべて消し、最後に Firebase のアカウントを消す。
// Workers の無料プランは、1 回の処理で外へ出せる問い合わせが 50 件までなので、
// 文書ごとに問い合わせず、コレクショングループで一度に探してから、まとめて消す（利用者が数十人の規模を前提とする）

const BATCH = 450 // Firestore の 1 回の書き込みは 500 件まで

function isUnder(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix))
}

export async function deleteMyAccount(env: Env, caller: Caller): Promise<Result<null>> {
  const uid = caller.uid
  const user = await getDocument(env, `users/${uid}`)

  const [posts, myComments, allComments, allLikes, followsOut, followsIn, allBlocks, notificationsBy, conversations, myPhotos, messagePhotos, myInvites, devices, myNotifications] = await Promise.all([
    runQuery(env, { collectionId: 'posts', where: { field: 'author', op: 'EQUAL', value: uid }, select: ['photos'] }),
    runQuery(env, { collectionId: 'comments', allDescendants: true, where: { field: 'author', op: 'EQUAL', value: uid }, select: [] }),
    runQuery(env, { collectionId: 'comments', allDescendants: true, select: [] }),
    runQuery(env, { collectionId: 'likes', allDescendants: true, select: [] }),
    runQuery(env, { collectionId: 'follows', where: { field: 'follower', op: 'EQUAL', value: uid }, select: [] }),
    runQuery(env, { collectionId: 'follows', where: { field: 'followee', op: 'EQUAL', value: uid }, select: [] }),
    runQuery(env, { collectionId: 'blocks', allDescendants: true, select: [] }),
    runQuery(env, { collectionId: 'notifications', allDescendants: true, where: { field: 'actor', op: 'EQUAL', value: uid }, select: [] }),
    runQuery(env, { collectionId: 'conversations', where: { field: 'members', op: 'ARRAY_CONTAINS', value: uid }, select: [] }),
    runQuery(env, { collectionId: 'photos', where: { field: 'owner', op: 'EQUAL', value: uid }, select: ['kind'] }),
    runQuery(env, { collectionId: 'photos', where: { field: 'kind', op: 'EQUAL', value: 'message' }, select: ['owner', 'parentId'] }),
    runQuery(env, { collectionId: 'invites', where: { field: 'createdBy', op: 'EQUAL', value: uid }, select: ['usedBy'] }),
    listDocumentIds(env, `users/${uid}/devices`),
    listDocumentIds(env, `users/${uid}/notifications`),
  ])

  const postPrefixes = posts.map((post) => `${post.path}/`)
  const conversationIds = conversations.map((conversation) => conversation.path.split('/')[1])
  const conversationPrefixes = conversations.map((conversation) => `${conversation.path}/`)
  const messages = conversations.length > 0
    ? (await runQuery(env, { collectionId: 'messages', allDescendants: true, select: [] })).filter((message) => isUnder(message.path, conversationPrefixes))
    : []

  const paths = new Set<string>()
  const add = (path: string) => paths.add(path)

  // 投稿と、そのコメント・いいね（ほかの人が書いたものも含む）
  for (const post of posts) add(post.path)
  for (const comment of allComments) if (isUnder(comment.path, postPrefixes)) add(comment.path)
  for (const like of allLikes) if (isUnder(like.path, postPrefixes) || like.path.endsWith(`/likes/${uid}`)) add(like.path)
  // ほかの人の投稿に書いたコメント
  for (const comment of myComments) add(comment.path)
  // フォロー（する側とされる側）
  for (const follow of [...followsOut, ...followsIn]) add(follow.path)
  // ブロック（した側とされた側）
  for (const block of allBlocks) if (block.path.startsWith(`users/${uid}/`) || block.path.endsWith(`/blocks/${uid}`)) add(block.path)
  // 通知（自分あてと、自分が相手に送ったもの）
  for (const id of myNotifications) add(`users/${uid}/notifications/${id}`)
  for (const notification of notificationsBy) add(notification.path)
  // やり取り（相手の側からも消す）とメッセージ
  for (const message of messages) add(message.path)
  for (const conversation of conversations) add(conversation.path)
  // 端末と、使われていない招待（使われた招待は、だれがだれを招待したかの記録として残す。F-13）
  for (const id of devices) add(`users/${uid}/devices/${id}`)
  for (const invite of myInvites) if (!invite.fields.usedBy) add(invite.path)

  // 写真: 自分の写真すべてと、やり取りの中で相手が送った写真。相手の写真の枚数は減らす
  const r2Keys: string[] = []
  const othersPhotoCount = new Map<string, number>()
  for (const photo of myPhotos) {
    add(photo.path)
    const id = photo.path.split('/')[1]
    if (photo.fields.kind === 'message') r2Keys.push(messagePhotoKey(id))
    else r2Keys.push(photoKey(id, 'full'), photoKey(id, 'thumb'))
  }
  for (const photo of messagePhotos) {
    const owner = photo.fields.owner as string
    if (owner === uid || !conversationIds.includes(photo.fields.parentId as string)) continue
    add(photo.path)
    r2Keys.push(messagePhotoKey(photo.path.split('/')[1]))
    othersPhotoCount.set(owner, (othersPhotoCount.get(owner) ?? 0) + 1)
  }

  // プロフィールと、本人だけの情報
  add(`users/${uid}`)
  add(`userPrivate/${uid}`)
  if (typeof user?.username === 'string') add(`usernames/${user.username}`)

  const writes: Write[] = [...paths].map((path): Write => ({ kind: 'delete', path }))
  for (const [owner, count] of othersPhotoCount) writes.push({ kind: 'increment', path: `userPrivate/${owner}`, field: 'photoCount', by: -count })
  writes.push({ kind: 'increment', path: 'config/app', field: 'memberCount', by: -1 })
  for (let index = 0; index < writes.length; index += BATCH) await commit(env, writes.slice(index, index + BATCH))

  for (let index = 0; index < r2Keys.length; index += 1000) await env.PHOTOS.delete(r2Keys.slice(index, index + 1000))

  try {
    await deleteAuthAccount(env, uid)
  } catch {
    // データは消せたが、アカウントだけが残ったとき。もう一度呼べば消せる
    return fail(500, 'account_not_deleted')
  }
  return ok(null)
}

