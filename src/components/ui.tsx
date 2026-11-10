import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { Link } from 'react-router'
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react'

// ハースの基本の部品。見た目は DESIGN.md、押せる部分は 44px 四方以上

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'text'
  // 処理中は押せなくする。disabled ではなく aria-disabled にして、読み上げで見つけられるようにする
  busy?: boolean
}

const BUTTON_STYLES = {
  primary: 'bg-accent text-on-accent hover:brightness-110',
  secondary: 'border border-border bg-surface text-text hover:bg-bg',
  text: 'text-accent-text underline underline-offset-4 hover:decoration-2',
}

export function Button({ variant = 'primary', busy = false, className = '', onClick, type = 'button', children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      aria-disabled={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-bold transition aria-disabled:cursor-wait aria-disabled:opacity-70 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  support?: ReactNode
  error?: string | null
}

export function TextField({ label, support, error, className = '', ...props }: TextFieldProps) {
  const id = useId()
  const supportId = `${id}-support`
  const errorId = `${id}-error`
  const describedBy = [support ? supportId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="font-bold">{label}</label>
      {support && <p id={supportId} className="text-note text-muted">{support}</p>}
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="min-h-12 rounded-lg border border-border bg-surface px-3 text-body aria-invalid:border-2 aria-invalid:border-error"
        {...props}
      />
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </div>
  )
}

export function CheckboxField({ label, error, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { label: ReactNode, error?: string | null }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className="mt-1 size-6 shrink-0 accent-accent"
          {...props}
        />
        <label htmlFor={id} className="min-h-8">{label}</label>
      </div>
      {error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}
    </div>
  )
}

function ErrorText({ id, children }: { id: string, children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1 text-note font-bold text-error">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

// 知らせ。色だけに頼らず、記号と文字で伝える
export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info', children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'success' ? CheckCircle2 : Info
  const color = tone === 'error' ? 'border-error text-error' : tone === 'success' ? 'border-success text-success' : 'border-border text-text'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-lg border-2 bg-surface p-3 ${color}`}>
      <Icon aria-hidden className="mt-1 size-5 shrink-0" />
      <div className="text-text">{children}</div>
    </div>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  return <span className={`font-logo font-bold tracking-wider text-accent-text ${className}`}>ハース</span>
}

// アプリの中の別の画面へのリンク
export function TextLink({ to, children }: { to: string, children: ReactNode }) {
  return <Link to={to} className="text-accent-text underline underline-offset-4 hover:decoration-2">{children}</Link>
}
