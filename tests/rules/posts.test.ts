import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore'
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
    await setDoc(doc(firestore, 'posts/visible'), { author: 'alice', caption: '', hidden: false, createdAt: new Date() })
    await setDoc(doc(firestore, 'posts/hidden'), { author: 'suspended', caption: '', hidden: true, createdAt: new Date() })
    await setDoc(doc(firestore, 'photos/p1'), { owner: 'alice', kind: 'post', parentId: 'visible' })
  })
})

const member = { member: true, email_verified: true }
const db = (uid: string, claims: Record<string, unknown> = member): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore

describe('投稿', () => {
  it('利用者は投稿を読める。タイムラインの取り出し方（hidden が false で新しい順）も通る', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'posts/visible')))
    await assertSucceeds(getDocs(query(collection(db('bob'), 'posts'), where('hidden', '==', false), orderBy('createdAt', 'desc'), limit(20))))
  })

  it('止めたアカウントの投稿（hidden）は読めない', async () => {
    await assertFails(getDoc(doc(db('bob'), 'posts/hidden')))
    await assertFails(getDocs(query(collection(db('bob'), 'posts'), orderBy('createdAt', 'desc'))))
  })

  it('利用者でない人は読めない', async () => {
    await assertFails(getDoc(doc(db('bob', {}), 'posts/visible')))
  })

  it('ブラウザからは、自分の投稿でも作れず、書き換えも削除もできない', async () => {
    await assertFails(setDoc(doc(db('alice'), 'posts/new'), { author: 'alice', caption: '', hidden: false, createdAt: new Date() }))
    await assertFails(updateDoc(doc(db('alice'), 'posts/visible'), { caption: '書き換え' }))
    await assertFails(deleteDoc(doc(db('alice'), 'posts/visible')))
  })
})

describe('写真の記録', () => {
  it('持ち主と運営者だけが読め、だれも書けない', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'photos/p1')))
    await assertSucceeds(getDoc(doc(db('admin', { ...member, admin: true }), 'photos/p1')))
    await assertFails(getDoc(doc(db('bob'), 'photos/p1')))
    await assertFails(updateDoc(doc(db('alice'), 'photos/p1'), { parentId: null }))
  })
})
