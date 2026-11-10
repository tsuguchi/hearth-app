import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
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

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore()
    await setDoc(doc(firestore, 'follows/bob_alice'), { follower: 'bob', followee: 'alice', createdAt: new Date() })
    await setDoc(doc(firestore, 'follows/carol_alice'), { follower: 'carol', followee: 'alice', createdAt: new Date() })
  })
})

const member = { member: true, email_verified: true }
const db = (uid: string, claims: Record<string, unknown> = member): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore

const report = (reporter: string, extra: Record<string, unknown> = {}) => ({
  reporter, targetType: 'post', targetPath: 'posts/p1', targetUser: 'alice', reason: 'spam', detail: '', status: 'open', createdAt: serverTimestamp(), ...extra,
})

describe('ブロックしたときのフォローの解除', () => {
  it('ブロックするのと同じ書き込みでなら、相手からのフォローを外せる', async () => {
    const alice = db('alice')
    const batch = writeBatch(alice)
    batch.set(doc(alice, 'users/alice/blocks/bob'), { createdAt: serverTimestamp() })
    batch.delete(doc(alice, 'follows/bob_alice'))
    await assertSucceeds(batch.commit())
  })

  it('ブロックしていない相手からのフォローは外せない', async () => {
    await assertFails(deleteDoc(doc(db('alice'), 'follows/carol_alice')))
  })
})

describe('通報', () => {
  it('利用者は通報でき、運営者だけが読める', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { detail: '宣伝の書き込みが続いています' })))
    await assertFails(getDoc(doc(db('bob'), 'reports/r1')))
    await assertFails(getDocs(collection(db('bob'), 'reports')))
    await assertSucceeds(getDoc(doc(db('admin', { ...member, admin: true }), 'reports/r1')))
  })

  it('なりすまし・自分自身・決まっていない理由・処理済みの状態・長すぎる補足では通報できない', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('carol')))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { targetUser: 'bob' })))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { reason: 'dislike' })))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { status: 'resolved' })))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { detail: 'あ'.repeat(1001) })))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { targetType: 'message' })))
  })

  it('利用者でない人は通報できず、通報は書き換えも削除もできない', async () => {
    await assertFails(setDoc(doc(db('bob', {}), 'reports/r1'), report('bob')))
    await setDoc(doc(db('bob'), 'reports/r1'), report('bob'))
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report('bob', { detail: '書き換え' })))
    await assertFails(deleteDoc(doc(db('bob'), 'reports/r1')))
  })
})
