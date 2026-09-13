import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Download, Film, FolderOpen, Image, LoaderCircle, Plus, Save, Scissors, X } from 'lucide-react'
import type { AppSettings, ClipItem, GenerationJob } from '../types'

type VideoMeta = { duration: number; fps: number; frameCount: number; width: number; height: number }
type SavedFrame = { path: string; name: string; index: number; role: 'start' | 'end' | 'frame'; preview?: string }
type ExportResult = {
  path: string
  name: string
  url: string
  folder: string
  frameCount: number
  duration: number
  startFrame: number
  endFrame: number
  width: number
  height: number
  fps: number
}

function clampFrame(value: number, meta: VideoMeta | null) {
  const maximum = Math.max(0, (meta?.frameCount ?? 1) - 1)
  return Math.max(0, Math.min(maximum, Math.floor(Number.isFinite(value) ? value : 0)))
}

function frameTime(frame: number, fps: number) {
  return fps > 0 ? frame / fps : 0
}

function frameLabel(frame: number, width = 4) { return String(frame).padStart(width, '0') }
function clipMasterFolderName(value: string) {
  const stem = value.replace(/\.[^.]+$/, '')
  return (stem || 'clip').replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'clip'
}

export function ClipMasterLaunchpad({ jobs, onChooseLocal, onOpenClip }: { jobs: GenerationJob[]; onChooseLocal(): void; onOpenClip(clip: ClipItem): void }) {
  const clips = useMemo(() => jobs.filter((job) => job.status === 'completed' && job.outputUrl && (job.mediaType ?? 'video') === 'video').map((job) => ({
    id: `clip-master-job-${job.id}`,
    name: job.movieLink ? `Scene render · ${job.movieLink.sceneId}` : job.prompt.trim().replace(/\s+/g, ' ').slice(0, 96) || 'Generated video',
    source: job.outputUrl!,
    duration: job.duration,
    createdAt: job.createdAt,
    resolution: `${job.width} × ${job.height}`,
  })), [jobs])
  return <div className="standard-page clip-master-launchpad">
    <div className="page-heading"><div><p className="eyebrow">BETA · FRAME-ACCURATE EDITING</p><h1>Clip Master Beta</h1><p>Select a completed render or a local video, then open it in the isolated frame editor.</p></div><button className="primary-button" onClick={onChooseLocal}><FolderOpen size={16} />Choose video</button></div>
    <section className="clip-master-picker" aria-labelledby="clip-master-picker-title"><header><div><Film size={18} /><span><strong id="clip-master-picker-title">Select a clip</strong><small>The current Clip Editor remains separate and unchanged.</small></span></div><span>{clips.length} completed render{clips.length === 1 ? '' : 's'}</span></header>{clips.length ? <div className="clip-master-picker-grid">{clips.map((clip) => <button key={clip.id} className="clip-master-picker-item" onClick={() => onOpenClip(clip)}><video src={clip.source} muted preload="metadata" /><span><strong>{clip.name}</strong><small>{clip.resolution} · {clip.duration ?? 0}s</small><em>Open in Clip Master Beta <ChevronRight size={14} /></em></span></button>)}</div> : <div className="clip-master-picker-empty"><Film size={28} /><strong>No completed video renders yet</strong><span>Choose a local video above, or finish a render and return here to select it.</span><button className="secondary-button" onClick={onChooseLocal}><FolderOpen size={15} />Choose video</button></div>}</section>
  </div>
}

export function ClipMasterBeta({ clip, settings, onClose, onNotice, onExportClip }: { clip: ClipItem; settings: AppSettings; onClose(): void; onNotice(tone: 'error' | 'success' | 'neutral', text: string): void; onExportClip?(clip: ClipItem): void }) {
  const dialogRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const noticeRef = useRef(onNotice)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [startFrame, setStartFrame] = useState(0)
  const [endFrame, setEndFrame] = useState(0)
  const [batchFrames, setBatchFrames] = useState<number[]>([])
  const [savedFrames, setSavedFrames] = useState<SavedFrame[]>([])
  const [outputFolder, setOutputFolder] = useState('')
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [busy, setBusy] = useState<'metadata' | 'frames' | 'export' | null>('metadata')
  const [batchInput, setBatchInput] = useState('')
  const [metadataError, setMetadataError] = useState('')
  const [exportError, setExportError] = useState('')

  useEffect(() => { noticeRef.current = onNotice }, [onNotice])

  useEffect(() => {
    let disposed = false
    setBusy('metadata'); setMeta(null); setMetadataError(''); setExportError(''); setSavedFrames([]); setOutputFolder(''); setExportResult(null); setBatchFrames([])
    void window.minimax.getVideoMetadata(clip.source, settings.ffmpegPath).then((value) => {
      if (disposed) return
      setMeta(value)
      setStartFrame(0); setCurrentFrame(0); setEndFrame(Math.max(0, value.frameCount - 1))
      setBusy(null)
    }).catch((error) => { if (!disposed) { const message = error instanceof Error ? error.message : String(error); setBusy(null); setMetadataError(message); noticeRef.current('error', `Clip Master could not read video metadata: ${message}`) } })
    return () => { disposed = true }
  }, [clip.id, clip.source, settings.ffmpegPath])

  useEffect(() => {
    if (meta && videoRef.current) videoRef.current.currentTime = 0
  }, [meta])

  const duration = meta ? (endFrame - startFrame + 1) / meta.fps : 0
  const selectedFrameCount = meta ? endFrame - startFrame + 1 : 0
  const folderName = useMemo(() => clipMasterFolderName(clip.name), [clip.name])
  const setFrame = (value: number) => {
    const next = clampFrame(value, meta)
    setCurrentFrame(next)
    if (videoRef.current && meta) videoRef.current.currentTime = frameTime(next, meta.fps)
  }
  const seekBy = (amount: -1 | 1) => setFrame(currentFrame + amount)
  const setStart = () => { setStartFrame(Math.min(currentFrame, endFrame)); onNotice('success', `Start frame set to ${frameLabel(currentFrame)}.`) }
  const setEnd = () => { setEndFrame(Math.max(currentFrame, startFrame)); onNotice('success', `End frame set to ${frameLabel(currentFrame)}.`) }
  const updateStartFrame = (value: number) => {
    const next = clampFrame(value, meta)
    setStartFrame(next)
    if (next > endFrame) setEndFrame(next)
  }
  const updateEndFrame = (value: number) => {
    const next = clampFrame(value, meta)
    setEndFrame(next)
    if (next < startFrame) setStartFrame(next)
  }
  const addBatchFrame = (value = currentFrame) => {
    const next = clampFrame(value, meta)
    setBatchFrames((items) => items.includes(next) ? items : [...items, next].sort((a, b) => a - b))
  }
  const removeBatchFrame = (value: number) => setBatchFrames((items) => items.filter((item) => item !== value))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])')].filter((item) => item.offsetParent !== null)
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); return }
        if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); return }
      }
      if (target?.closest('input, textarea, select, button, video, [contenteditable="true"]')) return
      if (event.key === 'Escape') onClose()
      else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && meta) {
        event.preventDefault()
        const amount = event.key === 'ArrowLeft' ? -1 : 1
        setCurrentFrame((value) => {
          const next = clampFrame(value + amount, meta)
          if (videoRef.current) videoRef.current.currentTime = frameTime(next, meta.fps)
          return next
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [meta, onClose])

  const saveFrames = async (requests: Array<{ index: number; role: 'start' | 'end' | 'frame' }>) => {
    if (!meta || !requests.length || busy) return false
    setBusy('frames')
    try {
      const result = await window.minimax.extractClipMasterFrames(clip.source, requests, settings.clipMasterOutputDirectory, settings.ffmpegPath, clip.name)
      const files = await Promise.all(result.files.map(async (file) => ({ ...file, preview: await window.minimax.mediaUrl(file.path) })))
      setSavedFrames((items) => [...items, ...files]); setOutputFolder(result.folder)
      onNotice('success', `${files.length} frame${files.length === 1 ? '' : 's'} saved to ${result.folder}.`)
      return true
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)); return false }
    finally { setBusy(null) }
  }
  const saveRangeFrames = () => void saveFrames([{ index: startFrame, role: 'start' }, { index: endFrame, role: 'end' }])
  const saveCurrent = () => void saveFrames([{ index: currentFrame, role: 'frame' }])
  const saveBatch = async () => {
    const saved = await saveFrames(batchFrames.map((index) => ({ index, role: 'frame' as const })))
    if (saved) setBatchFrames([])
  }
  const exportClip = async () => {
    if (!meta || busy || endFrame < startFrame) return
    try {
      const outputPath = await window.minimax.chooseClipMasterExportPath(settings.clipMasterOutputDirectory, clip.name)
      if (!outputPath) return
      setExportError(''); setBusy('export')
      const result = await window.minimax.trimClipMaster(clip.source, startFrame, endFrame, meta.fps, outputPath, settings.ffmpegPath)
      setExportResult({ ...result, startFrame, endFrame, width: meta.width, height: meta.height, fps: meta.fps }); setOutputFolder(result.folder)
      onNotice('success', `${result.name} exported to ${result.folder}.`)
      onExportClip?.({ id: `clip-master-${Date.now()}`, name: result.name, source: result.url, duration: result.duration, createdAt: Date.now(), mediaKind: 'video' })
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setExportError(message); onNotice('error', `Clip export failed. Your source and marked frame range are unchanged. ${message}`) }
    finally { setBusy(null) }
  }

  const metadataSummary = useMemo(() => meta ? `${meta.width} × ${meta.height} · ${meta.fps.toFixed(meta.fps % 1 ? 3 : 0)} fps · ${meta.frameCount.toLocaleString()} frames · ${meta.duration.toFixed(2)}s` : 'Reading frame rate and frame count…', [meta])
  return <div className="modal-backdrop clip-master-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section ref={dialogRef} className="clip-master-modal" role="dialog" aria-modal="true" aria-labelledby="clip-master-title">
      <header className="clip-master-header"><div><span className="eyebrow">BETA · FRAME EDITOR</span><h2 id="clip-master-title">Clip Master Beta</h2><small>{clip.name}</small></div><button autoFocus className="icon-button" onClick={onClose} aria-label="Close Clip Master Beta"><X size={18} /></button></header>
      <div className="clip-master-body">
        <div className="clip-master-preview"><video ref={videoRef} src={clip.source} controls playsInline preload="auto" onLoadedMetadata={(event) => { if (meta) event.currentTarget.currentTime = frameTime(currentFrame, meta.fps) }} onTimeUpdate={(event) => { if (!meta) return; const next = clampFrame(Math.round(event.currentTarget.currentTime * meta.fps), meta); if (next !== currentFrame) setCurrentFrame(next) }} /><div className="clip-master-frame-readout"><strong>Frame {frameLabel(currentFrame)}</strong><span>{meta ? `${frameTime(currentFrame, meta.fps).toFixed(3)}s · ${metadataSummary}` : metadataSummary}</span></div>{metadataError && <div className="clip-master-error" role="alert"><strong>Unable to inspect this clip.</strong><span>{metadataError}</span></div>}</div>
        <div className="clip-master-controls"><div className="clip-master-stepper"><button className="secondary-button" onClick={() => seekBy(-1)} disabled={!meta || currentFrame <= 0} aria-label="Previous frame"><ChevronLeft size={16} />Previous frame</button><label>Current frame<input type="number" min="0" max={Math.max(0, (meta?.frameCount ?? 1) - 1)} value={currentFrame} onChange={(event) => setFrame(Number(event.target.value))} /></label><button className="secondary-button" onClick={() => seekBy(1)} disabled={!meta || currentFrame >= (meta.frameCount - 1)} aria-label="Next frame">Next frame<ChevronRight size={16} /></button></div><input className="clip-master-scrubber" type="range" min="0" max={Math.max(0, (meta?.frameCount ?? 1) - 1)} value={currentFrame} onChange={(event) => setFrame(Number(event.target.value))} aria-label="Frame timeline" disabled={!meta} /><div className="clip-master-range-fields"><label>Start Frame<input type="number" min="0" max={Math.max(0, (meta?.frameCount ?? 1) - 1)} value={startFrame} onChange={(event) => updateStartFrame(Number(event.target.value))} /></label><button className="secondary-button" onClick={setStart} disabled={!meta}>Set current as Start</button><label>End Frame<input type="number" min="0" max={Math.max(0, (meta?.frameCount ?? 1) - 1)} value={endFrame} onChange={(event) => updateEndFrame(Number(event.target.value))} /></label><button className="secondary-button" onClick={setEnd} disabled={!meta}>Set current as End</button></div><div className="clip-master-range-summary"><strong>Selected range: {frameLabel(startFrame)}–{frameLabel(endFrame)}</strong><span>{selectedFrameCount.toLocaleString()} frames · {duration.toFixed(3)}s</span></div></div>
        <section className="clip-master-tools"><div className="clip-master-tool-heading"><div><strong>Frame extraction</strong><small>Frame indexes start at 0. Saved under the Clip Master default: {settings.clipMasterOutputDirectory}\\ClipMaster\\{folderName}</small></div><button className="secondary-button" onClick={saveRangeFrames} disabled={!meta || Boolean(busy)}>{busy === 'frames' ? <LoaderCircle className="spin" size={15} /> : <Image size={15} />}{busy === 'frames' ? 'Saving frames…' : 'Save Start + End'}</button></div><div className="clip-master-tool-grid"><button className="secondary-button" onClick={saveCurrent} disabled={!meta || Boolean(busy)}><Download size={14} />Save current frame {frameLabel(currentFrame)}</button><button className="secondary-button" onClick={() => addBatchFrame()} disabled={!meta || Boolean(busy)}><Plus size={14} />Add current to batch</button><label className="clip-master-batch-input">Frame #<input type="number" min="0" max={Math.max(0, (meta?.frameCount ?? 1) - 1)} value={batchInput} onChange={(event) => setBatchInput(event.target.value)} placeholder="e.g. 195" disabled={!meta || Boolean(busy)} /><button className="secondary-button" onClick={() => { addBatchFrame(Number(batchInput)); setBatchInput('') }} disabled={!batchInput || !meta || Boolean(busy)} aria-label="Add typed frame to batch"><Plus size={13} /></button></label><button className="primary-button" onClick={() => void saveBatch()} disabled={!batchFrames.length || Boolean(busy)}><Save size={14} />Save {batchFrames.length} selected frame{batchFrames.length === 1 ? '' : 's'}</button></div>{batchFrames.length > 0 && <div className="clip-master-batch-list" aria-label="Frames selected for extraction">{batchFrames.map((frame) => <button key={frame} className="chip" onClick={() => removeBatchFrame(frame)} title="Remove from batch">Frame {frameLabel(frame)} ×</button>)}</div>}</section>
        <section className="clip-master-export"><div><strong>Export New Clip</strong><small>Exact frame trim · opens a save dialog · defaults to a versioned name in the Clip Master video folder.</small><dl className="clip-master-export-plan"><div><dt>Range</dt><dd>{frameLabel(startFrame)}–{frameLabel(endFrame)} · {selectedFrameCount.toLocaleString()} frames</dd></div><div><dt>Timeline</dt><dd>{duration.toFixed(3)}s · {meta?.fps.toFixed(3) ?? '—'} fps CFR</dd></div><div><dt>Audio</dt><dd>Trimmed and re-encoded with the selected picture range</dd></div></dl></div><button className="primary-button" onClick={() => void exportClip()} disabled={!meta || Boolean(busy) || endFrame < startFrame}>{busy === 'export' ? <LoaderCircle className="spin" size={15} /> : <Scissors size={15} />}{busy === 'export' ? 'Exporting…' : exportError ? 'Retry export' : 'Export New Clip'}</button>{exportError && <div className="clip-master-error clip-master-export-error" role="alert"><strong>Export did not complete.</strong><span>{exportError}</span><small>The temporary failed output was removed. Choose a destination and retry; your source clip and frame marks are unchanged.</small></div>}</section>
        {(outputFolder || savedFrames.length > 0 || exportResult) && <section className="clip-master-results"><header><div><strong>Saved outputs</strong><small>{outputFolder}</small></div><button className="secondary-button" onClick={() => void window.minimax.showOutput(outputFolder)} disabled={!outputFolder}><FolderOpen size={14} />Open Folder</button></header>{exportResult && <div className="clip-master-confirmation"><Check size={18} /><div><strong>{exportResult.name}</strong><span>Frames {frameLabel(exportResult.startFrame)}–{frameLabel(exportResult.endFrame)} · {exportResult.frameCount.toLocaleString()} frames · {exportResult.duration.toFixed(3)}s · {exportResult.width} × {exportResult.height} · {exportResult.fps.toFixed(3)} fps</span><small>{exportResult.path}</small><video src={exportResult.url} controls preload="metadata" aria-label={`Exported clip ${exportResult.name}`} /></div></div>}{savedFrames.length > 0 && <div className="clip-master-saved-files">{savedFrames.map((file) => <div key={`${file.path}-${file.index}-${file.role}`}><img src={file.preview} alt="" /><span><strong>{file.name}</strong><small>Frame {frameLabel(file.index)} · {file.path}</small></span></div>)}</div>}</section>}
      </div>
      <footer className="clip-master-footer"><span>Exact frame controls are synchronized to the detected {meta?.fps ? `${meta.fps.toFixed(3)} fps` : 'video'} timeline.</span><button className="secondary-button" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
