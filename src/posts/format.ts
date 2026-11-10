// 投稿やコメントの日時を、短く読みやすい形にする（例「3 分前」「11月10日」）
export function formatPostTime(date: Date, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes} 分前`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 時間前`
  const sameYear = date.getFullYear() === now.getFullYear()
  return `${sameYear ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`
}
