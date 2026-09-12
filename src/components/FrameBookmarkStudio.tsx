import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Check, Clock3, FolderOpen, Image as ImageIcon, LoaderCircle, Play, Plus, Save, Trash2, X } from 'lucide-react'
import type { AppSettings, MediaFile } from '../types'
import { createId } from '../lib/createId'

export type BookmarkVideo = { id: string; name: string; source: string; duration?: number; provider?: 'minimax' | 'ltx25' }
type FrameBookmark = { id: string; label: string; time: number; frame?: MediaFile }
type BookmarkProject = BookmarkVideo & { createdAt: number; updatedAt: number; bookmarks: FrameBookmark[] }

const STORAGE_KEY = 'minimax.frame-bookmarks'

function loadProjects() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BookmarkProject[]
    return stored.filter((project) => project.id && project.source).map((project) => ({ ...project, bookmarks: Array.isArray(project.bookmarks) ? project.bookmarks : [] }))
  } catch { return [] }
}

function persistProjects(projects: BookmarkProject[]) {
  const stored = projects.map((project) => ({ ...project, bookmarks: project.bookmarks.map((bookmark) => {
    if (!bookmark.frame) return bookmark
    const frame = { ...bookmark.frame }
    delete frame.preview
    return { ...bookmark, frame }
  }) }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

function timecode(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0')
  const whole = Math.floor(safe % 60).toString().padStart(2, '0')
  const frames = Math.floor((safe % 1) * 24).toString().padStart(2, '0')
  return `${minutes}:${whole}:${frames}`
}

export function FrameBookmarkStudio({ initialVideo, videos, settings, onClose, onUseLtx, onNotice }: {
  initialVideo: BookmarkVideo
  videos: BookmarkVideo[]
  settings: AppSettings
  onClose(): void
  onUseLtx(file: MediaFile): void
  onNotice(tone: 'error' | 'success' | 'neutral', text: string): void
}) {
  const [projects, setProjects] = useState<BookmarkProject[]>(() => {
    const stored = loadProjects()
    if (stored.some((project) => project.id === initialVideo.id)) return stored
    const now = Date.now()
    return [...stored, { ...initialVideo, createdAt: now, updatedAt: now, bookmarks: [] }]
  })
  const [activeId, setActiveId] = useState(initialVideo.id)
  const hydrationProjects = useRef(projects)
  const [currentTime, setCurrentTime] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const active = projects.find((project) => project.id === activeId) ?? projects[0]
  const duration = Math.max(.01, active?.duration ?? 0)
  const savedFrames = useMemo(() => projects.flatMap((project) => project.bookmarks.filter((bookmark) => bookmark.frame).map((bookmark) => ({ project, bookmark, frame: bookmark.frame! }))).sort((a, b) => b.project.updatedAt - a.project.updatedAt), [projects])

  useEffect(() => persistProjects(projects), [projects])
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape) }
  }, [onClose])
  useEffect(() => {
    let disposed = false
    const missing = hydrationProjects.current.flatMap((project) => project.bookmarks.map((bookmark) => ({ projectId: project.id, bookmark })).filter(({ bookmark }) => bookmark.frame && !bookmark.frame.preview))
    if (!missing.length) return
    void Promise.all(missing.map(async ({ projectId, bookmark }) => {
      try { return { projectId, bookmarkId: bookmark.id, preview: await window.minimax.mediaUrl(bookmark.frame!.path) } }
      catch { return null }
    })).then((resolved) => {
      if (disposed) return
      setProjects((current) => current.map((project) => ({ ...project, bookmarks: project.bookmarks.map((bookmark) => {
        const match = resolved.find((item) => item?.projectId === project.id && item.bookmarkId === bookmark.id)
        return match && bookmark.frame ? { ...bookmark, frame: { ...bookmark.frame, preview: match.preview } } : bookmark
      }) })))
    })
    return () => { disposed = true }
  }, [])

  const patchProject = (id: string, change: (project: BookmarkProject) => BookmarkProject) => setProjects((current) => current.map((project) => project.id === id ? { ...change(project), updatedAt: Date.now() } : project))
  const seek = (time: number) => {
    const next = Math.max(0, Math.min(active?.duration ?? Number.POSITIVE_INFINITY, time))
    setCurrentTime(next)
    if (videoRef.current) videoRef.current.currentTime = next
  }
  const selectVideo = (video: BookmarkVideo) => {
    setProjects((current) => current.some((project) => project.id === video.id) ? current : [...current, { ...video, createdAt: Date.now(), updatedAt: Date.now(), bookmarks: [] }])
    setActiveId(video.id); setCurrentTime(0)
  }
  const chooseLocal = async () => {
    const file = await window.minimax.chooseMedia('video')
    if (!file) return
    selectVideo({ id: `local-${file.path}`, name: file.name, source: await window.minimax.mediaUrl(file.path) })
  }
  const addBookmark = () => {
    if (!active) return
    const at = Math.max(0, Math.min(active.duration ?? currentTime, currentTime))
    patchProject(active.id, (project) => ({ ...project, bookmarks: [...project.bookmarks, { id: createId(), label: `Start frame ${project.bookmarks.length + 1}`, time: at }].sort((a, b) => a.time - b.time) }))
  }
  const extract = async (project: BookmarkProject, bookmark: FrameBookmark) => {
    setBusy(bookmark.id)
    try {
      const result = await window.minimax.extractVideoFrame(project.source, bookmark.time, settings.outputDirectory, settings.ffmpegPath)
      const frame: MediaFile = { ...result, kind: 'image', preview: await window.minimax.mediaUrl(result.path) }
      patchProject(project.id, (current) => ({ ...current, bookmarks: current.bookmarks.map((item) => item.id === bookmark.id ? { ...item, frame } : item) }))
      return frame
    } catch (error) {
      onNotice('error', error instanceof Error ? error.message : String(error))
      return null
    } finally { setBusy(null) }
  }
  const extractAll = async () => {
    if (!active) return
    const pending = active.bookmarks.filter((bookmark) => !bookmark.frame)
    if (!pending.length) return onNotice('neutral', 'Every bookmark in this clip is already saved as a start frame.')
    setBusy('all')
    try {
      const results = await window.minimax.extractVideoFrames(active.source, pending.map((bookmark) => bookmark.time), settings.outputDirectory, settings.ffmpegPath)
      const frames = await Promise.all(results.map(async (result) => ({ ...result, kind: 'image' as const, preview: await window.minimax.mediaUrl(result.path) })))
      patchProject(active.id, (project) => ({ ...project, bookmarks: project.bookmarks.map((item) => {
        const index = pending.findIndex((bookmark) => bookmark.id === item.id)
        return index >= 0 && frames[index] ? { ...item, frame: frames[index] } : item
      }) }))
      onNotice('success', `${frames.length} bookmarked frame${frames.length === 1 ? '' : 's'} saved to Oyama AI Video Studio Frames.`)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setBusy(null) }
  }

  if (!active) return null
  return <div className="frame-bookmark-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="frame-bookmark-modal" role="dialog" aria-modal="true" aria-labelledby="frame-bookmark-title">
      <header><div><span><Bookmark size={18} /></span><div><small>LIBRARY TOOL</small><strong id="frame-bookmark-title">Frame bookmarks</strong><p>Mark useful moments, extract them as stills, and reuse them as LTX 2.5 starting frames.</p></div></div><button onClick={onClose} aria-label="Close frame bookmarks"><X size={19} /></button></header>
      <div className="frame-bookmark-body">
        <div className="frame-source-toolbar"><label>Source video<select value={active.id} onChange={(event) => { const video = videos.find((item) => item.id === event.target.value); if (video) selectVideo(video); else setActiveId(event.target.value) }}>{[...videos, ...projects.filter((project) => !videos.some((video) => video.id === project.id))].map((video) => <option key={video.id} value={video.id}>{video.name}</option>)}</select></label><button className="secondary-button" onClick={() => void chooseLocal()}><FolderOpen size={14} />Choose another video</button></div>
        <div className="frame-bookmark-workspace">
          <section className="frame-viewer">
            <div className="frame-video-stage"><video ref={videoRef} key={active.source} src={active.source} controls playsInline preload="metadata" onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) patchProject(active.id, (project) => ({ ...project, duration: nextDuration })) }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} /></div>
            <div className="bookmark-timeline"><div><span><Clock3 size={13} />{timecode(currentTime)}</span><span>{timecode(duration)}</span></div><input aria-label="Frame position" type="range" min="0" max={duration} step={1 / 24} value={Math.min(currentTime, duration)} onChange={(event) => seek(Number(event.target.value))} />{active.bookmarks.map((bookmark) => <button key={bookmark.id} style={{ left: `${Math.min(100, (bookmark.time / duration) * 100)}%` }} onClick={() => seek(bookmark.time)} aria-label={`Seek to ${bookmark.label} at ${timecode(bookmark.time)}`} title={`${bookmark.label} · ${timecode(bookmark.time)}`}><span /></button>)}</div>
            <div className="frame-viewer-actions"><span><strong>{active.name}</strong><small>{active.provider === 'ltx25' ? 'LTX 2.5 render' : active.provider === 'minimax' ? 'MiniMax H3 render' : 'Local video'} · {active.bookmarks.length} bookmark{active.bookmarks.length === 1 ? '' : 's'}</small></span><button className="primary-button" onClick={addBookmark}><Plus size={15} />Add bookmark here</button></div>
          </section>
          <aside className="bookmark-list-panel">
            <header><span><strong>Clip bookmarks</strong><small>Frame-accurate positions at 24 fps</small></span><button className="secondary-button" disabled={!active.bookmarks.some((bookmark) => !bookmark.frame) || Boolean(busy)} onClick={() => void extractAll()}>{busy === 'all' ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}Extract all</button></header>
            {active.bookmarks.length === 0 ? <div className="bookmark-empty"><Bookmark size={24} /><strong>No bookmarks yet</strong><span>Scrub or play the clip, then mark the current frame.</span></div> : <div className="bookmark-list">{active.bookmarks.map((bookmark, index) => <article key={bookmark.id} className={bookmark.frame ? 'saved' : ''}>
              <button className="bookmark-seek" onClick={() => seek(bookmark.time)} aria-label={`Preview ${bookmark.label}`}>{bookmark.frame?.preview ? <img src={bookmark.frame.preview} alt="" /> : <span><Play size={14} /></span>}</button>
              <div><input aria-label={`Bookmark ${index + 1} name`} value={bookmark.label} onChange={(event) => patchProject(active.id, (project) => ({ ...project, bookmarks: project.bookmarks.map((item) => item.id === bookmark.id ? { ...item, label: event.target.value } : item) }))} /><label><Clock3 size={11} /><input aria-label={`${bookmark.label} time in seconds`} type="number" min="0" max={active.duration} step={1 / 24} value={bookmark.time.toFixed(3)} onChange={(event) => patchProject(active.id, (project) => ({ ...project, bookmarks: project.bookmarks.map((item) => item.id === bookmark.id ? { ...item, time: Math.max(0, Number(event.target.value)) } : item) }))} /><span>{timecode(bookmark.time)}</span></label></div>
              <div className="bookmark-actions">{bookmark.frame ? <button className="bookmark-ltx" onClick={() => onUseLtx(bookmark.frame!)} title="Use in LTX 2.5"><ImageIcon size={14} /><span>LTX</span></button> : <button onClick={() => void extract(active, bookmark)} disabled={Boolean(busy)} title="Extract this frame">{busy === bookmark.id ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}</button>}<button onClick={() => patchProject(active.id, (project) => ({ ...project, bookmarks: project.bookmarks.filter((item) => item.id !== bookmark.id) }))} aria-label={`Remove ${bookmark.label}`} title="Remove bookmark; extracted file stays on disk"><Trash2 size={14} /></button></div>
            </article>)}</div>}
          </aside>
        </div>
        <section className="saved-frame-library"><header><span><strong>Saved start frames</strong><small>{savedFrames.length} reusable still{savedFrames.length === 1 ? '' : 's'} across all bookmarked clips</small></span><button className="secondary-button" onClick={() => void window.minimax.showOutput(settings.outputDirectory)}><FolderOpen size={14} />Open output folder</button></header>{savedFrames.length === 0 ? <div className="saved-frame-empty"><ImageIcon size={20} /><span>Extract a bookmark to add it to this reusable frame shelf.</span></div> : <div>{savedFrames.map(({ project, bookmark, frame }) => <article key={`${project.id}-${bookmark.id}`}><img src={frame.preview} alt={`${bookmark.label} from ${project.name}`} /><div><strong title={bookmark.label}>{bookmark.label}</strong><small title={project.name}>{project.name} · {timecode(bookmark.time)}</small></div><button onClick={() => onUseLtx(frame)}><ImageIcon size={14} />Use in LTX 2.5</button></article>)}</div>}</section>
      </div>
      <footer><span><Check size={14} />Extracted PNG files remain in Oyama AI Video Studio Frames even if a bookmark is removed.</span><button className="secondary-button" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
