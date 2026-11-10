import * as Dialog from '@radix-ui/react-dialog'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { type FormEvent, useId, useState } from 'react'
import { Button, Notice, TextAreaField } from '../components/ui'
import { db } from '../firebase'

// 通報（F-82）。理由を選び、補足を書いて運営者に送る。通報したことは相手に知らせない

export type ReportTarget = { type: 'post' | 'comment' | 'user', path: string, user: string, label: string }

const REASONS = [
  { value: 'spam', label: 'スパム・宣伝' },
  { value: 'harassment', label: '嫌がらせ・いじめ' },
  { value: 'inappropriate', label: '不適切な写真や文章' },
  { value: 'privacy', label: '他人の個人情報や、許可のない写真' },
  { value: 'other', label: 'その他' },
] as const

const DETAIL_MAX = 1000

export function ReportDialog({ me, target, onClose }: { me: string, target: ReportTarget, onClose: () => void }) {
  const [reason, setReason] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const groupId = useId()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!reason) {
      setReasonError('理由を 1 つ選んでください。')
      return
    }
    if (detail.length > DETAIL_MAX) return
    setReasonError(null)
    setFailure(null)
    setBusy(true)
    try {
      await addDoc(collection(db, 'reports'), {
        reporter: me,
        targetType: target.type,
        targetPath: target.path,
        targetUser: target.user,
        reason,
        detail: detail.trim(),
        status: 'open',
        createdAt: serverTimestamp(),
      })
      setSent(true)
    } catch {
      setFailure('送れませんでした。もう一度お試しください。')
    }
    setBusy(false)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-40 flex max-h-[90dvh] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-6 shadow-lg">
          <Dialog.Title className="text-subtitle font-bold">{target.label}を通報する</Dialog.Title>
          {sent ? (
            <>
              <Dialog.Description asChild>
                <div>
                  <Notice tone="success">通報を運営者に送りました。内容を確かめて対応します。通報したことは、相手には知らされません。</Notice>
                </div>
              </Dialog.Description>
              <div className="flex justify-end">
                <Dialog.Close asChild><Button>閉じる</Button></Dialog.Close>
              </div>
            </>
          ) : (
            <form onSubmit={submit} noValidate className="flex flex-col gap-4">
              <Dialog.Description>運営者だけが内容を見ます。通報したことは、相手には知らされません。</Dialog.Description>
              {failure && <Notice tone="error">{failure}</Notice>}
              <fieldset aria-describedby={reasonError ? `${groupId}-error` : undefined} className="flex flex-col gap-1">
                <legend className="mb-1 font-bold">理由</legend>
                {REASONS.map((option) => (
                  <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name={groupId}
                      value={option.value}
                      checked={reason === option.value}
                      onChange={() => setReason(option.value)}
                      className="size-5 accent-accent"
                    />
                    {option.label}
                  </label>
                ))}
                {reasonError && <p id={`${groupId}-error`} className="text-note font-bold text-error">{reasonError}</p>}
              </fieldset>
              <TextAreaField
                label="補足（なくてもかまいません）"
                support="何が問題かを書くと、運営者が確かめやすくなります。"
                value={detail}
                maxLength={DETAIL_MAX}
                onChange={(event) => setDetail(event.target.value)}
              />
              <div className="flex flex-wrap justify-end gap-3">
                <Dialog.Close asChild><Button variant="secondary">やめる</Button></Dialog.Close>
                <Button type="submit" busy={busy}>{busy ? '送っています…' : '通報する'}</Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
