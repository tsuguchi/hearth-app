// 本番で、メールアドレスの人に運営者の印（admin）を付ける（PUBLISHING.md の手順 5）。
// 使い方: HEARTH_SERVICE_ACCOUNT=鍵のファイル node scripts/production/make-admin.mjs メールアドレス
// 付けた後は、その人がログインし直すと「運営者の画面」が出る
import { accessToken, call, loadServiceAccount } from './google.mjs'

const email = process.argv[2]
if (!email) {
  console.error('メールアドレスを渡してください（例: node scripts/production/make-admin.mjs you@example.com）')
  process.exit(1)
}

const account = loadServiceAccount()
const token = await accessToken(account)
const base = `https://identitytoolkit.googleapis.com/v1/projects/${account.project_id}`

const { users } = await call(token, `${base}/accounts:lookup`, { email: [email] })
const user = users?.[0]
if (!user) {
  console.error(`${email} のアカウントが見つかりません。先に招待のリンクから登録してください。`)
  process.exit(1)
}
const claims = { ...(user.customAttributes ? JSON.parse(user.customAttributes) : {}), admin: true }
await call(token, `${base}/accounts:update`, { localId: user.localId, customAttributes: JSON.stringify(claims) })
console.log(`${email} に運営者の印を付けました:`, claims)
