import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { photoUrl, type PostPhoto } from './types'

// 投稿の写真。複数枚のときは横に送って見る。何枚目かを文字でも示し、キーボードの左右でも送れる（DESIGN.md の 5 章）
export function PhotoCarousel({ photos, fallbackAlt }: { photos: PostPhoto[], fallbackAlt: string }) {
  const [index, setIndex] = useState(0)
  const photo = photos[index]
  const many = photos.length > 1

  function move(step: number) {
    setIndex((current) => Math.min(photos.length - 1, Math.max(0, current + step)))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') move(1)
    if (event.key === 'ArrowLeft') move(-1)
  }

  const alt = photo.alt || (many ? `${fallbackAlt}（${index + 1} 枚目、説明なし）` : `${fallbackAlt}（説明なし）`)

  return (
    <div
      role={many ? 'group' : undefined}
      aria-roledescription={many ? '写真の切り替え' : undefined}
      aria-label={many ? `写真 ${photos.length} 枚` : undefined}
      tabIndex={many ? 0 : undefined}
      onKeyDown={many ? onKeyDown : undefined}
      className="relative overflow-hidden rounded-xl bg-divider"
    >
      {/* 写真を切り取らずに全体を見せる。縦長の写真は高さに上限を設ける */}
      <img
        key={photo.id}
        src={photoUrl(photo.id, 'full')}
        alt={alt}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        className="mx-auto max-h-[70vh] w-auto object-contain"
        style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
      />
      {many && (
        <>
          <button
            type="button"
            aria-label="前の写真"
            aria-disabled={index === 0 || undefined}
            onClick={() => move(-1)}
            className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow aria-disabled:opacity-40"
          >
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <button
            type="button"
            aria-label="次の写真"
            aria-disabled={index === photos.length - 1 || undefined}
            onClick={() => move(1)}
            className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow aria-disabled:opacity-40"
          >
            <ChevronRight aria-hidden className="size-6" />
          </button>
          <p aria-live="polite" className="absolute top-2 right-2 rounded-full bg-surface/90 px-3 text-note font-bold text-text">
            {index + 1} / {photos.length}
          </p>
        </>
      )}
    </div>
  )
}
