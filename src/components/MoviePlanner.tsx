import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CirclePause, CirclePlay, Clapperboard, Clock3, Film, ImagePlus, LoaderCircle, MapPin, MessageSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, SkipBack, SkipForward, Sparkles, Trash2, Users, X } from 'lucide-react'
import { CHARACTER_LIBRARY_EVENT, characterReferences, loadCharacterProjects } from '../lib/characterLibrary'
import { LOCATION_LIBRARY_EVENT, loadLocationProjects, locationReferences } from '../lib/locationLibrary'
import { composeReferenceInstructions, resolveMovieShot } from '../lib/promptComposer'
import { SmartPromptEditor, type SmartInsertOption } from './SmartPromptEditor'
import { MINIMAX_VIDEO_RESOLUTIONS } from '../lib/videoResolutions'
import { createId } from '../lib/createId'
import type { AppSettings, CharacterProject, GenerationJob, GenerationMode, LocationProject, MediaFile, MovieCharacter, MovieChatArea, MovieLocation, MovieProject, MovieScene, MovieShot, ResolvedMovieShot } from '../types'
import { resolveLlmConnection } from '../lib/llmProvider'

type PlannerStep = 'setup' | 'bible' | 'shots' | 'runner' | 'preview'

const plannerSchema: Record<string, unknown> = {
  type: 'object', properties: { scenes: { type: 'array', minItems: 1, maxItems: 24, items: {
    type: 'object', properties: {
      title: { type: 'string' }, summary: { type: 'string' }, location: { type: 'string' },
      shots: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', properties: {
        title: { type: 'string' }, duration: { type: 'number', minimum: 2, maximum: 15 }, prompt: { type: 'string' },
        dialogue: { type: 'string' }, mode: { type: 'string', enum: ['text', 'image', 'frames', 'reference'] },
        characters: { type: 'array', items: { type: 'string' } },
      }, required: ['title', 'duration', 'prompt', 'dialogue', 'mode', 'characters'] } },
    }, required: ['title', 'summary', 'location', 'shots'],
  } } }, required: ['scenes'],
}
const characterSchema: Record<string, unknown> = { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, wardrobe: { type: 'string' }, voiceNotes: { type: 'string' } }, required: ['name', 'description', 'wardrobe', 'voiceNotes'] }
const locationSchema: Record<string, unknown> = { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name', 'description'] }
const IMPORT_CHARACTER_EVENT = 'minimax-import-library-character'
const IMPORT_LOCATION_EVENT = 'minimax-import-library-location'
const MOVIE_UNDO_HISTORY_KEY = 'minimax.movie-undo-history'
const MOVIE_UNDO_LIMIT = 10
const LARGE_SHOT_DELETE_THRESHOLD = 3
const movieChatSchema: Record<string, unknown> = {
  type: 'object', properties: {
    reply: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } },
    focusAreas: { type: 'array', items: { type: 'string', enum: ['setup', 'bible', 'shots', 'preview'] } },
    projectPatch: { type: 'object', properties: { title: { type: 'string' }, targetRuntime: { type: 'number' }, computeBudgetMinutes: { type: 'number' }, aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'] }, genre: { type: 'string' }, visualStyle: { type: 'string' }, story: { type: 'string' }, visualRules: { type: 'string' } }, required: ['title', 'targetRuntime', 'computeBudgetMinutes', 'aspectRatio', 'genre', 'visualStyle', 'story', 'visualRules'] },
    characterUpserts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, wardrobe: { type: 'string' }, voiceNotes: { type: 'string' } }, required: ['id', 'name', 'description', 'wardrobe', 'voiceNotes'] } },
    characterDeletes: { type: 'array', items: { type: 'string' } },
    locationUpserts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['id', 'name', 'description'] } },
    locationDeletes: { type: 'array', items: { type: 'string' } },
    sceneUpserts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, locationId: { type: 'string' }, transition: { type: 'string', enum: ['connected', 'cut'] } }, required: ['id', 'title', 'summary', 'locationId', 'transition'] } },
    sceneDeletes: { type: 'array', items: { type: 'string' } },
    shotUpserts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sceneId: { type: 'string' }, title: { type: 'string' }, prompt: { type: 'string' }, dialogue: { type: 'string' }, duration: { type: 'number' }, mode: { type: 'string', enum: ['text', 'image', 'frames', 'reference'] }, characterIds: { type: 'array', items: { type: 'string' } } }, required: ['id', 'sceneId', 'title', 'prompt', 'dialogue', 'duration', 'mode', 'characterIds'] } },
    shotDeletes: { type: 'array', items: { type: 'string' } },
  }, required: ['reply', 'changes', 'focusAreas', 'projectPatch', 'characterUpserts', 'characterDeletes', 'locationUpserts', 'locationDeletes', 'sceneUpserts', 'sceneDeletes', 'shotUpserts', 'shotDeletes'],
}

type MovieRevisionDiff = {
  id: string
  area: MovieChatArea
  kind: 'add' | 'change' | 'remove'
  label: string
  before?: string
  after?: string
  destructive?: boolean
}

type PendingMovieRevision = {
  projectId: string
  baseUpdatedAt: number
  question: string
  reply: string
  changes: string[]
  areas: MovieChatArea[]
  raw: MovieChatResult
  preview: MovieProject
  diffs: MovieRevisionDiff[]
}

type MovieUndoEntry = { id: string; createdAt: number; label: string; snapshot: MovieProject }
type MovieUndoHistory = Record<string, MovieUndoEntry[]>

function makeProject(index = 1): MovieProject {
  const now = Date.now()
  return { id: createId(), title: index === 1 ? 'Untitled movie' : `Movie ${index}`, createdAt: now, updatedAt: now, status: 'planning', targetRuntime: 60, computeBudgetMinutes: 120, aspectRatio: '16:9', genre: '', visualStyle: '', story: '', visualRules: '', characters: [], locations: [], scenes: [], chatMessages: [] }
}

function normalizeShotStage(value: unknown, hasOutput: boolean): MovieShot['stage'] {
  if (value === 'rendered') return 'review'
  if (value === 'planned' || value === 'ready' || value === 'rendering' || value === 'review' || value === 'approved' || value === 'locked') return value
  return hasOutput ? 'review' : 'planned'
}

function loadProjects(): MovieProject[] {
  try {
    const stored = JSON.parse(localStorage.getItem('minimax.movie-projects') ?? '[]') as Array<Partial<MovieProject> & { quality?: unknown; reviewGate?: unknown }>
    const projects = stored.filter((item) => item.id && item.title).map((item, index) => {
      const sanitized = { ...item }
      delete sanitized.quality
      delete sanitized.reviewGate
      return {
      ...makeProject(index + 1), ...sanitized,
      characters: (item.characters ?? []).map((character) => ({ ...character, referenceImages: character.referenceImages ?? [] })),
      locations: (item.locations ?? []).map((location) => ({ ...location, referenceImages: location.referenceImages ?? [] })),
      scenes: (item.scenes ?? []).map((scene, sceneIndex) => {
        const shots = (scene.shots ?? []).map((shot) => ({ ...shot, preferredMode: shot.preferredMode ?? shot.mode ?? 'text', characterIds: shot.characterIds ?? [], referenceImages: shot.referenceImages ?? [], referenceVideos: shot.referenceVideos ?? [], referenceAudios: shot.referenceAudios ?? [], outputPath: shot.outputPath ?? localPathFromMediaUrl(shot.outputUrl), stage: normalizeShotStage(shot.stage, Boolean(shot.outputUrl)) }))
        return { ...scene, transition: scene.transition ?? (sceneIndex === 0 ? 'cut' : 'connected'), stage: scene.stage ?? (shots.length && shots.every((shot) => shot.outputUrl) ? 'review' as const : 'planned' as const), shots }
      }),
      chatMessages: item.chatMessages ?? [],
    }}) as MovieProject[]
    return projects.length ? projects : [makeProject()]
  } catch { return [makeProject()] }
}

function localPathFromMediaUrl(value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'minimax-media:' && (url.hostname === 'selected' || url.hostname === 'local') ? url.searchParams.get('path') ?? undefined : undefined
  } catch { return undefined }
}

function outputPathForShot(shot: MovieShot, jobs: GenerationJob[], projectId: string, sceneId: string) {
  const job = jobs.find((item) => item.movieLink?.projectId === projectId && item.movieLink.sceneId === sceneId && item.movieLink.shotId === shot.id && item.status === 'completed')
  return shot.outputPath ?? job?.localOutputPath ?? localPathFromMediaUrl(shot.outputUrl)
}

function productionSettingsFor(project: MovieProject, workingSeed: number): NonNullable<MovieProject['productionSettings']> {
  return {
    resolution: project.productionSettings?.resolution ?? (project.aspectRatio === '9:16' ? '768x1344' : project.aspectRatio === '1:1' ? '768x768' : '1344x768'),
    turbo: project.productionSettings?.turbo ?? 'off',
    steps: project.productionSettings?.steps ?? 30,
    seed: project.productionSettings?.seed ?? workingSeed,
    noDialogue: project.productionSettings?.noDialogue ?? true,
    naturalMovement: project.productionSettings?.naturalMovement ?? true,
  }
}

function loadMovieUndoHistory(): MovieUndoHistory {
  try {
    const stored = JSON.parse(localStorage.getItem(MOVIE_UNDO_HISTORY_KEY) ?? '{}') as MovieUndoHistory
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
  } catch { return {} }
}

export function MoviePlanner({ settings, jobs, workingSeed, connected, ollamaAvailable, ollamaModel, onOpenShot, onNotice }: {
  settings: AppSettings; jobs: GenerationJob[]; workingSeed: number; connected: boolean; ollamaAvailable: boolean; ollamaModel: string
  onOpenShot(shot: MovieShot, aspectRatio: MovieProject['aspectRatio'], resolved: ResolvedMovieShot, context: { projectId: string; sceneId: string; continuationSource?: string; continuityFrame?: MediaFile; autoStart?: boolean; renderSettings?: MovieProject['productionSettings'] }): void
  onNotice(tone: 'error' | 'success' | 'neutral', text: string): void
}) {
  const [projects, setProjects] = useState<MovieProject[]>(loadProjects)
  const [projectId, setProjectId] = useState(() => projects[0].id)
  const [step, setStep] = useState<PlannerStep>(() => projects[0].scenes.length ? 'runner' : 'setup')
  const [planning, setPlanning] = useState(false)
  const [assisting, setAssisting] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatting, setChatting] = useState(false)
  const [pendingChatRevision, setPendingChatRevision] = useState<PendingMovieRevision | null>(null)
  const [undoHistory, setUndoHistory] = useState<MovieUndoHistory>(loadMovieUndoHistory)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [characterDraft, setCharacterDraft] = useState<MovieCharacter | null>(null)
  const [characterLibrary, setCharacterLibrary] = useState<CharacterProject[]>(loadCharacterProjects)
  const [locationLibrary, setLocationLibrary] = useState<LocationProject[]>(loadLocationProjects)
  const [locationDraft, setLocationDraft] = useState<MovieLocation | null>(null)
  const [expandedScenes, setExpandedScenes] = useState<string[]>(() => projects[0].scenes[0] ? [projects[0].scenes[0].id] : [])
  const [expandedShots, setExpandedShots] = useState<string[]>([])
  const llm = resolveLlmConnection(settings)
  const project = projects.find((item) => item.id === projectId) ?? projects[0]
  const plannedSeconds = useMemo(() => project.scenes.reduce((total, scene) => total + scene.shots.reduce((sum, shot) => sum + shot.duration, 0), 0), [project.scenes])
  const shotCount = project.scenes.reduce((total, scene) => total + scene.shots.length, 0)
  const renderedClips = useMemo(() => project.scenes.flatMap((scene, sceneIndex) => scene.shots.map((shot, shotIndex) => ({ scene, sceneIndex, shot, shotIndex })).filter((item) => item.shot.outputUrl)), [project.scenes])

  useEffect(() => {
    const refresh = () => setCharacterLibrary(loadCharacterProjects())
    window.addEventListener(CHARACTER_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(CHARACTER_LIBRARY_EVENT, refresh)
  }, [])
  useEffect(() => {
    const refresh = () => setLocationLibrary(loadLocationProjects())
    window.addEventListener(LOCATION_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(LOCATION_LIBRARY_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (!characterDraft && !locationDraft) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setCharacterDraft(null); setLocationDraft(null) } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [characterDraft, locationDraft])

  useEffect(() => {
    setPreviewIndex((value) => Math.min(value, Math.max(0, renderedClips.length - 1)))
  }, [project.id, renderedClips.length])

  useEffect(() => { setPendingChatRevision(null) }, [project.id])

  const commit = (all: MovieProject[]) => { setProjects(all); localStorage.setItem('minimax.movie-projects', JSON.stringify(all)) }
  const commitUndoHistory = (next: MovieUndoHistory) => {
    setUndoHistory(next)
    try { localStorage.setItem(MOVIE_UNDO_HISTORY_KEY, JSON.stringify(next)) }
    catch { onNotice('neutral', 'Undo is available for this session, but its snapshot was too large to keep after restart.') }
  }
  const update = (change: (current: MovieProject) => MovieProject) => setProjects((currentProjects) => {
    const next = currentProjects.map((item) => item.id === project.id ? { ...change(item), updatedAt: Date.now() } : item)
    localStorage.setItem('minimax.movie-projects', JSON.stringify(next))
    return next
  })
  const updateScene = (id: string, change: Partial<MovieScene>) => update((value) => ({ ...value, scenes: value.scenes.map((item) => item.id === id ? { ...item, ...change } : item) }))
  const updateShot = (sceneId: string, shotId: string, change: Partial<MovieShot>) => update((value) => ({ ...value, scenes: value.scenes.map((scene) => scene.id === sceneId ? { ...scene, shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, ...change } : shot) } : scene) }))
  const addScene = () => {
    const id = createId()
    update((value) => ({ ...value, scenes: [...value.scenes, { id, title: `Scene ${value.scenes.length + 1}`, summary: '', locationId: value.locations[0]?.id ?? '', transition: value.scenes.length ? 'connected' : 'cut', shots: [] }] }))
    setExpandedScenes((value) => [...value, id])
  }
  const addShot = (sceneId: string) => update((value) => ({ ...value, scenes: value.scenes.map((scene) => scene.id === sceneId ? { ...scene, shots: [...scene.shots, makeShot(scene.shots.length + 1)] } : scene) }))

  // App writes completed ComfyUI outputs from its shared job monitor. Reload
  // those authoritative project changes instead of maintaining a second queue.
  useEffect(() => {
    const refresh = () => {
      const next = loadProjects()
      setProjects(next)
    }
    window.addEventListener('minimax-movie-production-updated', refresh)
    return () => window.removeEventListener('minimax-movie-production-updated', refresh)
  }, [])

  const queueRunnerShot = (scene: MovieScene, shot: MovieShot, approvedContinuityFrame?: MediaFile) => {
    if (!connected) return onNotice('error', 'Start ComfyUI and verify the Local engine connection before starting production.')
    if (project.status === 'paused') return onNotice('error', 'Resume this movie before starting production.')
    if (shot.outputUrl) return onNotice('neutral', `${shot.title} already has an attached output.`)
    if (jobs.some((item) => item.movieLink?.projectId === project.id && item.movieLink.sceneId === scene.id && item.movieLink.shotId === shot.id && ['queued', 'running'].includes(item.status))) return onNotice('neutral', `${shot.title} is already queued in ComfyUI.`)
    if (!shot.prompt.trim()) return onNotice('error', `${shot.title} needs a production prompt before it can render.`)
    const firstPending = scene.shots.find((item) => !item.outputUrl)
    if (firstPending?.id !== shot.id) return onNotice('error', `Finish ${firstPending?.title ?? 'the preceding shot'} before rendering ${shot.title}.`)
    const shotIndex = scene.shots.findIndex((item) => item.id === shot.id)
    const predecessor = shotIndex > 0 ? scene.shots[shotIndex - 1] : undefined
    if (predecessor && !predecessor.outputUrl) return onNotice('error', `Finish ${predecessor.title} before continuing this scene.`)
    const sceneIndex = project.scenes.findIndex((item) => item.id === scene.id)
    const priorScene = shotIndex === 0 && scene.transition === 'connected' ? project.scenes[sceneIndex - 1] : undefined
    if (priorScene && priorScene.stage !== 'locked' && !approvedContinuityFrame) return onNotice('error', `Approve and lock ${priorScene.title} before continuing into ${scene.title}.`)
    const predecessorPath = predecessor ? outputPathForShot(predecessor, jobs, project.id, scene.id) : undefined
    const priorFinalShot = priorScene?.shots.at(-1)
    const priorVideoPath = priorScene && priorFinalShot ? outputPathForShot(priorFinalShot, jobs, project.id, priorScene.id) : undefined
    const continuityFrame = predecessor ? undefined : approvedContinuityFrame ?? priorScene?.continuityFrame
    const continuitySource = predecessor ? predecessorPath : continuityFrame ? undefined : priorVideoPath
    const continuityOwner = predecessor ?? priorFinalShot
    if (continuityOwner && !continuityFrame && !continuitySource) return onNotice('error', `The local video for ${continuityOwner.title} is unavailable. Replace or rerender that shot before continuing.`)
    const continuityBinding = continuityFrame ?? (continuitySource ? { path: continuitySource, name: `${continuityOwner?.title ?? 'Previous scene'} final frame`, kind: 'image' as const } : undefined)
    const resolved = resolveMovieShot(project, scene, shot, characterLibrary, continuityBinding)
    if (resolved.omittedReferences.length) return onNotice('error', `${shot.title} exceeds the nine-image reference limit. Reduce assigned references first.`)
    // Keep the persisted runner retryable until App has created a real queue
    // job. The live job itself drives the Rendering label; failed validation or
    // an offline handoff therefore cannot strand a scene in Rendering.
    update((value) => ({ ...value, scenes: value.scenes.map((item) => item.id !== scene.id ? item : { ...item, stage: 'ready', previewUrl: undefined, approvedAt: undefined, lockedAt: undefined, continuityFrame: undefined, continuityState: undefined, shots: item.shots.map((candidate) => candidate.id === shot.id ? { ...candidate, stage: 'ready' } : candidate) }) }))
    onOpenShot(shot, project.aspectRatio, resolved, { projectId: project.id, sceneId: scene.id, continuationSource: continuitySource, continuityFrame, autoStart: true, renderSettings: productionSettingsFor(project, workingSeed) })
  }

  const assembleScene = async (scene: MovieScene) => {
    const clips = scene.shots.map((shot) => ({ source: outputPathForShot(shot, jobs, project.id, scene.id) ?? shot.outputUrl ?? '' }))
    const missing = clips.findIndex((clip) => !clip.source)
    if (missing >= 0) {
      onNotice('error', `${scene.shots[missing].title} has no accessible output, so the scene preview cannot be assembled.`)
      return
    }
    try {
      const joined = await window.minimax.joinVideos(clips, settings.outputDirectory, settings.ffmpegPath)
      updateScene(scene.id, { previewUrl: joined.url, stage: 'review', continuityState: `All ${scene.shots.length} shots rendered and assembled in story order. Review before locking continuity.` })
      onNotice('success', `${scene.title} is ready for scene review.`)
    } catch (error) { onNotice('error', `Shots finished, but the scene preview could not be assembled: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const approveRunnerScene = async (scene: MovieScene) => {
    const finalShot = scene.shots.at(-1)
    if (!finalShot?.outputUrl) { onNotice('error', 'Every shot needs an output before this scene can be approved.'); return }
    updateScene(scene.id, { stage: 'approved', continuityState: 'Approved. Saving the final continuity frame and locking the scene…' })
    try {
      const source = outputPathForShot(finalShot, jobs, project.id, scene.id) ?? finalShot.outputUrl
      const frame = await window.minimax.extractVideoFrame(source, 'last', settings.outputDirectory, settings.ffmpegPath)
      const continuityFrame = { ...frame, kind: 'image' as const, preview: await window.minimax.mediaUrl(frame.path) }
      const lockedAt = Date.now()
      updateScene(scene.id, { stage: 'locked', approvedAt: lockedAt, lockedAt, continuityFrame, continuityState: `Locked from ${finalShot.title}. ${frame.name} is the approved continuity anchor.`, shots: scene.shots.map((shot) => ({ ...shot, stage: 'locked' })) })
      onNotice('success', `${scene.title} approved and locked.`)
      const nextScene = project.scenes[project.scenes.findIndex((item) => item.id === scene.id) + 1]
      if (project.autoContinueCleanScenes && nextScene?.shots[0] && !nextScene.shots.some((shot) => shot.outputUrl)) {
        queueRunnerShot(nextScene, nextScene.shots[0], nextScene.transition === 'connected' ? continuityFrame : undefined)
      }
    } catch (error) {
      updateScene(scene.id, { stage: 'review', continuityState: 'Approval could not be completed. Review remains open and no continuity lock was changed.' })
      onNotice('error', `Could not save the final continuity frame: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const replaceRunnerShotOutput = async (scene: MovieScene, shot: MovieShot) => {
    try {
      const picked = await window.minimax.chooseMedia('video')
      if (!picked) return
      const outputUrl = await window.minimax.mediaUrl(picked.path)
      const shots = scene.shots.map((item) => item.id === shot.id ? { ...item, outputUrl, outputPath: picked.path, renderJobId: undefined, renderedAt: Date.now(), stage: 'review' as const } : item)
      updateScene(scene.id, { shots, previewUrl: undefined, stage: shots.every((item) => item.outputUrl) ? 'rendering' : 'planned', approvedAt: undefined, lockedAt: undefined, continuityFrame: undefined, continuityState: `${shot.title} was replaced with ${picked.name}. Rebuilding the scene preview…` })
      onNotice('success', `${picked.name} attached to ${shot.title}.`)
    } catch (error) { onNotice('error', `Could not replace ${shot.title}: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const rerenderRunnerShot = (scene: MovieScene, shot: MovieShot) => {
    const shots = scene.shots.map((item) => item.id === shot.id ? { ...item, outputUrl: undefined, outputPath: undefined, renderJobId: undefined, renderedAt: undefined, stage: 'planned' as const } : item)
    updateScene(scene.id, { shots, previewUrl: undefined, stage: 'planned', approvedAt: undefined, lockedAt: undefined, continuityFrame: undefined, continuityState: `${shot.title} is ready to rerender. The scene preview will rebuild when it finishes.` })
  }

  const requireOllama = () => {
    if (ollamaAvailable) return true
    onNotice('error', `No local ${llm.label} text model is available. Manual editing remains available.`)
    return false
  }
  const runTextAssistant = async (key: string, request: string, apply: (result: string) => void) => {
    if (!requireOllama()) return
    setAssisting(key)
    try {
      const result = (await window.minimax.generateWithOllama(llm.url, ollamaModel, request, llm.provider)).trim()
      if (!result) throw new Error(`${llm.label} returned an empty response.`)
      apply(result); onNotice('success', `Updated locally with ${ollamaModel}. Review the result before continuing.`)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setAssisting(null) }
  }
  const assistStory = () => {
    if (!project.story.trim()) { onNotice('error', `Write a short premise first so ${llm.label} has a direction to develop.`); return }
    void runTextAssistant('story', ['Rewrite the supplied premise as a concise, production-ready film treatment. Preserve all stated facts and ending. Add clear dramatic beats and only necessary dialogue. Return only the treatment.', `Genre: ${project.genre || 'unspecified'}`, `Visual style: ${project.visualStyle || 'unspecified'}`, `Target runtime: ${project.targetRuntime} seconds`, `Premise: ${project.story}`].join('\n\n'), (story) => update((value) => ({ ...value, story })))
  }
  const assistRules = () => void runTextAssistant('rules', [
    'Create a compact continuity bible for this AI-generated film. Cover palette, lighting, lenses, camera movement, aspect ratio, recurring props, wardrobe continuity, time of day, and changes to avoid. Return only practical rules.',
    `Story: ${project.story || 'No story supplied'}`, `Style: ${project.visualStyle || 'unspecified'}`, `Aspect: ${project.aspectRatio}`,
    `Characters: ${JSON.stringify(project.characters.map(({ name, description, wardrobe, voiceNotes }) => ({ name, description, wardrobe, voiceNotes })))}`,
    `Locations: ${JSON.stringify(project.locations.map(({ name, description }) => ({ name, description })))}`,
  ].join('\n\n'), (visualRules) => update((value) => ({ ...value, visualRules })))

  const assistCharacter = async () => {
    if (!characterDraft || !requireOllama()) return
    setAssisting('character')
    try {
      const raw = await window.minimax.generateStructuredWithOllama(llm.url, ollamaModel, ['Create or improve one recurring movie character. Make the appearance visually specific and repeatable between AI video shots. Wardrobe and voice must be concise continuity anchors. Return only the requested data.', `Film: ${project.title}`, `Genre: ${project.genre || 'unspecified'}`, `Style: ${project.visualStyle || 'unspecified'}`, `Story: ${project.story || 'No story supplied'}`, `Existing character notes: ${JSON.stringify(characterDraft)}`].join('\n\n'), characterSchema, llm.provider) as Partial<MovieCharacter>
      setCharacterDraft((value) => value ? { ...value, name: text(raw.name) || value.name, description: text(raw.description) || value.description, wardrobe: text(raw.wardrobe) || value.wardrobe, voiceNotes: text(raw.voiceNotes) || value.voiceNotes } : value)
      onNotice('success', `Character draft improved locally with ${ollamaModel}.`)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setAssisting(null) }
  }
  const assistLocation = async () => {
    if (!locationDraft || !requireOllama()) return
    setAssisting('location')
    try {
      const raw = await window.minimax.generateStructuredWithOllama(llm.url, ollamaModel, ['Create or improve one recurring movie location. Describe stable architecture, geography, layout, materials, lighting sources, atmosphere, and repeatable landmarks for visual continuity. Return only the requested data.', `Film: ${project.title}`, `Genre: ${project.genre || 'unspecified'}`, `Style: ${project.visualStyle || 'unspecified'}`, `Story: ${project.story || 'No story supplied'}`, `Existing location notes: ${JSON.stringify(locationDraft)}`].join('\n\n'), locationSchema, llm.provider) as Partial<MovieLocation>
      setLocationDraft((value) => value ? { ...value, name: text(raw.name) || value.name, description: text(raw.description) || value.description } : value)
      onNotice('success', `Location draft improved locally with ${ollamaModel}.`)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setAssisting(null) }
  }
  const addDraftReference = async (kind: 'character' | 'location') => {
    try {
      const picked = await window.minimax.chooseMedia('image')
      if (!picked) return
      const file: MediaFile = { ...picked, kind: 'image', preview: await window.minimax.mediaUrl(picked.path) }
      if (kind === 'character') setCharacterDraft((value) => value ? { ...value, referenceImages: [...value.referenceImages, file] } : value)
      else setLocationDraft((value) => value ? { ...value, referenceImages: [...value.referenceImages, file] } : value)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
  }
  const saveCharacter = () => {
    if (!characterDraft?.name.trim()) { onNotice('error', 'Give the character a name before saving.'); return }
    update((value) => ({ ...value, characters: value.characters.some((item) => item.id === characterDraft.id) ? value.characters.map((item) => item.id === characterDraft.id ? characterDraft : item) : [...value.characters, characterDraft] })); setCharacterDraft(null)
  }
  useEffect(() => {
    const importCharacter = (event: Event) => {
      const source = characterLibrary.find((character) => character.id === (event as CustomEvent<string>).detail)
      if (!source) return
      if (project.characters.some((character) => character.libraryCharacterId === source.id)) { onNotice('neutral', `${source.name} is already in this movie.`); return }
      const character: MovieCharacter = { id: createId(), libraryCharacterId: source.id, libraryUpdatedAt: source.updatedAt, name: source.name, description: source.description, wardrobe: source.wardrobe, voiceNotes: source.voiceNotes, referenceImages: characterReferences(source, settings.characterDetailReferencesEnabled) }
      const next = projects.map((item) => item.id === project.id ? { ...item, updatedAt: Date.now(), characters: [...item.characters, character] } : item)
      commit(next)
      onNotice('success', `${source.name} and ${character.referenceImages.length} approved reference${character.referenceImages.length === 1 ? '' : 's'} added to this movie.`)
    }
    window.addEventListener(IMPORT_CHARACTER_EVENT, importCharacter)
    return () => window.removeEventListener(IMPORT_CHARACTER_EVENT, importCharacter)
  }, [characterLibrary, project.id, project.characters, projects, settings.characterDetailReferencesEnabled, onNotice])
  useEffect(() => {
    const importLocation = (event: Event) => {
      const source = locationLibrary.find((location) => location.id === (event as CustomEvent<string>).detail)
      if (source) importLibraryLocation(source)
    }
    window.addEventListener(IMPORT_LOCATION_EVENT, importLocation)
    return () => window.removeEventListener(IMPORT_LOCATION_EVENT, importLocation)
  })
  const refreshLibraryCharacter = (characterId: string) => {
    const character = project.characters.find((item) => item.id === characterId)
    const source = character?.libraryCharacterId ? characterLibrary.find((item) => item.id === character.libraryCharacterId) : undefined
    if (!character || !source) return
    update((value) => ({ ...value, characters: value.characters.map((item) => item.id === characterId ? { ...item, name: source.name, description: source.description, wardrobe: source.wardrobe, voiceNotes: source.voiceNotes, referenceImages: characterReferences(source, settings.characterDetailReferencesEnabled), libraryUpdatedAt: source.updatedAt } : item) }))
    onNotice('success', `${source.name} refreshed from Character Studio without changing shot assignments.`)
  }
  const importLibraryLocation = (source: LocationProject) => {
    if (project.locations.some((location) => location.libraryLocationId === source.id)) { onNotice('neutral', `${source.name} is already in this movie.`); return }
    const location: MovieLocation = { id: createId(), libraryLocationId: source.id, libraryUpdatedAt: source.updatedAt, environmentMode: source.environmentMode, name: source.name, description: [source.description, source.atmosphere, source.timeOfDay, source.continuityAnchors].filter(Boolean).join(' '), referenceImages: locationReferences(source) }
    update((value) => ({ ...value, locations: [...value.locations, location] }))
    onNotice('success', `${source.name} and ${location.referenceImages.length} approved location view${location.referenceImages.length === 1 ? '' : 's'} added to this movie.`)
  }
  const saveLocation = () => {
    if (!locationDraft?.name.trim()) { onNotice('error', 'Give the location a name before saving.'); return }
    update((value) => ({ ...value, locations: value.locations.some((item) => item.id === locationDraft.id) ? value.locations.map((item) => item.id === locationDraft.id ? locationDraft : item) : [...value.locations, locationDraft] })); setLocationDraft(null)
  }
  const assistShot = (scene: MovieScene, shot: MovieShot) => {
    const location = project.locations.find((item) => item.id === scene.locationId)
    const characters = project.characters.filter((item) => shot.characterIds.includes(item.id))
    const effective = resolveMovieShot(project, scene, shot, characterLibrary)
    void runTextAssistant(`shot:${shot.id}`, ['Rewrite this as one production-ready MiniMax H3 video prompt in this order: subject and identity anchor, starting state, environment, literal chronological action, shot size, camera angle, lens/depth of field, camera movement, lighting, visual treatment, continuity, exact dialogue, ambient sound/effects, then reference assignments. Preserve names, quoted dialogue, specified camera/lens choices, timing, negative constraints, continuity, and every <Picture N>, <Video N>, or <Audio N> tag. Do not rename characters, invent wardrobe, add cuts, create a montage, or repeat full saved identity descriptions. Use concise saved-character anchors instead. Return only the natural production prompt.', `Scene: ${scene.title} — ${scene.summary}`, `Location: ${location ? `${location.name}: ${location.description}` : 'unspecified'}`, `Saved character anchors: ${characters.map((item) => item.name).join(', ') || 'none'}`, `Continuity rules: ${project.visualRules || 'none'}`, `Duration: ${shot.duration} seconds`, `Effective generation route: ${effective.effectiveMode}`, `Reference map: ${effective.references.map((binding, index) => `<Picture ${index + 1}> = ${binding.label}`).join('; ') || 'none'}`, `Exact dialogue: ${shot.dialogue || 'none'}`, `Current creative prompt: ${shot.prompt || 'none'}`].join('\n\n'), (prompt) => updateShot(scene.id, shot.id, { prompt }))
  }

  const sendMovieChat = async (suggestedQuestion?: string) => {
    const question = (suggestedQuestion ?? chatInput).trim()
    if (!question || chatting || pendingChatRevision || !requireOllama()) return
    setChatting(true)
    try {
      const context = {
        project: { title: project.title, targetRuntime: project.targetRuntime, computeBudgetMinutes: project.computeBudgetMinutes, aspectRatio: project.aspectRatio, genre: project.genre, visualStyle: project.visualStyle, story: project.story, visualRules: project.visualRules },
        characters: project.characters.map(({ id, name, description, wardrobe, voiceNotes }) => ({ id, name, description, wardrobe, voiceNotes })),
        locations: project.locations.map(({ id, name, description }) => ({ id, name, description })),
        scenes: project.scenes.map((scene) => ({ id: scene.id, title: scene.title, summary: scene.summary, locationId: scene.locationId, transition: scene.transition, shots: scene.shots.map(({ id, title, duration, prompt, dialogue, mode, characterIds, stage }) => ({ id, title, duration, prompt, dialogue, mode, characterIds, stage })) })),
        recentConversation: project.chatMessages.slice(-20).map(({ role, content }) => ({ role, content })),
      }
      const raw = await window.minimax.generateStructuredWithOllama(llm.url, ollamaModel, [
        'You are the persistent copilot and production designer for one AI movie project. You know the complete project context below. Answer the filmmaker directly and maintain story, character, location, camera, dialogue, and shot continuity.',
        'You can build every editable area: project setup and story, production bible, characters, locations, scenes, and MiniMax shots. Use an existing ID to revise an item. To create an item, use a temporary ID beginning with new- and reuse that exact temporary ID anywhere it is referenced in this response. Use delete arrays only when deletion was explicitly requested.',
        'If the filmmaker asks for a change, return the complete unchanged projectPatch plus only the upserts/deletes needed, and briefly list each applied change. If they only ask a question, return the project fields unchanged and every operation array empty. Preserve all unrequested content. Keep MiniMax prompts literal and chronological. Reply using concise Markdown: short headings, bold terms, bullets, and inline code are supported. Set focusAreas to the workspace areas the filmmaker should review.',
        `PROJECT CONTEXT: ${JSON.stringify(context)}`, `FILMMAKER: ${question}`,
      ].join('\n\n'), movieChatSchema, llm.provider) as MovieChatResult
      const changes = Array.isArray(raw.changes) ? raw.changes.map(text).filter(Boolean) : []
      const areas = normalizeChatAreas(raw.focusAreas, raw)
      const preview = applyMovieChatOperations(project, raw)
      const diffs = buildMovieRevisionDiffs(project, preview)
      if (diffs.length) {
        setPendingChatRevision({ projectId: project.id, baseUpdatedAt: project.updatedAt, question, reply: text(raw.reply) || 'I prepared a set of changes for review.', changes, areas, raw, preview, diffs })
      } else {
        update((value) => ({ ...value, chatMessages: appendMovieChat(value, question, text(raw.reply) || 'I reviewed the project.', [], areas) }))
      }
      setChatInput('')
    } catch (error) { onNotice('error', `Movie copilot: ${error instanceof Error ? error.message : String(error)}`) }
    finally { setChatting(false) }
  }

  const applyPendingChatRevision = () => {
    if (!pendingChatRevision || pendingChatRevision.projectId !== project.id) return
    if (project.updatedAt !== pendingChatRevision.baseUpdatedAt) {
      const preview = applyMovieChatOperations(project, pendingChatRevision.raw)
      setPendingChatRevision({ ...pendingChatRevision, baseUpdatedAt: project.updatedAt, preview, diffs: buildMovieRevisionDiffs(project, preview) })
      onNotice('neutral', 'The movie changed while this proposal was open. Review the refreshed comparison before applying it.')
      return
    }
    const label = pendingChatRevision.changes[0] || `${pendingChatRevision.diffs.length} copilot changes`
    const entry: MovieUndoEntry = { id: createId(), createdAt: Date.now(), label, snapshot: structuredClone(project) }
    commitUndoHistory({ ...undoHistory, [project.id]: [entry, ...(undoHistory[project.id] ?? [])].slice(0, MOVIE_UNDO_LIMIT) })
    const next: MovieProject = {
      ...pendingChatRevision.preview,
      updatedAt: Date.now(),
      chatMessages: appendMovieChat(project, pendingChatRevision.question, pendingChatRevision.reply, pendingChatRevision.changes.length ? pendingChatRevision.changes : pendingChatRevision.diffs.map((diff) => diff.label), pendingChatRevision.areas),
    }
    commit(projects.map((item) => item.id === project.id ? next : item))
    setPendingChatRevision(null)
    onNotice('success', `${pendingChatRevision.diffs.length} reviewed change${pendingChatRevision.diffs.length === 1 ? '' : 's'} applied. Undo is available in Movie copilot.`)
  }

  const discardPendingChatRevision = () => {
    if (!pendingChatRevision || pendingChatRevision.projectId !== project.id) return
    update((value) => ({ ...value, chatMessages: appendMovieChat(value, pendingChatRevision.question, `${pendingChatRevision.reply}\n\n*Proposal discarded — the movie was not changed.*`, [], pendingChatRevision.areas) }))
    setPendingChatRevision(null)
  }

  const undoLastChatRevision = () => {
    const [entry, ...remaining] = undoHistory[project.id] ?? []
    if (!entry || pendingChatRevision) return
    const restored: MovieProject = {
      ...structuredClone(entry.snapshot),
      updatedAt: Date.now(),
      chatMessages: [...project.chatMessages, { id: createId(), role: 'assistant' as const, content: `Undid the last reviewed AI revision: ${entry.label}`, createdAt: Date.now() }].slice(-100),
    }
    commit(projects.map((item) => item.id === project.id ? restored : item))
    commitUndoHistory({ ...undoHistory, [project.id]: remaining })
    onNotice('success', 'The movie was restored to its state before the last AI revision.')
  }

  const buildPlan = async () => {
    if (!project.story.trim()) { onNotice('error', 'Add the story before building a shot plan.'); setStep('setup'); return }
    if (!requireOllama()) return
    if (project.scenes.length && !window.confirm('Replace the current scene and shot plan? Your production bible will be kept.')) return
    const request = ['Create a practical shot plan for a locally generated AI film. Return only data matching the provided JSON schema. Application code—not you—will choose the final technical generation route and attach reference files.', `Target finished runtime: ${project.targetRuntime} seconds. Every shot must be 2 to 15 seconds. Keep the total close to the target.`, 'Use concise recurring-character names and approved-identity anchors; never repeat or reinvent a saved character’s full face, body, or wardrobe description in every shot.', 'Prompts must follow a natural cinematic order: subject/start state, environment, literal chronological action, shot scale, angle, lens/depth of field, camera movement, lighting, visual treatment, continuity, dialogue, then synchronized ambient sound/effects. Use canonical terms such as medium close-up, eye level, 50mm lens, slow push-in, locked tripod, tracking left, and subtle handheld. Do not introduce cuts or montages inside a single shot unless requested. Put exact spoken words in dialogue and repeat them unchanged in the prompt.', `PROJECT: ${JSON.stringify({ title: project.title, genre: project.genre, visualStyle: project.visualStyle, aspectRatio: project.aspectRatio, story: project.story, visualRules: project.visualRules, characters: project.characters.map(({ name, wardrobe, voiceNotes, libraryCharacterId }) => ({ name, wardrobe, voiceNotes, hasCharacterStudioIdentity: Boolean(libraryCharacterId) })), locations: project.locations.map(({ name, description }) => ({ name, description })) })}`].join('\n\n')
    setPlanning(true)
    try {
      const raw = await window.minimax.generateStructuredWithOllama(llm.url, ollamaModel, request, plannerSchema, llm.provider)
      const scenes = normalizePlan(raw, project)
      if (!scenes.length) throw new Error(`${llm.label} did not produce any usable scenes.`)
      update((value) => ({ ...value, scenes })); setExpandedScenes(scenes[0] ? [scenes[0].id] : []); setStep('shots'); onNotice('success', `Created ${scenes.reduce((total, scene) => total + scene.shots.length, 0)} editable shots. Nothing was sent to ComfyUI.`)
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setPlanning(false) }
  }
  const assistantButton = (key: string, label: string, action: () => void) => <button className="assistant-button" disabled={Boolean(assisting) || !ollamaAvailable} title={!ollamaAvailable ? `Connect a local ${llm.label} model in Settings` : `Use ${ollamaModel}`} onClick={action}>{assisting === key ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{assisting === key ? 'Working locally…' : label}</button>
  const smartOptionsForShot = (scene: MovieScene, shot: MovieShot): SmartInsertOption[] => {
    const libraryOptions = characterLibrary.filter((source) => characterReferences(source, settings.characterDetailReferencesEnabled).length > 0).map((source) => {
      const existing = project.characters.find((item) => item.libraryCharacterId === source.id)
      const candidate: MovieCharacter = existing ?? { id: `library-${source.id}`, libraryCharacterId: source.id, libraryUpdatedAt: source.updatedAt, name: source.name, description: source.description, wardrobe: source.wardrobe, voiceNotes: source.voiceNotes, referenceImages: characterReferences(source, settings.characterDetailReferencesEnabled) }
      const hypotheticalProject = existing ? project : { ...project, characters: [...project.characters, candidate] }
      const hypotheticalShot = { ...shot, characterIds: [...new Set([...shot.characterIds, candidate.id])] }
      const resolved = resolveMovieShot(hypotheticalProject, scene, hypotheticalShot, characterLibrary)
      const instruction = composeReferenceInstructions(resolved.references).find((line) => line.includes(`${source.name}'s`)) ?? `Preserve ${source.name}'s approved Character Studio identity.`
      return { id: `character.${source.id}`, category: 'character' as const, label: source.name, description: source.description || 'Character Studio identity', insertion: `Character: ${source.name} — ${instruction}`, thumbnail: characterReferences(source, settings.characterDetailReferencesEnabled)[0]?.preview, meta: `${characterReferences(source, settings.characterDetailReferencesEnabled).length} approved · ${source.referenceMode}`, onSelect: (nextPrompt: string) => update((value) => {
        const found = value.characters.find((item) => item.libraryCharacterId === source.id)
        const character = found ?? { ...candidate, id: createId() }
        return { ...value, characters: found ? value.characters : [...value.characters, character], scenes: value.scenes.map((item) => item.id !== scene.id ? item : { ...item, shots: item.shots.map((valueShot) => valueShot.id !== shot.id ? valueShot : { ...valueShot, prompt: nextPrompt, characterIds: [...new Set([...valueShot.characterIds, character.id])] }) }) }
      }) }
    })
    const movieOnlyOptions = project.characters.filter((item) => !item.libraryCharacterId).map((character) => ({ id: `character.movie.${character.id}`, category: 'character' as const, label: character.name, description: character.description || 'Movie-only character', insertion: `Character: ${character.name} — maintain ${character.name}'s established appearance, wardrobe, and performance continuity.`, thumbnail: character.referenceImages[0]?.preview, meta: `${character.referenceImages.length} refs · movie only`, onSelect: (nextPrompt: string) => updateShot(scene.id, shot.id, { prompt: nextPrompt, characterIds: [...new Set([...shot.characterIds, character.id])] }) }))
    const locationOptions = project.locations.map((location) => ({ id: `location.${location.id}`, category: 'location' as const, label: location.name, description: location.description || 'Movie location', insertion: `Environment: ${location.name}. ${location.description}`, thumbnail: location.referenceImages[0]?.preview, meta: `${location.referenceImages.length} refs`, onSelect: (nextPrompt: string) => update((value) => ({ ...value, scenes: value.scenes.map((item) => item.id !== scene.id ? item : { ...item, locationId: location.id, shots: item.shots.map((valueShot) => valueShot.id === shot.id ? { ...valueShot, prompt: nextPrompt } : valueShot) }) })) }))
    return [...libraryOptions, ...movieOnlyOptions, ...locationOptions]
  }
  const addShotReference = async (sceneId: string, shot: MovieShot, kind: 'image' | 'video' | 'audio') => {
    const current = kind === 'image' ? shot.referenceImages ?? [] : kind === 'video' ? shot.referenceVideos ?? [] : shot.referenceAudios ?? []
    const limit = kind === 'image' ? 9 : 3
    if (current.length >= limit) { onNotice('error', `MiniMax supports up to ${limit} ${kind} references in this workflow.`); return }
    const picked = await window.minimax.chooseMedia(kind)
    if (!picked) return
    const preview = kind === 'image' ? await window.minimax.mediaUrl(picked.path) : undefined
    const file: MediaFile = { ...picked, kind, preview }
    if (kind === 'image') updateShot(sceneId, shot.id, { referenceImages: [...(shot.referenceImages ?? []), file] })
    else if (kind === 'video') updateShot(sceneId, shot.id, { referenceVideos: [...(shot.referenceVideos ?? []), file] })
    else updateShot(sceneId, shot.id, { referenceAudios: [...(shot.referenceAudios ?? []), file] })
  }

  return <div className="standard-page movie-page">
    <div className="movie-planner-shell"><div className="movie-planner-main">
    <div className="page-heading"><div><p className="eyebrow">GUIDED PRODUCTION</p><h1>Movie planner</h1><p>Shape the story, lock continuity, then hand off one reviewed shot at a time.</p></div><div className="movie-heading-actions"><span className={`movie-save-state ${project.status}`}><Check size={13} />Saved locally</span><button className="secondary-button" onClick={() => update((value) => ({ ...value, status: value.status === 'paused' ? 'planning' : 'paused' }))}>{project.status === 'paused' ? <CirclePlay size={15} /> : <CirclePause size={15} />}{project.status === 'paused' ? 'Resume project' : 'Pause project'}</button></div></div>
    <div className="movie-project-bar"><label>Movie project<select value={project.id} onChange={(event) => { const next = projects.find((item) => item.id === event.target.value); setPendingChatRevision(null); setProjectId(event.target.value); setExpandedScenes(next?.scenes[0] ? [next.scenes[0].id] : []); setExpandedShots([]); setStep('setup') }}>{projects.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><button className="secondary-button" onClick={() => { const next = makeProject(projects.length + 1); commit([...projects, next]); setPendingChatRevision(null); setProjectId(next.id); setExpandedScenes([]); setExpandedShots([]); setStep('setup') }}><Plus size={15} />New movie</button><label className="movie-title-field">Project title<input value={project.title} onChange={(event) => update((value) => ({ ...value, title: event.target.value }))} /></label></div>
    <div className="movie-summary-strip"><div><Clock3 size={16} /><span><strong>{formatDuration(plannedSeconds)} / {formatDuration(project.targetRuntime)}</strong><small>planned runtime</small></span></div><div><Clapperboard size={16} /><span><strong>{project.scenes.length} scenes · {shotCount} shots</strong><small>editable plan</small></span></div><div><Sparkles size={16} /><span><strong>{project.computeBudgetMinutes} minute budget</strong><small>{ollamaAvailable ? `${ollamaModel} ready` : 'manual planning available'}</small></span></div><div className="runtime-meter"><i style={{ width: `${Math.min(100, project.targetRuntime ? plannedSeconds / project.targetRuntime * 100 : 0)}%` }} /></div></div>
    {project.status === 'paused' && <div className="movie-paused"><CirclePause size={16} /><span><strong>Project paused</strong><small>Your plan remains editable, but future automated production passes will not queue work.</small></span></div>}
    <nav className="movie-steps" aria-label="Movie production stages"><button className={step === 'setup' ? 'active' : ''} onClick={() => setStep('setup')}><span>1</span><div><strong>Story setup</strong><small>Creative brief</small></div></button><button className={step === 'bible' ? 'active' : ''} onClick={() => setStep('bible')}><span>2</span><div><strong>Production bible</strong><small>People and places</small></div></button><button className={step === 'shots' ? 'active' : ''} onClick={() => setStep('shots')}><span>3</span><div><strong>Shot plan</strong><small>Prepare scenes</small></div></button><button className={step === 'runner' ? 'active' : ''} onClick={() => setStep('runner')}><span>4</span><div><strong>Production runner</strong><small>Queue, review, lock</small></div></button><button className={step === 'preview' ? 'active' : ''} onClick={() => setStep('preview')}><span>5</span><div><strong>Movie preview</strong><small>{renderedClips.length} finished clips</small></div></button></nav>

    {step === 'setup' && <section className="movie-stage"><div className="movie-stage-heading"><div><BookOpen size={18} /><span><strong>Creative brief</strong><small>Start with the story. Production limits are grouped below to keep this page focused.</small></span></div></div><div className="movie-brief-layout"><div className="movie-story-field"><div className="field-heading"><label htmlFor="movie-story">Story, outline, or screenplay</label>{assistantButton('story', `Develop with ${llm.label}`, assistStory)}</div><textarea id="movie-story" value={project.story} onChange={(event) => update((value) => ({ ...value, story: event.target.value }))} placeholder="Begin with a short premise, or paste a complete outline. Include the ending and any dialogue that must be preserved…" /></div><div className="movie-direction-fields"><label>Genre<input value={project.genre} onChange={(event) => update((value) => ({ ...value, genre: event.target.value }))} placeholder="Science fiction, drama…" /></label><label>Visual direction<textarea value={project.visualStyle} onChange={(event) => update((value) => ({ ...value, visualStyle: event.target.value }))} placeholder="Grounded realism, 35mm, restrained handheld camera…" /></label></div></div><details className="movie-production-settings"><summary><span><strong>Production limits</strong><small>{project.targetRuntime}s · {project.aspectRatio} · scene-by-scene approval</small></span><ChevronDown size={16} /></summary><div className="movie-form-grid compact-grid"><label>Target runtime (seconds)<input type="number" min="10" max="3600" value={project.targetRuntime} onChange={(event) => update((value) => ({ ...value, targetRuntime: clamp(Number(event.target.value), 10, 3600) }))} /></label><label>Compute budget (minutes)<input type="number" min="10" max="100000" value={project.computeBudgetMinutes} onChange={(event) => update((value) => ({ ...value, computeBudgetMinutes: clamp(Number(event.target.value), 10, 100000) }))} /></label><label>Aspect ratio<select value={project.aspectRatio} onChange={(event) => update((value) => ({ ...value, aspectRatio: event.target.value as MovieProject['aspectRatio'] }))}><option value="16:9">Landscape · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="1:1">Square · 1:1</option></select></label></div></details><div className="movie-stage-actions"><span>{project.story.trim() ? 'Creative brief saved locally.' : 'Add a premise before continuing.'}</span><button className="primary-button" disabled={!project.story.trim()} onClick={() => setStep('bible')}>Continue to bible<ChevronRight size={16} /></button></div></section>}

    {step === 'bible' && <section className="movie-stage"><div className="movie-stage-heading"><div><Users size={18} /><span><strong>Production bible</strong><small>Create movie-ready people and places without crowding the main workspace.</small></span></div></div><div className="bible-rules"><div className="field-heading"><label htmlFor="visual-rules">Global continuity and camera rules</label>{assistantButton('rules', `Draft rules with ${llm.label}`, assistRules)}</div><textarea id="visual-rules" value={project.visualRules} onChange={(event) => update((value) => ({ ...value, visualRules: event.target.value }))} placeholder="Lighting, palette, lenses, camera motion, prohibited changes, recurring props…" /></div><div className="bible-columns"><AssetCollection title="Characters" subtitle={`${project.characters.length} recurring subjects`} empty="Create recurring cast members here. Each saved character becomes a reusable movie card." onAdd={() => setCharacterDraft(blankCharacter())}>{project.characters.map((character) => { const source = character.libraryCharacterId ? characterLibrary.find((item) => item.id === character.libraryCharacterId) : undefined; const refreshAvailable = Boolean(source && source.updatedAt > (character.libraryUpdatedAt ?? 0)); return <AssetCard key={character.id} icon="character" name={character.name} description={character.description} references={character.referenceImages} linked={Boolean(character.libraryCharacterId)} refreshAvailable={refreshAvailable} onRefresh={() => refreshLibraryCharacter(character.id)} onEdit={() => setCharacterDraft(structuredClone(character))} onRemove={() => { if (window.confirm(`Remove ${character.name} from the production bible?`)) update((value) => ({ ...value, characters: value.characters.filter((item) => item.id !== character.id) })) }} /> })}</AssetCollection><AssetCollection title="Locations" subtitle={`${project.locations.length} recurring sets`} empty="Create recognizable sets here. Each saved location becomes a reusable movie card." onAdd={() => setLocationDraft(blankLocation())}>{project.locations.map((location) => <AssetCard key={location.id} icon="location" name={location.name} description={location.description} references={location.referenceImages} onEdit={() => setLocationDraft(structuredClone(location))} onRemove={() => { if (window.confirm(`Remove ${location.name} from the production bible?`)) update((value) => ({ ...value, locations: value.locations.filter((item) => item.id !== location.id) })) }} />)}</AssetCollection></div><div className="movie-stage-actions"><span>{project.characters.length} characters and {project.locations.length} locations saved.</span><button className="primary-button" onClick={() => setStep('shots')}>Continue to shots<ChevronRight size={16} /></button></div></section>}

    {step === 'shots' && <section className="movie-stage shot-stage"><div className="movie-stage-heading"><div><Clapperboard size={18} /><span><strong>Scenes and shots</strong><small>Each scene is a summary card. Open only the scene or shot you need.</small></span></div><div className="shot-plan-actions"><button className="secondary-button" onClick={addScene}><Plus size={15} />Add scene</button><button className="primary-button" disabled={planning || !ollamaAvailable || !project.story.trim()} onClick={() => void buildPlan()}>{planning ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}{planning ? 'Planning locally…' : `Build with ${llm.label}`}</button></div></div>{!ollamaAvailable && <div className="movie-inline-warning">{llm.label} is offline. Manual scene and shot editing remains available.</div>}{project.scenes.length === 0 ? <div className="shot-plan-empty"><Clapperboard size={28} /><strong>No shots planned</strong><span>Use your local AI provider or add a scene manually. No ComfyUI work will start.</span></div> : <div className="scene-list">{project.scenes.map((scene, sceneIndex) => {
      const sceneOpen = expandedScenes.includes(scene.id)
      const sceneLocation = project.locations.find((item) => item.id === scene.locationId)
      const sceneSeconds = scene.shots.reduce((total, shot) => total + shot.duration, 0)
      const castNames = project.characters.filter((character) => scene.shots.some((shot) => shot.characterIds.includes(character.id))).map((character) => character.name)
      const previousScene = project.scenes[sceneIndex - 1]
      const continuationFrame = previousScene?.continuityFrame
      const connected = sceneIndex > 0 && scene.transition === 'connected'
      const routes = [...new Set(scene.shots.map((shot, index) => routeName(resolveMovieShot(project, scene, shot, characterLibrary, connected && index === 0 ? continuationFrame : undefined).effectiveMode)))]
      return <article className={`scene-card ${sceneOpen ? 'open' : ''}`} key={scene.id}><button className="scene-card-summary" aria-expanded={sceneOpen} aria-controls={`scene-body-${scene.id}`} onClick={() => setExpandedScenes((value) => value.includes(scene.id) ? value.filter((id) => id !== scene.id) : [...value, scene.id])}><span className="scene-index">{String(sceneIndex + 1).padStart(2, '0')}</span><span className="scene-summary-copy"><strong>{scene.title || `Scene ${sceneIndex + 1}`}</strong><span>{scene.summary || 'No scene summary yet.'}</span><small>{sceneLocation?.name || 'Location not set'} · {scene.shots.length} shot{scene.shots.length === 1 ? '' : 's'} · {formatDuration(sceneSeconds)}</small></span><span className="scene-card-facts"><span>{connected ? continuationFrame ? 'Connected · frame ready' : 'Connected · waiting for approval' : sceneIndex ? 'Hard cut' : 'Opening scene'}</span><span>{routes.length ? routes.join(' + ') : 'No routes'} · {castNames.length ? castNames.join(', ') : 'No cast assigned'}</span></span><ChevronDown className="scene-card-chevron" size={17} /></button>{sceneOpen && <div className="scene-card-body" id={`scene-body-${scene.id}`}><div className="scene-editor"><div><label>Scene title<input aria-label={`Scene ${sceneIndex + 1} title`} value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} /></label><label>Scene summary<textarea aria-label={`${scene.title} summary`} value={scene.summary} onChange={(event) => updateScene(scene.id, { summary: event.target.value })} placeholder="What changes in this scene?" /></label></div><label>Location<select value={scene.locationId} onChange={(event) => updateScene(scene.id, { locationId: event.target.value })}><option value="">Unspecified</option>{project.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>{sceneIndex > 0 && <label>Connection<select value={scene.transition} onChange={(event) => updateScene(scene.id, { transition: event.target.value as MovieScene['transition'] })}><option value="connected">Continue previous frame</option><option value="cut">Hard cut / new image</option></select></label>}<button className="secondary-button danger-button" onClick={() => { if (window.confirm(`Remove ${scene.title} and all its shots?`)) update((value) => ({ ...value, scenes: value.scenes.filter((item) => item.id !== scene.id) })) }}><Trash2 size={14} />Remove scene</button></div>{connected && <div className={`scene-continuity ${continuationFrame ? 'ready' : 'waiting'}`}><span><strong>Approved scene continuation</strong><small>{continuationFrame ? `${previousScene.title}'s locked continuity frame will become this scene's exact I2V opening frame.` : `Approve and lock ${previousScene.title} first. Its saved final frame will be prepared automatically.`}</small></span><span>{continuationFrame ? 'Ready' : 'Waiting'}</span></div>}<div className="shot-list">{scene.shots.map((shot, shotIndex) => {
          const expanded = expandedShots.includes(shot.id)
          const needsContinuation = connected && shotIndex === 0
          const continuation = needsContinuation ? continuationFrame : undefined
          const resolved = resolveMovieShot(project, scene, shot, characterLibrary, continuation)
          const routeSummary = `${routeName(resolved.effectiveMode)} · ${resolved.references.filter((item) => item.purpose !== 'continuity').length} reusable ref${resolved.references.filter((item) => item.purpose !== 'continuity').length === 1 ? '' : 's'}`
          return <div className={`movie-shot ${expanded ? 'expanded' : ''}`} key={shot.id}>
            <div className="shot-number">{sceneIndex + 1}.{shotIndex + 1}</div>
            <div className="shot-summary"><input aria-label="Shot title" value={shot.title} onChange={(event) => updateShot(scene.id, shot.id, { title: event.target.value })} /><span>{shot.prompt || 'No prompt yet'}</span><small>{shot.outputUrl ? 'Rendered' : shot.dialogue ? 'Dialogue added' : 'No dialogue'} · {shot.duration}s · <span className="effective-route" title={resolved.routeReason}>{routeSummary}</span> · {shot.characterIds.length} cast</small></div>
            <div className="shot-row-actions"><button className="secondary-button" onClick={() => setExpandedShots((value) => value.includes(shot.id) ? value.filter((id) => id !== shot.id) : [...value, shot.id])}><Pencil size={14} />{expanded ? 'Close details' : 'Edit details'}</button><button className="icon-button" aria-label={`Remove ${shot.title}`} onClick={() => updateScene(scene.id, { shots: scene.shots.filter((item) => item.id !== shot.id) })}><Trash2 size={14} /></button></div>
            {expanded && <div className="shot-details"><div className="field-heading"><label htmlFor={`prompt-${shot.id}`}>Creative prompt</label>{assistantButton(`shot:${shot.id}`, 'Improve prompt', () => assistShot(scene, shot))}</div><SmartPromptEditor id={`prompt-${shot.id}`} value={shot.prompt} onChange={(prompt) => updateShot(scene.id, shot.id, { prompt })} options={smartOptionsForShot(scene, shot)} placeholder="Subject, action, camera, light, and sound… Type // for presets." /><details className="compiled-prompt"><summary>Compiled render prompt</summary><p>{resolved.compiledPrompt}</p><ul>{resolved.references.map((binding, index) => <li key={`${binding.file.path}-${index}`}><code>{`<Picture ${index + 1}>`}</code><span>{binding.label}</span></li>)}</ul></details>{resolved.omittedReferences.length > 0 && <div className="reference-limit-warning">{resolved.omittedReferences.length} reference{resolved.omittedReferences.length === 1 ? '' : 's'} exceed the 9-picture limit. Deselect images in Character Studio or remove shot/location references before rendering.</div>}<label>Exact dialogue<input value={shot.dialogue} onChange={(event) => updateShot(scene.id, shot.id, { dialogue: event.target.value })} placeholder="Exact spoken words, if any" /></label>{project.characters.length > 0 && <fieldset className="shot-cast-picker"><legend>Characters in this shot</legend><div>{project.characters.map((character) => <label key={character.id}><input type="checkbox" checked={shot.characterIds.includes(character.id)} onChange={(event) => updateShot(scene.id, shot.id, { characterIds: event.target.checked ? [...shot.characterIds, character.id] : shot.characterIds.filter((id) => id !== character.id) })} /><span>{character.name}</span></label>)}</div></fieldset>}<ShotReferencePicker shot={shot} onAdd={(kind) => void addShotReference(scene.id, shot, kind)} onRemove={(kind, index) => updateShot(scene.id, shot.id, kind === 'image' ? { referenceImages: (shot.referenceImages ?? []).filter((_, itemIndex) => itemIndex !== index) } : kind === 'video' ? { referenceVideos: (shot.referenceVideos ?? []).filter((_, itemIndex) => itemIndex !== index) } : { referenceAudios: (shot.referenceAudios ?? []).filter((_, itemIndex) => itemIndex !== index) })} /><div className="shot-detail-settings"><label>Seconds<input type="number" min="2" max="15" step="1" value={shot.duration} onChange={(event) => updateShot(scene.id, shot.id, { duration: clamp(Number(event.target.value), 2, 15) })} /></label><label>Preferred route<select value={shot.preferredMode ?? shot.mode} onChange={(event) => updateShot(scene.id, shot.id, { preferredMode: event.target.value as GenerationMode, mode: event.target.value as GenerationMode })}><option value="text">Text to video</option><option value="image">Image to video</option><option value="frames">First + last frames</option><option value="reference">Reference to video</option></select></label></div><small className="continuity-note">Effective route: {routeName(resolved.effectiveMode)}. {resolved.routeReason}</small><small className="production-route-note">Rendering is controlled by the Production runner so queueing, output attachment, review, and continuity stay synchronized.</small></div>}
          </div>
        })}</div><button className="add-shot-button" onClick={() => addShot(scene.id)}><Plus size={14} />Add shot</button></div>}</article>
      })}</div>}</section>}
    {step === 'runner' && <ProductionRunner project={project} jobs={jobs} workingSeed={workingSeed} connected={connected} onEditPlan={() => setStep('shots')} onQueueShot={queueRunnerShot} onAssemble={assembleScene} onApprove={approveRunnerScene} onResetScene={(scene) => updateScene(scene.id, { stage: 'planned', previewUrl: undefined, continuityState: undefined, shots: scene.shots.map((shot) => shot.outputUrl ? shot : { ...shot, stage: 'planned' }) })} onRerenderShot={rerenderRunnerShot} onReplaceShot={replaceRunnerShotOutput} onUpdateShot={updateShot} onUpdateProject={(change) => update((value) => ({ ...value, ...change }))} />}
    {step === 'preview' && <MoviePreview clips={renderedClips} activeIndex={previewIndex} setActiveIndex={setPreviewIndex} />}
    </div><MovieCopilot project={project} input={chatInput} setInput={setChatInput} chatting={chatting} providerLabel={llm.label} ollamaAvailable={ollamaAvailable} pendingRevision={pendingChatRevision?.projectId === project.id ? pendingChatRevision : null} undoEntry={undoHistory[project.id]?.[0]} onSend={(question) => void sendMovieChat(question)} onNavigate={setStep} onApplyRevision={applyPendingChatRevision} onDiscardRevision={discardPendingChatRevision} onUndo={undoLastChatRevision} /></div>

    {characterDraft && <AssetModal title={project.characters.some((item) => item.id === characterDraft.id) ? 'Edit character' : 'Create character'} subtitle="Build a repeatable cast member for this movie." onClose={() => setCharacterDraft(null)} onSave={saveCharacter} saveDisabled={!characterDraft.name.trim()}><div className="asset-assistant-callout"><span><Sparkles size={15} /><span><strong>{llm.label} character assistant</strong><small>Uses your story and visual direction. Nothing leaves your computer.</small></span></span>{assistantButton('character', `Create with ${llm.label}`, () => void assistCharacter())}</div><div className="asset-modal-form"><label>Character name<input autoFocus value={characterDraft.name} onChange={(event) => setCharacterDraft({ ...characterDraft, name: event.target.value })} placeholder="Name or production label" /></label><label>Repeatable appearance<textarea value={characterDraft.description} onChange={(event) => setCharacterDraft({ ...characterDraft, description: event.target.value })} placeholder="Age range, face, hair, build, distinctive features…" /></label><label>Wardrobe and props<textarea value={characterDraft.wardrobe} onChange={(event) => setCharacterDraft({ ...characterDraft, wardrobe: event.target.value })} placeholder="Default clothing, colors, wear, recurring objects…" /></label><label>Voice and performance<textarea value={characterDraft.voiceNotes} onChange={(event) => setCharacterDraft({ ...characterDraft, voiceNotes: event.target.value })} placeholder="Tone, accent, cadence, emotional baseline…" /></label></div><ReferencePicker files={characterDraft.referenceImages} onAdd={() => void addDraftReference('character')} onRemove={(index) => setCharacterDraft({ ...characterDraft, referenceImages: characterDraft.referenceImages.filter((_, itemIndex) => itemIndex !== index) })} /></AssetModal>}
    {locationDraft && <AssetModal title={project.locations.some((item) => item.id === locationDraft.id) ? 'Edit location' : 'Create location'} subtitle="Define a reusable set for this movie." onClose={() => setLocationDraft(null)} onSave={saveLocation} saveDisabled={!locationDraft.name.trim()}><div className="asset-assistant-callout"><span><Sparkles size={15} /><span><strong>{llm.label} location assistant</strong><small>Turns a rough idea into repeatable production details.</small></span></span>{assistantButton('location', `Create with ${llm.label}`, () => void assistLocation())}</div><div className="asset-modal-form"><label>Location name<input autoFocus value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder="Set or place name" /></label><label>Set, lighting, and atmosphere<textarea value={locationDraft.description} onChange={(event) => setLocationDraft({ ...locationDraft, description: event.target.value })} placeholder="Architecture, layout, materials, landmarks, light sources, time of day…" /></label></div><ReferencePicker files={locationDraft.referenceImages} onAdd={() => void addDraftReference('location')} onRemove={(index) => setLocationDraft({ ...locationDraft, referenceImages: locationDraft.referenceImages.filter((_, itemIndex) => itemIndex !== index) })} /></AssetModal>}
  </div>
}

type RenderedMovieClip = { scene: MovieScene; sceneIndex: number; shot: MovieShot; shotIndex: number }
type MovieChatResult = {
  reply?: unknown; changes?: unknown[]
  focusAreas?: unknown[]
  projectPatch?: Partial<Pick<MovieProject, 'title' | 'targetRuntime' | 'computeBudgetMinutes' | 'aspectRatio' | 'genre' | 'visualStyle' | 'story' | 'visualRules'>>
  characterUpserts?: Array<Partial<Pick<MovieCharacter, 'id' | 'name' | 'description' | 'wardrobe' | 'voiceNotes'>>>
  characterDeletes?: unknown[]
  locationUpserts?: Array<Partial<Pick<MovieLocation, 'id' | 'name' | 'description'>>>
  locationDeletes?: unknown[]
  sceneUpserts?: Array<Partial<Pick<MovieScene, 'id' | 'title' | 'summary' | 'locationId' | 'transition'>>>
  sceneDeletes?: unknown[]
  shotUpserts?: Array<Partial<Pick<MovieShot, 'id' | 'title' | 'prompt' | 'dialogue' | 'duration' | 'mode' | 'characterIds'>> & { sceneId?: unknown }>
  shotDeletes?: unknown[]
}

function MovieCopilot({ project, input, setInput, chatting, providerLabel, ollamaAvailable, pendingRevision, undoEntry, onSend, onNavigate, onApplyRevision, onDiscardRevision, onUndo }: {
  project: MovieProject
  input: string
  setInput(value: string): void
  chatting: boolean
  providerLabel: string
  ollamaAvailable: boolean
  pendingRevision: PendingMovieRevision | null
  undoEntry?: MovieUndoEntry
  onSend(question?: string): void
  onNavigate(area: PlannerStep): void
  onApplyRevision(): void
  onDiscardRevision(): void
  onUndo(): void
}) {
  const starters = ['Build a complete story treatment from my current idea.', 'Create the recurring characters and locations this movie needs.', 'Turn the story into connected scenes and production-ready MiniMax shots.']
  return <aside className="movie-copilot" aria-label="Movie copilot">
    <header><span><MessageSquare size={16} /><span><strong>Movie copilot</strong><small>Whole-project builder · local {providerLabel}</small></span></span><div className="movie-copilot-status"><button disabled={!undoEntry || Boolean(pendingRevision)} title={undoEntry ? `Restore the project to before: ${undoEntry.label}` : 'No AI revision to undo'} onClick={onUndo}><RotateCcw size={12} />Undo</button><i className={ollamaAvailable ? 'online' : ''}>{ollamaAvailable ? 'Ready' : 'Offline'}</i></div></header>
    {pendingRevision ? <MovieRevisionReview revision={pendingRevision} onApply={onApplyRevision} onDiscard={onDiscardRevision} /> : <>
      <div className="movie-chat-log" aria-live="polite">{project.chatMessages.length === 0 ? <div className="movie-chat-empty"><Sparkles size={22} /><strong>Build the movie from here</strong><span>Chat can create and revise your brief, production bible, cast, locations, scenes, dialogue, and shot prompts.</span><div>{starters.map((starter) => <button key={starter} disabled={!ollamaAvailable || chatting} onClick={() => onSend(starter)}>{starter}</button>)}</div></div> : project.chatMessages.map((message) => <article className={`movie-chat-message ${message.role}`} key={message.id}><span>{message.role === 'user' ? 'You' : 'Copilot'}</span><SmartMarkup value={message.content} />{message.areas && message.areas.length > 0 && <nav className="chat-area-links" aria-label="Review updated movie areas">{message.areas.map((area) => <button key={area} onClick={() => onNavigate(area)}>{areaLabel(area)}<ChevronRight size={12} /></button>)}</nav>}{message.appliedChanges && message.appliedChanges.length > 0 && <details open><summary>{message.appliedChanges.length} change{message.appliedChanges.length === 1 ? '' : 's'} applied</summary><ul>{message.appliedChanges.map((change, index) => <li key={`${change}-${index}`}>{change}</li>)}</ul></details>}</article>)}</div>
      <form onSubmit={(event) => { event.preventDefault(); onSend() }}><label htmlFor="movie-chat-input">Build or revise this movie</label><textarea id="movie-chat-input" value={input} onChange={(event) => setInput(event.target.value)} disabled={chatting} placeholder="Create two characters, three connected scenes, and detailed MiniMax prompts…" onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend() } }} /><div><small>Enter to send · Shift+Enter for a new line</small><button className="primary-button" disabled={!input.trim() || chatting || !ollamaAvailable} type="submit">{chatting ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{chatting ? 'Building…' : 'Send'}</button></div></form>
    </>}
  </aside>
}

function MovieRevisionReview({ revision, onApply, onDiscard }: { revision: PendingMovieRevision; onApply(): void; onDiscard(): void }) {
  const destructive = revision.diffs.filter((diff) => diff.destructive)
  const shotRemovals = revision.diffs.filter((diff) => diff.kind === 'remove' && diff.label.startsWith('Shot ')).length
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => { setConfirmed(false) }, [revision])
  return <section className="movie-revision-review" aria-labelledby="movie-revision-title">
    <div className="movie-revision-summary"><span><Sparkles size={16} /><span><strong id="movie-revision-title">Review proposed changes</strong><small>Nothing has changed yet · {revision.diffs.length} field-level update{revision.diffs.length === 1 ? '' : 's'}</small></span></span><SmartMarkup value={revision.reply} /></div>
    {destructive.length > 0 && <div className="movie-revision-warning" role="alert"><AlertTriangle size={16} /><span><strong>Destructive changes need confirmation</strong><small>{destructive.length} removal{destructive.length === 1 ? '' : 's'} may detach assets, scenes, shots, or rendered outputs from this movie.{shotRemovals > LARGE_SHOT_DELETE_THRESHOLD ? ` This exceeds the ${LARGE_SHOT_DELETE_THRESHOLD}-shot safety threshold.` : ''}</small></span></div>}
    <div className="movie-revision-diffs" role="list" aria-label="Proposed field changes">{revision.diffs.map((diff) => <article key={diff.id} className={`movie-revision-diff ${diff.kind}`} role="listitem"><span>{diff.kind}</span><div><strong>{diff.label}</strong>{diff.kind === 'change' ? <p><del>{diff.before || 'Empty'}</del><ArrowRight size={11} /><ins>{diff.after || 'Empty'}</ins></p> : <small>{diff.after || diff.before}</small>}</div></article>)}</div>
    <footer>{destructive.length > 0 && <label className="movie-revision-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand these removals will be applied to the movie. A local undo snapshot will be kept.</span></label>}<div><button className="secondary-button" onClick={onDiscard}>Discard proposal</button><button className="primary-button" disabled={destructive.length > 0 && !confirmed} onClick={onApply}><Check size={14} />Apply reviewed changes</button></div></footer>
  </section>
}

function ProductionRunner({ project, jobs, workingSeed, connected, onEditPlan, onQueueShot, onAssemble, onApprove, onResetScene, onRerenderShot, onReplaceShot, onUpdateShot, onUpdateProject }: {
  project: MovieProject
  jobs: GenerationJob[]
  workingSeed: number
  connected: boolean
  onEditPlan(): void
  onQueueShot(scene: MovieScene, shot: MovieShot): void
  onAssemble(scene: MovieScene): Promise<void>
  onApprove(scene: MovieScene): Promise<void>
  onResetScene(scene: MovieScene): void
  onRerenderShot(scene: MovieScene, shot: MovieShot): void
  onReplaceShot(scene: MovieScene, shot: MovieShot): Promise<void>
  onUpdateShot(sceneId: string, shotId: string, change: Partial<MovieShot>): void
  onUpdateProject(change: Partial<MovieProject>): void
}) {
  const [assembling, setAssembling] = useState<string | null>(null)
  const [editingShotId, setEditingShotId] = useState<string | null>(null)
  const activeMovieJobs = useMemo(() => jobs.filter((job) => job.movieLink?.projectId === project.id && ['queued', 'running'].includes(job.status)), [jobs, project.id])

  useEffect(() => {
    if (!connected || project.status === 'paused') return
    const scene = project.scenes.find((item) => item.stage === 'rendering')
    if (!scene) return
    const activeSceneJobs = activeMovieJobs.filter((job) => job.movieLink?.sceneId === scene.id && scene.shots.some((shot) => shot.id === job.movieLink?.shotId))
    if (activeSceneJobs.length) return
    if (scene.shots.length && scene.shots.every((shot) => Boolean(shot.outputUrl))) {
      if (!scene.previewUrl && assembling !== scene.id) {
        setAssembling(scene.id)
        void onAssemble(scene).finally(() => setAssembling(null))
      }
      return
    }
    const nextIndex = scene.shots.findIndex((shot, index) => !shot.outputUrl && index > 0 && Boolean(scene.shots[index - 1].outputUrl) && shot.stage === 'planned' && shot.prompt.trim())
    if (nextIndex >= 0) onQueueShot(scene, scene.shots[nextIndex])
  }, [project.scenes, project.status, connected, activeMovieJobs, assembling, onAssemble, onQueueShot])

  if (!project.scenes.length) return <section className="movie-stage production-runner"><div className="movie-stage-heading"><div><Clapperboard size={18} /><span><strong>Guided production runner</strong><small>Plan scenes and shots before production can begin.</small></span></div></div><button className="primary-button" onClick={onEditPlan}>Open shot plan<ChevronRight size={15} /></button></section>
  const runSettings = productionSettingsFor(project, workingSeed)
  const saveRunSettings = (change: Partial<typeof runSettings>) => onUpdateProject({ productionSettings: { ...runSettings, ...change } })
  return <section className="movie-stage production-runner"><div className="movie-stage-heading"><div><Clapperboard size={18} /><span><strong>Guided production runner</strong><small>References, prompts, queueing, output attachment, and scene review are managed here.</small></span></div><label className="no-dialogue-toggle"><input type="checkbox" checked={Boolean(project.autoContinueCleanScenes)} onChange={(event) => onUpdateProject({ autoContinueCleanScenes: event.target.checked })} /><span><strong>Auto-continue clean scenes</strong><small>Automatically start the next ready scene after approval.</small></span></label></div>
    <fieldset className="production-run-settings"><legend>Whole-run render settings</legend><label>Resolution<select value={runSettings.resolution} onChange={(event) => saveRunSettings({ resolution: event.target.value })}>{MINIMAX_VIDEO_RESOLUTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution.replace('x', ' × ')}</option>)}</select></label><label>Speed<select value={runSettings.turbo} onChange={(event) => { const turbo = event.target.value as 'off' | '4' | '8'; saveRunSettings({ turbo, steps: turbo === '8' ? 8 : turbo === '4' ? 4 : runSettings.steps <= 8 ? 30 : runSettings.steps }) }}><option value="off">Quality</option><option value="4">Turbo 4</option><option value="8">Turbo 8</option></select></label><label>Sampling steps<input type="number" min="1" max="100" value={runSettings.steps} onChange={(event) => saveRunSettings({ steps: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /></label><label>Run seed<span className="production-seed-control"><input type="number" min="0" max="2147483646" value={runSettings.seed ?? workingSeed} onChange={(event) => saveRunSettings({ seed: Math.max(0, Math.min(2147483646, Math.floor(Number(event.target.value) || 0))) })} /><button type="button" className="secondary-button" onClick={() => saveRunSettings({ seed: workingSeed })} disabled={runSettings.seed === workingSeed}>Use working seed</button></span></label><label className="production-setting-toggle"><input type="checkbox" checked={Boolean(runSettings.noDialogue)} onChange={(event) => saveRunSettings({ noDialogue: event.target.checked })} /><span>No dialogue</span></label><label className="production-setting-toggle"><input type="checkbox" checked={Boolean(runSettings.naturalMovement)} onChange={(event) => saveRunSettings({ naturalMovement: event.target.checked })} /><span>Natural movement</span></label><small>All Ref2VA / MiniMax H3 canvases use the same shared resolution source. Seed {runSettings.seed ?? workingSeed} is locked for every shot in this run.</small></fieldset>
    <div className="production-state-legend" aria-label="Production status"><span>Planned</span><span>Ready</span><span>Rendering</span><span>Review</span><span>Approved</span><span>Locked</span></div>
    {project.scenes.map((scene, sceneIndex) => {
      const allRendered = scene.shots.length > 0 && scene.shots.every((shot) => Boolean(shot.outputUrl))
      const canStart = sceneIndex === 0 || project.scenes[sceneIndex - 1].stage === 'locked'
      const sceneHasLiveRender = activeMovieJobs.some((job) => job.movieLink?.sceneId === scene.id && scene.shots.some((shot) => shot.id === job.movieLink?.shotId))
      const firstPending = scene.shots.find((shot) => !shot.outputUrl)
      const missingPrompts = scene.shots.filter((shot) => !shot.prompt.trim()).length
      const ready = scene.shots.length > 0 && Boolean(firstPending) && canStart && !missingPrompts && connected && project.status !== 'paused'
      const sceneState = sceneHasLiveRender ? 'rendering' : scene.stage === 'rendering' || scene.stage === 'review' || scene.stage === 'approved' || scene.stage === 'locked' ? scene.stage : allRendered ? 'review' : ready ? 'ready' : 'planned'
      const isAssembling = assembling === scene.id
      const blocker = project.status === 'paused' ? 'Resume the movie to start production.' : !connected ? 'Start ComfyUI and verify the Local engine connection.' : !scene.shots.length ? 'Add at least one shot in the Shot plan.' : !canStart ? 'Approve and lock the preceding scene first.' : missingPrompts ? `${missingPrompts} shot prompt${missingPrompts === 1 ? ' is' : 's are'} missing.` : sceneHasLiveRender ? 'ComfyUI is processing this scene.' : undefined
      return <article key={scene.id} className={`production-scene production-${sceneState}`}><header><div><span>Scene {sceneIndex + 1}</span><strong>{scene.title}</strong><small>{scene.summary || 'No scene summary'} · {scene.shots.length} shots</small></div><em>{sceneState}</em></header>
        {scene.previewUrl && <video className="scene-review-preview" src={scene.previewUrl} controls />}
        <div className="production-shot-list">{scene.shots.map((shot, shotIndex) => {
          const job = jobs.find((item) => item.movieLink?.projectId === project.id && item.movieLink?.sceneId === scene.id && item.movieLink?.shotId === shot.id)
          const shotState = sceneState === 'locked' && shot.outputUrl ? 'locked' : job && ['queued', 'running'].includes(job.status) ? 'rendering' : shot.outputUrl ? 'review' : ready && firstPending?.id === shot.id ? 'ready' : 'planned'
          return <div key={shot.id} className={`production-shot production-shot-${shotState}`}><span>{sceneIndex + 1}.{shotIndex + 1}</span><div><strong>{shot.title}</strong><small>{shotState} · {job?.status === 'queued' ? `Queue position ${job.queuePosition ?? 'pending'}` : job?.status === 'running' ? `${Math.round(job.progress)}% · ${job.progressLabel ?? 'Rendering'}` : shot.outputUrl ? 'Output attached' : `${shot.duration}s · awaiting render`}</small></div>{sceneState !== 'locked' && <div className="production-shot-actions"><button className="secondary-button" onClick={() => setEditingShotId((value) => value === shot.id ? null : shot.id)}><Pencil size={13} />{editingShotId === shot.id ? 'Close prompt' : 'Revise prompt'}</button>{shot.outputUrl && <><button className="secondary-button" onClick={() => void onReplaceShot(scene, shot)}><Film size={13} />Replace</button><button className="secondary-button" onClick={() => onRerenderShot(scene, shot)}><RefreshCw size={13} />Rerender</button></>}</div>}{editingShotId === shot.id && sceneState !== 'locked' && <label className="production-shot-prompt">Production prompt<textarea value={shot.prompt} onChange={(event) => onUpdateShot(scene.id, shot.id, { prompt: event.target.value })} /><small>Changes are saved immediately and will be compiled with the current cast, wardrobe, location, reference, and continuity bindings at render time.</small></label>}</div>
        })}</div>
        <footer>{sceneState === 'locked' ? <small>Locked continuity: {scene.continuityState}</small> : sceneState === 'approved' ? <small className="production-busy"><LoaderCircle className="spin" size={14} />Saving the approved final continuity frame…</small> : sceneState === 'review' ? <><small>{scene.continuityState ?? 'Review the assembled scene, revise or replace individual shots if needed, then lock continuity.'}</small><button className="primary-button" onClick={() => void onApprove(scene)}><Check size={15} />Approve Scene & Continue</button></> : isAssembling ? <small className="production-busy"><LoaderCircle className="spin" size={14} />Assembling the finished shots into the scene preview…</small> : sceneState === 'rendering' ? <><small>{sceneHasLiveRender ? 'ComfyUI is processing this scene’s current production shot.' : 'No active ComfyUI job was found. Reset the runner state to continue.'}</small>{!sceneHasLiveRender && <button className="secondary-button" onClick={() => onResetScene(scene)}><RotateCcw size={15} />Reset scene</button>}</> : <><small>{blocker ?? 'Ready. References and the final model prompt will resolve automatically when production starts.'}</small>{firstPending && <button className="primary-button" disabled={Boolean(blocker)} title={blocker} onClick={() => onQueueShot(scene, firstPending)}><CirclePlay size={15} />Start scene</button>}</>}</footer>
      </article>
    })}
  </section>
}

function MoviePreview({ clips, activeIndex, setActiveIndex }: { clips: RenderedMovieClip[]; activeIndex: number; setActiveIndex(value: number): void }) {
  const active = clips[activeIndex]
  if (!active) return <section className="movie-stage movie-preview"><div className="movie-stage-heading"><div><Film size={18} /><span><strong>Movie preview</strong><small>Finished movie-linked clips appear here automatically in story order.</small></span></div></div><div className="movie-preview-empty"><Film size={30} /><strong>No finished movie clips yet</strong><span>Render a shot opened from this movie project. Its completed clip will be placed on this timeline without joining the source files.</span></div></section>
  return <section className="movie-stage movie-preview"><div className="movie-stage-heading"><div><Film size={18} /><span><strong>Movie preview</strong><small>{clips.length} finished clip{clips.length === 1 ? '' : 's'} · story order</small></span></div></div><div className="movie-preview-stage"><video key={active.shot.id} src={active.shot.outputUrl} controls autoPlay={activeIndex > 0} onEnded={() => { if (activeIndex < clips.length - 1) setActiveIndex(activeIndex + 1) }} /><div><strong>{active.scene.title} · {active.shot.title}</strong><span>Scene {active.sceneIndex + 1}, shot {active.shotIndex + 1} · {active.shot.duration}s · {routeName(active.shot.mode)}</span></div><nav aria-label="Movie preview controls"><button className="secondary-button" disabled={activeIndex === 0} onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}><SkipBack size={14} />Previous</button><span>{activeIndex + 1} / {clips.length}</span><button className="secondary-button" disabled={activeIndex === clips.length - 1} onClick={() => setActiveIndex(Math.min(clips.length - 1, activeIndex + 1))}>Next<SkipForward size={14} /></button></nav></div><div className="movie-clip-timeline" role="list" aria-label="Finished movie clips">{clips.map((clip, index) => <button role="listitem" className={index === activeIndex ? 'active' : ''} key={clip.shot.id} onClick={() => setActiveIndex(index)}><span>{clip.sceneIndex + 1}.{clip.shotIndex + 1}</span><strong>{clip.shot.title}</strong><small>{clip.scene.title} · {clip.shot.duration}s</small></button>)}</div></section>
}

function normalizeProjectPatch(raw: MovieChatResult['projectPatch'], current: MovieProject): Partial<MovieProject> {
  if (!raw) return {}
  return {
    title: typeof raw.title === 'string' ? raw.title : current.title,
    targetRuntime: clamp(Number(raw.targetRuntime), 10, 3600), computeBudgetMinutes: clamp(Number(raw.computeBudgetMinutes), 10, 100000),
    aspectRatio: ['16:9', '9:16', '1:1'].includes(raw.aspectRatio ?? '') ? raw.aspectRatio : current.aspectRatio,
    genre: typeof raw.genre === 'string' ? raw.genre : current.genre, visualStyle: typeof raw.visualStyle === 'string' ? raw.visualStyle : current.visualStyle,
    story: typeof raw.story === 'string' ? raw.story : current.story, visualRules: typeof raw.visualRules === 'string' ? raw.visualRules : current.visualRules,
  }
}
function normalizeChatAreas(raw: unknown[] | undefined, result?: MovieChatResult): MovieChatArea[] {
  const allowed: MovieChatArea[] = ['setup', 'bible', 'shots', 'preview']
  const areas = (raw ?? []).filter((area): area is MovieChatArea => allowed.includes(area as MovieChatArea))
  if (result?.characterUpserts?.length || result?.characterDeletes?.length || result?.locationUpserts?.length || result?.locationDeletes?.length) areas.push('bible')
  if (result?.sceneUpserts?.length || result?.sceneDeletes?.length || result?.shotUpserts?.length || result?.shotDeletes?.length) areas.push('shots')
  return [...new Set(areas)]
}

function hasMovieChatOperations(raw: MovieChatResult) {
  return [raw.characterUpserts, raw.characterDeletes, raw.locationUpserts, raw.locationDeletes, raw.sceneUpserts, raw.sceneDeletes, raw.shotUpserts, raw.shotDeletes].some((items) => Array.isArray(items) && items.length > 0)
}

function applyMovieChatOperations(current: MovieProject, raw: MovieChatResult): MovieProject {
  let next: MovieProject = { ...current, ...normalizeProjectPatch(raw.projectPatch, current) }
  if (!hasMovieChatOperations(raw)) return next

  const characterDeletes = new Set((raw.characterDeletes ?? []).map(text).filter(Boolean))
  const locationDeletes = new Set((raw.locationDeletes ?? []).map(text).filter(Boolean))
  const sceneDeletes = new Set((raw.sceneDeletes ?? []).map(text).filter(Boolean))
  const shotDeletes = new Set((raw.shotDeletes ?? []).map(text).filter(Boolean))
  const characterAliases = new Map<string, string>()
  const locationAliases = new Map<string, string>()
  const sceneAliases = new Map<string, string>()

  let characters = current.characters.filter((item) => !characterDeletes.has(item.id))
  for (const rawCharacter of raw.characterUpserts ?? []) {
    const suppliedId = text(rawCharacter.id)
    const existing = characters.find((character) => character.id === suppliedId)
    const id = existing?.id ?? createId()
    if (suppliedId) characterAliases.set(suppliedId, id)
    const name = text(rawCharacter.name) || existing?.name || ''
    if (!name) continue
    const character: MovieCharacter = { id, name, description: text(rawCharacter.description) || existing?.description || '', wardrobe: text(rawCharacter.wardrobe) || existing?.wardrobe || '', voiceNotes: text(rawCharacter.voiceNotes) || existing?.voiceNotes || '', referenceImages: existing?.referenceImages ?? [] }
    characters = existing ? characters.map((item) => item.id === id ? character : item) : [...characters, character]
  }

  let locations = current.locations.filter((item) => !locationDeletes.has(item.id))
  for (const rawLocation of raw.locationUpserts ?? []) {
    const suppliedId = text(rawLocation.id)
    const existing = locations.find((location) => location.id === suppliedId)
    const id = existing?.id ?? createId()
    if (suppliedId) locationAliases.set(suppliedId, id)
    const name = text(rawLocation.name) || existing?.name || ''
    if (!name) continue
    const location: MovieLocation = { id, name, description: text(rawLocation.description) || existing?.description || '', referenceImages: existing?.referenceImages ?? [] }
    locations = existing ? locations.map((item) => item.id === id ? location : item) : [...locations, location]
  }

  let scenes = current.scenes.filter((scene) => !sceneDeletes.has(scene.id)).map((scene) => ({ ...scene, locationId: locationDeletes.has(scene.locationId) ? '' : scene.locationId, shots: scene.shots.filter((shot) => !shotDeletes.has(shot.id)).map((shot) => ({ ...shot, characterIds: shot.characterIds.filter((id) => !characterDeletes.has(id)) })) }))
  for (const rawScene of raw.sceneUpserts ?? []) {
    const suppliedId = text(rawScene.id)
    const existing = scenes.find((scene) => scene.id === suppliedId)
    const id = existing?.id ?? createId()
    if (suppliedId) sceneAliases.set(suppliedId, id)
    const title = text(rawScene.title) || existing?.title || ''
    if (!title) continue
    const requestedLocation = locationAliases.get(text(rawScene.locationId)) ?? text(rawScene.locationId)
    const locationId = locations.some((location) => location.id === requestedLocation) ? requestedLocation : existing?.locationId ?? ''
    const transition = rawScene.transition === 'cut' || rawScene.transition === 'connected' ? rawScene.transition : existing?.transition ?? (scenes.length ? 'connected' : 'cut')
    const scene: MovieScene = { id, title, summary: text(rawScene.summary) || existing?.summary || '', locationId, transition, shots: existing?.shots ?? [] }
    scenes = existing ? scenes.map((item) => item.id === id ? scene : item) : [...scenes, scene]
  }

  const modes: GenerationMode[] = ['text', 'image', 'frames', 'reference']
  for (const rawShot of raw.shotUpserts ?? []) {
    const suppliedId = text(rawShot.id)
    const existingScene = scenes.find((scene) => scene.shots.some((shot) => shot.id === suppliedId))
    const existing = existingScene?.shots.find((shot) => shot.id === suppliedId)
    const requestedSceneId = sceneAliases.get(text(rawShot.sceneId)) ?? text(rawShot.sceneId)
    const targetSceneId = scenes.some((scene) => scene.id === requestedSceneId) ? requestedSceneId : existingScene?.id
    if (!targetSceneId) continue
    const id = existing?.id ?? createId()
    const title = text(rawShot.title) || existing?.title || ''
    if (!title) continue
    const rawCharacterIds = Array.isArray(rawShot.characterIds) ? rawShot.characterIds.map(text) : existing?.characterIds ?? []
    const characterIds = [...new Set(rawCharacterIds.map((characterId) => characterAliases.get(characterId) ?? characterId).filter((characterId) => characters.some((character) => character.id === characterId)))]
    const mode = modes.includes(rawShot.mode as GenerationMode) ? rawShot.mode as GenerationMode : existing?.preferredMode ?? existing?.mode ?? 'text'
    const shot: MovieShot = { ...existing, id, title, prompt: text(rawShot.prompt) || existing?.prompt || '', dialogue: text(rawShot.dialogue) || existing?.dialogue || '', duration: rawShot.duration === undefined ? existing?.duration ?? 5 : clamp(Number(rawShot.duration), 2, 15), mode, preferredMode: mode, characterIds, referenceImages: existing?.referenceImages ?? [], referenceVideos: existing?.referenceVideos ?? [], referenceAudios: existing?.referenceAudios ?? [], stage: existing?.stage ?? 'planned' }
    if (existing && existingScene?.id === targetSceneId) scenes = scenes.map((scene) => scene.id === targetSceneId ? { ...scene, shots: scene.shots.map((item) => item.id === id ? shot : item) } : scene)
    else {
      scenes = scenes.map((scene) => ({ ...scene, shots: scene.shots.filter((item) => item.id !== id) }))
      scenes = scenes.map((scene) => scene.id === targetSceneId ? { ...scene, shots: [...scene.shots, shot] } : scene)
    }
  }

  scenes = scenes.map((scene, index) => ({ ...scene, transition: index === 0 ? 'cut' : scene.transition, locationId: locations.some((location) => location.id === scene.locationId) ? scene.locationId : '', shots: scene.shots.map((shot) => ({ ...shot, characterIds: shot.characterIds.filter((id) => characters.some((character) => character.id === id)) })) }))
  next = { ...next, characters, locations, scenes }
  return next
}

function appendMovieChat(project: MovieProject, question: string, reply: string, appliedChanges: string[], areas: MovieChatArea[]) {
  const now = Date.now()
  return [...project.chatMessages,
    { id: createId(), role: 'user' as const, content: question, createdAt: now },
    { id: createId(), role: 'assistant' as const, content: reply, createdAt: now + 1, appliedChanges, areas },
  ].slice(-100)
}

function buildMovieRevisionDiffs(before: MovieProject, after: MovieProject): MovieRevisionDiff[] {
  const diffs: MovieRevisionDiff[] = []
  const addChange = (area: MovieChatArea, label: string, previous: unknown, next: unknown) => {
    const left = displayRevisionValue(previous)
    const right = displayRevisionValue(next)
    if (left === right) return
    diffs.push({ id: `${area}-${label}-${diffs.length}`, area, kind: 'change', label, before: left, after: right })
  }
  const projectFields: Array<[keyof MovieProject, string]> = [
    ['title', 'Project title'], ['targetRuntime', 'Target runtime'], ['computeBudgetMinutes', 'Compute budget'], ['aspectRatio', 'Aspect ratio'], ['genre', 'Genre'], ['visualStyle', 'Visual direction'], ['story', 'Story treatment'], ['visualRules', 'Continuity rules'],
  ]
  projectFields.forEach(([field, label]) => addChange(field === 'visualRules' ? 'bible' : 'setup', label, before[field], after[field]))

  diffNamedCollection(before.characters, after.characters, 'bible', 'Character', ['name', 'description', 'wardrobe', 'voiceNotes'], { name: 'name', description: 'appearance', wardrobe: 'wardrobe', voiceNotes: 'voice' }, diffs)
  diffNamedCollection(before.locations, after.locations, 'bible', 'Location', ['name', 'description'], { name: 'name', description: 'description' }, diffs)

  const beforeScenes = new Map(before.scenes.map((scene) => [scene.id, scene]))
  const afterScenes = new Map(after.scenes.map((scene) => [scene.id, scene]))
  for (const scene of before.scenes) {
    if (afterScenes.has(scene.id)) continue
    const rendered = scene.shots.filter((shot) => shot.outputUrl).length
    diffs.push({ id: `scene-remove-${scene.id}`, area: 'shots', kind: 'remove', label: `Scene “${scene.title}”`, before: `${scene.shots.length} shot${scene.shots.length === 1 ? '' : 's'}${rendered ? ` · ${rendered} rendered` : ''}`, destructive: true })
  }
  for (const scene of after.scenes) {
    const previous = beforeScenes.get(scene.id)
    if (!previous) {
      diffs.push({ id: `scene-add-${scene.id}`, area: 'shots', kind: 'add', label: `Scene “${scene.title}”`, after: `${scene.shots.length} shot${scene.shots.length === 1 ? '' : 's'}` })
      continue
    }
    addChange('shots', `Scene “${scene.title}” · title`, previous.title, scene.title)
    addChange('shots', `Scene “${scene.title}” · summary`, previous.summary, scene.summary)
    addChange('shots', `Scene “${scene.title}” · location`, movieLocationName(before, previous.locationId), movieLocationName(after, scene.locationId))
    addChange('shots', `Scene “${scene.title}” · transition`, previous.transition, scene.transition)
  }

  const beforeShots = flattenMovieShots(before).filter((entry) => afterScenes.has(entry.scene.id))
  const afterShots = flattenMovieShots(after)
  const beforeShotMap = new Map(beforeShots.map((entry) => [entry.shot.id, entry]))
  const afterShotMap = new Map(afterShots.map((entry) => [entry.shot.id, entry]))
  for (const entry of beforeShots) {
    if (afterShotMap.has(entry.shot.id)) continue
    diffs.push({ id: `shot-remove-${entry.shot.id}`, area: 'shots', kind: 'remove', label: `Shot “${entry.shot.title}”`, before: `${entry.scene.title}${entry.shot.outputUrl ? ' · rendered output attached' : ''}`, destructive: true })
  }
  for (const entry of afterShots) {
    const previous = beforeShotMap.get(entry.shot.id)
    if (!previous) {
      diffs.push({ id: `shot-add-${entry.shot.id}`, area: 'shots', kind: 'add', label: `Shot “${entry.shot.title}”`, after: `${entry.scene.title} · ${entry.shot.duration}s · ${routeName(entry.shot.mode)}` })
      continue
    }
    const prefix = `Shot “${entry.shot.title}”`
    addChange('shots', `${prefix} · scene`, previous.scene.title, entry.scene.title)
    addChange('shots', `${prefix} · title`, previous.shot.title, entry.shot.title)
    addChange('shots', `${prefix} · prompt`, previous.shot.prompt, entry.shot.prompt)
    addChange('shots', `${prefix} · dialogue`, previous.shot.dialogue, entry.shot.dialogue)
    addChange('shots', `${prefix} · duration`, `${previous.shot.duration}s`, `${entry.shot.duration}s`)
    addChange('shots', `${prefix} · route`, routeName(previous.shot.mode), routeName(entry.shot.mode))
    addChange('shots', `${prefix} · cast`, movieCharacterNames(before, previous.shot.characterIds), movieCharacterNames(after, entry.shot.characterIds))
  }
  return diffs
}

function diffNamedCollection<T extends { id: string; name: string }>(before: T[], after: T[], area: MovieChatArea, noun: string, fields: Array<keyof T>, labels: Partial<Record<keyof T, string>>, diffs: MovieRevisionDiff[]) {
  const beforeMap = new Map(before.map((item) => [item.id, item]))
  const afterMap = new Map(after.map((item) => [item.id, item]))
  for (const item of before) if (!afterMap.has(item.id)) diffs.push({ id: `${noun}-remove-${item.id}`, area, kind: 'remove', label: `${noun} “${item.name}”`, before: 'Removed from the movie and unassigned from linked shots', destructive: true })
  for (const item of after) {
    const previous = beforeMap.get(item.id)
    if (!previous) { diffs.push({ id: `${noun}-add-${item.id}`, area, kind: 'add', label: `${noun} “${item.name}”`, after: displayRevisionValue(fields.map((field) => item[field]).filter(Boolean).join(' · ')) }); continue }
    for (const field of fields) {
      const left = displayRevisionValue(previous[field]); const right = displayRevisionValue(item[field])
      if (left !== right) diffs.push({ id: `${noun}-${item.id}-${String(field)}`, area, kind: 'change', label: `${noun} “${item.name}” · ${labels[field] ?? String(field)}`, before: left, after: right })
    }
  }
}

function flattenMovieShots(project: MovieProject) { return project.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot }))) }
function movieLocationName(project: MovieProject, id: string) { return project.locations.find((location) => location.id === id)?.name || 'Unspecified' }
function movieCharacterNames(project: MovieProject, ids: string[]) { return ids.map((id) => project.characters.find((character) => character.id === id)?.name).filter(Boolean).join(', ') || 'No cast' }
function displayRevisionValue(value: unknown) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized
}

function SmartMarkup({ value }: { value: string }) {
  return <div className="chat-markup">{value.split(/\r?\n/).map((line, index) => {
    const heading = line.match(/^#{1,3}\s+(.+)/)
    const bullet = line.match(/^[-*]\s+(.+)/)
    if (!line.trim()) return <span className="chat-markup-space" key={index} />
    if (heading) return <strong className="chat-markup-heading" key={index}>{inlineMarkup(heading[1])}</strong>
    if (bullet) return <span className="chat-markup-bullet" key={index}><i>•</i><span>{inlineMarkup(bullet[1])}</span></span>
    return <p key={index}>{inlineMarkup(line)}</p>
  })}</div>
}

function inlineMarkup(value: string) {
  return value.split(/(\*\*.*?\*\*|`.*?`)/g).filter(Boolean).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part)
}

function areaLabel(area: MovieChatArea) { return area === 'setup' ? 'Review story' : area === 'bible' ? 'Review bible' : area === 'shots' ? 'Review shots' : 'Open preview' }

function AssetCollection({ title, subtitle, empty, onAdd, library, children }: { title: string; subtitle: string; empty: string; onAdd(): void; library?: React.ReactNode; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  const [characters, setCharacters] = useState<CharacterProject[]>(loadCharacterProjects)
  const [locations, setLocations] = useState<LocationProject[]>(loadLocationProjects)
  useEffect(() => { const refresh = () => setCharacters(loadCharacterProjects()); window.addEventListener(CHARACTER_LIBRARY_EVENT, refresh); return () => window.removeEventListener(CHARACTER_LIBRARY_EVENT, refresh) }, [])
  useEffect(() => { const refresh = () => setLocations(loadLocationProjects()); window.addEventListener(LOCATION_LIBRARY_EVENT, refresh); return () => window.removeEventListener(LOCATION_LIBRARY_EVENT, refresh) }, [])
  const libraryStrip = title === 'Characters' && characters.length > 0 ? <div className="bible-library-strip"><span>Add from Character Studio</span>{characters.map((character) => { const references = characterReferences(character); return <button key={character.id} disabled={!references.length} onClick={() => window.dispatchEvent(new CustomEvent(IMPORT_CHARACTER_EVENT, { detail: character.id }))}>{character.baseImage?.preview ? <img src={character.baseImage.preview} alt="" /> : <Users size={14} />}<span>{character.name}</span><Plus size={12} /></button> })}</div> : title === 'Locations' && locations.length > 0 ? <div className="bible-library-strip"><span>Add from Location Studio</span>{locations.map((location) => { const references = locationReferences(location); return <button key={location.id} disabled={!references.length} onClick={() => window.dispatchEvent(new CustomEvent(IMPORT_LOCATION_EVENT, { detail: location.id }))}>{references[0]?.preview ? <img src={references[0].preview} alt="" /> : <MapPin size={14} />}<span>{location.name}</span><Plus size={12} /></button> })}</div> : null
  return <section className="bible-column"><div className="bible-column-heading"><div><strong>{title}</strong><small>{subtitle}</small></div><button onClick={onAdd}><Plus size={14} />Create</button></div>{library ?? libraryStrip}{hasChildren ? <div className="asset-card-grid">{children}</div> : <div className="bible-empty">{empty}</div>}</section>
}

function AssetCard({ icon, name, description, references, linked, refreshAvailable, onRefresh, onEdit, onRemove }: { icon: 'character' | 'location'; name: string; description: string; references: MediaFile[]; linked?: boolean; refreshAvailable?: boolean; onRefresh?(): void; onEdit(): void; onRemove(): void }) {
  return <article className="movie-asset-card"><button className="asset-card-main" onClick={onEdit}>{references[0]?.preview ? <img src={references[0].preview} alt="" /> : <span className="asset-placeholder">{icon === 'character' ? <Users size={20} /> : <MapPin size={20} />}</span>}<span className="asset-card-copy"><strong>{name}{linked && <em>Character Studio</em>}</strong><span>{description || `Add ${icon === 'character' ? 'appearance and performance' : 'set and atmosphere'} details`}</span><small>{references.length} approved reference image{references.length === 1 ? '' : 's'}{!linked && icon === 'character' ? ' · movie only' : ''}</small>{refreshAvailable && <small className="asset-refresh-state">Character Studio has newer references</small>}</span></button><div className="asset-card-actions">{refreshAvailable && onRefresh && <button className="refresh" onClick={onRefresh}><RefreshCw size={13} />Refresh</button>}<button onClick={onEdit}><Pencil size={13} />Edit</button><button aria-label={`Remove ${name}`} onClick={onRemove}><Trash2 size={13} /></button></div></article>
}
function AssetModal({ title, subtitle, onClose, onSave, saveDisabled, children }: { title: string; subtitle: string; onClose(): void; onSave(): void; saveDisabled: boolean; children: React.ReactNode }) {
  return <div className="modal-backdrop movie-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="movie-asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title"><header><div><span>MOVIE ASSET</span><strong id="asset-modal-title">{title}</strong><small>{subtitle}</small></div><button aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header><div className="movie-modal-body">{children}</div><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saveDisabled} onClick={onSave}>Save to movie</button></footer></section></div>
}
function ReferencePicker({ files, onAdd, onRemove }: { files: MediaFile[]; onAdd(): void; onRemove(index: number): void }) {
  return <section className="asset-references"><div><span><strong>Reference images</strong><small>Use clear, consistent views. Files stay in their current locations.</small></span><button className="secondary-button" onClick={onAdd}><ImagePlus size={14} />Add image</button></div>{files.length ? <div className="reference-thumb-grid">{files.map((file, index) => <figure key={`${file.path}-${index}`}><img src={file.preview} alt={file.name} /><figcaption title={file.name}>{file.name}</figcaption><button aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}><X size={13} /></button></figure>)}</div> : <div className="reference-empty"><ImagePlus size={19} /><span>No references added. You can still save and add them later.</span></div>}</section>
}
function ShotReferencePicker({ shot, onAdd, onRemove }: { shot: MovieShot; onAdd(kind: 'image' | 'video' | 'audio'): void; onRemove(kind: 'image' | 'video' | 'audio', index: number): void }) {
  const groups = [['image', shot.referenceImages ?? []], ['video', shot.referenceVideos ?? []], ['audio', shot.referenceAudios ?? []]] as const
  return <fieldset className="shot-reference-picker"><legend>Explicit shot references</legend><div className="shot-reference-actions">{groups.map(([kind, files]) => <div key={kind}><button type="button" onClick={() => onAdd(kind)}><Plus size={12} />Add {kind}</button>{files.map((file, index) => <span key={`${file.path}-${index}`} title={file.name}>{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(kind, index)}><X size={11} /></button></span>)}</div>)}</div></fieldset>
}

function blankCharacter(): MovieCharacter { return { id: createId(), name: '', description: '', wardrobe: '', voiceNotes: '', referenceImages: [] } }
function blankLocation(): MovieLocation { return { id: createId(), name: '', description: '', referenceImages: [] } }
function makeShot(index: number): MovieShot { return { id: createId(), title: `Shot ${index}`, duration: 5, prompt: '', dialogue: '', mode: 'text', preferredMode: 'text', characterIds: [], referenceImages: [], referenceVideos: [], referenceAudios: [], stage: 'planned' } }
function normalizePlan(raw: unknown, project: MovieProject): MovieScene[] {
  const value = raw as { scenes?: Array<{ title?: unknown; summary?: unknown; location?: unknown; shots?: Array<{ title?: unknown; duration?: unknown; prompt?: unknown; dialogue?: unknown; mode?: unknown; characters?: unknown }> }> }
  if (!Array.isArray(value?.scenes)) return []
  const modes: GenerationMode[] = ['text', 'image', 'frames', 'reference']
  return value.scenes.slice(0, 24).map((scene, sceneIndex) => {
    const locationName = text(scene.location)
    const locationId = project.locations.find((item) => item.name.toLowerCase() === locationName.toLowerCase())?.id ?? ''
    const shots = Array.isArray(scene.shots) ? scene.shots.slice(0, 16).map((shot, shotIndex) => {
      const names = Array.isArray(shot.characters) ? shot.characters.map(text) : []
      const mode = modes.includes(shot.mode as GenerationMode) ? shot.mode as GenerationMode : 'text'
      return { id: createId(), title: text(shot.title) || `Shot ${shotIndex + 1}`, duration: clamp(Number(shot.duration) || 5, 2, 15), prompt: text(shot.prompt), dialogue: text(shot.dialogue), mode, preferredMode: mode, characterIds: project.characters.filter((character) => names.some((name) => name.toLowerCase() === character.name.toLowerCase())).map((character) => character.id), referenceImages: [], referenceVideos: [], referenceAudios: [], stage: 'planned' as const }
    }).filter((shot) => shot.prompt) : []
    return { id: createId(), title: text(scene.title) || `Scene ${sceneIndex + 1}`, summary: text(scene.summary), locationId, transition: sceneIndex === 0 ? 'cut' as const : 'connected' as const, shots }
  }).filter((scene) => scene.shots.length)
}
function routeName(mode: GenerationMode) { return ({ text: 'T2V', image: 'I2V', frames: 'First + last', reference: 'Ref2V' } as const)[mode] }
function text(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)) }
function formatDuration(seconds: number) { const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }
