import { Link } from 'react-router'

const linkClass = 'text-accent-text underline underline-offset-4 hover:decoration-2'

// 利用規約とプライバシーポリシーへのリンク
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <p className={`flex flex-wrap gap-x-4 gap-y-1 text-note ${className}`}>
      <Link to="/terms" className={linkClass}>利用規約</Link>
      <Link to="/privacy" className={linkClass}>プライバシーポリシー</Link>
    </p>
  )
}
