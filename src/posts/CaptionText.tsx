import { Fragment } from 'react'
import { Link } from 'react-router'

// タグの書き方は Workers の extractTags（worker/posts.ts）と同じ。文末の句読点はタグに含めない
const TAG = /#([^\s#]+?)([.,!?。、！？」』）)]*)(?=\s|#|$)/gu

export function normalizeTag(tag: string): string {
  return tag.normalize('NFKC').replace(/^#/, '').trim().toLowerCase()
}

// 説明文。「#言葉」をタグの検索へのリンクにする（F-25、F-71）
export function CaptionText({ text }: { text: string }) {
  const parts: (string | { tag: string, raw: string })[] = []
  let last = 0
  for (const match of text.matchAll(TAG)) {
    const start = match.index
    parts.push(text.slice(last, start))
    parts.push({ tag: normalizeTag(match[1]), raw: `#${match[1]}` })
    last = start + 1 + match[1].length
  }
  parts.push(text.slice(last))

  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => (typeof part === 'string' ? <Fragment key={index}>{part}</Fragment> : (
        <Link key={index} to={`/search?tag=${encodeURIComponent(part.tag)}`} className="text-accent-text hover:underline hover:underline-offset-4">
          {part.raw}
        </Link>
      )))}
    </p>
  )
}
