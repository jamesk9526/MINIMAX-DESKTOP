import type { MediaFile } from '../types'

export const defaultCrop = { x: 0.5, y: 0.5, zoom: 1, fit: 'crop' as const, background: 'auto' as const }
export const defaultCharacterCrop = { x: 0.5, y: 0.5, zoom: 1, fit: 'contain' as const, background: 'auto' as const }

export function fitWholeCharacter(file: MediaFile): MediaFile {
  return file.crop ? file : { ...file, crop: { ...defaultCharacterCrop } }
}

export function cropRect(sw: number, sh: number, width: number, height: number, crop = defaultCrop as NonNullable<MediaFile['crop']>) {
  const scale = Math.max(width / sw, height / sh) * Math.max(1, crop.zoom)
  const w = width / scale
  const h = height / scale
  return { x: Math.max(0, sw - w) * Math.max(0, Math.min(1, crop.x)), y: Math.max(0, sh - h) * Math.max(0, Math.min(1, crop.y)), w, h }
}

/**
 * Keeps a complete portrait or reference board visible without teaching the
 * video model that black side-bars are part of the source. A softly blurred,
 * slightly enlarged copy fills the target aspect ratio behind the sharp
 * foreground. It is deliberately rendered into the uploaded image, not just
 * the editor preview, so ComfyUI receives one full-frame image.
 */
function drawSmartFillBackground(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * 1.08
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.save()
  ctx.fillStyle = '#161616'
  ctx.fillRect(0, 0, width, height)
  ctx.filter = 'blur(28px) saturate(0.92) brightness(0.82)'
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
  ctx.restore()
}

function averageImageColor(image: CanvasImageSource, sourceWidth: number, sourceHeight: number) {
  try {
    const sample = document.createElement('canvas')
    sample.width = 24
    sample.height = 24
    const context = sample.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, sample.width, sample.height)
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data
    let red = 0, green = 0, blue = 0, weight = 0
    for (let y = 0; y < sample.height; y += 1) for (let x = 0; x < sample.width; x += 1) {
      if (x > 2 && x < sample.width - 3 && y > 2 && y < sample.height - 3) continue
      const index = (y * sample.width + x) * 4
      const alpha = pixels[index + 3] / 255
      red += pixels[index] * alpha; green += pixels[index + 1] * alpha; blue += pixels[index + 2] * alpha; weight += alpha
    }
    return weight ? [Math.round(red / weight), Math.round(green / weight), Math.round(blue / weight)] as const : [28, 28, 28] as const
  } catch { return [28, 28, 28] as const }
}

function drawNeutralBackground(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const [red, green, blue] = averageImageColor(image, sourceWidth, sourceHeight)
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, `rgb(${Math.max(0, red - 16)} ${Math.max(0, green - 16)} ${Math.max(0, blue - 16)})`)
  gradient.addColorStop(0.5, `rgb(${red} ${green} ${blue})`)
  gradient.addColorStop(1, `rgb(${Math.min(255, red + 12)} ${Math.min(255, green + 12)} ${Math.min(255, blue + 12)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

export function resolveImageBackground(file: MediaFile) {
  const selected = file.crop?.background ?? 'auto'
  if (selected !== 'auto') return selected
  return file.referenceType && file.referenceType !== 'other' ? 'neutral' : file.referenceRole === 'subject' || file.referenceRole === 'wardrobe' || file.referenceRole === 'prop' ? 'neutral' : 'smart'
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
  ctx.imageSmoothingQuality = 'high'
  const crop = file.crop ?? defaultCrop
  if (crop.fit === 'contain') {
    if (resolveImageBackground(file) === 'neutral') drawNeutralBackground(ctx, img, img.naturalWidth, img.naturalHeight, width, height)
    else drawSmartFillBackground(ctx, img, img.naturalWidth, img.naturalHeight, width, height)
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight)
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h)
  } else {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)
    const rect = cropRect(img.naturalWidth, img.naturalHeight, width, height, crop)
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height)
  }
}

export async function prepareImage(file: MediaFile, width: number, height: number) {
  const canvas = document.createElement('canvas')
  await drawPreparedImage(canvas, file, width, height)
  return canvas.toDataURL('image/png')
}
