// 練習用の Firebase（Emulator）に、全体の設定と、運営者の招待を 1 件作る。
// 使い方: npm run emulators を動かしたまま、別のターミナルで npm run seed
import { createHash, randomBytes } from 'node:crypto'

const PROJECT_ID = 'demo-hearth'
const FIRESTORE = 'http://127.0.0.1:8180'
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173'
const DAY = 24 * 60 * 60 * 1000

const documents = `projects/${PROJECT_ID}/databases/(default)/documents`
const now = new Date()
const token = randomBytes(24).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')

const writes = [
  {
    // すでにあるときは、人数を残したまま設定だけを書く
    update: {
      name: `${documents}/config/app`,
      fields: { memberCap: { integerValue: '50' }, invitesEnabled: { booleanValue: true }, invitesBlocked: { arrayValue: {} } },
    },
    updateMask: { fieldPaths: ['memberCap', 'invitesEnabled', 'invitesBlocked'] },
  },
  {
    update: {
      name: `${documents}/invites/${tokenHash}`,
      fields: {
        createdBy: { nullValue: null },
        createdAt: { timestampValue: now.toISOString() },
        expiresAt: { timestampValue: new Date(now.getTime() + 7 * DAY).toISOString() },
        usedBy: { nullValue: null },
        usedAt: { nullValue: null },
        revokedAt: { nullValue: null },
      },
    },
  },
]

const response = await fetch(`${FIRESTORE}/v1/${documents}:commit`, {
  method: 'POST',
  headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
  body: JSON.stringify({ writes }),
}).catch(() => null)

if (!response?.ok) {
  console.error('Emulator に書き込めませんでした。npm run emulators を先に動かしてください。')
  process.exit(1)
}

console.log('招待を 1 件作りました（7 日間有効）。このリンクを開くと登録できます:')
console.log(`${APP_URL}/join#${token}`)
console.log('確認のメールは実際には送られません。Emulator の管理画面（http://127.0.0.1:4100/auth）か、')
console.log(`http://127.0.0.1:9199/emulator/v1/projects/${PROJECT_ID}/oobCodes のリンクを開くと、確認が済みます。`)
