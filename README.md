# ハース（Hearth）

招待を受けた人だけが使える、写真を共有するための Web アプリケーション。
写真の投稿、フォロー・いいね・コメント、24 時間で消える投稿、1 対 1 のメッセージ（運営者にも読めないよう暗号化）ができる。

いまは作り始めの段階。招待による登録・ログイン・プロフィールの作成、写真の投稿と削除、タイムライン（「フォロー中」「みんな」）、フォロー・いいね・コメント、通知の一覧、プロフィール（表示と編集）、ブロックと通報、検索（人・タグ）、招待の画面、運営者の画面、メッセージ（端末ごとの鍵で暗号化）ができている。

- 要件: [REQUIREMENTS.md](REQUIREMENTS.md)
- デザインの方針: [DESIGN.md](DESIGN.md)
- データ構造と暗号化の設計: [DATA_MODEL.md](DATA_MODEL.md)

## 使っているもの

- 画面: React + TypeScript + Vite、Tailwind CSS v4、Radix Primitives、Lucide（アイコン）
- 書体: Noto Sans JP（本文）、Zen Maru Gothic（ロゴ）。`@fontsource` でサイトの中に置いて配る
- ログインとデータ: Firebase Authentication、Cloud Firestore
- サーバー側の処理と配信: Cloudflare Workers（`worker/`）。Firebase の操作は REST API を直接呼ぶ

## 開発の始め方

Java（Firebase Emulator が使う）と Node.js が必要。

1. `npm install`
2. `.env.example` を `.env.local` に、`.dev.vars.example` を `.dev.vars` にコピーする（そのままで Emulator につながる）
3. `npm run emulators` で Firebase Emulator を起動する（管理画面は http://127.0.0.1:4100）
4. 別のターミナルで `npm run seed` を実行すると、招待のリンクが 1 つ出る
5. 別のターミナルで `npm run dev` を実行し、出てきた招待のリンクを開いて登録する（Workers も同じ開発サーバーで動く）

- 開発サーバーの番号が `5173` でないときは、`APP_URL=http://localhost:番号 npm run seed` のように渡す
- 確認メールは実際には送られない。Emulator の管理画面の Authentication か、`http://127.0.0.1:9199/emulator/v1/projects/demo-hearth/oobCodes` に出るリンクを開くと、確認が済む
- Emulator のポートは、家計簿アプリと同時に動かせるよう、既定とずらしている（Auth 9199、Firestore 8180、管理画面 4100）
- 写真を置く R2 は、開発中は手元で動く模擬の R2 を使う（Cloudflare のアカウントは要らない）。置いた写真は `.wrangler/` に残る
- 写真は、Workers が出す cookie（1 時間）を確かめてから `/photos/{ID}/{full|thumb}` で返す。cookie の署名の鍵は `.dev.vars` の `SESSION_SECRET`

## コマンド

- `npm run dev`: 開発サーバー（画面と Workers）
- `npm run build`: 本番用に組み立てる
- `npm run lint`: コードの点検
- `npm test`: Workers の処理（登録・写真・投稿・cookie）と Security Rules のテスト（Emulator を自動で起動・終了する。R2 は模造品を使う）
- `npm run emulators`: Firebase Emulator を起動する
- `npm run seed`: Emulator に全体の設定と招待を 1 件作る
- `npm run admin -- メールアドレス`: Emulator で、その人に運営者の印（admin）を付ける。付けた後にページを読み込み直すと、「運営者の画面」が出る

## ブランチの使い方

| ブランチ | 役割 |
|---|---|
| `main` | 本番。公開しているものと同じ状態にする。直接はコミットしない |
| `develop` | 開発。作業のブランチをここにまとめ、確かめてから `main` に入れる |
| `feature/〇〇`・`fix/〇〇` | 作業ごとのブランチ。`develop` から切り、終わったら `develop` に入れる |

流れ:

1. `develop` から作業のブランチを切る（例: `git switch -c feature/invite develop`）
2. 作業を終えたら、`develop` に向けてプルリクエストを出して入れる
3. 公開するときは、`develop` から `main` に向けてプルリクエストを出して入れ、`main` から公開する
