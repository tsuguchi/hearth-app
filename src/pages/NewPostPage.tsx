import { ArrowDown, ArrowUp, ImagePlus, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api, ApiError } from '../api'
import { AppShell } from '../components/AppShell'
import { Button, Notice, TextAreaField, TextField } from '../components/ui'
import { processImage, type ProcessedPhoto, UnsupportedImageError } from '../photos/processImage'
import { ALT_MAX, CAPTION_MAX, PHOTO_LIMIT, PHOTO_WARNING, PHOTOS_PER_POST } from '../posts/types'
import { usePhotoCount } from '../profile/usePhotoCount'

// uploadedId: 送り終えた写真の ID。途中で失敗してやり直すときは、送り直さずに使う
type Draft = ProcessedPhoto & { key: string, name: string, previewUrl: string, alt: string, uploadedId?: string }

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif'

// 写真 1〜10 枚と説明文で投稿する（F-20〜F-23、F-25〜F-28）
export function NewPostPage({ uid }: { uid: string }) {
  const navigate = useNavigate()
  const photoCount = usePhotoCount(uid)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [caption, setCaption] = useState('')
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const draftsRef = useRef<Draft[]>([])
  draftsRef.current = drafts

  // 画面を離れるときに、見本の画像のための URL を片付ける
  useEffect(() => () => draftsRef.current.forEach((draft) => URL.revokeObjectURL(draft.previewUrl)), [])

  const remaining = photoCount === null ? null : PHOTO_LIMIT - photoCount
  const busy = preparing || progress !== null

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    setPhotosError(null)
    const room = PHOTOS_PER_POST - drafts.length
    if (files.length > room) setPhotosError(`1 つの投稿に入れられる写真は ${PHOTOS_PER_POST} 枚までです。先頭の ${room} 枚だけを加えました。`)

    setPreparing(true)
    const added: Draft[] = []
    const failed: string[] = []
    for (const file of files.slice(0, room)) {
      try {
        const processed = await processImage(file)
        added.push({ ...processed, key: crypto.randomUUID(), name: file.name, previewUrl: URL.createObjectURL(processed.thumb), alt: '' })
      } catch (error) {
        if (!(error instanceof UnsupportedImageError)) throw error
        failed.push(file.name)
      }
    }
    if (failed.length > 0) {
      setPhotosError(`読み込めない写真がありました（${failed.join('、')}）。JPEG・PNG の写真か、iPhone の写真なら Safari から選んでください。`)
    }
    setDrafts((current) => [...current, ...added])
    setPreparing(false)
  }

  function update(key: string, change: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)))
  }

  function move(index: number, step: number) {
    setDrafts((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(index + step, 0, item)
      return next
    })
  }

  function removeDraft(key: string) {
    setDrafts((current) => {
      const target = current.find((draft) => draft.key === key)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((draft) => draft.key !== key)
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    if (drafts.length === 0) {
      setPhotosError('写真を 1 枚以上選んでください。')
      fileInput.current?.focus()
      return
    }
    if (caption.length > CAPTION_MAX || drafts.some((draft) => draft.alt.length > ALT_MAX)) {
      setMessage('文字数が多すぎる欄があります。赤く示した欄を直してください。')
      return
    }
    if (remaining !== null && drafts.length > remaining) {
      setMessage(`写真の上限（${PHOTO_LIMIT} 枚）を超えます。いまはあと ${Math.max(0, remaining)} 枚まで送れます。古い投稿を削除すると空きます。`)
      return
    }

    try {
      const ids: string[] = []
      for (const [index, draft] of drafts.entries()) {
        if (draft.uploadedId) {
          ids.push(draft.uploadedId)
          continue
        }
        setProgress(`写真を送っています（${index + 1} / ${drafts.length}）…`)
        const form = new FormData()
        form.set('kind', 'post')
        form.set('width', String(draft.width))
        form.set('height', String(draft.height))
        form.set('full', draft.full, 'full.jpg')
        form.set('thumb', draft.thumb, 'thumb.jpg')
        const result = await api<{ id: string }>('/api/photos', { method: 'POST', body: form })
        ids.push(result.id)
        update(draft.key, { uploadedId: result.id })
      }
      setProgress('投稿しています…')
      await api('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ caption, photos: drafts.map((draft, index) => ({ id: ids[index], alt: draft.alt })) }),
      })
      navigate('/')
    } catch (error) {
      setMessage(postErrorMessage(error))
      setProgress(null)
    }
  }

  return (
    <AppShell title="投稿">
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        {message && <Notice tone="error">{message}</Notice>}
        {remaining !== null && remaining <= PHOTO_LIMIT - PHOTO_WARNING && (
          <Notice tone="info">写真はあと {Math.max(0, remaining)} 枚まで送れます（上限 {PHOTO_LIMIT} 枚）。古い投稿を削除すると空きます。</Notice>
        )}

        <section aria-labelledby="photos-heading" className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <h2 id="photos-heading" className="text-subtitle font-bold">写真（{drafts.length} / {PHOTOS_PER_POST} 枚）</h2>
          <p className="text-note text-muted">写真は送る前にこの端末の中で縮め、撮影場所などの情報を取り除きます。</p>
          {photosError && <Notice tone="error">{photosError}</Notice>}

          <ol className="flex flex-col gap-4">
            {drafts.map((draft, index) => (
              <li key={draft.key} className="flex flex-col gap-3 border-t border-divider pt-4 first:border-t-0 first:pt-0 desktop:flex-row">
                <img src={draft.previewUrl} alt="" className="size-28 shrink-0 rounded-lg object-cover" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <TextField
                    label={`${index + 1} 枚目の説明（代替テキスト）`}
                    support="目の見えにくい人のために、写っているものを短く書いてください（例: 夕日に染まる海辺を歩く犬）。"
                    value={draft.alt}
                    error={draft.alt.length > ALT_MAX ? `${ALT_MAX} 文字までにしてください。` : null}
                    onChange={(event) => update(draft.key, { alt: event.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" aria-disabled={index === 0 || undefined} onClick={() => index > 0 && move(index, -1)}>
                      <ArrowUp aria-hidden className="size-5" />前へ
                    </Button>
                    <Button variant="secondary" aria-disabled={index === drafts.length - 1 || undefined} onClick={() => index < drafts.length - 1 && move(index, 1)}>
                      <ArrowDown aria-hidden className="size-5" />後ろへ
                    </Button>
                    <Button variant="secondary" onClick={() => removeDraft(draft.key)}>
                      <X aria-hidden className="size-5" />取り除く<span className="sr-only">（{index + 1} 枚目）</span>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {drafts.length < PHOTOS_PER_POST && (
            <div>
              <input ref={fileInput} id="photo-input" type="file" accept={ACCEPT} multiple onChange={addFiles} className="peer sr-only" />
              <label
                htmlFor="photo-input"
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-5 font-bold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                <ImagePlus aria-hidden className="size-5" />
                {preparing ? '写真を準備しています…' : '写真を選ぶ'}
              </label>
              <p className="mt-1 text-note text-muted">JPEG・PNG・HEIC（iPhone の写真）。あと {PHOTOS_PER_POST - drafts.length} 枚選べます。</p>
            </div>
          )}
        </section>

        <TextAreaField
          label="説明文"
          support="「#」で始まる言葉はタグになり、あとでタグで探せます（例: #紅葉）。"
          value={caption}
          maxLength={CAPTION_MAX}
          onChange={(event) => setCaption(event.target.value)}
        />

        {progress && <p role="status" className="font-bold">{progress}</p>}
        <div>
          <Button type="submit" busy={busy}>{progress ? '投稿しています…' : '投稿する'}</Button>
        </div>
      </form>
    </AppShell>
  )
}

function postErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '投稿できませんでした。もう一度お試しください。'
  switch (error.code) {
    case 'photo_limit':
      return `写真の上限（${PHOTO_LIMIT} 枚）に達しました。古い投稿を削除すると空きます。`
    case 'too_large':
      return '写真が大きすぎます。別の写真を選んでください。'
    case 'network':
      return 'インターネットにつながっていないようです。接続を確かめて、もう一度「投稿する」を押してください。'
    case 'unauthorized':
      return 'ログインの期限が切れました。ページを読み込み直してください。'
    default:
      return '投稿できませんでした。もう一度お試しください。'
  }
}
