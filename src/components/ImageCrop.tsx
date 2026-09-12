import { useEffect, useRef, useState } from 'react'
import type { MediaFile, ReferenceHandoffRole, ReferenceRetention } from '../types'
import { defaultCrop, drawPreparedImage, resolveImageBackground } from '../lib/imageCrop'

const referenceRoles: Array<{ value: ReferenceHandoffRole; label: string }> = [
  { value: 'subject', label: 'Subject / identity' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'prop', label: 'Prop / product' },
  { value: 'location', label: 'Location / set' },
  { value: 'composition', label: 'Composition / pose' },
  { value: 'lighting-style', label: 'Lighting / style' },
]

export function ImageCrop({ file, resolution, onChange, label, handoff = false }: { file: MediaFile; resolution: string; onChange(file: MediaFile): void; label: string; handoff?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const crop = file.crop ?? defaultCrop
  useEffect(() => {
    let alive = true
    const [width, height] = resolution.split('x').map(Number)
    const prepared = document.createElement('canvas')
    void drawPreparedImage(prepared, file, width, height).then(() => {
      if (!alive || !canvas.current) return
      canvas.current.width = width
      canvas.current.height = height
      canvas.current.getContext('2d')!.drawImage(prepared, 0, 0)
      setError('')
    }).catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [file, resolution])
  return <section className="crop-editor" aria-label={`${label} crop`}>
    <canvas ref={canvas} aria-label={`${label} output crop preview`} />
    {error && <p role="alert">{error}</p>}
    <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide crop controls' : 'Adjust crop'} · {resolution.replace('x', ' × ')}</button>
    {open && <div className="crop-controls">
      {handoff && <div className="reference-handoff-fields"><label>Reference role<select value={file.referenceRole ?? 'composition'} onChange={(event) => onChange({ ...file, referenceRole: event.target.value as ReferenceHandoffRole })}>{referenceRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label><label>Retention<select value={file.referenceRetention ?? 'guide'} onChange={(event) => onChange({ ...file, referenceRetention: event.target.value as ReferenceRetention })}><option value="guide">Guide only</option><option value="preserve">Must preserve</option></select></label></div>}
      <label>Image fitting<select value={crop.fit} onChange={(e) => onChange({ ...file, crop: { ...crop, fit: e.target.value as 'crop' | 'contain' } })}><option value="crop">Fill frame · crop edges</option><option value="contain">Fit whole image · smart background fill</option></select></label>
      {crop.fit === 'contain' && <label>Background treatment<select value={crop.background ?? 'auto'} onChange={(event) => onChange({ ...file, crop: { ...crop, background: event.target.value as 'auto' | 'smart' | 'neutral' } })}><option value="auto">Auto · {resolveImageBackground(file) === 'neutral' ? 'neutral plate' : 'scene extension'}</option><option value="neutral">Neutral color-matched plate</option><option value="smart">Blurred scene extension</option></select></label>}
      {(['x', 'y', 'zoom'] as const).map((key) => <label key={key}>{key === 'x' ? 'Horizontal position' : key === 'y' ? 'Vertical position' : 'Zoom'}<input type="range" min={key === 'zoom' ? 1 : 0} max={key === 'zoom' ? 4 : 1} step="0.01" value={crop[key]} disabled={crop.fit === 'contain'} onChange={(e) => onChange({ ...file, crop: { ...crop, [key]: Number(e.target.value) } })} /><output>{key === 'zoom' ? `${crop[key].toFixed(2)}×` : `${Math.round(crop[key] * 100)}%`}</output></label>)}
      <button type="button" className="secondary-button" onClick={() => onChange({ ...file, crop: { ...defaultCrop } })}>Reset to automatic center crop</button>
      <p className="field-help">Edits apply immediately to this exact handoff preview. The original image stays intact.</p>
    </div>}
  </section>
}
