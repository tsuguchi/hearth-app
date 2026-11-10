# ハース データ構造と暗号化の設計（ドラフト v0.1）

最終更新: 2026-11-10

要件は [REQUIREMENTS.md](REQUIREMENTS.md)（F 番号）を参照する。

## 1. 全体の方針

- **だれが書くか**を 2 つに分ける
  - 利用者のブラウザが直接書くもの: コメント、いいね、フォロー、ブロック、通知、メッセージ、プロフィールの文字。Firestore の Security Rules で守る
  - Workers（サーバー側）だけが書くもの: アカウント、招待、写真の記録、投稿、24 時間で消える投稿、通報の処理、アカウントの停止・削除。Security Rules では、ブラウザからの書き込みを禁止する
- 投稿を Workers で作るのは、写真が本当にその人のものか、写真の枚数の上限（F-26）を守れているかを確かめるため（Security Rules では 1 回に調べられる文書が 10 件までで、写真 10 枚の投稿を確かめきれない）
- 読み取りは、「利用者」の印（`member`）を持つ人にだけ許す。印は Firebase のカスタムクレーム（ログインの証明書に入る情報）に入れ、Security Rules は文書を読まずに確かめられる
- 数（いいね数・コメント数・フォロー数）は保存せず、Firestore の数える機能（count）で数える。書き換えによる数のずれが起きない

## 2. ログインの証明書の情報（カスタムクレーム）

| 印 | 意味 | 付ける・外す |
|---|---|---|
| `member: true` | 招待を受けて登録した利用者 | Workers が登録のときに付ける。止めたときに外す |
| `admin: true` | 運営者 | 運営者が手で付ける |

止めたアカウント（F-92）は、Workers が Firebase のアカウントを無効にし、`member` を外し、ログインの更新を取り消す。
すでに出ている証明書は最長 1 時間有効なので、その間は Workers が持つ止めた人の一覧でも弾く。

## 3. Firestore の構造

### 3.1 利用者

**`users/{uid}`**（利用者全員が読める。プロフィールの文字は本人が書ける）

| 項目 | 型 | 内容 |
|---|---|---|
| `username` | string | ユーザー名（英小文字・数字・`_`、3〜20 文字） |
| `displayName` | string | 表示名（30 文字まで） |
| `bio` | string | 自己紹介（150 文字まで） |
| `iconPhotoId` | string \| null | アイコンの写真 |
| `status` | `'active' \| 'suspended'` | Workers だけが変える |
| `createdAt` | timestamp | |

**`usernames/{username}`** `{ uid }`: ユーザー名が重ならないようにするための表。ユーザー名を変えるときは、本人がトランザクションで古い方を消し新しい方を作る（Security Rules で、`users` の `username` と一致することを確かめる）

**`userPrivate/{uid}`**（本人と Workers だけ）

| 項目 | 内容 |
|---|---|
| `photoCount` | 今残っている写真の枚数（F-26）。Workers だけが変える |
| `invitedBy` | 招待した人の uid（F-13） |
| `adultConfirmedAt` | 18 歳以上と申告した日時（F-02） |
| `lastReadNotificationsAt` | 通知の一覧を最後に開いた日時 |

### 3.2 招待（Workers だけが読み書きする）

**`invites/{tokenHash}`**

| 項目 | 内容 |
|---|---|
| `createdBy` | 作った人の uid |
| `createdAt`・`expiresAt` | 作った日時と、その 7 日後（F-11） |
| `usedBy`・`usedAt` | 使った人と日時。未使用は null |
| `revokedAt` | 取り消した日時 |

- 招待のリンクは `https://…/join#<招待の文字列>`。文字列は 128 ビットの乱数で、`#` の後ろに置くので、Web サーバーのログに残らない
- 文書の ID は文字列の SHA-256。Firestore の中身を見ても、招待のリンクは作れない
- 自分の招待の一覧は、Workers の API を通して見る

**`config/app`**: `memberCap`（50）、`memberCount`、`invitesEnabled`、`invitesBlocked`（招待を止めた uid の一覧）。Workers だけが書く

### 3.3 写真の記録

**`photos/{photoId}`**（Workers だけが書く。持ち主と運営者が読める）

| 項目 | 内容 |
|---|---|
| `owner` | 持ち主の uid |
| `kind` | `'post' \| 'story' \| 'message' \| 'icon'` |
| `parentId` | 投稿・24 時間で消える投稿・やり取りの ID。まだ付いていないときは null |
| `bytes` | 大きさ（元の画像と小さな画像の合計） |
| `width`・`height` | 縦横のピクセル数（メッセージの写真は暗号化しているので持たない） |
| `createdAt` | |

- 送ったが投稿に使われなかった写真（`parentId` が null のまま 24 時間たったもの）は、定時の実行で消す

### 3.4 投稿

**`posts/{postId}`**（利用者全員が読める。Workers だけが書く）

| 項目 | 内容 |
|---|---|
| `author` | uid |
| `caption` | 説明文（2,000 文字まで） |
| `tags` | 説明文から取り出したタグ（F-25、F-71）。小文字・NFKC にそろえる |
| `photos` | `[{ id, width, height, alt }]`（1〜10 件） |
| `hidden` | 止めたアカウントの投稿は true（F-92）。読み取りの条件で弾く |
| `createdAt`・`updatedAt` | |

**`posts/{postId}/comments/{commentId}`**: `{ author, text, createdAt }`

- 作れるのは利用者で、投稿した人にブロックされていないとき（Security Rules で 2 方向のブロックの文書を調べる）
- 消せるのは、書いた人と投稿した人（F-43）

**`posts/{postId}/likes/{uid}`**: `{ createdAt }`。文書の ID を自分の uid に限ることで、1 人 1 回にする

### 3.5 フォローとブロック

**`follows/{followerUid}_{followeeUid}`**: `{ follower, followee, createdAt }`

- 「フォロー中」のタイムライン（F-30）は、フォローしている人の uid で投稿を取り出す（1 回に 30 人まで指定できるので、50 人なら 2 回に分ける）

**`users/{uid}/blocks/{targetUid}`**: `{ createdAt }`（本人だけが読み書きする。Security Rules からは調べられる）

- ブロックされた人には、ブロックされたことが分からない（F-81）。そのため、相手側の画面で投稿を隠すことはできず、ブロックした人の画面で相手を隠す。コメント・メッセージ・フォローは、Security Rules で 2 方向とも止める

### 3.6 24 時間で消える投稿

**`stories/{storyId}`**（利用者全員が読める。Workers だけが書く）: `{ author, photoId, text, createdAt, expiresAt }`

- 読み取りは `expiresAt` が今より後のものだけを許す。時間が来た瞬間に見えなくなる
- 写真と文書は、1 時間ごとの定時の実行で消す（F-52）

### 3.7 通知

**`users/{uid}/notifications/{id}`**: `{ type, actor, postId?, createdAt }`

- `type`: `'like' | 'comment' | 'follow' | 'inviteUsed'`
- いいね・コメント・フォローをした人のブラウザが、相手の通知として書く。Security Rules で `actor` が自分であること、相手にブロックされていないことを確かめる。招待の通知は Workers が書く
- 通知の ID は、フォローが `follow_{した人}`、いいねが `like_{投稿}_{した人}`、コメントが `comment_{コメント}`。同じ操作の通知が重ならず、取り消したとき（フォローをやめる・いいねを外す・コメントを消す）に、した人がその通知を消せる
- Security Rules は、同じ書き込みで本体（フォロー・いいね・コメントの文書）ができていることと、投稿の通知なら相手が投稿した人であることを確かめる。実際にしていない操作の通知は作れない
- 読んだかどうかは、`userPrivate` の `lastReadNotificationsAt` より新しいかで決める
- 90 日たった通知は、1 日 1 回の定時の実行で消す（F-97）

### 3.8 メッセージ（4 章で暗号化）

**`conversations/{uidA}_{uidB}`**（uid を並べ替えてつなぐ。2 人だけが読み書きできる）

| 項目 | 内容 |
|---|---|
| `members` | `[uidA, uidB]` |
| `lastMessageAt` | 最後のメッセージの日時 |
| `lastReadAt` | `{ uid: 日時 }`。読んでいないかどうか（F-62）を決める |

**`conversations/{id}/messages/{messageId}`**: 4.3 の形。送った人だけが消せる（F-63）

**`users/{uid}/devices/{deviceId}`**（利用者全員が読める。本人だけが書ける）

| 項目 | 内容 |
|---|---|
| `encPublicKey` | 暗号化用の公開鍵（ECDH P-256、JWK） |
| `signPublicKey` | 署名の確かめ用の公開鍵（ECDSA P-256、JWK） |
| `label` | 端末の名前（例「Chrome・Windows」）。設定の画面の一覧用（F-104） |
| `createdAt`・`lastSeenAt` | |

### 3.9 通報

**`reports/{reportId}`**（作るのは利用者、読むのは運営者だけ）

| 項目 | 内容 |
|---|---|
| `reporter` | uid |
| `targetType` | `'post' \| 'comment' \| 'story' \| 'user' \| 'message'` |
| `targetPath` | 対象の文書の場所 |
| `reason`・`detail` | 理由（選択）と補足 |
| `messageContent` | メッセージの通報のときだけ、通報した人が読んだ内容（F-83） |
| `status`・`handledAt`・`handledBy` | 運営者の対応 |

## 4. メッセージの暗号化

### 4.1 鍵

- 端末（ブラウザ）ごとに、暗号化用の鍵の組（ECDH P-256）と署名用の鍵の組（ECDSA P-256）を Web Crypto API で作る
- 秘密鍵は取り出せない形（non-extractable）で IndexedDB に置く。端末の外には出ない（F-100）
- ブラウザに、保存したデータを消さないよう頼む（`navigator.storage.persist()`）。消されると前のメッセージを読めなくなる（REQUIREMENTS の未決事項）

### 4.2 送るとき

1. メッセージごとに、中身を暗号化する鍵（AES-256-GCM）を乱数で作る
2. 文字と写真を、その鍵で暗号化する。写真は暗号化してから Workers に送る
3. 相手のすべての端末と、自分のほかの端末（F-101）について、使い捨ての鍵の組と、その端末の公開鍵から包むための鍵を作り（ECDH → HKDF-SHA256）、中身の鍵を包む
4. 全体に、自分の端末の署名用の鍵で署名する

### 4.3 メッセージの文書

| 項目 | 内容 |
|---|---|
| `sender`・`senderDevice` | 送った人と端末 |
| `createdAt` | |
| `epk` | 使い捨ての公開鍵 |
| `keys` | `{ 端末の ID: 包んだ中身の鍵 }` |
| `iv`・`ct` | 暗号化した文字 |
| `photoIds` | 暗号化した写真（4 枚まで） |
| `sig` | 署名 |

- 暗号化の追加データ（AAD）に、やり取りの ID・メッセージの ID・送った人を入れ、別の場所へ写されても読めないようにする
- 署名で、運営者がメッセージを偽って差し込めないようにする。偽の端末を紛れ込ませることは、F-105（相手の端末が増えたら知らせる）で気付けるようにする

### 4.4 読めないとき

- 自分の端末の ID が `keys` にないメッセージは、「この端末では読めません」と示す（F-102）

## 5. Workers の API

| API | 内容 |
|---|---|
| `POST /api/join` | 招待の文字列・メールアドレス・パスワード・18 歳以上の申告を受け取り、招待と人数の上限を確かめてから、アカウントを作り `member` を付ける |
| `POST /api/session` | ログインの証明書を確かめ、写真を見るための cookie（1 時間、HttpOnly、SameSite=Strict）を出す。止めたアカウントも、出した cookie が切れるまでの最長 1 時間は写真を見られる（そのぶん、毎回 Firestore を読まずに済む） |
| `PUT /api/photos` | 写真（元の画像と小さな画像）を受け取り、R2 に保存し、`photos` に記録する。枚数の上限を守る |
| `GET /photos/{id}/{full\|thumb}` | cookie を確かめてから R2 の写真を返す。メッセージの写真は、やり取りの 2 人にだけ返す |
| `POST /api/posts`・`PATCH`・`DELETE` | 投稿を作る・直す・消す |
| `POST /api/stories`・`DELETE` | 24 時間で消える投稿 |
| `POST /api/invites`・`GET`・`DELETE` | 招待を作る（5 件まで）・一覧・取り消し |
| `DELETE /api/account` | アカウントの削除（F-06） |
| `/api/admin/…` | 通報の対応、アカウントの停止、招待の管理（`admin` だけ） |

- 写真は Workers と同じ場所（同じドメイン）から配るので、cookie で確かめられ、`<img>` でそのまま表示できる
- 利用者自身による登録は、Firebase の設定（Authentication → Settings → User actions の「Enable create (sign-up)」を外す）で止め、アカウントは `POST /api/join` からだけ作る

### 定時の実行（Cron Triggers、5 つまで）

| 間隔 | 内容 |
|---|---|
| 1 時間ごと | 時間の過ぎた 24 時間で消える投稿と、その写真を消す |
| 1 日 1 回 | 90 日たった通知、使われなかった写真、期限の切れた招待を消す |

## 6. R2 の構造

- `photos/{photoId}/full.jpg`・`photos/{photoId}/thumb.jpg`
- メッセージの写真は暗号化したもの（`photos/{photoId}/full.bin`）。R2 のメタデータに、やり取りの 2 人の uid を入れ、配るときに Firestore を読まずに確かめる

## 7. 削除

| 対象 | 消すもの |
|---|---|
| 投稿 | 投稿・コメント・いいね・写真（R2 と `photos`）・その投稿への通知 |
| アカウント（F-06） | `users`・`userPrivate`・`usernames`・投稿（上のとおり）・ほかの人の投稿へのコメントといいね・フォロー（する側とされる側）・ブロック・通知・端末・24 時間で消える投稿・その人が入ったやり取り（相手の側からも消す。相手には、やり取りの一覧から消えることで分かる）・未使用の招待・写真。最後に Firebase のアカウント |

- アカウントの削除は Workers が行う。量が多く 1 回の処理に収まらないときは、Cloudflare Queues などで分けて行う（作るときに確かめる）

## 8. 未決事項

| 項目 | 内容 |
|---|---|
| Workers の計算時間 | ログインの証明書の確かめ（RS256）と、Firestore に書くための証明書の作成が、1 回 10 ミリ秒に収まるか |
