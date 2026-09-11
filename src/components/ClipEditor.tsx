import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, GripVertical, Image, LoaderCircle, Magnet, Plus, Save, Scissors, Trash2, X } from 'lucide-react'
import type { AppSettings, ClipItem, ClipProject, GenerationJob, MediaFile } from '../types'
import { createId } from '../lib/createId'

type DragItem = { origin: 'bin' | 'timeline'; clip: ClipItem }

const makeProject = (n = 1): ClipProject => {
  const now = Date.now()
  return { id: createId(), name: n === 1 ? 'My continuous video' : `Project ${n}`, createdAt: now, updatedAt: now, media: [], clips: [] }
}

function loadProjects() {
  try {
    const stored = JSON.parse(localStorage.getItem('minimax.clip-projects') ?? '[]') as Array<Partial<ClipProject>>
    const projects = stored.filter((project): project is Partial<ClipProject> & Pick<ClipProject, 'id' | 'name'> => Boolean(project.id && project.name)).map((project) => ({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt ?? Date.now(),
      updatedAt: project.updatedAt ?? Date.now(),
      media: Array.isArray(project.media) ? project.media : [],
      clips: Array.isArray(project.clips) ? project.clips : [],
    }))
    return projects.length ? projects : [makeProject()]
  } catch {
    return [makeProject()]
  }
}

export function ClipEditor({ settings, jobs, onUseFrame, onNotice }: {
  settings: AppSettings
  jobs: GenerationJob[]
  onUseFrame(file: MediaFile, target: 'i2v' | 'first' | 'last' | 'reference', clip: ClipItem): void
  onNotice(tone: 'error' | 'success' | 'neutral', text: string): void
}) {
  const [projects, setProjects] = useState<ClipProject[]>(loadProjects)
  const [projectId, setProjectId] = useState(() => projects[0].id)
  const [selected, setSelected] = useState<ClipItem | null>(null)
  const [preview, setPreview] = useState<ClipItem | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [frame, setFrame] = useState<MediaFile | null>(null)
  const [busy, setBusy] = useState<'frame' | 'export' | null>(null)
  const [frameEdge, setFrameEdge] = useState<'first' | 'last' | null>(null)
  const [exportUrl, setExportUrl] = useState('')
  const [dragged, setDragged] = useState<DragItem | null>(null)
  const project = projects.find((item) => item.id === projectId) ?? projects[0]
  const completed = jobs.filter((job) => job.status === 'completed' && job.outputUrl)
  const timelineDuration = useMemo(() => project.clips.reduce((total, clip) => total + clipLength(clip), 0), [project.clips])
  const programClip = preview ?? project.clips[0] ?? null

  useEffect(() => localStorage.setItem('minimax.clip-projects', JSON.stringify(projects)), [projects])
  useEffect(() => { setSelected(null); setPreview(null); setExportUrl('') }, [projectId])

  const update = (change: (value: ClipProject) => ClipProject) => setProjects((all) => all.map((item) => item.id === project.id ? { ...change(item), updatedAt: Date.now() } : item))
  const addToTimeline = (clip: ClipItem, beforeId?: string) => {
    const timelineClip = { ...clip, id: createId(), createdAt: Date.now() }
    update((value) => {
      const clips = [...value.clips]
      const index = beforeId ? clips.findIndex((item) => item.id === beforeId) : -1
      if (index >= 0) clips.splice(index, 0, timelineClip)
      else clips.push(timelineClip)
      return { ...value, clips }
    })
    setPreview(timelineClip)
  }
  const chooseLocal = async () => {
    const file = await window.minimax.chooseMedia('video')
    if (!file) return
    const media = { id: createId(), name: file.name, source: await window.minimax.mediaUrl(file.path), createdAt: Date.now() }
    update((value) => ({ ...value, media: [...value.media, media] }))
    setPreview(media)
    onNotice('success', `${file.name} added to the media bin.`)
  }
  const open = (clip: ClipItem) => {
    setSelected(clip)
    setPreview(clip)
    setFrame(null)
    setStart(clip.start ?? 0)
    setEnd(clip.end ?? clip.duration ?? 0)
  }
  const saveTrim = () => {
    if (!selected) return
    const safeStart = Math.max(0, start)
    const maximum = selected.duration && selected.duration > 0 ? selected.duration : Number.POSITIVE_INFINITY
    const safeEnd = Math.min(maximum, end)
    const next = { ...selected, start: safeStart, end: safeEnd > safeStart ? safeEnd : undefined }
    update((value) => ({ ...value, clips: value.clips.map((clip) => clip.id === selected.id ? next : clip) }))
    setSelected(next)
    setPreview(next)
    onNotice('success', 'Clip start and end points saved.')
  }
  const grab = async (edge: 'first' | 'last') => {
    if (!selected) return
    setBusy('frame')
    setFrameEdge(edge)
    setFrame(null)
    try {
      const safeStart = Math.max(0, start)
      const at = edge === 'first' ? safeStart : end > safeStart ? Math.max(safeStart, end - 0.05) : 'last'
      const result = await window.minimax.extractVideoFrame(selected.source, at, settings.outputDirectory, settings.ffmpegPath)
      setFrame({ ...result, kind: 'image', preview: await window.minimax.mediaUrl(result.path) })
      onNotice('success', `${edge === 'first' ? 'Start' : 'End'} frame extracted.`)
    } catch (error) {
      onNotice('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      setFrameEdge(null)
    }
  }
  const move = (clip: ClipItem, by: -1 | 1) => update((value) => {
    const clips = [...value.clips]
    const index = clips.findIndex((item) => item.id === clip.id)
    const target = index + by
    if (target < 0 || target >= clips.length) return value
    ;[clips[index], clips[target]] = [clips[target], clips[index]]
    return { ...value, clips }
  })
  const drop = (beforeId?: string) => {
    if (!dragged) return
    if (dragged.origin === 'bin') addToTimeline(dragged.clip, beforeId)
    else update((value) => {
      if (dragged.clip.id === beforeId) return value
      const clips = value.clips.filter((clip) => clip.id !== dragged.clip.id)
      const index = beforeId ? clips.findIndex((clip) => clip.id === beforeId) : -1
      if (index >= 0) clips.splice(index, 0, dragged.clip)
      else clips.push(dragged.clip)
      return { ...value, clips }
    })
    setDragged(null)
  }
  const exportVideo = async () => {
    setBusy('export')
    try {
      const result = await window.minimax.joinVideos(project.clips, settings.outputDirectory, settings.ffmpegPath)
      setExportUrl(result.url)
      setPreview({ id: `export-${Date.now()}`, name: `${project.name} export`, source: result.url, duration: timelineDuration, createdAt: Date.now() })
      onNotice('success', `Exported ${project.clips.length} clips as one video.`)
    } catch (error) {
      onNotice('error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return <div className="standard-page editor-page">
    <div className="page-heading">
      <div><p className="eyebrow">CLIP WORKSPACE</p><h1>Movie editor</h1><p>Preview, trim, reorder, and assemble as many clips as you need. Nothing joins until export.</p></div>
      <button className="primary-button" onClick={() => void exportVideo()} disabled={busy === 'export' || project.clips.length < 2}>{busy === 'export' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}Export timeline</button>
    </div>

    <div className="project-toolbar">
      <label>Project<select value={project.id} onChange={(event) => setProjectId(event.target.value)}>{projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <button className="secondary-button" onClick={() => { const next = makeProject(projects.length + 1); setProjects((all) => [...all, next]); setProjectId(next.id) }}><Plus size={15} />New project</button>
      <input aria-label="Project name" value={project.name} onChange={(event) => update((value) => ({ ...value, name: event.target.value }))} />
      <button className="secondary-button" onClick={() => void chooseLocal()}><FolderOpen size={15} />Import media</button>
    </div>


    <div className="editor-workbench">
      <aside className="media-bin" aria-label="Project media bin">
        <div className="editor-pane-heading"><div><strong>Media bin</strong><span>{project.media.length + completed.length} available clips</span></div><button onClick={() => void chooseLocal()} aria-label="Import video"><Plus size={15} /></button></div>
        <div className="media-bin-list">
          {project.media.map((clip) => <MediaBinItem key={clip.id} clip={clip} onPreview={setPreview} onAdd={addToTimeline} onDrag={(item) => setDragged({ origin: 'bin', clip: item })} onDuration={(duration) => update((value) => ({ ...value, media: value.media.map((item) => item.id === clip.id ? { ...item, duration } : item) }))} />)}
          {completed.map((job) => {
            const clip = { id: `job-${job.id}`, name: shorten(job.prompt), source: job.outputUrl!, duration: job.duration, createdAt: job.createdAt }
            return <MediaBinItem key={clip.id} clip={clip} meta={`${job.width} × ${job.height}`} onPreview={setPreview} onAdd={addToTimeline} onDrag={(item) => setDragged({ origin: 'bin', clip: item })} />
          })}
          {project.media.length + completed.length === 0 && <div className="media-bin-empty"><FolderOpen size={22} /><span>Import a video or render a clip.</span></div>}
        </div>
      </aside>

      <div className="editor-main-column">
        <section className="program-monitor">
          <div className="editor-pane-heading"><div><strong>Preview</strong><span>{programClip ? programClip.name : 'Select a clip from the bin or timeline'}</span></div>{exportUrl && <span className="export-chip">Latest export</span>}</div>
          <div className="program-stage">{programClip ? <ProgramPlayback key={`${programClip.id}:${programClip.source}`} clip={programClip} /> : <div><Scissors size={30} /><strong>No clip selected</strong><span>Choose media to preview it here.</span></div>}</div>
        </section>

        <section className="timeline-panel">
          <div className="editor-pane-heading"><div><strong>Timeline</strong><span>{project.clips.length} clips · {formatTime(timelineDuration)}</span></div><span className="magnetic-status"><Magnet size={13} />Magnetic timeline</span></div>
          <div className="timeline-ruler" aria-hidden="true"><span>00:00</span><i /><span>{formatTime(timelineDuration)}</span></div>
          {project.clips.length === 0 ? <div className={`timeline-empty ${dragged ? 'drop-ready' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); drop() }}><Scissors size={24} /><strong>Drop clips here</strong><span>Clips snap together in timeline order.</span></div> : <div className={`clip-timeline ${dragged ? 'drag-active' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); drop() }}>
            {project.clips.map((clip, index) => <article className={`timeline-clip ${programClip?.id === clip.id ? 'active' : ''}`} style={{ flexBasis: `${Math.max(165, Math.min(360, clipLength(clip) * 28))}px` }} key={clip.id} draggable onDragStart={() => setDragged({ origin: 'timeline', clip })} onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); drop(clip.id) }} onClick={() => setPreview(clip)} onDoubleClick={() => open(clip)} onContextMenu={(event) => { event.preventDefault(); open(clip) }}>
              <div className="clip-grip"><GripVertical size={14} /><span>{index + 1}</span></div>
              <video src={clip.source} muted preload="metadata" onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && !clip.duration) update((value) => ({ ...value, clips: value.clips.map((item) => item.id === clip.id ? { ...item, duration } : item) })) }} />
              <div className="timeline-clip-copy"><strong title={clip.name}>{clip.name}</strong><small>{formatTime(clipLength(clip))} · {formatTime(clip.start ?? 0)} in</small></div>
              <div className="clip-actions"><button onClick={(event) => { event.stopPropagation(); move(clip, -1) }} disabled={!index} aria-label="Move clip left"><ChevronLeft size={14} /></button><button onClick={(event) => { event.stopPropagation(); move(clip, 1) }} disabled={index === project.clips.length - 1} aria-label="Move clip right"><ChevronRight size={14} /></button><button onClick={(event) => { event.stopPropagation(); open(clip) }}>Edit</button></div>
            </article>)}
          </div>}
        </section>
      </div>
    </div>

    {selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}><section className="clip-modal" role="dialog" aria-modal="true" aria-labelledby="clip-title">
      <header><div><span>CLIP OPTIONS</span><strong id="clip-title">{selected.name}</strong></div><button onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button></header>
      <video src={selected.source} controls preload="metadata" onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (!end) setEnd(duration); if (!selected.duration && Number.isFinite(duration)) setSelected({ ...selected, duration }) }} />
      <div className="trim-fields"><label>Start (seconds)<input type="number" min="0" max={selected.duration} step="0.04" value={start} onChange={(event) => setStart(Number(event.target.value))} /></label><label>End (seconds)<input type="number" min="0.04" max={selected.duration} step="0.04" value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label><button className="secondary-button" onClick={saveTrim}><Scissors size={15} />Set start / end</button></div>
      <div className="frame-grab-actions"><button type="button" className="secondary-button" onClick={() => void grab('first')} disabled={busy === 'frame'}>{frameEdge === 'first' ? <LoaderCircle className="spin" size={15} /> : <Image size={15} />}{frameEdge === 'first' ? 'Extracting start…' : 'Grab start frame'}</button><button type="button" className="secondary-button" onClick={() => void grab('last')} disabled={busy === 'frame'}>{frameEdge === 'last' ? <LoaderCircle className="spin" size={15} /> : <Image size={15} />}{frameEdge === 'last' ? 'Extracting end…' : 'Grab end frame'}</button>{busy === 'frame' && <span role="status">Decoding one frame with FFmpeg…</span>}</div>
      {frame && <div className="frame-route"><img src={frame.preview} alt="Extracted frame" /><div><strong>How should this frame be used?</strong><small>The next render remains separate until you add it to this timeline and export.</small><button onClick={() => onUseFrame(frame, 'i2v', selected)}>Use as I2V first frame</button><button onClick={() => onUseFrame(frame, 'first', selected)}>First + last: first</button><button onClick={() => onUseFrame(frame, 'last', selected)}>First + last: last</button><button onClick={() => onUseFrame(frame, 'reference', selected)}>Reference picture</button></div></div>}
      <footer><button className="danger-button" onClick={() => { update((value) => ({ ...value, clips: value.clips.filter((clip) => clip.id !== selected.id) })); if (preview?.id === selected.id) setPreview(null); setSelected(null) }}><Trash2 size={15} />Remove from timeline</button><button className="secondary-button" onClick={() => setSelected(null)}>Done</button></footer>
    </section></div>}
  </div>
}

function MediaBinItem({ clip, meta, onPreview, onAdd, onDrag, onDuration }: { clip: ClipItem; meta?: string; onPreview(clip: ClipItem): void; onAdd(clip: ClipItem): void; onDrag(clip: ClipItem): void; onDuration?(duration: number): void }) {
  return <article className="media-bin-item" draggable onDragStart={() => onDrag(clip)} onClick={() => onPreview(clip)}>
    <video src={clip.source} muted preload="metadata" onLoadedMetadata={(event) => { if (!clip.duration && Number.isFinite(event.currentTarget.duration)) onDuration?.(event.currentTarget.duration) }} />
    <div><strong title={clip.name}>{clip.name}</strong><small>{meta ?? formatTime(clip.duration ?? 0)}</small></div>
    <button onClick={(event) => { event.stopPropagation(); onAdd(clip) }} aria-label={`Add ${clip.name} to timeline`}><Plus size={14} /></button>
  </article>
}

function ProgramPlayback({ clip }: { clip: ClipItem }) {
  const [failed, setFailed] = useState(false)
  const startAt = Math.max(0, clip.start ?? 0)
  const endAt = clip.end && clip.end > startAt ? clip.end : undefined
  if (failed) return <div className="playback-error"><strong>Preview unavailable</strong><span>The file may have moved or use a codec this Windows installation cannot decode.</span></div>
  return <video
    key={`${clip.id}:${clip.source}:${startAt}:${endAt ?? 'end'}`}
    src={clip.source}
    controls
    playsInline
    preload="auto"
    onError={() => setFailed(true)}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget
      if (Number.isFinite(startAt) && startAt < video.duration) video.currentTime = startAt
    }}
    onPlay={(event) => {
      const video = event.currentTarget
      if (endAt && video.currentTime >= endAt - .04) video.currentTime = startAt
    }}
    onTimeUpdate={(event) => {
      const video = event.currentTarget
      if (endAt && video.currentTime >= endAt) { video.pause(); video.currentTime = endAt }
    }}
  />
}

function clipLength(clip: ClipItem) { return Math.max(0, (clip.end ?? clip.duration ?? 0) - (clip.start ?? 0)) }
function formatTime(seconds: number) { const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0); return `${Math.floor(safe / 60).toString().padStart(2, '0')}:${Math.floor(safe % 60).toString().padStart(2, '0')}` }
function shorten(value: string) { return value.length > 54 ? `${value.slice(0, 54)}…` : value }
