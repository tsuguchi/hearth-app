import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
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

// alice と bob がやり取りする。carol は第三者、mallory は alice にブロックされている
beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore()
    for (const uid of ['alice', 'bob', 'carol', 'mallory']) {
      await setDoc(doc(firestore, 'users', uid), { username: uid, displayName: uid, bio: '', iconPhotoId: null, status: 'active' })
      await setDoc(doc(firestore, 'users', uid, 'devices', `${uid}-device`), { encPublicKey: { kty: 'EC' }, signPublicKey: { kty: 'EC' }, label: 'test' })
    }
    await setDoc(doc(firestore, 'users/alice/blocks/mallory'), { createdAt: new Date() })
  })
})

const member = { member: true, email_verified: true }
const db = (uid: string, claims: Record<string, unknown> = member): Firestore =>
  testEnv.authenticatedContext(uid, claims).firestore() as unknown as Firestore

const message = (sender: string, extra: Record<string, unknown> = {}) => ({
  v: 1, sender, senderDevice: `${sender}-device`, createdAt: serverTimestamp(), epk: 'epk',
  keys: { 'bob-device': { iv: 'iv', ct: 'ct' } }, iv: 'iv', ct: 'ciphertext', photos: [], sig: 'sig', ...extra,
})

// 最初のメッセージは、やり取りの文書と一緒に作る
function firstMessage(firestore: Firestore, me: string, other: string, extra: Record<string, unknown> = {}) {
  const members = [me, other].sort()
  const id = members.join('_')
  const batch = writeBatch(firestore)
  batch.set(doc(firestore, 'conversations', id), { members, createdAt: serverTimestamp(), lastMessageAt: serverTimestamp(), lastReadAt: { [me]: serverTimestamp() } })
  batch.set(doc(firestore, 'conversations', id, 'messages', 'm1'), message(me, extra))
  return batch.commit()
}

describe('端末の公開鍵', () => {
  it('利用者全員が読め、本人だけが登録・削除できる', async () => {
    await assertSucceeds(getDoc(doc(db('bob'), 'users/alice/devices/alice-device')))
    const device = { encPublicKey: { kty: 'EC' }, signPublicKey: { kty: 'EC' }, label: 'Chrome・Windows', createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(db('alice'), 'users/alice/devices/new'), device))
    await assertFails(setDoc(doc(db('bob'), 'users/alice/devices/evil'), device))
    await assertFails(deleteDoc(doc(db('bob'), 'users/alice/devices/alice-device')))
    await assertSucceeds(deleteDoc(doc(db('alice'), 'users/alice/devices/new')))
  })

  it('登録した公開鍵は書き換えられない（入れ替えによるなりすましを防ぐ）', async () => {
    await assertFails(updateDoc(doc(db('alice'), 'users/alice/devices/alice-device'), { encPublicKey: { kty: 'EC', x: 'other' } }))
    await assertSucceeds(updateDoc(doc(db('alice'), 'users/alice/devices/alice-device'), { lastSeenAt: serverTimestamp() }))
  })
})

describe('やり取りとメッセージ', () => {
  it('2 人の間で、やり取りを作って最初のメッセージを送れ、2 人とも読める', async () => {
    await assertSucceeds(firstMessage(db('alice'), 'alice', 'bob'))
    await assertSucceeds(getDoc(doc(db('bob'), 'conversations/alice_bob')))
    await assertSucceeds(getDocs(collection(db('bob'), 'conversations/alice_bob/messages')))
  })

  it('まだないやり取りは、自分が入る ID なら「ない」ことを確かめられる。ほかの人どうしのものは確かめられない', async () => {
    await assertSucceeds(getDoc(doc(db('alice'), 'conversations/alice_bob')))
    await assertFails(getDoc(doc(db('carol'), 'conversations/alice_bob')))
  })

  it('第三者は、やり取りもメッセージも読めない', async () => {
    await firstMessage(db('alice'), 'alice', 'bob')
    await assertFails(getDoc(doc(db('carol'), 'conversations/alice_bob')))
    await assertFails(getDocs(collection(db('carol'), 'conversations/alice_bob/messages')))
  })

  it('自分の入っていないやり取りや、並び順の違う ID では作れない', async () => {
    await assertFails(firstMessage(db('carol'), 'alice', 'bob'))
    const firestore = db('alice')
    await assertFails(setDoc(doc(firestore, 'conversations/bob_alice'), {
      members: ['bob', 'alice'], createdAt: serverTimestamp(), lastMessageAt: serverTimestamp(), lastReadAt: {},
    }))
  })

  it('ブロックしている・されている相手とはやり取りできない（F-64）', async () => {
    await assertFails(firstMessage(db('mallory'), 'mallory', 'alice'))
    await assertFails(firstMessage(db('alice'), 'alice', 'mallory'))
  })

  it('なりすまし・登録していない端末・長すぎる暗号文・5 枚以上の写真では送れない', async () => {
    await firstMessage(db('alice'), 'alice', 'bob')
    const send = (sender: Firestore, data: Record<string, unknown>) => setDoc(doc(sender, 'conversations/alice_bob/messages/m2'), data)
    await assertFails(send(db('alice'), message('bob')))
    await assertFails(send(db('alice'), message('alice', { senderDevice: 'unknown-device' })))
    await assertFails(send(db('alice'), message('alice', { ct: 'a'.repeat(8001) })))
    await assertFails(send(db('alice'), message('alice', { photos: [1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, iv: 'iv' })) })))
    await assertSucceeds(send(db('bob'), message('bob')))
  })

  it('メッセージはブラウザから書き換えも削除もできない（取り消しは Workers が行う）', async () => {
    await firstMessage(db('alice'), 'alice', 'bob')
    await assertFails(updateDoc(doc(db('alice'), 'conversations/alice_bob/messages/m1'), { ct: '書き換え' }))
    await assertFails(deleteDoc(doc(db('alice'), 'conversations/alice_bob/messages/m1')))
  })

  it('読んだ日時は自分の分だけ書ける', async () => {
    await firstMessage(db('alice'), 'alice', 'bob')
    await assertSucceeds(updateDoc(doc(db('bob'), 'conversations/alice_bob'), { 'lastReadAt.bob': serverTimestamp() }))
    await assertFails(updateDoc(doc(db('bob'), 'conversations/alice_bob'), { 'lastReadAt.alice': serverTimestamp() }))
    await assertFails(updateDoc(doc(db('bob'), 'conversations/alice_bob'), { members: ['bob', 'carol'] }))
  })
})

describe('メッセージの通報', () => {
  const report = (extra: Record<string, unknown>) => ({
    reporter: 'bob', targetType: 'message', targetPath: 'conversations/alice_bob/messages/m1', targetUser: 'alice',
    reason: 'harassment', detail: '', status: 'open', createdAt: serverTimestamp(), ...extra,
  })

  it('読んだ内容を添えて通報できる。添えないと通報できない', async () => {
    await assertSucceeds(setDoc(doc(db('bob'), 'reports/r1'), report({ messageContent: '受け取ったメッセージ' })))
    await assertFails(setDoc(doc(db('bob'), 'reports/r2'), report({})))
    await assertFails(setDoc(doc(db('bob'), 'reports/r3'), report({ messageContent: 'あ'.repeat(2001) })))
  })

  it('メッセージ以外の通報には、内容を添えられない', async () => {
    await assertFails(setDoc(doc(db('bob'), 'reports/r1'), report({ targetType: 'post', targetPath: 'posts/p1', messageContent: 'x' })))
  })
})
