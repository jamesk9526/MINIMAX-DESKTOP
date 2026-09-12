import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Images } from 'lucide-react'
import { drawPreparedImage, resolveImageBackground } from '../lib/imageCrop'
import type { MediaFile } from '../types'

type Inspection = { width: number; height: number; warnings: string[]; error?: string }

function roleName(file: MediaFile, fallback: string) {
  if (file.referenceType) return file.referenceType.replace('-', ' ')
  if (file.referenceRole) return file.referenceRole.replace('-', ' / ')
  return fallback
}

function ReferenceHandoffCard({ file, label, index, width, height, onInspection }: { file: MediaFile; label: string; index: number; width: number; height: number; onInspection(index: number, value: Inspection): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [inspection, setInspection] = useState<Inspection>({ width: 0, height: 0, warnings: [] })
  useEffect(() => {
    let alive = true
    const inspect = async () => {
      try {
        const preview = file.preview || await window.minimax.fileDataUrl(file.path)
        const source = new Image()
        source.src = preview
        await source.decode()
        const prepared = document.createElement('canvas')
        await drawPreparedImage(prepared, file, width, height)
        if (!alive || !canvas.current) return
        canvas.current.width = width
        canvas.current.height = height
        canvas.current.getContext('2d')!.drawImage(prepared, 0, 0)
        const sourceRatio = source.naturalWidth / source.naturalHeight
        const targetRatio = width / height
        const ratioDifference = Math.max(sourceRatio, targetRatio) / Math.min(sourceRatio, targetRatio)
        const warnings = [
          Math.min(source.naturalWidth, source.naturalHeight) < 512 ? 'Low source resolution may weaken fine details.' : '',
          ratioDifference > 1.65 && (file.crop?.fit ?? 'crop') === 'crop' ? 'Heavy aspect crop—check that the important subject remains visible.' : '',
          file.referenceType === 'face' && source.naturalWidth < 640 ? 'Face anchor is relatively small; a tighter, sharper source may hold identity better.' : '',
        ].filter(Boolean)
        const next = { width: source.naturalWidth, height: source.naturalHeight, warnings }
        setInspection(next); onInspection(index, next)
      } catch (error) {
        if (!alive) return
        const next = { width: 0, height: 0, warnings: [], error: error instanceof Error ? error.message : String(error) }
        setInspection(next); onInspection(index, next)
      }
    }
    void inspect()
    return () => { alive = false }
  }, [file, height, index, onInspection, width])
  const fit = file.crop?.fit ?? 'crop'
  const treatment = fit === 'crop' ? 'edge crop' : resolveImageBackground(file) === 'neutral' ? 'neutral plate' : 'scene extension'
  return <article className={`reference-handoff-card ${inspection.error ? 'error' : inspection.warnings.length ? 'warning' : 'ready'}`}>
    <div className="reference-handoff-preview"><canvas ref={canvas} aria-label={`Prepared handoff preview for Picture ${index + 1}`} />{inspection.error && <span>Preview unavailable</span>}</div>
    <div className="reference-handoff-card-body"><header><code>{`<Picture ${index + 1}>`}</code>{inspection.error || inspection.warnings.length ? <AlertTriangle size={13} /> : <Check size={13} />}</header><strong title={label}>{label}</strong><small>{roleName(file, 'reference')} · {file.referenceRetention === 'preserve' ? 'must preserve' : 'guided'} · {treatment}</small><small>{inspection.width ? `${inspection.width} × ${inspection.height} source → ${width} × ${height}` : `${width} × ${height} target`}</small>{inspection.warnings.map((warning) => <p key={warning}>{warning}</p>)}{inspection.error && <p>{inspection.error}</p>}</div>
  </article>
}

export function ReferenceHandoffInspector({ files, labels, resolution }: { files: MediaFile[]; labels: string[]; resolution: string }) {
  const [inspections, setInspections] = useState<Record<number, Inspection>>({})
  const [width, height] = resolution.split('x').map(Number)
  const duplicates = useMemo(() => files.filter((file, index) => files.findIndex((item) => item.path === file.path) !== index).length, [files])
  const warnings = files.reduce((total, _file, index) => total + (inspections[index]?.warnings.length ?? 0) + Number(Boolean(inspections[index]?.error)), 0) + duplicates
  const updateInspection = useCallback((index: number, value: Inspection) => setInspections((current) => ({ ...current, [index]: value })), [])
  if (!files.length) return <div className="reference-handoff-empty"><Images size={17} /><span><strong>No prepared pictures yet</strong><small>Select a library asset or add a standalone picture to inspect the handoff.</small></span></div>
  return <div className="reference-handoff-inspector">
    <div className={`reference-handoff-status ${warnings ? 'warning' : 'ready'}`}>{warnings ? <AlertTriangle size={15} /> : <Check size={15} />}<span><strong>{warnings ? `${warnings} handoff warning${warnings === 1 ? '' : 's'}` : 'Reference handoff ready'}</strong><small>These are the exact aspect-ratio preparations and slot assignments that will be uploaded.</small></span></div>
    <div className="reference-handoff-grid">{files.map((file, index) => <ReferenceHandoffCard key={`${file.path}-${index}`} file={file} label={labels[index] ?? file.name} index={index} width={width} height={height} onInspection={updateInspection} />)}</div>
    {duplicates > 0 && <p className="reference-handoff-duplicate"><AlertTriangle size={13} />{duplicates} duplicate image slot{duplicates === 1 ? '' : 's'} detected. Duplicates consume the nine-picture budget without adding coverage.</p>}
  </div>
}
