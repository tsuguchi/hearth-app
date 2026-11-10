import { Fragment, type ReactNode, useEffect } from 'react'
import { Link } from 'react-router'
import privacy from '../../PRIVACY_POLICY.md?raw'
import terms from '../../TERMS.md?raw'
import { EmulatorBanner } from '../components/AuthLayout'
import { Logo } from '../components/ui'

const linkClass = 'text-accent-text underline underline-offset-4 hover:decoration-2'

// 文の中の URL とメールアドレスをリンクにする
function inline(text: string): ReactNode[] {
  return text.split(/(https:\/\/[^\s）)]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g).map((part, index) => {
    if (part.startsWith('https://')) return <a key={index} href={part} className={linkClass} target="_blank" rel="noreferrer">{part}</a>
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(part)) return <a key={index} href={`mailto:${part}`} className={linkClass}>{part}</a>
    return part
  })
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
}

// TERMS.md・PRIVACY_POLICY.md を画面にする。使っている書き方（見出し・段落・箇条書き・表）だけに対応した、HTML を差し込まない変換
function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '' || line.startsWith('# ')) {
      // ページの見出し（# ）は画面の h1 で出すので飛ばす
      i++
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={i} className="mt-4 text-subtitle font-bold">{line.slice(3)}</h2>)
      i++
    } else if (line.startsWith('### ')) {
      blocks.push(<h3 key={i} className="font-bold">{line.slice(4)}</h3>)
      i++
    } else if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2))
      blocks.push(<ul key={i} className="flex list-disc flex-col gap-1 pl-6">{items.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>)
    } else if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) rows.push(cells(lines[i++]))
      const [header, , ...body] = rows
      blocks.push(
        <div key={i} className="overflow-x-auto">
          <table className="w-full border-collapse text-note">
            <thead>
              <tr className="border-b border-border text-left">
                {header.map((cell, index) => <th key={index} scope="col" className="py-2 pr-3 align-top">{cell}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-divider">
                  {row.map((cell, index) => <td key={index} className="py-2 pr-3 align-top">{inline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
    } else {
      // 続いた行は、改行を残して 1 つの段落にする
      const paragraph: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(#|- |\|)/.test(lines[i])) paragraph.push(lines[i++])
      blocks.push(
        <p key={i}>
          {paragraph.map((text, index) => <Fragment key={index}>{index > 0 && <br />}{inline(text)}</Fragment>)}
        </p>,
      )
    }
  }
  return blocks
}

const DOCUMENTS = {
  terms: { title: '利用規約', source: terms },
  privacy: { title: 'プライバシーポリシー', source: privacy },
}

// 利用規約とプライバシーポリシー。ログインしていなくても読める
export function LegalPage({ kind }: { kind: keyof typeof DOCUMENTS }) {
  const { title, source } = DOCUMENTS[kind]

  useEffect(() => {
    document.title = `${title}｜ハース`
  }, [title])

  return (
    <>
      <EmulatorBanner />
      <header className="border-b border-divider">
        <div className="mx-auto flex max-w-150 items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-subtitle"><Logo /></Link>
          <Link to="/" className={`text-note font-bold ${linkClass}`}>アプリに戻る</Link>
        </div>
      </header>
      <main className="mx-auto max-w-150 px-4 py-8">
        <h1 className="text-title font-bold">{title}</h1>
        <div className="mt-6 flex flex-col gap-4">{renderMarkdown(source)}</div>
      </main>
    </>
  )
}
