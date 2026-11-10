// この端末の鍵を、ブラウザの IndexedDB に置く（F-100）。秘密鍵は取り出せない形のまま保存する

export type StoredDevice = {
  uid: string
  deviceId: string
  encryptionPrivateKey: CryptoKey
  signingPrivateKey: CryptoKey
  createdAt: number
}

const DB_NAME = 'hearth'
const STORE = 'devices'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'uid' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function loadDevice(uid: string): Promise<StoredDevice | null> {
  return (await run<StoredDevice | undefined>('readonly', (store) => store.get(uid))) ?? null
}

export async function saveDevice(device: StoredDevice): Promise<void> {
  await run('readwrite', (store) => store.put(device))
}

export async function deleteDevice(uid: string): Promise<void> {
  await run('readwrite', (store) => store.delete(uid))
}

// 端末の名前（設定の画面の一覧に出す）。ブラウザと OS の名前だけにする
export function deviceLabel(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'ブラウザ'
  const os = /iPhone|iPad/.test(agent) ? 'iPhone・iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Mac OS X/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : ''
  return os ? `${browser}・${os}` : browser
}
