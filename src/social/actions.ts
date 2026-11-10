import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'

// フォロー・いいね・コメントと、その通知を同じ書き込みでまとめて行う（DATA_MODEL.md の 3.4、3.5、3.7）。
// Security Rules は、通知と本体が一緒に書かれていることを確かめる

export async function follow(me: string, target: string): Promise<void> {
  const batch = writeBatch(db)
  batch.set(doc(db, 'follows', `${me}_${target}`), { follower: me, followee: target, createdAt: serverTimestamp() })
  batch.set(doc(db, 'users', target, 'notifications', `follow_${me}`), { type: 'follow', actor: me, createdAt: serverTimestamp() })
  await batch.commit()
}

export async function unfollow(me: string, target: string): Promise<void> {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'follows', `${me}_${target}`))
  batch.delete(doc(db, 'users', target, 'notifications', `follow_${me}`))
  await batch.commit()
}

export async function like(me: string, postId: string, author: string): Promise<void> {
  const batch = writeBatch(db)
  batch.set(doc(db, 'posts', postId, 'likes', me), { createdAt: serverTimestamp() })
  // 自分の投稿へのいいねは知らせない
  if (author !== me) {
    batch.set(doc(db, 'users', author, 'notifications', `like_${postId}_${me}`), { type: 'like', actor: me, postId, createdAt: serverTimestamp() })
  }
  await batch.commit()
}

export async function unlike(me: string, postId: string, author: string): Promise<void> {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'posts', postId, 'likes', me))
  if (author !== me) batch.delete(doc(db, 'users', author, 'notifications', `like_${postId}_${me}`))
  await batch.commit()
}

export const COMMENT_MAX = 500

export async function addComment(me: string, postId: string, author: string, text: string): Promise<void> {
  const commentRef = doc(collection(db, 'posts', postId, 'comments'))
  const batch = writeBatch(db)
  batch.set(commentRef, { author: me, text, createdAt: serverTimestamp() })
  if (author !== me) {
    batch.set(doc(db, 'users', author, 'notifications', `comment_${commentRef.id}`), {
      type: 'comment', actor: me, postId, commentId: commentRef.id, createdAt: serverTimestamp(),
    })
  }
  await batch.commit()
}

// コメントを消す。書いた人が消すときは、相手に送った通知も消す
export async function deleteComment(me: string, postId: string, postAuthor: string, commentId: string, commentAuthor: string): Promise<void> {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'posts', postId, 'comments', commentId))
  if (commentAuthor === me && postAuthor !== me) batch.delete(doc(db, 'users', postAuthor, 'notifications', `comment_${commentId}`))
  if (postAuthor === me && commentAuthor !== me) batch.delete(doc(db, 'users', me, 'notifications', `comment_${commentId}`))
  await batch.commit()
}
