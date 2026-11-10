// 写真を送る前に、ブラウザの中で縮める（F-23）。
// 描き直して JPEG にするので、撮影場所（位置情報）などの写真の情報は残らない（F-22）。
// iPhone の HEIC は、読み込めるブラウザ（Safari など）なら、ここで JPEG に変わる（F-28）

export const FULL_SIDE = 2048
export const THUMB_SIDE = 640

export type ProcessedPhoto = {
  full: Blob
  thumb: Blob
  width: number
  height: number
}

export class UnsupportedImageError extends Error {}

function fit(width: number, height: number, maxSide: number): { width: number, height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<{ blob: Blob, width: number, height: number }> {
  const size = fit(bitmap.width, bitmap.height, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')!
  // 透明な部分（PNG）は白にする
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new UnsupportedImageError('JPEG にできませんでした')
  return { blob, ...size }
}

export async function processImage(file: File): Promise<ProcessedPhoto> {
  let bitmap: ImageBitmap
  try {
    // 写真の向きの情報（EXIF）は、読み込むときに反映される
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new UnsupportedImageError('この写真の形式は、このブラウザでは読み込めません')
  }
  try {
    const full = await encode(bitmap, FULL_SIDE, 0.85)
    const thumb = await encode(bitmap, THUMB_SIDE, 0.8)
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height }
  } finally {
    bitmap.close()
  }
}
