// Workers が使う設定。本番の値は wrangler の vars と secret、開発中は .dev.vars で渡す
export interface Env {
  FIREBASE_PROJECT_ID: string
  // Firebase Emulator につなぐときだけ設定する（例: 127.0.0.1:9099）
  FIREBASE_AUTH_EMULATOR_HOST?: string
  FIRESTORE_EMULATOR_HOST?: string
  // 本番でだけ使う、Google のサービスアカウントの鍵（JSON）。wrangler secret で設定する
  GOOGLE_SERVICE_ACCOUNT?: string
}

export function usesEmulator(env: Env): boolean {
  return Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST)
}
