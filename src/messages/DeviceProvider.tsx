import { doc, getDoc, serverTimestamp, setDoc, type Timestamp, updateDoc } from 'firebase/firestore'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { db } from '../firebase'
import { generateDeviceKeys } from './crypto'
import { deviceLabel, loadDevice, saveDevice, type StoredDevice } from './deviceStore'

// この端末のメッセージの鍵（F-100〜F-104）。メッセージの画面を開いたときに用意する。
// - 鍵がないとき（はじめての端末・ブラウザのデータを消した後）は、新しく作って公開鍵を登録する
// - 別の端末から「外す」を選ばれて登録が消えていたときも、新しく作り直す
// 新しく作ったときは isNew を立て、「この端末では、これより前のメッセージは読めません」と知らせる（F-103）

type DeviceState =
  | { status: 'loading' }
  | { status: 'ready', device: StoredDevice, isNew: boolean, persisted: boolean }
  | { status: 'error' }

type DeviceContextValue = { state: DeviceState, ensure: () => void, acknowledgeNew: () => void }

const DeviceContext = createContext<DeviceContextValue | null>(null)
const LAST_SEEN_KEY = 'hearth.device.lastSeen'

// 同じ人の準備は 1 回だけにする（同時に 2 回走ると、端末が 2 つ登録されてしまうため）
const preparing = new Map<string, Promise<{ device: StoredDevice, isNew: boolean, persisted: boolean }>>()

function prepare(uid: string): Promise<{ device: StoredDevice, isNew: boolean, persisted: boolean }> {
  let pending = preparing.get(uid)
  if (!pending) {
    pending = prepareOnce(uid).finally(() => preparing.delete(uid))
    preparing.set(uid, pending)
  }
  return pending
}

async function prepareOnce(uid: string): Promise<{ device: StoredDevice, isNew: boolean, persisted: boolean }> {
  // 保存したデータを消さないよう、ブラウザに頼む（消されると前のメッセージを読めなくなる）
  const persisted = await navigator.storage?.persist?.().catch(() => false) ?? false

  const stored = await loadDevice(uid)
  if (stored) {
    const registered = await getDoc(doc(db, 'users', uid, 'devices', stored.deviceId))
    if (registered.exists()) {
      // 最後に使った日時は 1 日に 1 回だけ書く
      const today = new Date().toDateString()
      if (localStorage.getItem(LAST_SEEN_KEY) !== today) {
        await updateDoc(registered.ref, { lastSeenAt: serverTimestamp() }).catch(() => {})
        localStorage.setItem(LAST_SEEN_KEY, today)
      }
      return { device: stored, isNew: false, persisted }
    }
  }

  const keys = await generateDeviceKeys()
  const deviceId = crypto.randomUUID()
  const device: StoredDevice = {
    uid,
    deviceId,
    encryptionPrivateKey: keys.encryption.privateKey,
    signingPrivateKey: keys.signing.privateKey,
    createdAt: Date.now(),
  }
  await setDoc(doc(db, 'users', uid, 'devices', deviceId), {
    encPublicKey: keys.encPublicKey,
    signPublicKey: keys.signPublicKey,
    label: deviceLabel(),
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  })
  await saveDevice(device)
  return { device, isNew: true, persisted }
}

export function DeviceProvider({ me, children }: { me: string, children: ReactNode }) {
  const [state, setState] = useState<DeviceState>({ status: 'loading' })
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (!requested) return
    let cancelled = false
    prepare(me)
      .then((result) => !cancelled && setState({ status: 'ready', ...result }))
      .catch(() => !cancelled && setState({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [me, requested])

  // 鍵は、メッセージを使うときにはじめて用意する（ほかの画面だけを使う人の端末は登録しない）
  const ensure = useCallback(() => setRequested(true), [])
  const acknowledgeNew = useCallback(() => setState((current) => (current.status === 'ready' ? { ...current, isNew: false } : current)), [])

  return <DeviceContext value={{ state, ensure, acknowledgeNew }}>{children}</DeviceContext>
}

export function useDevice(): DeviceContextValue {
  const value = useContext(DeviceContext)
  if (!value) throw new Error('DeviceProvider の中で使ってください')
  return value
}

export type DeviceRecord = {
  deviceId: string
  encPublicKey: JsonWebKey
  signPublicKey: JsonWebKey
  label: string
  createdAt: Timestamp | null
  lastSeenAt: Timestamp | null
}
