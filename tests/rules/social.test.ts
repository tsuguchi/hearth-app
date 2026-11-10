import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { PROJECT_ID } from '../helpers'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8180').split(':')
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
  })
})
afterAll(() => testEnv.cleanup())

// alice の投稿 post1 に、bob や carol が反応する。mallory は alice をブロックしている／されている役
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore()
    for (const uid of ['alice', 'bob', 'carol', 'mallory']) {
      await setDoc(doc(firestore, 'users', uid), { username: uid, displayName: uid, bio: '', iconPhotoId: null, status: 'active' })
    }
    await setDoc(doc(firestore, 'posts/post1'), { author: 'alice', caption: '', hidden: false, createdAt: new Date() })
    await setDoc(doc(firestore, 'posts/hiddenPost'), { author: 'alice', caption: '', hidden: true, createdAt: new Date() })
    await setDoc(doc(firestore, 'users/alice/blocks/mallory'), { createdAt: new Date() })
  })
})

const member = { member: true, email_verified: true }
const db = (uid: string, claims: Record<string, unknown> = member): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore

function follow(firestore: Firestore, follower: string, followee: string, withNotification = true) {
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'follows', `${follower}_${followee}`), { follower, followee, createdAt: serverTimestamp() })
  if (withNotification) {
    batch.set(doc(firestore, 'users', followee, 'notifications', `follow_${follower}`), { type: 'follow', actor: follower, createdAt: serverTimestamp() })
  }
  return batch.commit()
}

function like(firestore: Firestore, liker: string, postId = 'post1', author = 'alice') {
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'posts', postId, 'likes', liker), { createdAt: serverTimestamp() })
  batch.set(doc(firestore, 'users', author, 'notifications', `like_${postId}_${liker}`), { type: 'like', actor: liker, postId, createdAt: serverTimestamp() })
  return batch.commit()
}

function comment(firestore: Firestore, author: string, text: string, commentId = 'c1', postId = 'post1', postAuthor = 'alice') {
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'posts', postId, 'comments', commentId), { author, text, createdAt: serverTimestamp() })
  batch.set(doc(firestore, 'users', postAuthor, 'notifications', `comment_${commentId}`), {
    type: 'comment', actor: author, postId, commentId, createdAt: serverTimestamp(),
  })
  return batch.commit()
}

describe('フォロー', () => {
  it('利用者は、通知と一緒にほかの人をフォローでき、外せる', async () => {
    await assertSucceeds(follow(db('bob'), 'bob', 'alice'))
    await assertSucceeds(getCountFromServer(query(collection(db('carol'), 'follows'), where('followee', '==', 'alice'))))
    await assertSucceeds(deleteDoc(doc(db('bob'), 'follows/bob_alice')))
  })

  it('自分自身・いない人・ほかの人になりすましてのフォローはできない', async () => {
    await assertFails(follow(db('bob'), 'bob', 'bob', false))
    await assertFails(follow(db('bob'), 'bob', 'nobody', false))
    await assertFails(follow(db('bob'), 'carol', 'alice', false))
  })

  it('ブロックしている・されている相手はフォローできない', async () => {
    await assertFails(follow(db('mallory'), 'mallory', 'alice', false))
    await assertFails(follow(db('alice'), 'alice', 'mallory', false))
  })

  it('ほかの人のフォローは外せない', async () => {
    await follow(db('bob'), 'bob', 'alice')
    await assertFails(deleteDoc(doc(db('carol'), 'follows/bob_alice')))
  })
})

describe('いいね', () => {
  it('通知と一緒にいいねを付け、外せる。数は利用者が数えられる', async () => {
    await assertSucceeds(like(db('bob'), 'bob'))
    await assertSucceeds(getCountFromServer(collection(db('carol'), 'posts/post1/likes')))
    const bob = db('bob')
    const batch = writeBatch(bob)
    batch.delete(doc(bob, 'posts/post1/likes/bob'))
    batch.delete(doc(bob, 'users/alice/notifications/like_post1_bob'))
    await assertSucceeds(batch.commit())
  })

  it('ほかの人の名前でいいねはできない', async () => {
    await assertFails(setDoc(doc(db('bob'), 'posts/post1/likes/carol'), { createdAt: serverTimestamp() }))
  })

  it('止めたアカウントの投稿や、ブロックしている人の投稿にはいいねできない', async () => {
    await assertFails(setDoc(doc(db('bob'), 'posts/hiddenPost/likes/bob'), { createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db('mallory'), 'posts/post1/likes/mallory'), { createdAt: serverTimestamp() }))
  })
})

describe('コメント', () => {
  it('500 文字までのコメントを、通知と一緒に書ける', async () => {
    await assertSucceeds(comment(db('bob'), 'bob', 'すてきな写真です'))
    await assertSucceeds(getDocs(collection(db('carol'), 'posts/post1/comments')))
  })

  it('空のコメント、501 文字以上のコメント、なりすましは書けない', async () => {
    await assertFails(setDoc(doc(db('bob'), 'posts/post1/comments/c1'), { author: 'bob', text: '', createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db('bob'), 'posts/post1/comments/c1'), { author: 'bob', text: 'あ'.repeat(501), createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db('bob'), 'posts/post1/comments/c1'), { author: 'carol', text: 'こんにちは', createdAt: serverTimestamp() }))
  })

  it('ブロックされている人はコメントできない', async () => {
    await assertFails(setDoc(doc(db('mallory'), 'posts/post1/comments/c1'), { author: 'mallory', text: 'こんにちは', createdAt: serverTimestamp() }))
  })

  it('消せるのは、書いた人・投稿した人・運営者だけ', async () => {
    await comment(db('bob'), 'bob', 'ひとつめ', 'c1')
    await comment(db('bob'), 'bob', 'ふたつめ', 'c2')
    await comment(db('bob'), 'bob', 'みっつめ', 'c3')
    await assertFails(deleteDoc(doc(db('carol'), 'posts/post1/comments/c1')))
    await assertSucceeds(deleteDoc(doc(db('bob'), 'posts/post1/comments/c1')))
    await assertSucceeds(deleteDoc(doc(db('alice'), 'posts/post1/comments/c2')))
    await assertSucceeds(deleteDoc(doc(db('admin', { ...member, admin: true }), 'posts/post1/comments/c3')))
  })
})

describe('通知', () => {
  it('通知は本人だけが読める', async () => {
    await like(db('bob'), 'bob')
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/notifications/like_post1_bob')))
    await assertFails(getDoc(doc(db('carol'), 'users/alice/notifications/like_post1_bob')))
  })

  it('実際にしていない操作の通知は作れない', async () => {
    // いいねをせずに、いいねの通知だけを書く
    await assertFails(setDoc(doc(db('bob'), 'users/alice/notifications/like_post1_bob'), { type: 'like', actor: 'bob', postId: 'post1', createdAt: serverTimestamp() }))
    // フォローせずに、フォローの通知だけを書く
    await assertFails(setDoc(doc(db('bob'), 'users/alice/notifications/follow_bob'), { type: 'follow', actor: 'bob', createdAt: serverTimestamp() }))
    // ほかの人になりすます
    await assertFails(setDoc(doc(db('bob'), 'users/alice/notifications/follow_carol'), { type: 'follow', actor: 'carol', createdAt: serverTimestamp() }))
  })

  it('投稿した人でない人あての、いいね・コメントの通知は作れない', async () => {
    const bob = db('bob')
    const batch = writeBatch(bob)
    batch.set(doc(bob, 'posts/post1/likes/bob'), { createdAt: serverTimestamp() })
    batch.set(doc(bob, 'users/carol/notifications/like_post1_bob'), { type: 'like', actor: 'bob', postId: 'post1', createdAt: serverTimestamp() })
    await assertFails(batch.commit())
    await assertFails(comment(db('bob'), 'bob', 'こんにちは', 'c9', 'post1', 'carol'))
  })

  it('本人は自分の通知を消せるが、ほかの人の通知は消せない', async () => {
    await like(db('bob'), 'bob')
    await assertFails(deleteDoc(doc(db('carol'), 'users/alice/notifications/like_post1_bob')))
    await assertSucceeds(deleteDoc(doc(db('alice'), 'users/alice/notifications/like_post1_bob')))
  })
})

describe('ブロック', () => {
  it('本人だけが読み書きでき、相手には見えない', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'users/alice/blocks/mallory')))
    await assertFails(getDoc(doc(db('mallory'), 'users/alice/blocks/mallory')))
    await assertSucceeds(setDoc(doc(db('bob'), 'users/bob/blocks/carol'), { createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db('bob'), 'users/carol/blocks/bob'), { createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db('bob'), 'users/bob/blocks/bob'), { createdAt: serverTimestamp() }))
    await assertSucceeds(deleteDoc(doc(db('bob'), 'users/bob/blocks/carol')))
  })
})
