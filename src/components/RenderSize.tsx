import { useEffect, useState } from 'react'
import { LTX25_MAX_PIXELS, LTX25_RESOLUTIONS, ltx25ResolutionLabel } from '../lib/ltx25Resolutions'
import { MINIMAX_VIDEO_RESOLUTION_GROUPS } from '../lib/videoResolutions'

type Orientation = 'landscape' | 'ultrawide' | 'portrait' | 'square'

const imageSizes: Record<string, string[]> = {
  '16:9': ['1024x576', '1344x768', '1536x864', '1920x1080'],
  '3:2': ['1024x672', '1152x768', '1536x1024', '1920x1280'],
  '4:3': ['1024x768', '1280x960', '1536x1152', '1920x1440'],
  '1:1': ['768x768', '1024x1024', '1536x1536'],
  '4:5': ['768x960', '1024x1280', '1536x1920'],
  '3:4': ['768x1024', '960x1280', '1152x1536', '1440x1920'],
  '2:3': ['672x1024', '768x1152', '1024x1536', '1280x1920'],
  '9:16': ['576x1024', '768x1344', '864x1536', '1080x1920'],
}

export function RenderSize({ value, onChange, provider = 'minimax' }: { value: string; onChange(value: string): void; provider?: 'minimax' | 'ltx25' | 'zimage' }) {
  const [w, h] = value.split('x').map(Number)
  const orientation: Orientation = w === h ? 'square' : w / h >= 2.1 ? 'ultrawide' : w > h ? 'landscape' : 'portrait'
  const resolutionOptions: Record<Orientation, readonly string[]> = provider === 'ltx25' ? LTX25_RESOLUTIONS : MINIMAX_VIDEO_RESOLUTION_GROUPS
  const listed = resolutionOptions[orientation].includes(value)
  const [custom, setCustom] = useState(!listed)
  const [customWidth, setCustomWidth] = useState(Number.isFinite(w) ? w : 1344)
  const [customHeight, setCustomHeight] = useState(Number.isFinite(h) ? h : 768)
  useEffect(() => {
    const [nextWidth, nextHeight] = value.split('x').map(Number)
    if (Number.isFinite(nextWidth) && Number.isFinite(nextHeight)) {
      setCustomWidth(nextWidth); setCustomHeight(nextHeight)
    }
    setCustom(!Object.values(resolutionOptions).some((options) => options.includes(value)))
  }, [resolutionOptions, value])
  if (provider === 'zimage') {
    const ratio = Object.entries(imageSizes).find(([, options]) => options.includes(value))?.[0] ?? (w === h ? '1:1' : w > h ? '16:9' : '9:16')
    const area = w * h
    return <fieldset className="render-size image-render-size"><legend>Image canvas</legend>
      <label>Aspect ratio<select value={ratio} onChange={(event) => {
        const options = imageSizes[event.target.value]
        onChange(options.reduce((best, option) => {
          const [ow, oh] = option.split('x').map(Number)
          const [bw, bh] = best.split('x').map(Number)
          return Math.abs(ow * oh - area) < Math.abs(bw * bh - area) ? option : best
        }))
      }}>{Object.keys(imageSizes).map((option) => <option key={option} value={option}>{imageRatioLabel(option)}</option>)}</select></label>
      <label>Resolution<select value={value} onChange={(event) => onChange(event.target.value)}>{imageSizes[ratio].map((size) => <option key={size} value={size}>{size.replace('x', ' × ')} · {imageQualityLabel(size)}</option>)}</select></label>
      <p className="field-help">Z-Image canvas · {(area / 1e6).toFixed(2)} megapixels. Larger canvases use more VRAM and take longer to render.</p>
    </fieldset>
  }
  const maxPixels = provider === 'minimax' ? 1344 * 768 : LTX25_MAX_PIXELS
  const validCustom = customWidth >= 256 && customHeight >= 256 && customWidth % 32 === 0 && customHeight % 32 === 0 && customWidth * customHeight <= maxPixels
  const applyCustom = (width: number, height: number) => {
    setCustomWidth(width); setCustomHeight(height)
    if (width >= 256 && height >= 256 && width % 32 === 0 && height % 32 === 0 && width * height <= maxPixels) onChange(`${width}x${height}`)
  }
  return <fieldset className="render-size"><legend>Output size</legend>
    <label>Orientation<select value={orientation} onChange={(e) => {
      const next = e.target.value as Orientation
      const options = resolutionOptions[next]
      const recommended = next === 'landscape' ? '1056x608' : next === 'ultrawide' ? '1216x512' : ''
      const preferred = recommended && options.includes(recommended) ? recommended : options.reduce((best, size) => Math.abs(size.split('x').map(Number).reduce((product, dimension) => product * dimension, 1) - w * h) < Math.abs(best.split('x').map(Number).reduce((product, dimension) => product * dimension, 1) - w * h) ? size : best)
      onChange(preferred)
    }}><option value="landscape">Landscape · 16:9</option><option value="ultrawide">Ultrawide · 21:9</option><option value="portrait">Portrait · 9:16</option><option value="square">Square · 1:1</option></select></label>
    <label>Resolution<select value={custom ? '__custom' : value} onChange={(e) => { if (e.target.value === '__custom') setCustom(true); else { setCustom(false); onChange(e.target.value) } }}>{resolutionOptions[orientation].map((size) => <option key={size} value={size}>{size.replace('x', ' × ')}{provider === 'minimax' ? ` · ${qualityLabel(size)}` : provider === 'ltx25' ? ` · ${ltx25ResolutionLabel(size)}` : ''}</option>)}<option value="__custom">Custom…</option></select></label>
    {custom && <div className="custom-resolution" role="group" aria-label="Custom output resolution"><label>Width<input type="number" min="256" max="1920" step="32" value={customWidth} aria-invalid={!validCustom} onChange={(event) => applyCustom(Number(event.target.value), customHeight)} /></label><span aria-hidden="true">×</span><label>Height<input type="number" min="256" max="1920" step="32" value={customHeight} aria-invalid={!validCustom} onChange={(event) => applyCustom(customWidth, Number(event.target.value))} /></label></div>}
    <p className={`field-help ${custom && !validCustom ? 'error' : ''}`}>{custom && !validCustom ? `Use multiples of 32, at least 256 × 256, within ${(maxPixels / 1e6).toFixed(2)} megapixels. ` : ''}{provider === 'ltx25' ? '1056 × 608 (16:9) and 1216 × 512 (21:9) are quality-and-speed recommendations with comparable pixel counts. Quality mode generates at half size before the official latent 2× refinement stage.' : '1056 × 608 (16:9) and 1216 × 512 (21:9) are quality-and-speed recommendations with comparable pixel counts. All choices are 32-pixel aligned and input crops follow this size.'} {(w * h / 1e6).toFixed(2)} megapixels{provider === 'minimax' && (value === '1344x768' || value === '768x1344') ? ' · native 768p' : ''}</p>
  </fieldset>
}

function imageRatioLabel(ratio: string) {
  if (ratio === '16:9') return 'Widescreen · 16:9'
  if (ratio === '3:2') return 'Photo landscape · 3:2'
  if (ratio === '4:3') return 'Classic landscape · 4:3'
  if (ratio === '1:1') return 'Square · 1:1'
  if (ratio === '4:5') return 'Portrait · 4:5'
  if (ratio === '3:4') return 'Classic portrait · 3:4'
  if (ratio === '2:3') return 'Photo portrait · 2:3'
  return 'Vertical · 9:16'
}

function imageQualityLabel(size: string) {
  const [width, height] = size.split('x').map(Number)
  const pixels = width * height
  if (pixels >= 2_000_000) return 'Maximum'
  if (pixels >= 1_300_000) return 'High'
  if (pixels >= 900_000) return 'Standard'
  return 'Fast'
}

function qualityLabel(size: string) {
  if (size === '1056x608' || size === '1216x512') return 'Recommended · quality + speed'
  const [width, height] = size.split('x').map(Number)
  const short = Math.min(width, height)
  if (short >= 768) return 'Native quality'
  if (short >= 640) return 'Balanced'
  if (short >= 480) return 'Preview'
  return 'Draft'
}
