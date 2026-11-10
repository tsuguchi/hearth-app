// 本番の Firestore に全体の設定（config/app）を作り、運営者の招待を 1 件作って、招待のリンクを出す。
// 使い方（PUBLISHING.md の手順 4）:
//   HEARTH_SERVICE_ACCOUNT=鍵のファイル APP_URL=https://… node scripts/production/bootstrap.mjs
// 設定がすでにあるときは書き換えず、招待だけを作る
import { createHash, randomBytes } from 'node:crypto'
import { accessToken, call, loadServiceAccount } from './google.mjs'

const account = loadServiceAccount()
const appUrl = process.env.APP_URL
if (!appUrl) {
  console.error('環境変数 APP_URL に、公開した URL を入れてください（例: https://hearth-app.example.workers.dev）。')
  process.exit(1)
}

const token = await accessToken(account)
const documents = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents`
const name = (path) => `projects/${account.project_id}/databases/(default)/documents/${path}`

const config = await fetch(`${documents}/config/app`, { headers: { authorization: `Bearer ${token}` } })
if (config.status === 404) {
  await call(token, `${documents}:commit`, {
    writes: [{
      update: {
        name: name('config/app'),
        fields: {
          memberCap: { integerValue: '50' },
          memberCount: { integerValue: '0' },
          invitesEnabled: { booleanValue: true },
          invitesBlocked: { arrayValue: {} },
          // メッセージは、電気通信事業法の届出が要るかを確かめるまで止めておく
          messagesEnabled: { booleanValue: false },
        },
      },
      currentDocument: { exists: false },
    }],
  })
  console.log('全体の設定（config/app）を作りました。利用者数の上限 50 人、メッセージは止めています。')
} else {
  console.log('全体の設定（config/app）はすでにあるので、そのままにしました。')
}

const invite = randomBytes(24).toString('base64url')
const now = new Date()
await call(token, `${documents}:commit`, {
  writes: [{
    update: {
      name: name(`invites/${createHash('sha256').update(invite).digest('hex')}`),
      fields: {
        createdBy: { nullValue: null },
        createdAt: { timestampValue: now.toISOString() },
        expiresAt: { timestampValue: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() },
        usedBy: { nullValue: null },
        usedAt: { nullValue: null },
        revokedAt: { nullValue: null },
      },
    },
    currentDocument: { exists: false },
  }],
})
console.log('運営者の招待を 1 件作りました（7 日間有効）。このリンクは今だけ表示されます:')
console.log(`${appUrl.replace(/\/$/, '')}/join#${invite}`)
