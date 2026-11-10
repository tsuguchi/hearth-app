# ハース 公開の手順

本番の Firebase と Cloudflare を用意して、ハースを公開するまでの手順。
「あなた」と書いた手順は、Firebase や Cloudflare の画面で行う。それ以外は、Claude Code（またはコマンド）で行う。

## 0. 公開する前に確かめること

- メッセージの機能は、電気通信事業法の届出が要るかを確かめるまで、本番では止めておく（画面に出さず、送ることもできない）。確かめた後に使えるようにする手順は 7 章
- 利用規約（TERMS.md）とプライバシーポリシー（PRIVACY_POLICY.md）の制定日を、公開する日に合わせる

## 1. Firebase のプロジェクトを作る（あなた）

1. https://console.firebase.google.com/ で「プロジェクトを作成」。名前は例えば `hearth`。Google アナリティクスは使わない
2. 「Authentication」→「始める」→「ログイン方法」で「メール / パスワード」を有効にする（「メールリンク」は使わない）
3. 「Authentication」→「設定」→「ユーザー アクション」で、**「作成（登録）を有効にする」と「削除を有効にする」のチェックを外して保存**する
   - 登録は招待を確かめる Workers からだけ、削除はアカウントの削除の画面（Workers）からだけにするため
4. 「Firestore Database」→「データベースを作成」。エディションは「Standard」、場所は **`asia-northeast1`（東京）**、「本番環境モード」で始める
5. 「プロジェクトの設定」→「マイアプリ」で、ウェブアプリ（`</>`）を登録する（Firebase Hosting は使わない）。表示される `firebaseConfig` の値を Claude Code に伝える
6. 「プロジェクトの設定」→「サービス アカウント」→「新しい秘密鍵を生成」で鍵のファイル（JSON）を受け取る
   - **リポジトリの外**（例: `C:\Users\tsugu\secrets\hearth-service-account.json`）に置く
   - **中身をチャットに貼らない**。置いた場所だけを Claude Code に伝える

## 2. Cloudflare の R2 を用意する（あなた）

1. Cloudflare のダッシュボードの「R2 オブジェクト ストレージ」を開き、使い始める（カードの登録を求められることがある。無料の範囲なら請求はない）
2. 「バケットを作成」。名前は **`hearth-photos`**、場所のヒントは「アジア太平洋（APAC）」。公開アクセスは**有効にしない**

## 3. 本番の設定と公開（Claude Code）

1. `wrangler.jsonc` の `FIREBASE_PROJECT_ID` と `.firebaserc` を、1 章のプロジェクト ID にする
2. `.env.production.local` に 1 章の `firebaseConfig` の値を書き、`VITE_USE_EMULATOR=false`、`VITE_MESSAGES_ENABLED=false` にする
3. Workers の秘密の値を設定する
   - `npx wrangler secret put GOOGLE_SERVICE_ACCOUNT < 鍵のファイル`
   - `SESSION_SECRET` に 32 バイト以上の乱数（`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` の出力）
4. `npm run deploy:rules` で Security Rules とインデックスを本番に反映する
5. `npm run deploy` で組み立てて Cloudflare に公開する（URL は `https://hearth-app.<アカウントのサブドメイン>.workers.dev`）
6. Firebase の「Authentication」→「設定」→「承認済みドメイン」に、公開した URL のドメインを足す（あなた）

## 4. 最初の運営者を作る

1. `HEARTH_SERVICE_ACCOUNT=鍵のファイル APP_URL=公開した URL node scripts/production/bootstrap.mjs`
   - 全体の設定（利用者数の上限 50 人、メッセージは止めた状態）と、運営者の招待のリンクが 1 つできる
2. あなたが、そのリンクから登録する（確認のメールが届く）
3. `HEARTH_SERVICE_ACCOUNT=鍵のファイル node scripts/production/make-admin.mjs あなたのメールアドレス`
4. ログインし直すと「運営者の画面」が出る。ここから招待のリンクを作って、知り合いに渡す

## 5. 公開した後に確かめること

- 招待のリンクから登録し、確認のメールが届くこと
- 写真を投稿でき、ほかの利用者のタイムラインに出ること
- ブラウザのコンソールに、Content-Security-Policy で止められた読み込みがないこと（あれば `public/_headers` に足す）
- 招待のリンクを使わずに登録できないこと（Firebase の画面からの直接の登録が止まっていること）

## 6. 公開し直す（機能を足したとき）

- `develop` から `main` へのプルリクエストを出して入れ、`main` を手元に取り込んでから `npm run deploy`
- Security Rules やインデックスを変えたときは `npm run deploy:rules` も行う

## 7. メッセージを使えるようにする（法令の確認が済んだ後）

1. Firestore の `config/app` の `messagesEnabled` を `true` にする（Firebase の画面の「Firestore Database」から）
2. `.env.production.local` の `VITE_MESSAGES_ENABLED` を `true` にして、`npm run deploy`
