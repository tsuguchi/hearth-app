// Workers が使う設定。本番の値は wrangler の vars と secret、開発中は .dev.vars で渡す
export interface Env {
  FIREBASE_PROJECT_ID: string
  // Firebase Emulator につなぐときだけ設定する（例: 127.0.0.1:9199）
  FIREBASE_AUTH_EMULATOR_HOST?: string
  FIRESTORE_EMULATOR_HOST?: string
  // 本番でだけ使う、Google のサービスアカウントの鍵（JSON）。wrangler secret で設定する
  GOOGLE_SERVICE_ACCOUNT?: string
  // 写真を見るための cookie に署名する鍵（32 バイト以上の乱数）。wrangler secret で設定する
  SESSION_SECRET: string
  // 写真を置く R2 のバケット
  PHOTOS: PhotoBucket
}

// R2 のバケットのうち、ハースが使う機能だけ。テストでは手元の模造品に差し替える
export interface PhotoBucket {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }, customMetadata?: Record<string, string> }): Promise<unknown>
  get(key: string): Promise<{ body: ReadableStream, httpEtag: string, customMetadata?: Record<string, string> } | null>
  delete(keys: string | string[]): Promise<void>
}

export function usesEmulator(env: Env): boolean {
  return Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST)
}
