import type { MediaFile } from '../types'

export const defaultCrop = { x: 0.5, y: 0.5, zoom: 1, fit: 'crop' as const }
export const defaultCharacterCrop = { x: 0.5, y: 0.5, zoom: 1, fit: 'contain' as const }

export function fitWholeCharacter(file: MediaFile): MediaFile {
  return file.crop ? file : { ...file, crop: { ...defaultCharacterCrop } }
}

export function cropRect(sw: number, sh: number, width: number, height: number, crop = defaultCrop as NonNullable<MediaFile['crop']>) {
  const scale = Math.max(width / sw, height / sh) * Math.max(1, crop.zoom)
  const w = width / scale
  const h = height / scale
  return { x: Math.max(0, sw - w) * Math.max(0, Math.min(1, crop.x)), y: Math.max(0, sh - h) * Math.max(0, Math.min(1, crop.y)), w, h }
}

export async function drawPreparedImage(canvas: HTMLCanvasElement, file: MediaFile, width: number, height: number) {
  const preview = file.preview || await window.minimax.fileDataUrl(file.path).catch(() => '')
  if (!preview) throw new Error(`No preview available for ${file.name}. Choose the image again.`)
  const img = new Image()
  img.src = preview
  await img.decode()
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  const crop = file.crop ?? defaultCrop
  if (crop.fit === 'contain') {
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight)
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
  } else {
    const rect = cropRect(img.naturalWidth, img.naturalHeight, width, height, crop)
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height)
  }
}

export async function prepareImage(file: MediaFile, width: number, height: number) {
  const canvas = document.createElement('canvas')
  await drawPreparedImage(canvas, file, width, height)
  return canvas.toDataURL('image/png')
}
