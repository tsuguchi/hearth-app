// 本番の Firebase を、サービスアカウントの鍵で操作するための部品（公開の作業で使う）。
// 鍵のファイルは、リポジトリの外に置き、環境変数 HEARTH_SERVICE_ACCOUNT でその場所を渡す
import { readFileSync } from 'node:fs'
import { importPKCS8, SignJWT } from 'jose'

export function loadServiceAccount() {
  const path = process.env.HEARTH_SERVICE_ACCOUNT
  if (!path) {
    console.error('環境変数 HEARTH_SERVICE_ACCOUNT に、サービスアカウントの鍵のファイルの場所を入れてください。')
    process.exit(1)
  }
  return JSON.parse(readFileSync(path, 'utf8'))
}

export async function accessToken(account) {
  const key = await importPKCS8(account.private_key, 'RS256')
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  if (!response.ok) throw new Error(`Google の証明書を取得できませんでした（${response.status}）: ${await response.text()}`)
  return (await response.json()).access_token
}

export async function call(token, url, body, method = 'POST') {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status} ${text}`)
  return text ? JSON.parse(text) : {}
}
