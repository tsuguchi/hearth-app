// 練習用の Firebase（Emulator）で、メールアドレスの人に運営者の印（admin）を付ける。
// 使い方: npm run emulators を動かしたまま、npm run admin -- haru@example.com
// 付けた後は、その人がログインし直すと（またはページを読み込み直すと）運営者の画面が出る
const PROJECT_ID = 'demo-hearth'
const AUTH = `http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`
const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' }

const email = process.argv[2]
if (!email) {
  console.error('メールアドレスを渡してください（例: npm run admin -- haru@example.com）')
  process.exit(1)
}

const lookup = await fetch(`${AUTH}/accounts:lookup`, { method: 'POST', headers, body: JSON.stringify({ email: [email] }) }).catch(() => null)
if (!lookup?.ok) {
  console.error('Emulator に接続できませんでした。npm run emulators を先に動かしてください。')
  process.exit(1)
}
const user = (await lookup.json()).users?.[0]
if (!user) {
  console.error(`${email} のアカウントが見つかりません。`)
  process.exit(1)
}

const claims = { ...(user.customAttributes ? JSON.parse(user.customAttributes) : {}), admin: true }
await fetch(`${AUTH}/accounts:update`, { method: 'POST', headers, body: JSON.stringify({ localId: user.localId, customAttributes: JSON.stringify(claims) }) })
console.log(`${email} に運営者の印を付けました:`, claims)
