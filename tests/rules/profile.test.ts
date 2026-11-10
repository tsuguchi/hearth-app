import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
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
beforeEach(() => testEnv.clearFirestore())

const member = { member: true, email_verified: true }
const db = (uid: string, claims: Record<string, unknown> = member): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore

function createProfile(firestore: Firestore, uid: string, username: string, extra: Record<string, unknown> = {}) {
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'users', uid), {
    username, displayName: '表示名', bio: '', iconPhotoId: null, status: 'active', createdAt: serverTimestamp(), ...extra,
  })
  batch.set(doc(firestore, 'usernames', username), { uid })
  return batch.commit()
}

describe('プロフィールとユーザー名', () => {
  it('利用者は、自分のプロフィールとユーザー名を一緒に作れる', async () => {
    await assertSucceeds(createProfile(db('alice'), 'alice', 'alice_01'))
  })

  it('利用者の印がない人や、メールアドレスの確認が済んでいない人は作れない', async () => {
    await assertFails(createProfile(db('alice', {}), 'alice', 'alice_01'))
    await assertFails(createProfile(db('alice', { member: true, email_verified: false }), 'alice', 'alice_01'))
  })

  it('ほかの人が使っているユーザー名は使えない', async () => {
    await createProfile(db('alice'), 'alice', 'same_name')
    await assertFails(createProfile(db('bob'), 'bob', 'same_name'))
  })

  it('ユーザー名の表に登録せずにプロフィールだけは作れない', async () => {
    await assertFails(setDoc(doc(db('alice'), 'users', 'alice'), {
      username: 'alice_01', displayName: '表示名', bio: '', iconPhotoId: null, status: 'active', createdAt: serverTimestamp(),
    }))
  })

  it('形の正しくないユーザー名や長すぎる表示名は使えない', async () => {
    await assertFails(createProfile(db('alice'), 'alice', 'Alice'))
    await assertFails(createProfile(db('alice'), 'alice', 'ab'))
    await assertFails(createProfile(db('alice'), 'alice', 'alice_01', { displayName: 'あ'.repeat(31) }))
    await assertFails(createProfile(db('alice'), 'alice', 'alice_01', { displayName: '' }))
  })

  it('状態（status）は自分では変えられない', async () => {
    await assertFails(createProfile(db('alice'), 'alice', 'alice_01', { status: 'suspended' }))
    await createProfile(db('alice'), 'alice', 'alice_01')
    await assertFails(updateDoc(doc(db('alice'), 'users', 'alice'), { status: 'suspended' }))
  })

  it('ほかの人のプロフィールは書き換えられないが、読める', async () => {
    await createProfile(db('alice'), 'alice', 'alice_01')
    await assertFails(updateDoc(doc(db('bob'), 'users', 'alice'), { displayName: '別の名前' }))
    await assertSucceeds(getDoc(doc(db('bob'), 'users', 'alice')))
    await assertFails(getDoc(doc(db('bob', {}), 'users', 'alice')))
  })

  it('ユーザー名は、新しい名前の登録と古い名前の削除を一緒にすれば変えられる', async () => {
    await createProfile(db('alice'), 'alice', 'old_name')
    const firestore = db('alice')
    const batch = writeBatch(firestore)
    batch.update(doc(firestore, 'users', 'alice'), { username: 'new_name' })
    batch.set(doc(firestore, 'usernames', 'new_name'), { uid: 'alice' })
    batch.delete(doc(firestore, 'usernames', 'old_name'))
    await assertSucceeds(batch.commit())
  })

  it('古いユーザー名を残したまま変えることはできない', async () => {
    await createProfile(db('alice'), 'alice', 'old_name')
    const firestore = db('alice')
    const batch = writeBatch(firestore)
    batch.update(doc(firestore, 'users', 'alice'), { username: 'new_name' })
    batch.set(doc(firestore, 'usernames', 'new_name'), { uid: 'alice' })
    await assertFails(batch.commit())
  })
})

describe('本人だけの情報と、ブラウザから使えない文書', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore()
      await setDoc(doc(firestore, 'userPrivate/alice'), { photoCount: 0 })
      await setDoc(doc(firestore, 'invites/hash'), { createdBy: 'alice' })
      await setDoc(doc(firestore, 'config/app'), { memberCap: 50 })
    })
  })

  it('本人だけの情報は、本人だけが読める。写真の枚数などは本人も書けない', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'userPrivate/alice')))
    await assertFails(getDoc(doc(db('bob'), 'userPrivate/alice')))
    await assertFails(updateDoc(doc(db('alice'), 'userPrivate/alice'), { photoCount: 999 }))
    await assertFails(updateDoc(doc(db('alice'), 'userPrivate/alice'), { lastReadNotificationsAt: serverTimestamp(), photoCount: 5 }))
  })

  it('通知を読んだ日時だけは、本人が今の日時で書ける', async () => {
    await assertSucceeds(updateDoc(doc(db('alice'), 'userPrivate/alice'), { lastReadNotificationsAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(db('alice'), 'userPrivate/alice'), { lastReadNotificationsAt: new Date('2099-01-01') }))
    await assertFails(updateDoc(doc(db('bob'), 'userPrivate/alice'), { lastReadNotificationsAt: serverTimestamp() }))
  })

  it('招待と全体の設定は、ブラウザからは読み書きできない', async () => {
    await assertFails(getDoc(doc(db('alice'), 'invites/hash')))
    await assertFails(setDoc(doc(db('alice'), 'invites/new'), { createdBy: 'alice' }))
    await assertFails(getDoc(doc(db('alice'), 'config/app')))
    await assertFails(updateDoc(doc(db('alice'), 'config/app'), { memberCap: 1000 }))
  })
})
