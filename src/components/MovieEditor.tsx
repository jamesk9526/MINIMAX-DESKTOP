import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { Copy, Eye, EyeOff, Flag, FolderOpen, Layers3, LoaderCircle, Lock, Magnet, Music2, Plus, Redo2, Scissors, Trash2, Undo2, Volume2, VolumeX } from 'lucide-react'
import type { AppSettings, ClipItem, GenerationJob, MediaFile, MovieEditorClip, MovieEditorProject, MovieEditorTrack, MovieEditorTrackKind } from '../types'
import { createId } from '../lib/createId'

const STORAGE_KEY = 'minimax.movie-editor-projects'
const fps = 24
const defaultTracks: MovieEditorTrack[] = [
  { id: 'v1', name: 'Primary video', kind: 'video' },
  { id: 'v2', name: 'B-roll / inserts', kind: 'video' },
  { id: 'titles', name: 'Titles', kind: 'title' },
  { id: 'a1', name: 'Dialogue', kind: 'audio' },
  { id: 'a2', name: 'Music', kind: 'audio' },
]
const frameToTime = (frame: number, rate: number) => Math.max(0, frame) / rate
const timecode = (frame: number, rate: number) => {
  const seconds = Math.max(0, Math.floor(frame / rate)); const frames = Math.max(0, frame % rate)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}
const clipFrames = (clip: MovieEditorClip) => Math.max(1, (clip.sourceOutFrame ?? Math.round((clip.duration ?? 5) * fps)) - clip.sourceInFrame)
const makeProject = (n = 1): MovieEditorProject => { const now = Date.now(); return { id: createId(), name: n === 1 ? 'Untitled movie' : `Movie ${n}`, createdAt: now, updatedAt: now, frameRate: fps, media: [], tracks: defaultTracks.map((track) => ({ ...track })), clips: [] } }
function loadProjects(): MovieEditorProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Partial<MovieEditorProject>[]
    const projects = parsed.filter((project) => project?.id && project?.name).map((project) => ({ ...makeProject(), ...project, tracks: Array.isArray(project.tracks) && project.tracks.length ? project.tracks : defaultTracks.map((track) => ({ ...track })), media: Array.isArray(project.media) ? project.media : [], clips: Array.isArray(project.clips) ? project.clips : [] }))
    return projects.length ? projects : [makeProject()]
  } catch { return [makeProject()] }
}
function jobClip(job: GenerationJob): ClipItem | null {
  if (job.status !== 'completed' || !job.outputUrl || job.mediaType === 'image') return null
  const filename = job.localOutputPath?.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '')
  const readablePrompt = job.prompt
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b(?:subject_definitions|integrated_multimodal|reference_images?)\b\s*[:=]?/gi, ' ')
    .replace(/[_{}[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const name = filename || readablePrompt.split(/[.!?]/)[0]?.slice(0, 54) || `${job.modelName ?? 'Generated'} clip`
  return { id: `job-${job.id}`, name, source: job.outputUrl, duration: job.duration, createdAt: job.createdAt, mediaKind: job.mediaType === 'audio' ? 'audio' : 'video' }
}

export function MovieEditor({ settings, jobs, onUseFrame, onOpenClipMaster, onNotice, standalone = false }: {
  settings: AppSettings; jobs: GenerationJob[]; onUseFrame(file: MediaFile, target: 'i2v' | 'first' | 'last' | 'reference', clip: ClipItem): void; onOpenClipMaster?(clip: ClipItem): void; onNotice(tone: 'error' | 'success' | 'neutral', text: string): void; standalone?: boolean
}) {
  const [projects, setProjects] = useState<MovieEditorProject[]>(loadProjects)
  const [projectId, setProjectId] = useState(() => projects[0].id)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [playhead, setPlayhead] = useState(0)
  const [zoom, setZoom] = useState(4)
  const [dragSource, setDragSource] = useState<ClipItem | MovieEditorClip | null>(null)
  const [busy, setBusy] = useState<'export' | 'frame' | null>(null)
  const [history, setHistory] = useState<MovieEditorProject[][]>([])
  const [future, setFuture] = useState<MovieEditorProject[][]>([])
  const [clipboard, setClipboard] = useState<MovieEditorClip[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const project = projects.find((item) => item.id === projectId) ?? projects[0]
  const selected = project.clips.find((clip) => selectedIds.includes(clip.id)) ?? null
  const program = useMemo(() => project.clips.filter((clip) => clip.trackId === 'v1' && clip.startFrame <= playhead && clip.startFrame + clipFrames(clip) > playhead).sort((a, b) => b.startFrame - a.startFrame)[0] ?? selected ?? project.clips[0] ?? null, [playhead, project.clips, selected])
  const totalFrames = Math.max(project.frameRate * 15, ...project.clips.map((clip) => clip.startFrame + clipFrames(clip) + project.frameRate * 2))
  const timelineWidth = Math.max(960, totalFrames * zoom)
  const completed = jobs.map(jobClip).filter((clip): clip is ClipItem => Boolean(clip))

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)) }, [projects])
  useEffect(() => { setSelectedIds([]); setPlayhead(0) }, [projectId])
  useEffect(() => {
    const importClip = (event: Event) => {
      const clip = (event as CustomEvent<ClipItem>).detail
      if (!clip?.id || !clip.source) return
      const trackId = project.tracks.find((track) => track.kind === (clip.mediaKind === 'audio' ? 'audio' : 'video'))?.id ?? 'v1'
      const timelineClip: MovieEditorClip = { ...clip, id: createId(), assetId: clip.id, trackId, startFrame: playhead, sourceInFrame: 0, sourceOutFrame: clip.duration ? Math.round(clip.duration * project.frameRate) : undefined, transform: { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 }, audio: { volume: 100, fadeInFrames: 0, fadeOutFrames: 0, muted: false } }
      commit((value) => ({ ...value, media: [...value.media, clip], clips: [...value.clips, timelineClip] }))
      setSelectedIds([timelineClip.id])
      onNotice('success', `${clip.name} returned from Clip Master and was placed on the timeline.`)
    }
    window.addEventListener('oyama-movie-add-media', importClip)
    return () => window.removeEventListener('oyama-movie-add-media', importClip)
  })
  useEffect(() => {
    const video = videoRef.current
    if (!video || !program) return
    const inFrame = program.sourceInFrame + Math.max(0, playhead - program.startFrame)
    const next = frameToTime(inFrame, project.frameRate)
    if (Math.abs(video.currentTime - next) > .15) video.currentTime = next
  }, [playhead, program, project.frameRate])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches('input, textarea, select')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return }
      if (event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); rippleDelete(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); return }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); split(); return }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); addMarker(); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); setPlayhead((value) => Math.max(0, value - 1)) }
      if (event.key === 'ArrowRight') { event.preventDefault(); setPlayhead((value) => Math.min(totalFrames, value + 1)) }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  })
  const commit = (change: (value: MovieEditorProject) => MovieEditorProject) => {
    setHistory((entries) => [...entries.slice(-39), projects]); setFuture([])
    setProjects((items) => items.map((item) => item.id === project.id ? { ...change(item), updatedAt: Date.now() } : item))
  }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [...items, projects]); setProjects(previous); setHistory((items) => items.slice(0, -1)) }
  const redo = () => { const next = future.at(-1); if (!next) return; setHistory((items) => [...items, projects]); setProjects(next); setFuture((items) => items.slice(0, -1)) }
  const addTrack = (kind: MovieEditorTrackKind) => commit((value) => ({ ...value, tracks: [...value.tracks, { id: createId(), name: kind === 'audio' ? 'Audio track' : 'Video track', kind }] }))
  const addClip = (asset: ClipItem, trackId = project.tracks.find((track) => track.kind === (asset.mediaKind === 'audio' ? 'audio' : 'video'))?.id ?? 'v1', at = playhead) => {
    const generation = asset.id.startsWith('job-') ? jobs.find((job) => `job-${job.id}` === asset.id) : undefined
    const clip: MovieEditorClip = { ...asset, id: createId(), assetId: asset.id, trackId, startFrame: Math.max(0, at), sourceInFrame: 0, sourceOutFrame: asset.duration ? Math.round(asset.duration * project.frameRate) : undefined, transform: { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 }, audio: { volume: 100, fadeInFrames: 0, fadeOutFrames: 0, muted: false }, generation: generation ? { jobId: generation.id, model: generation.modelName ?? generation.provider, prompt: generation.prompt, width: generation.width, height: generation.height } : undefined }
    commit((value) => ({ ...value, clips: [...value.clips, clip] })); setSelectedIds([clip.id]); setPlayhead(clip.startFrame)
  }
  const positionFromPointer = (event: { clientX: number; currentTarget: Element }) => Math.max(0, Math.min(totalFrames, Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom)))
  const drop = (track: MovieEditorTrack, event: DragEvent) => { event.preventDefault(); if (!dragSource || track.locked) return; const at = positionFromPointer(event); if ('trackId' in dragSource) commit((value) => ({ ...value, clips: value.clips.map((clip) => clip.id === dragSource.id ? { ...clip, trackId: track.id, startFrame: at } : clip) })); else addClip(dragSource, track.id, at); setDragSource(null) }
  const remove = () => { if (!selectedIds.length) return; commit((value) => ({ ...value, clips: value.clips.filter((clip) => !selectedIds.includes(clip.id)) })); setSelectedIds([]) }
  const rippleDelete = () => {
    const targets = project.clips.filter((clip) => selectedIds.includes(clip.id)); if (!targets.length) return
    const shifts = new Map<string, number>(); for (const clip of targets) shifts.set(clip.trackId, (shifts.get(clip.trackId) ?? 0) + clipFrames(clip))
    commit((value) => ({ ...value, clips: value.clips.filter((clip) => !selectedIds.includes(clip.id)).map((clip) => {
      const removedBefore = targets.filter((target) => target.trackId === clip.trackId && target.startFrame < clip.startFrame).reduce((sum, target) => sum + clipFrames(target), 0)
      return removedBefore ? { ...clip, startFrame: Math.max(0, clip.startFrame - removedBefore) } : clip
    }) })); setSelectedIds([])
  }
  const duplicate = () => { if (!selected) return; const copy = { ...selected, id: createId(), startFrame: selected.startFrame + clipFrames(selected) }; commit((value) => ({ ...value, clips: [...value.clips, copy] })); setSelectedIds([copy.id]) }
  const copySelection = () => setClipboard(project.clips.filter((clip) => selectedIds.includes(clip.id)))
  const pasteSelection = () => { if (!clipboard.length) return; const earliest = Math.min(...clipboard.map((clip) => clip.startFrame)); const copies = clipboard.map((clip) => ({ ...clip, id: createId(), startFrame: playhead + clip.startFrame - earliest })); commit((value) => ({ ...value, clips: [...value.clips, ...copies] })); setSelectedIds(copies.map((clip) => clip.id)) }
  const addMarker = () => commit((value) => ({ ...value, markers: [...(value.markers ?? []), { id: createId(), frame: playhead, label: `Marker ${((value.markers?.length ?? 0) + 1)}`, color: 'yellow' }] }))
  const split = () => { if (!selected || playhead <= selected.startFrame || playhead >= selected.startFrame + clipFrames(selected)) return; const offset = playhead - selected.startFrame; const left = { ...selected, sourceOutFrame: selected.sourceInFrame + offset }; const right = { ...selected, id: createId(), startFrame: playhead, sourceInFrame: selected.sourceInFrame + offset }; commit((value) => ({ ...value, clips: value.clips.flatMap((clip) => clip.id === selected.id ? [left, right] : [clip]) })); setSelectedIds([right.id]) }
  const markIn = () => { if (!selected || playhead < selected.startFrame || playhead >= selected.startFrame + clipFrames(selected)) return; const sourceInFrame = selected.sourceInFrame + playhead - selected.startFrame; commit((value) => ({ ...value, clips: value.clips.map((clip) => clip.id === selected.id ? { ...clip, startFrame: playhead, sourceInFrame } : clip) })); onNotice('success', `In point set at ${timecode(playhead, project.frameRate)}.`) }
  const markOut = () => { if (!selected || playhead < selected.startFrame || playhead >= selected.startFrame + clipFrames(selected)) return; const sourceOutFrame = selected.sourceInFrame + playhead - selected.startFrame + 1; commit((value) => ({ ...value, clips: value.clips.map((clip) => clip.id === selected.id ? { ...clip, sourceOutFrame } : clip) })); onNotice('success', `Out point set at ${timecode(playhead, project.frameRate)}.`) }
  const toggleTrack = (track: MovieEditorTrack, key: 'locked' | 'hidden' | 'muted') => commit((value) => ({ ...value, tracks: value.tracks.map((item) => item.id === track.id ? { ...item, [key]: !item[key] } : item) }))
  const updateSelected = (change: Partial<MovieEditorClip>) => { if (!selected) return; commit((value) => ({ ...value, clips: value.clips.map((clip) => clip.id === selected.id ? { ...clip, ...change } : clip) })) }
  const exportMovie = async () => { const clips = project.clips.filter((clip) => project.tracks.find((track) => track.id === clip.trackId)?.kind === 'video').sort((a, b) => a.startFrame - b.startFrame); if (clips.length < 2) return; setBusy('export'); try { await window.minimax.joinVideos(clips.map((clip) => ({ source: clip.source, start: frameToTime(clip.sourceInFrame, project.frameRate), end: clip.sourceOutFrame ? frameToTime(clip.sourceOutFrame, project.frameRate) : undefined })), settings.outputDirectory, settings.ffmpegPath); onNotice('success', 'Exported a versioned movie file from the primary video sequence.') } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) } finally { setBusy(null) } }
  const grabFrame = async () => { if (!selected) return; setBusy('frame'); try { const result = await window.minimax.extractVideoFrame(selected.source, frameToTime(selected.sourceInFrame + Math.max(0, playhead - selected.startFrame), project.frameRate), settings.outputDirectory, settings.ffmpegPath); onUseFrame({ ...result, kind: 'image', preview: await window.minimax.mediaUrl(result.path) }, 'i2v', selected) } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) } finally { setBusy(null) } }

  return <div className={`movie-editor ${standalone ? 'movie-editor-standalone' : ''}`} aria-label="Movie editor">
    <div className="movie-editor-projectbar"><label>Project<select value={project.id} onChange={(event) => setProjectId(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><input aria-label="Movie name" value={project.name} onChange={(event) => commit((value) => ({ ...value, name: event.target.value }))} /><button className="secondary-button" onClick={() => { const next = makeProject(projects.length + 1); setProjects((items) => [...items, next]); setProjectId(next.id) }}><Plus size={15} />New movie</button></div>
    <div className="movie-editor-workspace">
      <aside className="movie-media-panel"><header><Layers3 size={16} /><span><strong>Media pool</strong><small>{project.media.length + completed.length} available · double-click to add</small></span><div><button title="Import video" aria-label="Import video" onClick={async () => { const item = await window.minimax.chooseMedia('video'); if (!item) return; const clip = { id: createId(), name: item.name, source: await window.minimax.mediaUrl(item.path), createdAt: Date.now(), mediaKind: 'video' as const }; commit((value) => ({ ...value, media: [...value.media, clip] })) }}><FolderOpen size={15} /></button><button title="Import audio" aria-label="Import audio" onClick={async () => { const item = await window.minimax.chooseMedia('audio'); if (!item) return; const clip = { id: createId(), name: item.name, source: await window.minimax.mediaUrl(item.path), createdAt: Date.now(), mediaKind: 'audio' as const }; commit((value) => ({ ...value, media: [...value.media, clip] })) }}><Music2 size={15} /></button></div></header><div className="movie-media-list">{[...project.media, ...completed].map((clip) => <button key={clip.id} draggable title={`${clip.name} — double-click to add at playhead`} aria-label={`${clip.name}. Double-click to add at playhead.`} onDragStart={() => setDragSource(clip)} onDoubleClick={() => addClip(clip)} onClick={() => setSelectedIds([])}>{clip.mediaKind === 'audio' ? <span className="movie-audio-icon"><Music2 size={18} /></span> : <video src={clip.source} muted preload="metadata" />}<span><strong>{clip.name}</strong><small>{clip.duration ? `${clip.duration.toFixed(1)}s` : 'Duration pending'}</small></span><Plus aria-hidden="true" size={14} /></button>)}{!project.media.length && !completed.length && <p>Import media or finish a render to begin.</p>}</div></aside>
      <section className="movie-program"><header><span><strong>Program monitor</strong><small>{timecode(playhead, project.frameRate)}</small></span>{selected && <button className="secondary-button" onClick={() => onOpenClipMaster?.(selected)}><Scissors size={14} />Clip Master</button>}</header><div className="movie-program-stage">{program ? <video ref={videoRef} src={program.source} controls playsInline onTimeUpdate={(event) => { if (!event.currentTarget.paused) setPlayhead(program.startFrame + Math.round(event.currentTarget.currentTime * project.frameRate) - program.sourceInFrame) }} /> : <div><Layers3 size={30} /><strong>Build your first sequence</strong><span>Drag a generated clip into the timeline.</span></div>}</div></section>
      <aside className={`movie-inspector ${selected ? '' : 'is-empty'}`}><header><strong>Inspector</strong>{selected ? <small>{selected.name}</small> : <small>Select one clip</small>}</header>{selected ? <div className="movie-inspector-fields"><label>Position X<input type="number" value={selected.transform?.x ?? 0} onChange={(event) => updateSelected({ transform: { ...(selected.transform ?? { y: 0, scale: 100, rotation: 0, opacity: 100 }), x: Number(event.target.value) } })} /></label><label>Position Y<input type="number" value={selected.transform?.y ?? 0} onChange={(event) => updateSelected({ transform: { ...(selected.transform ?? { x: 0, scale: 100, rotation: 0, opacity: 100 }), y: Number(event.target.value) } })} /></label><label>Scale<input type="number" value={selected.transform?.scale ?? 100} onChange={(event) => updateSelected({ transform: { ...(selected.transform ?? { x: 0, y: 0, rotation: 0, opacity: 100 }), scale: Number(event.target.value) } })} /></label><label>Opacity<input type="number" min="0" max="100" value={selected.transform?.opacity ?? 100} onChange={(event) => updateSelected({ transform: { ...(selected.transform ?? { x: 0, y: 0, scale: 100, rotation: 0 }), opacity: Number(event.target.value) } })} /></label><label>Volume<input type="number" min="0" max="200" value={selected.audio?.volume ?? 100} onChange={(event) => updateSelected({ audio: { ...(selected.audio ?? { fadeInFrames: 0, fadeOutFrames: 0, muted: false }), volume: Number(event.target.value) } })} /></label><section><strong>Source range</strong><small>{timecode(selected.sourceInFrame, project.frameRate)} — {timecode(selected.sourceInFrame + clipFrames(selected), project.frameRate)} · Use Mark in / Mark out, then Split or open Clip Master to render this range.</small></section><section><strong>Generated media</strong><small>{selected.generation?.model ?? 'Imported media'}{selected.generation?.prompt ? ` · ${selected.generation.prompt}` : ''}</small></section><button className="secondary-button" onClick={() => void grabFrame()} disabled={busy === 'frame'}>{busy === 'frame' ? <LoaderCircle className="spin" size={14} /> : <Scissors size={14} />}{standalone ? 'Save current frame' : 'Use current frame'}</button><button className="secondary-button" onClick={() => onOpenClipMaster?.(selected)}><Scissors size={14} />Open in Clip Master</button><button className="danger-button" onClick={remove}><Trash2 size={14} />Remove</button></div> : <p className="movie-inspector-empty">Use Shift-click to multi-select. Double-click media to place it at the playhead.</p>}</aside>
    </div>
    <section className="movie-timeline">
      <header><div className="timeline-tools"><button aria-label="Zoom timeline out" onClick={() => setZoom((value) => Math.max(2, value - 2))}>−</button><span>{zoom}px / frame</span><button aria-label="Zoom timeline in" onClick={() => setZoom((value) => Math.min(24, value + 2))}>+</button><button className="secondary-button" onClick={markIn} disabled={!selected}><Flag size={14} />Mark in</button><button className="secondary-button" onClick={markOut} disabled={!selected}><Flag size={14} />Mark out</button><button className="secondary-button" onClick={split} disabled={!selected}><Scissors size={14} />Split</button><button className="secondary-button" onClick={duplicate} disabled={!selected}><Copy size={14} />Duplicate</button><button className="secondary-button" onClick={rippleDelete} disabled={!selected}><Trash2 size={14} />Ripple delete</button><button className="secondary-button" onClick={addMarker}><Flag size={14} />Marker</button><button className="secondary-button" onClick={() => addTrack('video')}><Plus size={14} />Track</button><span className="magnetic-status"><Magnet size={13} />Snap on</span></div><output>{timecode(playhead, project.frameRate)}</output></header>
      <div className="movie-timeline-scroll">
        <div className="movie-timeline-canvas" style={{ '--timeline-width': `${timelineWidth}px` } as CSSProperties}>
          <div className="movie-ruler"><div className="movie-ruler-gutter" aria-hidden="true" /><div className="movie-ruler-lane" onClick={(event) => setPlayhead(positionFromPointer(event))}>{Array.from({ length: Math.ceil(totalFrames / (project.frameRate * 2)) + 1 }, (_, index) => <span key={index} style={{ left: `${index * project.frameRate * 2 * zoom}px` }}>{timecode(index * project.frameRate * 2, project.frameRate)}</span>)}{(project.markers ?? []).map((marker) => <i className={`movie-marker ${marker.color}`} key={marker.id} title={marker.label} style={{ left: `${marker.frame * zoom}px` }} />)}<i className="movie-playhead" style={{ left: `${playhead * zoom}px` }} /></div></div>
          <div className="movie-track-list">{project.tracks.map((track) => <div className="movie-track" key={track.id}><div className="movie-track-controls"><strong>{track.name}</strong><small>{track.kind}</small><span><button onClick={() => toggleTrack(track, 'locked')} aria-label={`Toggle ${track.name} lock`} className={track.locked ? 'active' : ''}><Lock size={13} /></button><button onClick={() => toggleTrack(track, 'hidden')} aria-label={`Toggle ${track.name} visibility`} className={track.hidden ? 'active' : ''}>{track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>{track.kind === 'audio' && <button onClick={() => toggleTrack(track, 'muted')} aria-label={`Toggle ${track.name} mute`} className={track.muted ? 'active' : ''}>{track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>}</span></div><div className="movie-track-lane" onClick={(event) => { if (event.target === event.currentTarget) setPlayhead(positionFromPointer(event)) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(track, event)}>{project.clips.filter((clip) => clip.trackId === track.id).map((clip) => <button key={clip.id} draggable onDragStart={() => setDragSource(clip)} className={`movie-timeline-clip ${selectedIds.includes(clip.id) ? 'selected' : ''}`} style={{ left: `${clip.startFrame * zoom}px`, width: `${Math.max(42, clipFrames(clip) * zoom)}px` }} onClick={(event) => setSelectedIds((current) => event.shiftKey ? (current.includes(clip.id) ? current.filter((id) => id !== clip.id) : [...current, clip.id]) : [clip.id])} onDoubleClick={() => onOpenClipMaster?.(clip)}><strong>{clip.name}</strong><small>{timecode(clip.sourceInFrame, project.frameRate)} — {timecode(clip.sourceInFrame + clipFrames(clip), project.frameRate)}</small></button>)}<i className="movie-playhead" style={{ left: `${playhead * zoom}px` }} /></div></div>)}</div>
        </div>
      </div>
      <footer><button className="secondary-button" onClick={() => addTrack('audio')}><Music2 size={14} />Add audio track</button><span>Shortcuts: ←/→ frame step · S split · M marker · Ctrl/Cmd+C/V copy/paste · Shift+Delete ripple delete</span></footer>
    </section>
    <footer className="movie-editor-bottom-bar"><div><strong>{project.name || 'Untitled movie'}</strong><span>{project.clips.length} {project.clips.length === 1 ? 'clip' : 'clips'} · {project.media.length + completed.length} media</span></div><span className="movie-editor-bottom-status">{selected ? `Selected: ${selected.name}` : `Playhead ${timecode(playhead, project.frameRate)}`}</span><div className="movie-editor-bottom-actions"><button className="secondary-button" onClick={undo} disabled={!history.length}><Undo2 size={15} />Undo</button><button className="secondary-button" onClick={redo} disabled={!future.length}><Redo2 size={15} />Redo</button><button className="primary-button" onClick={() => void exportMovie()} disabled={busy === 'export' || project.clips.filter((clip) => clip.trackId === 'v1').length < 2}>{busy === 'export' ? <LoaderCircle className="spin" size={15} /> : <Scissors size={15} />}Export movie</button></div></footer>
  </div>
}
