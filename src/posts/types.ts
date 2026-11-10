import type { Timestamp } from 'firebase/firestore'

export type PostPhoto = { id: string, width: number, height: number, alt: string }

export type Post = {
  id: string
  author: string
  caption: string
  tags: string[]
  photos: PostPhoto[]
  createdAt: Timestamp | null
}

// 投稿・写真の大きさの決まり（Workers の worker/posts.ts と同じ値）
export const CAPTION_MAX = 2000
export const ALT_MAX = 500
export const PHOTOS_PER_POST = 10
export const PHOTO_LIMIT = 1000
export const PHOTO_WARNING = 900

export function photoUrl(id: string, variant: 'full' | 'thumb'): string {
  return `/photos/${id}/${variant}`
}
