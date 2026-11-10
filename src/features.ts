// 機能の切り替え。組み立てるときの設定（.env.local・.env.production.local）で決める
//
// メッセージ（F-60〜）は、電気通信事業法の届出が要るかを確かめるまで、本番では出さない。
// 画面を出すかどうかはここで、実際に送れるかどうかは config/app の messagesEnabled（Security Rules と Workers）で決める
export const messagesEnabled = import.meta.env.VITE_MESSAGES_ENABLED === 'true'
