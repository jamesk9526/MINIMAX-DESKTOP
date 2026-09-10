import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import QRCode from 'qrcode'
import { createId } from './lib/createId'
import {
  Activity,
  AlertCircle,
  Aperture,
  Bookmark,
  Check,
  ChevronDown,
  Clapperboard,
  CircleStop,
  Clock3,
  Copy,
  ExternalLink,
  Film,
  Folder,
  FolderOpen,
  Gauge,
  HardDrive,
  History,
  Image as ImageIcon,
  ImagePlus,
  Library,
  LockKeyhole,
  ListVideo,
  LoaderCircle,
  MapPin,
  Menu,
  MessageSquareText,
  Minus,
  Music2,
  PanelLeftClose,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Settings,
  Shirt,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Trash2,
  Users,
  Volume2,
  WandSparkles,
  Watch,
  X,
} from 'lucide-react'
import { buildMiniMaxReferenceStillWorkflow, buildMiniMaxWorkflow, extractOutputFile, extractOutputUrl, frameCount } from './lib/workflow'
import { buildLtx25Workflow } from './lib/ltx25Workflow'
import { ACE_STEP_REQUIRED_NODES, buildAceStepWorkflow, inferAceStepSelections } from './lib/aceStepWorkflow'
import { fitWholeCharacter, prepareImage } from './lib/imageCrop'
import { inferLtx25Selections, inferSelections } from './lib/modelSelection'
import { choices, type ObjectInfo } from './lib/comfyInfo'
import { useLivePreview, type LivePreview, type LiveProgress } from './lib/useLivePreview'
import { RenderSize } from './components/RenderSize'
import { ImageCrop } from './components/ImageCrop'
import { ZImageWorkspace } from './components/ZImageWorkspace'
import { ClipEditor } from './components/ClipEditor'
import { FrameBookmarkStudio, type BookmarkVideo } from './components/FrameBookmarkStudio'
import { MoviePlanner } from './components/MoviePlanner'
import { Ltx25Workspace } from './components/Ltx25Workspace'
import { AceStepWorkspace } from './components/AceStepWorkspace'
import { VideoReferenceClipper } from './components/VideoReferenceClipper'
import { CharacterStudio } from './components/CharacterStudio'
import { HairStudio } from './components/HairStudio'
import { WardrobeStudio } from './components/WardrobeStudio'
import { LocationStudio } from './components/LocationStudio'
import { AccessoryStudio } from './components/AccessoryStudio'
import { AiChatHead, type CopilotWorkspaceContext } from './components/AiChatHead'
import { SmartPromptEditor, type SmartPromptEditorHandle } from './components/SmartPromptEditor'
import { CharacterDialogueModal, type CharacterDialogueDraft } from './components/CharacterDialogueModal'
import { RenderConstruction } from './components/RenderConstruction'
import { CHARACTER_LIBRARY_EVENT, characterReferences, loadCharacterProjects, updateCharacterProject } from './lib/characterLibrary'
import { loadWardrobeProjects, wardrobeReferences, WARDROBE_LIBRARY_EVENT } from './lib/wardrobeLibrary'
import { loadLocationProjects, locationReferences, updateLocationProject, LOCATION_LIBRARY_EVENT } from './lib/locationLibrary'
import { loadHairStyleProjects } from './lib/hairLibrary'
import { allocateWorkspaceReferences, buildPromptAssistantRequest, composeReferenceInstructions } from './lib/promptComposer'
import { applyDialoguePolicy, applyNaturalMovementPolicy, buildCharacterDialogueRequest } from './lib/dialogPolicy'
import { COPILOT_DECISION_EVENT, offerCopilotSuggestion } from './lib/copilot'
import { resolveLlmConnection } from './lib/llmProvider'
import type {
  AppSettings,
  AceStepGenerationOptions,
  CharacterProject,
  ComfyStatus,
  GenerationJob,
  GenerationMode,
  GpuTelemetry,
  Ltx25GenerationOptions,
  LocationProject,
  LanStatus,
  MediaFile,
  MediaKind,
  ModelFile,
  ModelKind,
  ModelSelection,
  Turbo8Profile,
  MovieProject,
  MovieReferenceBinding,
  ResolvedMovieShot,
  RenderSettingsPreset,
  WardrobeProject,
  MovieShot,
  OllamaModel,
  UpscaleMode,
  View,
} from './types'

type PersistedWorkspace = {
  mode: GenerationMode
  prompt: string
  duration: number
  resolution: string
  turbo: 'off' | '4' | '8'
  steps: number
  sampler: string
  scheduler: string
  experimentalSampling: boolean
  refImageSize: 'match' | 'max'
  noDialogue: boolean
  naturalMovement: boolean
  clothingPolicy: 'wardrobe' | 'underwear' | 'unrestricted'
  sigmaShiftMode: 'model' | 'custom'
  shiftVideo: number
  shiftAudio: number
  loraStrength: number
  userLoras: Array<{ name: string; strength: number }>
  seed: number
  advanced: boolean
  liveEnabled: boolean
  livePreviewMode: 'standard' | 'h3-override'
  upscaleMode: UpscaleMode
  textEncoderPreference: 'fast' | 'quality'
  turbo8Profile: Turbo8Profile
  rtxModel: string
  firstFrame: MediaFile | null
  lastFrame: MediaFile | null
  referenceImages: MediaFile[]
  referenceVideos: MediaFile[]
  referenceAudios: MediaFile[]
  selectedReferenceCharacterIds: string[]
  selectedReferenceLocationIds: string[]
  activeJobId: string | null
  movieHandoff: MovieLink | null
}

type MovieLink = { projectId: string; sceneId: string; shotId: string }

const workspaceDefaults: PersistedWorkspace = {
  mode: 'text', prompt: '', duration: 5, resolution: '1344x768', turbo: 'off', steps: 30,
  sampler: 'res_multistep', scheduler: 'simple', experimentalSampling: false, refImageSize: 'match', noDialogue: true, naturalMovement: true, clothingPolicy: 'wardrobe',
  sigmaShiftMode: 'model', shiftVideo: 12, shiftAudio: 3, loraStrength: 1, userLoras: [{ name: '', strength: 1 }, { name: '', strength: 1 }], seed: Math.floor(Math.random() * 1_000_000_000),
  advanced: false, liveEnabled: true, livePreviewMode: 'standard', upscaleMode: 'off', textEncoderPreference: 'fast', turbo8Profile: 'balanced', rtxModel: '', firstFrame: null,
  lastFrame: null, referenceImages: [], referenceVideos: [], referenceAudios: [], selectedReferenceCharacterIds: [], selectedReferenceLocationIds: [], activeJobId: null, movieHandoff: null,
}

const LTX_UPSCALE_REQUIRED_NODES = [
  'VAEEncodeTiled', 'LatentUpscaleModelLoader', 'LTXVLatentUpsampler',
  'VAEDecodeTiled', 'ImageFromBatch', 'RepeatImageBatch', 'ImageBatch',
] as const

const LTX_NATIVE_REQUIRED_NODES = [
  'LTXVConditioning', 'LTXVEmptyLatentAudio', 'EmptyLTXVLatentVideo',
  'LTXVDualCFGGuider', 'LTXVSeparateAVLatent', 'LTXVConcatAVLatent',
  'LTXVLatentUpsampler', 'LTXVAudioVAEDecode', 'ManualSigmas',
  'VAEDecodeTiled', 'CLIPTextEncode', 'KSamplerSelect', 'SamplerCustomAdvanced',
] as const

function findH3PreviewOverrideNode(info: ObjectInfo) {
  return Object.keys(info).find((name) => name === 'MiniMaxH3PreviewOverrideCS')
    ?? Object.keys(info).find((name) => /minimax.*h3.*preview.*override/i.test(name))
}

function formatRuntime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatStepDuration(milliseconds: number) {
  const seconds = Math.max(0, milliseconds / 1000)
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s/step`
}

function samplerProgressSummary(job: GenerationJob | undefined, now: number) {
  if (!job || job.status !== 'running' || job.currentStep === undefined || !job.totalSteps || job.totalSteps <= 0) return null
  const progress = Math.min(100, Math.round((job.currentStep / job.totalSteps) * 100))
  const rate = job.estimatedSamplerStepMs
  const nextStepIn = rate && job.lastSamplerStepAt ? Math.max(0, rate - (now - job.lastSamplerStepAt)) : undefined
  return { progress, currentStep: job.currentStep, totalSteps: job.totalSteps, rate, nextStepIn }
}

function buildCharacterDetailInstructions(characters: CharacterProject[], enabled: boolean) {
  if (!enabled) return []
  return characters.flatMap((character) => (character.detailReferences ?? []).flatMap((detail) => detail.images.length
    ? [`${character.name} detail reference${detail.label.trim() ? ` · ${detail.label.trim()}` : ''}: ${detail.notes.trim() || 'Preserve the visible detail exactly from its assigned reference image.'}`]
    : []))
}

function readWorkspace(): PersistedWorkspace {
  try {
    const stored = JSON.parse(localStorage.getItem('minimax.workspace') ?? '{}') as Partial<PersistedWorkspace>
    const workspace = { ...workspaceDefaults, ...stored }
    workspace.userLoras = Array.isArray(stored.userLoras) ? stored.userLoras.slice(0, 2).map((item) => ({ name: typeof item?.name === 'string' ? item.name : '', strength: Math.max(0, Math.min(2, Number(item?.strength) || 1)) })) : workspaceDefaults.userLoras.map((item) => ({ ...item }))
    while (workspace.userLoras.length < 2) workspace.userLoras.push({ name: '', strength: 1 })
    // Existing installs predate the explicit experimental opt-in. Migrate them
    // back to the official ComfyUI sampling pair to prevent stale combinations
    // such as heun+karras from continuing to produce surprising output.
    if (!stored.experimentalSampling) {
      workspace.sampler = 'res_multistep'
      workspace.scheduler = 'simple'
      workspace.experimentalSampling = false
    }
    workspace.steps = Math.max(16, Math.min(30, Number(workspace.steps) || 30))
    if (stored.steps === 20) workspace.steps = 30
    return workspace
  } catch {
    return workspaceDefaults
  }
}

function withoutPreview(file: MediaFile | null) {
  if (!file) return null
  const stored = { ...file }
  delete stored.preview
  return stored
}

const modeInfo: Array<{ id: GenerationMode; label: string; note: string; icon: typeof Film }> = [
  { id: 'text', label: 'Text', note: 'Prompt to video', icon: WandSparkles },
  { id: 'image', label: 'Image', note: 'Animate one frame', icon: ImageIcon },
  { id: 'frames', label: 'First + last', note: 'Direct the transition', icon: Aperture },
  { id: 'reference', label: 'Reference', note: 'Images, video, audio', icon: Sparkles },
]

const diagnosticPrompt = 'A woman standing beside a window in soft daylight, natural skin texture, subtle head movement, realistic cinematic photography.'
const validatedH3Files = [
  { label: 'FL2VA', kind: 'diffusion_models' as const, expected: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', fallback: /^minimax_h3_fl2va.*\.safetensors$/i },
  { label: 'Ref2VA', kind: 'diffusion_models' as const, expected: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', fallback: /^minimax_h3_ref2va.*\.safetensors$/i },
  { label: 'Text encoder', kind: 'text_encoders' as const, expected: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', alternatives: ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors'], fallback: /^qwen3vl_32b_minimax_h3.*\.safetensors$/i },
  { label: 'Video VAE', kind: 'vae' as const, expected: 'minimax_h3_video_vae_fp16.safetensors', fallback: /^minimax_h3_video_vae.*\.safetensors$/i },
  { label: 'Audio VAE', kind: 'vae' as const, expected: 'minimax_h3_audio_vae_fp32.safetensors', fallback: /^minimax_h3_audio_vae.*\.safetensors$/i },
  { label: 'FL2V Turbo 8 LoRA', kind: 'loras' as const, expected: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', fallback: /^minimax_h3_fl2v_turbo_8step.*\.safetensors$/i },
  { label: 'Ref2V Turbo 8 LoRA', kind: 'loras' as const, expected: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', fallback: /^minimax_h3_ref2v_turbo_8step.*\.safetensors$/i },
  { label: 'Ref2V Turbo 4 LoRA', kind: 'loras' as const, expected: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', fallback: /^minimax_h3_ref2v_turbo_4step.*\.safetensors$/i, optional: true },
]

function h3StackReport(models: ModelFile[]) {
  const rows = validatedH3Files.map((definition) => {
    const files = models.filter((model) => model.kind === definition.kind)
    const exact = files.find((model) => [definition.expected, ...(definition.alternatives ?? [])].some((name) => model.name.toLowerCase() === name.toLowerCase()))
    const fallback = files.find((model) => definition.fallback.test(model.name))
    return { ...definition, selected: exact?.name ?? fallback?.name ?? '', validated: Boolean(exact) }
  })
  return { rows, validated: rows.every((row) => row.optional || row.validated), ready: rows.every((row) => row.optional || row.selected) }
}

function playableOutputUrl(value?: string) {
  if (!value || value.startsWith('minimax-media:')) return value
  try {
    const url = new URL(value)
    return url.pathname === '/view' ? `minimax-media://comfy?url=${encodeURIComponent(value)}` : value
  } catch {
    return value
  }
}

const initialJobs = (): GenerationJob[] => {
  try {
    const stored = JSON.parse(localStorage.getItem('minimax.jobs') ?? '[]') as GenerationJob[]
    return stored.map((job) => ({ ...job, outputUrl: playableOutputUrl(job.outputUrl) }))
  } catch {
    return []
  }
}

function recordMovieOutput(link: MovieLink | undefined, outputUrl: string) {
  if (!link) return
  try {
    const projects = JSON.parse(localStorage.getItem('minimax.movie-projects') ?? '[]') as MovieProject[]
    const next = projects.map((project) => project.id !== link.projectId ? project : { ...project, updatedAt: Date.now(), scenes: project.scenes.map((scene) => scene.id !== link.sceneId ? scene : { ...scene, shots: scene.shots.map((shot) => shot.id !== link.shotId ? shot : { ...shot, outputUrl, renderedAt: Date.now(), stage: 'rendered' as const }) }) })
    localStorage.setItem('minimax.movie-projects', JSON.stringify(next))
  } catch { /* Keep the completed generation even if legacy movie data cannot be updated. */ }
}

function recordCharacterTurntable(characterProjectId: string | undefined, outputUrl: string) {
  if (!characterProjectId) return
  updateCharacterProject(characterProjectId, { turntableVideo: { path: outputUrl, name: 'Generated character turntable', kind: 'video', preview: outputUrl } })
}

function recordLocationWalkthrough(locationProjectId: string | undefined, outputUrl: string) {
  if (!locationProjectId) return
  updateLocationProject(locationProjectId, { walkthroughVideo: { path: outputUrl, name: 'Generated location walkthrough', kind: 'video', preview: outputUrl } })
}

async function extractAutomatedReferenceSet(kind: 'character' | 'location', projectId: string | undefined, source: string, duration: number, settings: AppSettings) {
  if (!projectId || !source) return null
  try {
    const positions = [0.05, .25, .5, .75, .95].map((ratio) => Math.max(0, Math.min(duration - .04, duration * ratio)))
    const references = await Promise.all(positions.map(async (position) => {
      const result = await window.minimax.extractVideoFrame(source, position, settings.outputDirectory, settings.ffmpegPath)
      return { ...result, kind: 'image' as const, preview: await window.minimax.mediaUrl(result.path) }
    }))
    if (kind === 'character') updateCharacterProject(projectId, { referenceMode: 'set', referenceImages: references, selectedReferencePaths: undefined })
    else updateLocationProject(projectId, { referenceMode: 'set', referenceImages: references, selectedReferencePaths: undefined })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

function shortPrompt(prompt: string) {
  return prompt.length > 76 ? `${prompt.slice(0, 76)}…` : prompt
}

function syncReferencePrompt(value: string, previous: MovieReferenceBinding[], next: MovieReferenceBinding[]) {
  let result = value
    // The automatic reference direction is one generated line. Remove it as a
    // unit so changed wardrobe/hair assignments cannot leave a stale block.
    .replace(/^References:[^\r\n]*(?:\r?\n\r?\n|$)/m, '')
    .replace(/Character:\s*([^—\n]+?)\s*—\s*(?=<Picture \d+>)[^\n]*?from another character\./g, (_match, name: string) => `Character: ${name.trim()}.`)
    .replace(/Location:\s*preserve the approved ([^;\n]+?) environment from [^;\n]+;\s*keep its architecture, layout, materials, lighting, landmarks, and geography consistent\./gi, (_match, name: string) => `Location: ${name.trim()}.`)
  const previousInstructions = composeReferenceInstructions(previous)
  const previousCharacters = [...new Set(previous.filter((binding) => binding.characterId).map((binding) => binding.label.replace(/^Character:\s*/, '').replace(/^Wardrobe:\s*/, '').split(' / ')[0].split(' for ').at(-1)!))]
  for (const name of previousCharacters) {
    const instructions = previousInstructions.filter((line) => line.includes(name)).join(' ')
    result = result.replace(`Character: ${name} — ${instructions}`, `Character: ${name}`)
  }
  for (const line of previousInstructions) result = result.replace(line, '')
  result = result.replace(/References:\s*(?=\n|$)/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const nextInstructions = composeReferenceInstructions(next).join(' ')
  return [result, nextInstructions ? `References: ${nextInstructions}` : ''].filter(Boolean).join('\n\n')
}

function composeH3Prompt(input: {
  prompt: string
  mode: GenerationMode
  duration: number
  bindings: MovieReferenceBinding[]
  clothingPolicy: 'wardrobe' | 'underwear' | 'unrestricted'
  noDialogue: boolean
  naturalMovement: boolean
  referenceVideoCount?: number
  referenceAudioCount?: number
}) {
  const activeBindings = input.clothingPolicy === 'wardrobe' ? input.bindings : input.bindings.filter((binding) => binding.purpose !== 'wardrobe')
  const referenceDirection = composeReferenceInstructions(activeBindings).join(' ')
  const missingReferenceDirection = referenceDirection && !input.prompt.includes(referenceDirection) ? referenceDirection : ''
  const policyDirection = input.clothingPolicy === 'wardrobe'
    ? missingReferenceDirection
    : input.clothingPolicy === 'underwear'
      ? `${missingReferenceDirection} Clothing intent: keep only the underwear shown in each named adult character's own identity reference; do not add outer garments and ignore supplied wardrobe outfits.`
      : `${missingReferenceDirection} Clothing intent: adult fictional characters only; follow the scene prompt's explicit clothing or nudity direction. Clothing visible in identity references is not mandatory and must not override the scene prompt.`
  const composed = applyNaturalMovementPolicy(applyDialoguePolicy([input.prompt.trim(), input.mode === 'reference' && input.bindings.length ? policyDirection.trim() : ''].filter(Boolean).join(' '), input.noDialogue), input.naturalMovement)
  // MiniMax H3 uses a distinct six-section contract in full-reference mode.
  // It needs explicit subjects and retention rules, whereas T2V/I2V use the
  // smaller audiovisual timeline format.
  if (/^\s*(?:subject_definitions|summary|retention_analysis|detailed_description|how the reference pictures align|for the target video|integrated_multimodal_description):/i.test(composed)) return composed
  const musicRequested = /\b(?:background music|score|soundtrack|music begins|music plays|song)\b/i.test(composed)
  const soundscape = input.noDialogue
    ? 'Only the natural ambience and synchronized physical sound effects described in the shot; no speech, singing, narration, captions, or text overlays.'
    : 'Natural ambience and synchronized physical sound effects match the visible actions and environment. No additional voices, narration, or sound events are introduced.'
  const music = musicRequested ? 'Use only the non-diegetic music explicitly requested in the visual description; do not add any other score.' : 'N/A'
  if (input.mode === 'reference') {
    const numbered = activeBindings.map((binding, index) => ({ ...binding, number: index + 1 }))
    const subjectLines: string[] = []
    const retentionLines: string[] = []
    const characters = new Map<string, typeof numbered>()
    for (const binding of numbered.filter((binding) => binding.characterId)) characters.set(binding.characterId!, [...(characters.get(binding.characterId!) ?? []), binding])
    let subjectNumber = 1
    for (const bindings of characters.values()) {
      const name = bindings.find((binding) => binding.purpose === 'character' || binding.purpose === 'character-angle')?.label.replace(/^Character:\s*/, '').split(' / ')[0] ?? bindings[0].label.split(' for ').at(-1) ?? 'character'
      const pictures = bindings.map((binding) => `<Picture ${binding.number}>`).join(', ')
      const subject = `<Subject ${subjectNumber++}>`
      subjectLines.push(`${subject} is ${name}, defined by ${pictures}. Preserve the assigned identity, hair, wardrobe, accessories, and approved detail references only in the role explicitly assigned to each picture.`)
      retentionLines.push(`${subject} (appears in [Shot 1]): fully_preserved - retain ${name}'s approved identity and all assigned attributes without merging, swapping, or duplicating them.`)
    }
    for (const binding of numbered.filter((binding) => binding.purpose === 'location')) {
      const subject = `<Subject ${subjectNumber++}>`
      const name = binding.label.replace(/^Location:\s*/, '')
      subjectLines.push(`${subject} is the approved ${name} environment from <Picture ${binding.number}>. Preserve its spatial layout, materials, landmarks, and atmosphere.`)
      retentionLines.push(`${subject} (appears in [Shot 1]): fully_preserved - retain the approved ${name} layout, landmarks, lighting logic, and atmosphere.`)
    }
    for (const binding of numbered.filter((binding) => binding.purpose === 'generic')) {
      const subject = `<Subject ${subjectNumber++}>`
      subjectLines.push(`${subject} is the visual planning reference in <Picture ${binding.number}>.`)
      retentionLines.push(`${subject} (appears where relevant): weak_reference - use only its requested composition, style, or visual planning cues.`)
    }
    const sourceLines = numbered.filter((binding) => !binding.characterId && binding.purpose !== 'location' && binding.purpose !== 'generic').map((binding) => `<Picture ${binding.number}> is used only as ${binding.label}.`)
    const videoDefinitions = Array.from({ length: input.referenceVideoCount ?? 0 }, (_, index) => `<Video ${index + 1}> is a temporal reference for the target video. Use it only for requested action timing, camera movement, cut rhythm, or motion qualities; it is not a source-video edit or continuation unless the detailed description explicitly says so.`)
    const audioDefinitions = Array.from({ length: input.referenceAudioCount ?? 0 }, (_, index) => `<Audio ${index + 1}> is an audio reference for the target video. Use only the requested voice timbre, delivery, rhythm, music style, or sound texture; do not copy the source signal verbatim unless the detailed description explicitly says so.`)
    const mediaRetention = [
      ...Array.from({ length: input.referenceVideoCount ?? 0 }, (_, index) => `<Video ${index + 1}> (camera, action, or temporal structure): weak_reference - transfer only the requested motion or pacing qualities without copying source subjects or footage.`),
      ...Array.from({ length: input.referenceAudioCount ?? 0 }, (_, index) => `<Audio ${index + 1}>: reference - use only the requested timbre, rhythm, music style, or sound texture; generate a new synchronized target soundtrack.`),
    ]
    return [
      `subject_definitions:\n${[...subjectLines, ...sourceLines, ...videoDefinitions, ...audioDefinitions].join('\n')}`,
      `summary: [reference generation] Create one coherent target video from the approved sources. Reference assignments are authoritative and must not be swapped, merged, duplicated, or treated as on-screen source material.`,
      `retention_analysis:\n${[...retentionLines, ...mediaRetention, referenceDirection || 'Reference assignments are role-specific; do not swap, merge, duplicate, or show source sheets, panels, or backgrounds.'].join('\n')}`,
      `detailed_description: ${composed}`,
      `overall_soundscape: ${soundscape}`,
      `non_diegetic_music: ${music}`,
    ].join('\n\n')
  }
  const alignment = input.mode === 'frames'
    ? `How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 0.00-second mark of the target video; <Picture 2> (from [Shot 1]) aligns with the ${input.duration.toFixed(2)}-second mark of the target video.`
    : input.mode === 'image'
      ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
      : ''
  return [
    alignment,
    `integrated_multimodal_description: [Shot 1] ${composed}`,
    `overall_soundscape: ${soundscape}`,
    `non_diegetic_music: ${music}`,
  ].filter(Boolean).join('\n\n')
}

function appendPromptAddition(current: string, addition: string) {
  const base = current.trim()
  const next = addition.trim()
  if (!next || base.includes(next)) return base
  return [base, next].filter(Boolean).join('\n\n')
}

function resolveRenderReferenceImages(files: MediaFile[], bindings: MovieReferenceBinding[], clothingPolicy: 'wardrobe' | 'underwear' | 'unrestricted') {
  if (!bindings.length) return files
  const activeBindings = clothingPolicy === 'wardrobe' ? bindings : bindings.filter((binding) => binding.purpose !== 'wardrobe')
  const libraryPaths = new Set(bindings.map((binding) => binding.file.path))
  const assigned = activeBindings.map((binding) => files.find((file) => file.path === binding.file.path) ?? binding.file)
  const standalone = files.filter((file) => !libraryPaths.has(file.path))
  return [...assigned, ...standalone].slice(0, 9)
}

function App() {
  const persisted = useMemo(readWorkspace, [])
  const [view, setView] = useState<View>('create')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 680)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [models, setModels] = useState<ModelFile[]>([])
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState<ComfyStatus>({ connected: false, latencyMs: 0 })
  const [checking, setChecking] = useState(false)
  const [gpu, setGpu] = useState<GpuTelemetry | null>(null)
  const [mode, setMode] = useState<GenerationMode>(persisted.mode)
  const [prompt, setPrompt] = useState(persisted.prompt)
  const [duration, setDuration] = useState(persisted.duration)
  const [resolution, setResolution] = useState(persisted.resolution)
  const [turbo, setTurbo] = useState<'off' | '4' | '8'>(persisted.turbo)
  const [textEncoderPreference, setTextEncoderPreference] = useState<'fast' | 'quality'>(persisted.textEncoderPreference)
  const [turbo8Profile, setTurbo8Profile] = useState<Turbo8Profile>(persisted.turbo8Profile)
  const [steps, setSteps] = useState(persisted.steps)
  const [sampler, setSampler] = useState(persisted.sampler)
  const [scheduler, setScheduler] = useState(persisted.scheduler)
  const [experimentalSampling, setExperimentalSampling] = useState(persisted.experimentalSampling)
  const [refImageSize, setRefImageSize] = useState<'match' | 'max'>(persisted.refImageSize)
  const [noDialogue, setNoDialogue] = useState(persisted.noDialogue)
  const [naturalMovement, setNaturalMovement] = useState(persisted.naturalMovement)
  const [clothingPolicy, setClothingPolicy] = useState<'wardrobe' | 'underwear' | 'unrestricted'>(persisted.clothingPolicy)
  const [sigmaShiftMode, setSigmaShiftMode] = useState<'model' | 'custom'>(persisted.sigmaShiftMode)
  const [shiftVideo, setShiftVideo] = useState(persisted.shiftVideo)
  const [shiftAudio, setShiftAudio] = useState(persisted.shiftAudio)

  useEffect(() => {
    // Older workspaces stored 30 as their shared step value while Turbo was
    // hard-wired to 8. Normalize only invalid Turbo 8 values on load/switch.
    if (turbo === '8' && (steps < 4 || steps > 12)) setSteps(8)
  }, [steps, turbo])
  const [loraStrength, setLoraStrength] = useState(persisted.loraStrength)
  const [userLoras, setUserLoras] = useState(() => persisted.userLoras.map((item) => ({ ...item })))
  const [info, setInfo] = useState<ObjectInfo>({})
  const h3PreviewOverrideNode = findH3PreviewOverrideNode(info)
  const [liveEnabled, setLiveEnabled] = useState(persisted.liveEnabled)
  const [livePreviewMode, setLivePreviewMode] = useState<'standard' | 'h3-override'>(persisted.livePreviewMode)
  const [upscaleMode, setUpscaleMode] = useState<UpscaleMode>(persisted.upscaleMode)
  const upscaleModel = choices(info, 'LatentUpscaleModelLoader', 'model_name').find((n) => /ltx-2\.5.*spatial.*x2/i.test(n)) ?? ''
  const upscaleVae = choices(info, 'VAELoader', 'vae_name').find((n) => /ltx-2\.5.*video.*vae/i.test(n)) ?? ''
  const missingLtxUpscaleNodes = LTX_UPSCALE_REQUIRED_NODES.filter((node) => !info[node])
  const ltxUpscaleReady = Boolean(upscaleModel && upscaleVae && missingLtxUpscaleNodes.length === 0)
  const rtxModels = choices(info, 'UpscaleModelLoader', 'model_name')
  const [rtxModel, setRtxModel] = useState(persisted.rtxModel)
  const [seed, setSeed] = useState(persisted.seed)
  const [advanced, setAdvanced] = useState(persisted.advanced)
  const [firstFrame, setFirstFrame] = useState<MediaFile | null>(persisted.firstFrame)
  const [lastFrame, setLastFrame] = useState<MediaFile | null>(persisted.lastFrame)
  const [referenceImages, setReferenceImages] = useState<MediaFile[]>(persisted.referenceImages)
  const [referenceVideos, setReferenceVideos] = useState<MediaFile[]>(persisted.referenceVideos)
  const [referenceAudios, setReferenceAudios] = useState<MediaFile[]>(persisted.referenceAudios)
  const [characterProjects, setCharacterProjects] = useState<CharacterProject[]>(loadCharacterProjects)
  const [wardrobeProjects, setWardrobeProjects] = useState<WardrobeProject[]>(loadWardrobeProjects)
  const [locationProjects, setLocationProjects] = useState<LocationProject[]>(loadLocationProjects)
  const [selectedReferenceCharacterIds, setSelectedReferenceCharacterIds] = useState<string[]>(persisted.selectedReferenceCharacterIds)
  const [selectedReferenceLocationIds, setSelectedReferenceLocationIds] = useState<string[]>(persisted.selectedReferenceLocationIds)
  const [jobs, setJobs] = useState<GenerationJob[]>(initialJobs)
  const [activeJobId, setActiveJobId] = useState<string | null>(persisted.activeJobId)
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now())
  const [movieHandoff, setMovieHandoff] = useState<MovieLink | null>(persisted.movieHandoff)
  const [characterHandoff, setCharacterHandoff] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [stillSubmitting, setStillSubmitting] = useState(false)
  const [ltxSubmitting, setLtxSubmitting] = useState(false)
  const [aceSubmitting, setAceSubmitting] = useState(false)
  const [diagnosticRunning, setDiagnosticRunning] = useState(false)
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(() => new Set())
  const cancellationRequests = useRef(new Set<string>())
  const mediaHydrated = useRef(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success' | 'neutral'; text: string } | null>(null)
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const activeLlmProvider = useRef<AppSettings['llmProvider'] | null>(null)
  const [promptSuggestion, setPromptSuggestion] = useState('')
  const [promptSuggestionId, setPromptSuggestionId] = useState('')
  const [characterCopilotContext, setCharacterCopilotContext] = useState<CopilotWorkspaceContext>({ label: 'Character Studio' })
  const [promptingTool, setPromptingTool] = useState<'enhance' | 'timeline' | 'audio' | null>(null)
  const [dialogueGenerating, setDialogueGenerating] = useState(false)
  const [lanOpen, setLanOpen] = useState(false)
  const [lanStatus, setLanStatus] = useState<LanStatus>({ running: false })
  const [lanQr, setLanQr] = useState('')
  const [videoClipDraft, setVideoClipDraft] = useState<{ source: MediaFile; replaceIndex?: number } | null>(null)
  const [createResetKey, setCreateResetKey] = useState(0)
  const [ltxResetKey, setLtxResetKey] = useState(0)
  const [zImageResetKey, setZImageResetKey] = useState(0)
  const [ltxResetAt, setLtxResetAt] = useState(0)
  useEffect(() => {
    const decide = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; decision: 'approve' | 'dismiss' }>).detail
      if (!promptSuggestionId || detail.id !== promptSuggestionId) return
      if (detail.decision === 'approve') { setPrompt(promptSuggestion); setNotice({ tone: 'success', text: 'Copilot refinement approved and applied to Create.' }) }
      setPromptSuggestion(''); setPromptSuggestionId('')
    }
    window.addEventListener(COPILOT_DECISION_EVENT, decide)
    return () => window.removeEventListener(COPILOT_DECISION_EVENT, decide)
  }, [promptSuggestion, promptSuggestionId])
  const onLiveProgress = useCallback((id: string, update: LiveProgress) => {
    if (!id) return
    const receivedAt = Date.now()
    setJobs((current) => current.map((j) => {
      if (j.promptId !== id || !['running', 'queued'].includes(j.status)) return j
      const advancedSamplerStep = update.currentStep !== undefined && update.currentStep > (j.currentStep ?? -1)
      const measuredStepMs = advancedSamplerStep && j.lastSamplerStepAt && j.currentStep !== undefined
        ? receivedAt - j.lastSamplerStepAt
        : undefined
      const estimatedSamplerStepMs = measuredStepMs
        ? j.estimatedSamplerStepMs ? Math.round(j.estimatedSamplerStepMs * 0.65 + measuredStepMs * 0.35) : measuredStepMs
        : j.estimatedSamplerStepMs
      return {
        ...j,
        ...update,
        progress: update.progress ?? j.progress,
        status: 'running',
        ...(advancedSamplerStep ? { lastSamplerStepAt: receivedAt, estimatedSamplerStepMs } : {}),
      }
    }))
  }, [])
  // Keep the lightweight ComfyUI event socket active even when image previews
  // are hidden so queue, node, and sampler-step progress remain real-time.
  const live = useLivePreview(settings?.comfyUrl, true, onLiveProgress)

  const selection = useMemo(() => inferSelections(models, turbo, textEncoderPreference), [models, turbo, textEncoderPreference])
  const userLoraChoices = useMemo(() => models.filter((model) => model.kind === 'loras' && !/^minimax_h3_(?:fl2v|ref2v)_turbo_/i.test(model.name)).map((model) => model.name).sort((a, b) => a.localeCompare(b)), [models])
  const h3Report = useMemo(() => h3StackReport(models), [models])
  const ltxSelection = useMemo(() => inferLtx25Selections(models, choices(info, 'LatentUpscaleModelLoader', 'model_name')), [models, info])
  const aceSelection = useMemo(() => inferAceStepSelections(models), [models])
  const activeModel = mode === 'reference' ? selection.ref2va : selection.fl2va
  const activeLora = mode === 'reference' ? selection.ref2vLora : selection.fl2vLora
  const requiredModels = [activeModel, selection.textEncoder, selection.videoVae, selection.audioVae]
  const modelReady = requiredModels.every(Boolean) && (turbo === 'off' || Boolean(activeLora))
  const pendingJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'running')
  const activeRenderJob = activeJobId ? jobs.find((job) => job.id === activeJobId) : undefined
  useEffect(() => {
    if (!pendingJobs.length) return
    const timer = window.setInterval(() => setRuntimeNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pendingJobs.length])
  const activeRenderRuntime = activeRenderJob
    ? activeRenderJob.renderDurationMs ?? (['queued', 'running'].includes(activeRenderJob.status) ? Math.max(0, runtimeNow - activeRenderJob.createdAt) : undefined)
    : undefined
  const activeSamplerProgress = samplerProgressSummary(activeRenderJob, runtimeNow)
  const pendingKey = pendingJobs.map((job) => job.id).join(',')
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs

  const scanModels = useCallback(async (nextSettings: AppSettings) => {
    setScanning(true)
    try {
      const found = await window.minimax.scanModels(nextSettings)
      setModels(found)
    } finally {
      setScanning(false)
    }
  }, [])

  const checkConnection = useCallback(async (url: string) => {
    setChecking(true)
    const nextStatus = await window.minimax.getComfyStatus(url)
    setStatus(nextStatus)
    if (nextStatus.connected) {
      try { setInfo(await window.minimax.getObjectInfo(url)) } catch { setInfo({}) }
    } else setInfo({})
    setChecking(false)
    return nextStatus
  }, [])

  const refreshOllama = useCallback(async (nextSettings: AppSettings) => {
    try {
      const connection = resolveLlmConnection(nextSettings)
      const found = await window.minimax.listOllamaModels(connection.url, connection.provider)
      const usable = found.filter((model) => model.local && model.family !== 'nomic-bert')
      setOllamaModels(usable)
      if (usable.length && !usable.some((model) => model.name === connection.model)) {
        setSettings((current) => current && current.llmProvider === connection.provider
          ? { ...current, [connection.provider === 'lmstudio' ? 'lmStudioModel' : 'ollamaModel']: usable[0].name }
          : current)
      }
    } catch {
      setOllamaModels([])
    }
  }, [])

  useEffect(() => {
    void window.minimax.getSettings().then((loaded) => {
      activeLlmProvider.current = loaded.llmProvider
      setSettings(loaded)
      void Promise.all([scanModels(loaded), checkConnection(loaded.comfyUrl), refreshOllama(loaded)])
    })
  }, [checkConnection, refreshOllama, scanModels])

  useEffect(() => {
    if (!settings || activeLlmProvider.current === null || activeLlmProvider.current === settings.llmProvider) return
    activeLlmProvider.current = settings.llmProvider
    setOllamaModels([])
    void refreshOllama(settings)
  }, [settings, refreshOllama])

  useEffect(() => {
    void window.minimax.getLanStatus().then(setLanStatus)
  }, [])

  useEffect(() => {
    let disposed = false
    const refresh = () => {
      if (document.hidden) return
      void window.minimax.getGpuTelemetry().then((value) => { if (!disposed) setGpu(value) }).catch(() => { if (!disposed) setGpu({ available: false }) })
    }
    refresh()
    const timer = window.setInterval(refresh, 4000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!lanOpen || !lanStatus.url) {
      setLanQr('')
      return
    }
    void QRCode.toDataURL(lanStatus.url, { width: 300, margin: 2, color: { dark: '#101412', light: '#ffffff' } }).then(setLanQr)
  }, [lanOpen, lanStatus.url])

  useEffect(() => {
    if (!lanOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setLanOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [lanOpen])

  useEffect(() => {
    localStorage.setItem('minimax.jobs', JSON.stringify(jobs.slice(0, 100)))
  }, [jobs])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.tone === 'error' ? 6500 : 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const refresh = () => setCharacterProjects(loadCharacterProjects())
    window.addEventListener(CHARACTER_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(CHARACTER_LIBRARY_EVENT, refresh)
  }, [])
  useEffect(() => {
    let disposed = false
    void Promise.all(characterProjects.map(async (character) => {
      const bindings = allocateWorkspaceReferences([{ id: character.id, name: character.name, identity: characterReferences(character), detailReferences: settings?.characterDetailReferencesEnabled ? character.detailReferences : [], hairStyleIds: character.hairStyleIds, wardrobeIds: character.wardrobeIds, accessoryIds: character.accessoryIds }], wardrobeProjects, [])
      const wardrobe = wardrobeProjects.find((item) => item.id === character.wardrobeIds[0])
      const references = await Promise.all(bindings.map(async (binding) => {
        let preview = binding.file.preview ?? ''
        if (!preview.startsWith('data:')) {
          try { preview = await window.minimax.fileDataUrl(binding.file.path) } catch { /* Omit inaccessible media from the phone library. */ }
        }
        return { name: binding.file.name, preview, purpose: binding.purpose, label: binding.label }
      }))
      return { id: character.id, name: character.name, description: character.description, wardrobe: wardrobe && wardrobeReferences(wardrobe).length ? wardrobe.name : '', voiceNotes: character.voiceNotes, visualStyle: character.visualStyle, referenceInstructions: composeReferenceInstructions(bindings), references: references.filter((file) => file.preview.startsWith('data:')) }
    })).then((characters) => { if (!disposed) return window.minimax.syncMobileCharacters(characters) }).catch(() => undefined)
    return () => { disposed = true }
  }, [characterProjects, settings?.characterDetailReferencesEnabled, wardrobeProjects])
  useEffect(() => {
    const refresh = () => setWardrobeProjects(loadWardrobeProjects())
    window.addEventListener(WARDROBE_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(WARDROBE_LIBRARY_EVENT, refresh)
  }, [])
  useEffect(() => {
    const refresh = () => setLocationProjects(loadLocationProjects())
    window.addEventListener(LOCATION_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(LOCATION_LIBRARY_EVENT, refresh)
  }, [])

  useEffect(() => {
    const workspace: PersistedWorkspace = {
      mode, prompt, duration, resolution, turbo, steps, sampler, scheduler, experimentalSampling, refImageSize, noDialogue, naturalMovement, clothingPolicy,
      sigmaShiftMode, shiftVideo, shiftAudio, loraStrength, userLoras, seed, advanced, liveEnabled, livePreviewMode,
      upscaleMode, turbo8Profile, rtxModel, firstFrame: withoutPreview(firstFrame), lastFrame: withoutPreview(lastFrame),
      referenceImages: referenceImages.map((file) => withoutPreview(file)!),
      referenceVideos: referenceVideos.map((file) => withoutPreview(file)!), textEncoderPreference,
      referenceAudios: referenceAudios.map((file) => withoutPreview(file)!), selectedReferenceCharacterIds, selectedReferenceLocationIds, activeJobId, movieHandoff,
    }
    localStorage.setItem('minimax.workspace', JSON.stringify(workspace))
  }, [activeJobId, advanced, clothingPolicy, duration, experimentalSampling, firstFrame, lastFrame, liveEnabled, livePreviewMode, loraStrength, mode, movieHandoff, naturalMovement, noDialogue, prompt, refImageSize, referenceAudios, referenceImages, referenceVideos, resolution, rtxModel, sampler, scheduler, seed, selectedReferenceCharacterIds, selectedReferenceLocationIds, shiftAudio, shiftVideo, sigmaShiftMode, steps, textEncoderPreference, turbo, turbo8Profile, upscaleMode, userLoras])

  useEffect(() => {
    if (!settings || mediaHydrated.current) return
    mediaHydrated.current = true
    const hydrate = async (file: MediaFile | null) => {
      if (!file || file.kind !== 'image' || file.preview) return file
      try { return { ...file, preview: await window.minimax.fileDataUrl(file.path) } } catch { return file }
    }
    void Promise.all([hydrate(firstFrame), hydrate(lastFrame)]).then(([first, last]) => {
      setFirstFrame(first); setLastFrame(last)
    })
    void Promise.all(referenceImages.map(hydrate)).then((files) => setReferenceImages(files.filter(Boolean) as MediaFile[]))
  }, [firstFrame, lastFrame, referenceImages, settings])

  useEffect(() => {
    if (!rtxModel && rtxModels.length) setRtxModel(rtxModels[0])
  }, [rtxModel, rtxModels])

  useEffect(() => {
    if (!settings || !pendingKey || !status.connected) return
    const timer = window.setInterval(() => {
      for (const job of jobsRef.current.filter((j) => j.status === 'queued' || j.status === 'running')) {
        const promptId = job.promptId
        if (!promptId) continue
        void window.minimax.getHistory(settings.comfyUrl, promptId).then(async (history) => {
          const entry = history[promptId] as { status?: { status_str?: string; completed?: boolean; messages?: unknown[] } } | undefined
          const mediaType = job.mediaType ?? 'video'
          const outputUrl = playableOutputUrl(extractOutputUrl(history, promptId, settings.comfyUrl, mediaType))
          if (entry?.status?.status_str === 'error') {
            setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'failed', error: 'ComfyUI reported an execution error. The original may still be saved if upscaling failed.' } : item))
          } else if (mediaType === 'image' && outputUrl && entry?.status?.completed) {
            const outputFile = extractOutputFile(history, promptId, 'image')
            if (!outputFile) return
            try {
              const saved = await window.minimax.saveStillImage(settings.comfyUrl, outputFile, settings.outputDirectory)
              const localUrl = await window.minimax.mediaUrl(saved.path)
              setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'completed', progress: 100, renderDurationMs: Date.now() - item.createdAt, outputUrl: localUrl, localOutputPath: saved.path, progressLabel: 'Reference still ready' } : item))
            } catch (error) {
              setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'failed', error: `The still rendered, but could not be saved locally: ${error instanceof Error ? error.message : String(error)}` } : item))
            }
          } else if (outputUrl && entry?.status?.completed) {
            recordMovieOutput(job.movieLink, outputUrl)
            const localOutput = await window.minimax.findLatestOutput(settings.outputDirectory, job.createdAt, mediaType === 'audio' ? 'audio' : 'video')
            let extractionError: string | null = null
            if (job.characterProjectId) {
              recordCharacterTurntable(job.characterProjectId, localOutput ?? outputUrl)
              if (localOutput) extractionError = await extractAutomatedReferenceSet('character', job.characterProjectId, localOutput, job.duration, settings)
            } else if (job.locationProjectId) {
              recordLocationWalkthrough(job.locationProjectId, localOutput ?? outputUrl)
              if (localOutput) extractionError = await extractAutomatedReferenceSet('location', job.locationProjectId, localOutput, job.duration, settings)
            }
            if (extractionError) setNotice({ tone: 'error', text: `The video rendered, but its reference frames could not be extracted: ${extractionError}` })
            setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'completed', progress: 100, renderDurationMs: Date.now() - item.createdAt, outputUrl, localOutputPath: localOutput ?? undefined } : item))
          } else if (entry?.status?.completed) {
            const localOutput = await window.minimax.findLatestOutput(settings.outputDirectory, job.createdAt, mediaType === 'audio' ? 'audio' : 'video')
            if (localOutput) recordMovieOutput(job.movieLink, localOutput)
            if (localOutput) recordCharacterTurntable(job.characterProjectId, localOutput)
            if (localOutput) recordLocationWalkthrough(job.locationProjectId, localOutput)
            const extractionError = localOutput && job.characterProjectId ? await extractAutomatedReferenceSet('character', job.characterProjectId, localOutput, job.duration, settings) : localOutput && job.locationProjectId ? await extractAutomatedReferenceSet('location', job.locationProjectId, localOutput, job.duration, settings) : null
            if (extractionError) setNotice({ tone: 'error', text: `The video rendered, but its reference frames could not be extracted: ${extractionError}` })
            setJobs((current) => current.map((item) => item.id === job.id ? localOutput ? { ...item, status: 'completed', progress: 100, renderDurationMs: Date.now() - item.createdAt, outputUrl: localOutput, localOutputPath: localOutput } : { ...item, status: 'running', progress: 98 } : item))
          } else {
            setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'running' } : item))
          }
        }).catch(() => undefined)
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [pendingKey, settings, status.connected])

  const chooseMedia = async (kind: MediaKind, setter: (file: MediaFile) => void) => {
    const picked = await window.minimax.chooseMedia(kind)
    if (!picked) return
    let preview: string | undefined
    if (kind === 'image') preview = await window.minimax.fileDataUrl(picked.path)
    setter({ ...picked, kind, preview })
  }

  const startVideoContinuation = async (job: GenerationJob) => {
    if (!settings || !job.outputUrl) return
    try {
      const source = job.localOutputPath ?? await window.minimax.findLatestOutput(settings.outputDirectory, job.createdAt)
      if (!source) throw new Error('The completed video file could not be found in the output folder.')
      const extracted = await window.minimax.extractVideoFrame(source, 'last', settings.outputDirectory, settings.ffmpegPath)
      const frame: MediaFile = { ...extracted, name: `Locked continuation frame · ${extracted.name}`, kind: 'image', preview: await window.minimax.mediaUrl(extracted.path) }
      setFirstFrame(frame)
      setLastFrame(null)
      setReferenceImages([])
      setReferenceVideos([])
      setReferenceAudios([])
      setSelectedReferenceCharacterIds([])
      setSelectedReferenceLocationIds([])
      setMode('image')
      setResolution(`${job.renderWidth ?? job.width}x${job.renderHeight ?? job.height}`)
      if (job.turbo) setTurbo(job.turbo)
      if (job.steps) setSteps(job.steps)
      if (job.noDialogue !== undefined) setNoDialogue(job.noDialogue)
      if (job.naturalMovement !== undefined) setNaturalMovement(job.naturalMovement)
      if (job.loraStrength !== undefined) setLoraStrength(job.loraStrength)
      setUpscaleMode('off')
      setActiveJobId(null)
      setNotice({ tone: 'success', text: 'Continuation prepared. The exact final frame is locked as the next I2V opening frame; source canvas and sampling settings were retained.' })
    } catch (error) {
      setNotice({ tone: 'error', text: `Could not prepare the continuation frame: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  const chooseMany = async (kind: MediaKind) => {
    if (kind === 'video') {
      const picked = await window.minimax.chooseMedia('video')
      if (!picked) return
      const preview = await window.minimax.mediaUrl(picked.path)
      setVideoClipDraft({ source: { ...picked, kind: 'video', preview } })
      return
    }
    await chooseMedia(kind, (file) => {
      if (kind === 'image') { setSelectedReferenceCharacterIds([]); setSelectedReferenceLocationIds([]); setReferenceImages((current) => current.length < 9 ? [...current, file] : current) }
      if (kind === 'audio') setReferenceAudios((current) => current.length < 3 ? [...current, file] : current)
    })
  }

  const workspaceBindingsFor = (characterIds: string[], locationIds: string[]) => {
    // Resolve every linked record from storage at selection time. A Character
    // Studio save and a Source Media click can occur before React has committed
    // the library event, which previously left the character's new wardrobe out.
    const currentCharacters = loadCharacterProjects()
    const currentLocations = loadLocationProjects()
    const selectedCharacters = characterIds.map((id) => currentCharacters.find((project) => project.id === id)).filter(Boolean) as CharacterProject[]
    const selectedLocations = locationIds.map((id) => currentLocations.find((project) => project.id === id)).filter(Boolean) as LocationProject[]
    const currentWardrobes = loadWardrobeProjects()
    return allocateWorkspaceReferences(
      selectedCharacters.map((character) => ({ id: character.id, name: character.name, identity: characterReferences(character), detailReferences: settings?.characterDetailReferencesEnabled ? character.detailReferences : [], hairStyleIds: character.hairStyleIds, wardrobeIds: character.wardrobeIds, accessoryIds: character.accessoryIds })),
      currentWardrobes,
      selectedLocations.map((location) => ({ id: location.id, name: location.name, images: locationReferences(location), environmentMode: location.environmentMode })),
    )
  }

  const applyWorkspaceBindings = async (previous: MovieReferenceBinding[], next: MovieReferenceBinding[]) => {
    const images = await Promise.all(next.map(async ({ file: source }) => {
      if (source.preview) return source
      try { return { ...source, preview: await window.minimax.fileDataUrl(source.path) } }
      catch { return source }
    }))
    setReferenceImages(images)
    setPrompt((current) => syncReferencePrompt(current, previous, next))
    return images
  }

  const refreshSourceMedia = async () => {
    const previous = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    setCharacterProjects(loadCharacterProjects())
    setWardrobeProjects(loadWardrobeProjects())
    setLocationProjects(loadLocationProjects())
    const next = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    if (selectedReferenceCharacterIds.length || selectedReferenceLocationIds.length) await applyWorkspaceBindings(previous, next)
  }

  // Keep selected library assets authoritative. Character Studio and Wardrobe
  // Studio can change a link while this workspace (and even its modal) remains
  // mounted. Rebuild the actual render inputs whenever either library changes
  // so the checked active outfit cannot remain UI-only state.
  useEffect(() => {
    if (!selectedReferenceCharacterIds.length && !selectedReferenceLocationIds.length) return
    let disposed = false
    const selectedCharacters = selectedReferenceCharacterIds.map((id) => characterProjects.find((project) => project.id === id)).filter(Boolean) as CharacterProject[]
    const selectedLocations = selectedReferenceLocationIds.map((id) => locationProjects.find((project) => project.id === id)).filter(Boolean) as LocationProject[]
    const next = allocateWorkspaceReferences(
      selectedCharacters.map((character) => ({ id: character.id, name: character.name, identity: characterReferences(character), detailReferences: settings?.characterDetailReferencesEnabled ? character.detailReferences : [], hairStyleIds: character.hairStyleIds, wardrobeIds: character.wardrobeIds, accessoryIds: character.accessoryIds })),
      wardrobeProjects,
      selectedLocations.map((location) => ({ id: location.id, name: location.name, images: locationReferences(location), environmentMode: location.environmentMode })),
    )
    void Promise.all(next.map(async ({ file }) => {
      if (file.preview) return file
      try { return { ...file, preview: await window.minimax.fileDataUrl(file.path) } } catch { return file }
    })).then((images) => {
      if (disposed) return
      setReferenceImages(images)
      setPrompt((current) => syncReferencePrompt(current, [], next))
    })
    return () => { disposed = true }
  }, [characterProjects, locationProjects, selectedReferenceCharacterIds, selectedReferenceLocationIds, settings?.characterDetailReferencesEnabled, wardrobeProjects])

  const loadReferenceCharacter = async (characterId: string) => {
    const previousBindings = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    const selectedIds = characterId ? (selectedReferenceCharacterIds.includes(characterId) ? selectedReferenceCharacterIds.filter((id) => id !== characterId) : [...selectedReferenceCharacterIds, characterId]) : []
    setSelectedReferenceCharacterIds(selectedIds)
    setMode('reference')
    const selectedCharacters = selectedIds.map((id) => characterProjects.find((project) => project.id === id)).filter(Boolean) as CharacterProject[]
    if (selectedCharacters.some((character) => characterReferences(character, settings?.characterDetailReferencesEnabled).length === 0)) {
      setNotice({ tone: 'error', text: 'Every selected character needs at least one approved identity image.' })
      return
    }
    const bindings = workspaceBindingsFor(selectedIds, selectedReferenceLocationIds)
    await applyWorkspaceBindings(previousBindings, bindings)
    const identityCount = bindings.filter((item) => item.purpose === 'character' || item.purpose === 'character-angle').length
    const hairCount = bindings.filter((item) => item.purpose === 'hair').length
    const wardrobeCount = bindings.filter((item) => item.purpose === 'wardrobe').length
    const locationCount = bindings.filter((item) => item.purpose === 'location').length
    setNotice({ tone: 'success', text: selectedCharacters.length ? `Using ${identityCount} identity, ${hairCount} hair, ${wardrobeCount} wardrobe, and ${locationCount} location picture${locationCount === 1 ? '' : 's'} across ${bindings.length} of 9 slots.` : locationCount ? `Cast cleared. Keeping ${locationCount} location picture${locationCount === 1 ? '' : 's'}.` : 'Cleared character references.' })
  }

  const loadReferenceLocation = async (locationId: string) => {
    const previousBindings = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    if (!locationId) {
      setSelectedReferenceLocationIds([]); setMode('reference')
      const bindings = workspaceBindingsFor(selectedReferenceCharacterIds, [])
      await applyWorkspaceBindings(previousBindings, bindings)
      setNotice({ tone: 'success', text: bindings.length ? `Locations cleared. Keeping ${bindings.length} character and wardrobe picture${bindings.length === 1 ? '' : 's'}.` : 'Cleared location references.' })
      return
    }
    const location = locationProjects.find((project) => project.id === locationId)
    if (!location) return
    const sources = locationReferences(location)
    if (!sources.length) { setNotice({ tone: 'error', text: `${location.name} needs an approved reference image first.` }); return }
    const selectedIds = selectedReferenceLocationIds.includes(locationId) ? selectedReferenceLocationIds.filter((id) => id !== locationId) : [...selectedReferenceLocationIds, locationId]
    setSelectedReferenceLocationIds(selectedIds); setMode('reference')
    const bindings = workspaceBindingsFor(selectedReferenceCharacterIds, selectedIds)
    await applyWorkspaceBindings(previousBindings, bindings)
    const locationCount = bindings.filter((item) => item.purpose === 'location').length
    setNotice({ tone: 'success', text: selectedIds.includes(locationId) ? `Added ${location.name}. Characters, wardrobe, and locations now use ${bindings.length} of 9 picture slots.` : `${location.name} removed. ${locationCount} location picture${locationCount === 1 ? '' : 's'} remain.` })
  }

  const loadReferenceWardrobe = async (wardrobeId: string) => {
    const wardrobe = wardrobeProjects.find((project) => project.id === wardrobeId)
    if (!wardrobe) return
    const approved = wardrobeReferences(wardrobe).slice(0, 9).map(fitWholeCharacter)
    if (!approved.length) { setNotice({ tone: 'error', text: `${wardrobe.name} has no approved wardrobe images yet.` }); return }
    const images = await Promise.all(approved.map(async (file) => { if (file.preview) return file; try { return { ...file, preview: await window.minimax.fileDataUrl(file.path) } } catch { return file } }))
    setSelectedReferenceCharacterIds([]); setSelectedReferenceLocationIds([]); setMode('reference'); setReferenceImages(images)
    setNotice({ tone: 'success', text: `Loaded ${images.length} approved wardrobe reference${images.length === 1 ? '' : 's'} for ${wardrobe.name}.` })
  }

  const editVideoReference = async (index: number) => {
    const file = referenceVideos[index]
    if (!file) return
    const sourcePath = file.clip?.sourcePath ?? file.path
    const preview = await window.minimax.mediaUrl(sourcePath)
    setVideoClipDraft({ source: { ...file, path: sourcePath, name: file.clip?.sourceName ?? file.name, preview }, replaceIndex: index })
  }

  const createVideoReferenceClip = async (start: number, end: number) => {
    if (!settings || !videoClipDraft) return
    const source = videoClipDraft.source
    const result = await window.minimax.trimVideo(source.path, start, end, settings.outputDirectory, settings.ffmpegPath)
    const clipped: MediaFile = { ...result, kind: 'video', clip: { sourcePath: source.path, sourceName: source.name, start, end } }
    setReferenceVideos((current) => videoClipDraft.replaceIndex === undefined
      ? current.length < 3 ? [...current, clipped] : current
      : current.map((file, index) => index === videoClipDraft.replaceIndex ? clipped : file))
    setVideoClipDraft(null)
    setNotice({ tone: 'success', text: `${(end - start).toFixed(1)}s reference clip created. The original video was not changed.` })
  }

  const saveAppSettings = async () => {
    if (!settings) return
    await window.minimax.saveSettings(settings)
    await scanModels(settings)
    await checkConnection(settings.comfyUrl)
    await refreshOllama(settings)
    setNotice({ tone: 'success', text: 'Settings saved and model folders rescanned.' })
  }

  const applyGenerationDefaults = () => {
    if (!settings) return
    const defaults = settings.generationDefaults
    setResolution(defaults.resolution)
    setDuration(defaults.duration)
    setTurbo(defaults.turbo)
    setTurbo8Profile(defaults.turbo8Profile)
    setTextEncoderPreference(defaults.textEncoderPreference)
    setSteps(defaults.steps)
    setSampler(defaults.sampler)
    setScheduler(defaults.scheduler)
    setExperimentalSampling(defaults.experimentalSampling)
    setRefImageSize(defaults.refImageSize)
    setLiveEnabled(defaults.livePreview)
    setSigmaShiftMode(defaults.sigmaShiftMode)
    setShiftVideo(defaults.shiftVideo)
    setShiftAudio(defaults.shiftAudio)
    setLoraStrength(defaults.loraStrength)
    setUserLoras(workspaceDefaults.userLoras.map((item) => ({ ...item })))
    setUpscaleMode(defaults.upscaleMode)
    setNotice({ tone: 'success', text: 'Saved generation defaults applied to the current Create workspace.' })
  }

  const runPromptTool = async (tool: 'enhance' | 'timeline' | 'audio') => {
    if (!settings || !prompt.trim()) {
      setNotice({ tone: 'error', text: 'Write a rough prompt first, then ask the local assistant to refine it.' })
      return
    }
    const llm = resolveLlmConnection(settings)
    if (!llm.model || ollamaModels.length === 0) {
      setNotice({ tone: 'error', text: `No local ${llm.label} model is available. Check the local AI provider in Settings.` })
      return
    }
    const workspaceBindings = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    const referenceMap = mode === 'reference' ? [
      ...referenceImages.map((file, index) => `<Picture ${index + 1}> = ${workspaceBindings[index]?.label ?? file.name}`),
      ...referenceVideos.map((file, index) => `<Video ${index + 1}> = ${file.name}`),
      ...referenceAudios.map((file, index) => `<Audio ${index + 1}> = ${file.name}`),
    ] : undefined
    const request = buildPromptAssistantRequest(tool, prompt, { duration, mode, referenceMap, noDialogue })
    setPromptingTool(tool)
    setPromptSuggestion('')
    try {
      const imagePaths = mode === 'reference' ? referenceImages.map((file) => file.path) : [firstFrame?.path, lastFrame?.path].filter(Boolean) as string[]
      let response: string
      if (imagePaths.length) {
        try { response = await window.minimax.generateWithOllamaVision(llm.url, llm.model, `${request}\n\nInspect the attached pictures in reference-map order. Use visible details to make identity, wardrobe, location, composition, and continuity instructions concrete. Do not invent unseen details.`, imagePaths, llm.provider) }
        catch { response = await window.minimax.generateWithOllama(llm.url, llm.model, request, llm.provider) }
      } else response = await window.minimax.generateWithOllama(llm.url, llm.model, request, llm.provider)
      const suggestionId = createId()
      setPromptSuggestion(response); setPromptSuggestionId(suggestionId)
      offerCopilotSuggestion({ id: suggestionId, title: tool === 'timeline' ? 'Review timeline rewrite' : tool === 'audio' ? 'Review sound and dialogue pass' : 'Review MiniMax-ready refinement', text: response, target: 'create-prompt', sourceLabel: `${llm.model} · ${llm.label}` })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setPromptingTool(null)
    }
  }

  const resetCreateWorkspace = () => {
    const defaults = settings?.generationDefaults
    setMode('text')
    setPrompt('')
    setPromptSuggestion('')
    setPromptingTool(null)
    setDialogueGenerating(false)
    setDuration(defaults?.duration ?? workspaceDefaults.duration)
    setResolution(defaults?.resolution ?? workspaceDefaults.resolution)
    setTurbo(defaults?.turbo ?? workspaceDefaults.turbo)
    setTurbo8Profile(defaults?.turbo8Profile ?? workspaceDefaults.turbo8Profile)
    setTextEncoderPreference(defaults?.textEncoderPreference ?? workspaceDefaults.textEncoderPreference)
    setSteps(defaults?.steps ?? workspaceDefaults.steps)
    setSampler(defaults?.sampler ?? workspaceDefaults.sampler)
    setScheduler(defaults?.scheduler ?? workspaceDefaults.scheduler)
    setExperimentalSampling(defaults?.experimentalSampling ?? workspaceDefaults.experimentalSampling)
    setRefImageSize(defaults?.refImageSize ?? workspaceDefaults.refImageSize)
    setNoDialogue(true)
    setClothingPolicy('wardrobe')
    setSigmaShiftMode(defaults?.sigmaShiftMode ?? workspaceDefaults.sigmaShiftMode)
    setShiftVideo(defaults?.shiftVideo ?? workspaceDefaults.shiftVideo)
    setShiftAudio(defaults?.shiftAudio ?? workspaceDefaults.shiftAudio)
    setLoraStrength(defaults?.loraStrength ?? workspaceDefaults.loraStrength)
    setUserLoras(workspaceDefaults.userLoras.map((item) => ({ ...item })))
    setLiveEnabled(defaults?.livePreview ?? workspaceDefaults.liveEnabled)
    setLivePreviewMode('standard')
    setUpscaleMode(defaults?.upscaleMode ?? workspaceDefaults.upscaleMode)
    setRtxModel('')
    setSeed(Math.floor(Math.random() * 1_000_000_000))
    setAdvanced(false)
    setFirstFrame(null)
    setLastFrame(null)
    setReferenceImages([])
    setReferenceVideos([])
    setReferenceAudios([])
    setVideoClipDraft(null)
    setActiveJobId(null)
    setMovieHandoff(null)
    setCharacterHandoff(null)
    setSelectedReferenceCharacterIds([])
    setSelectedReferenceLocationIds([])
    setCreateResetKey((value) => value + 1)
    setNotice({ tone: 'success', text: 'MiniMax Create reset. Saved libraries, rendered files, and queue history were not deleted.' })
  }

  const generateCharacterDialogue = async (draft: CharacterDialogueDraft) => {
    if (!settings) throw new Error('Studio settings are still loading.')
    const llm = resolveLlmConnection(settings)
    if (!llm.model || ollamaModels.length === 0) throw new Error(`No local ${llm.label} text model is available. Check the local AI provider in Settings.`)
    setDialogueGenerating(true)
    try {
      return await window.minimax.generateWithOllama(llm.url, llm.model, buildCharacterDialogueRequest({
        characterName: draft.character.name,
        characterDescription: draft.character.description,
        voiceNotes: draft.character.voiceNotes,
        shotPrompt: prompt,
        intent: draft.intent,
        requiredWords: draft.requiredWords,
        delivery: draft.delivery,
        length: draft.length,
        language: draft.language,
        duration,
      }), llm.provider)
    } finally {
      setDialogueGenerating(false)
    }
  }

  const resetCurrentWorkspace = () => {
    if (view === 'create') {
      resetCreateWorkspace()
      return
    }
    if (view === 'ltx25') {
      localStorage.removeItem('ltx25.workspace')
      setLtxResetAt(Date.now())
      setLtxResetKey((value) => value + 1)
      setNotice({ tone: 'success', text: 'LTX 2.5 reset. Its prompt, first frame, options, and current preview were cleared.' })
      return
    }
    if (view === 'zimage') {
      localStorage.removeItem('minimax.zimage-workspace')
      setZImageResetKey((value) => value + 1)
      setNotice({ tone: 'success', text: 'Create Image reset. Its prompt, options, selection, and current preview were cleared.' })
    }
  }

  const cancelJob = async (job: GenerationJob) => {
    if (!settings) return
    if (!['queued', 'running'].includes(job.status) || cancellingIds.has(job.id)) return
    cancellationRequests.current.add(job.id)
    setCancellingIds((current) => new Set(current).add(job.id))
    if (!job.promptId) {
      setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'cancelled', error: undefined } : item))
      setNotice({ tone: 'neutral', text: 'Cancelling input preparation…' })
      return
    }
    try {
      const result = await window.minimax.cancelPrompt(settings.comfyUrl, job.promptId)
      if (result.cancelled) {
        setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: 'cancelled', error: undefined } : item))
        setNotice({ tone: 'success', text: result.state === 'pending' ? 'Queued generation removed.' : 'Running generation stopped.' })
      } else {
        setNotice({ tone: 'neutral', text: result.state === 'finished' ? 'That generation already finished.' : 'That generation is no longer in the ComfyUI queue.' })
      }
    } catch (error) {
      cancellationRequests.current.delete(job.id)
      setNotice({ tone: 'error', text: `Could not stop generation: ${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setCancellingIds((current) => { const next = new Set(current); next.delete(job.id); return next })
    }
  }

  const chooseLtxImage = async (): Promise<MediaFile | null> => {
    const picked = await window.minimax.chooseMedia('image')
    if (!picked) return null
    return { ...picked, kind: 'image', preview: await window.minimax.fileDataUrl(picked.path) }
  }

  const useStartFrameInLtx = (file: MediaFile) => {
    let workspace: Record<string, unknown> = {}
    try { workspace = JSON.parse(localStorage.getItem('ltx25.workspace') ?? '{}') as Record<string, unknown> } catch { /* Replace malformed legacy workspace data. */ }
    const storedFrame = { ...file }
    delete storedFrame.preview
    localStorage.setItem('ltx25.workspace', JSON.stringify({ ...workspace, mode: 'image', firstFrame: storedFrame }))
    setLtxResetAt(Date.now())
    setLtxResetKey((value) => value + 1)
    setView('ltx25')
    setNotice({ tone: 'success', text: `${file.name} loaded as the LTX 2.5 image-to-video starting frame.` })
  }

  const generateLtx = async (options: Ltx25GenerationOptions, input: MediaFile | null, handoff?: { characterProjectId?: string; locationProjectId?: string }) => {
    if (!settings) return 'Studio settings are still loading.'
    if (!status.connected) {
      const message = 'Start ComfyUI and verify the server connection in Settings.'
      setNotice({ tone: 'error', text: message })
      return message
    }
    if (!options.prompt) {
      const message = 'Add an LTX prompt before generating.'
      setNotice({ tone: 'error', text: message })
      return message
    }
    if (options.mode === 'image' && !input) {
      const message = 'Choose a first frame for LTX image-to-video.'
      setNotice({ tone: 'error', text: message })
      return message
    }
    if (!ltxSelection.diffusion || !ltxSelection.textEncoder || !ltxSelection.videoVae || !ltxSelection.audioVae || !ltxSelection.latentUpscaler) {
      const message = 'The LTX‑2.5 distilled transformer, Gemma encoder, video/audio VAEs, or latent spatial upscaler is missing.'
      setNotice({ tone: 'error', text: message })
      return message
    }
    const missingNodes = LTX_NATIVE_REQUIRED_NODES.filter((node) => !info[node])
    if (missingNodes.length) {
      const message = `Update ComfyUI before using LTX‑2.5. Missing core nodes: ${missingNodes.join(', ')}.`
      setNotice({ tone: 'error', text: message })
      return message
    }

    const localId = createId()
    const job: GenerationJob = { id: localId, provider: 'ltx25', mode: options.mode, prompt: options.prompt, createdAt: Date.now(), status: 'queued', progress: 2, progressLabel: input ? 'Preparing first frame' : 'Preparing workflow', width: options.width, height: options.height, duration: options.duration, characterProjectId: handoff?.characterProjectId ?? characterHandoff ?? undefined, locationProjectId: handoff?.locationProjectId }
    setJobs((current) => [job, ...current])
    setActiveJobId(localId)
    setLtxSubmitting(true)
    setNotice({ tone: 'neutral', text: 'Preparing the official LTX‑2.5 ComfyUI graph…' })
    try {
      const uploaded = input ? await window.minimax.uploadImageData(settings.comfyUrl, await prepareImage(input, options.width, options.height)) : undefined
      if (cancellationRequests.current.has(localId)) throw new Error('Generation cancelled before submission.')
      const graph = buildLtx25Workflow(options, ltxSelection, uploaded)
      const response = await window.minimax.submitPrompt(settings.comfyUrl, graph, live.clientId)
      if (cancellationRequests.current.has(localId)) {
        await window.minimax.cancelPrompt(settings.comfyUrl, response.prompt_id)
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'cancelled' } : item))
        return 'The LTX 2.5 survey was cancelled before it started.'
      } else {
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'running', progress: 4, progressLabel: 'Waiting for ComfyUI to start' } : item))
        setNotice({ tone: 'success', text: `${options.preset === 'quality' ? 'Two-stage quality' : 'Single-stage Turbo'} LTX‑2.5 generation added to ComfyUI.` })
        if (!handoff) setCharacterHandoff(null)
        return null
      }
    } catch (error) {
      const cancelled = cancellationRequests.current.has(localId)
      const message = cancelled ? 'LTX generation cancelled.' : error instanceof Error ? error.message : String(error)
      setJobs((current) => current.map((item) => item.id === localId ? { ...item, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : error instanceof Error ? error.message : String(error) } : item))
      setNotice(cancelled ? { tone: 'success', text: message } : { tone: 'error', text: message })
      return message
    } finally {
      cancellationRequests.current.delete(localId)
      setLtxSubmitting(false)
    }
  }

  const generateAceStep = async (options: AceStepGenerationOptions) => {
    if (!settings) return
    if (!status.connected) {
      setNotice({ tone: 'error', text: 'Start ComfyUI and verify the server connection in Settings.' })
      return
    }
    const selectedModel = options.model === 'sft' ? aceSelection.sft : aceSelection.base
    if (!selectedModel || !aceSelection.vae || !aceSelection.textEncoderSmall || !aceSelection.textEncoderLarge) {
      setNotice({ tone: 'error', text: `The ACE-Step ${options.model.toUpperCase()} model, audio VAE, and both Qwen ACE text encoders are required.` })
      return
    }
    const missingNodes = ACE_STEP_REQUIRED_NODES.filter((node) => !info[node])
    if (missingNodes.length) {
      setNotice({ tone: 'error', text: `Update ComfyUI before using ACE-Step 1.5. Missing core nodes: ${missingNodes.join(', ')}.` })
      return
    }
    const localId = createId()
    const job: GenerationJob = {
      id: localId, provider: 'acestep', mediaType: 'audio', mode: 'text', prompt: options.tags,
      createdAt: Date.now(), status: 'queued', progress: 2, progressLabel: 'Preparing ACE-Step workflow',
      width: 0, height: 0, duration: options.duration,
    }
    setJobs((current) => [job, ...current])
    setAceSubmitting(true)
    setNotice({ tone: 'neutral', text: `Preparing the official ACE-Step XL ${options.model.toUpperCase()} ComfyUI graph…` })
    try {
      const graph = buildAceStepWorkflow(options, aceSelection)
      const response = await window.minimax.submitPrompt(settings.comfyUrl, graph, live.clientId)
      if (cancellationRequests.current.has(localId)) {
        await window.minimax.cancelPrompt(settings.comfyUrl, response.prompt_id)
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'cancelled' } : item))
      } else {
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'running', progress: 4, progressLabel: 'Waiting for ComfyUI to start' } : item))
        setNotice({ tone: 'success', text: `ACE-Step XL ${options.model.toUpperCase()} music generation added to ComfyUI.` })
      }
    } catch (error) {
      const cancelled = cancellationRequests.current.has(localId)
      setJobs((current) => current.map((item) => item.id === localId ? { ...item, status: cancelled ? 'cancelled' : 'failed', error: cancelled ? undefined : error instanceof Error ? error.message : String(error) } : item))
      setNotice(cancelled ? { tone: 'success', text: 'Music generation cancelled.' } : { tone: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      cancellationRequests.current.delete(localId)
      setAceSubmitting(false)
    }
  }

  const generate = async (target: 'video' | 'image' = 'video') => {
    if (!settings) return
    if (target === 'image' && mode !== 'reference') {
      setNotice({ tone: 'error', text: 'Generate Image is available for the Ref2VA Reference workspace.' })
      return
    }
    if (target === 'video' && upscaleMode === 'ltx' && (!upscaleModel || !upscaleVae)) {
      setNotice({ tone: 'error', text: 'LTX 2.5 spatial upscaler and video VAE must be available in ComfyUI.' })
      return
    }
    if (target === 'video' && upscaleMode === 'ltx' && missingLtxUpscaleNodes.length) {
      setNotice({ tone: 'error', text: `Update ComfyUI before using LTX 2× upscale. Missing nodes: ${missingLtxUpscaleNodes.join(', ')}.` })
      return
    }
    if (target === 'video' && upscaleMode === 'rtx' && !rtxModel) {
      setNotice({ tone: 'error', text: 'Choose an AI upscale model installed in ComfyUI first.' })
      return
    }
    if (target === 'video' && upscaleMode === 'rtx' && !window.confirm('RTX/CUDA upscale processes every frame independently and can amplify MiniMax noise or temporal shimmer. Continue with this experimental post-process?')) return
    if (!prompt.trim()) {
      setNotice({ tone: 'error', text: 'Add a prompt before generating.' })
      return
    }
    if (!status.connected) {
      setNotice({ tone: 'error', text: 'Start ComfyUI and verify the server connection in Settings.' })
      return
    }
    if (!modelReady) {
      setNotice({ tone: 'error', text: 'One or more required MiniMax H3 model components are missing.' })
      return
    }
    if (target === 'video' && liveEnabled && livePreviewMode === 'h3-override' && !h3PreviewOverrideNode) {
      setNotice({ tone: 'error', text: 'MiniMax H3 animated preview is selected, but its Preview Override node was not detected. Install or enable the custom node, restart ComfyUI, then click the Local engine status to refresh.' })
      return
    }
    if (target === 'video' && liveEnabled && livePreviewMode === 'h3-override' && !selection.previewVae) {
      setNotice({ tone: 'error', text: 'MiniMax H3 animated preview requires taeh3_decoder.safetensors in ComfyUI/models/vae_approx. Refresh the Local engine after adding it.' })
      return
    }
    if ((mode === 'image' || mode === 'frames') && !firstFrame) {
      setNotice({ tone: 'error', text: 'Choose a first frame for this mode.' })
      return
    }
    if (mode === 'frames' && !lastFrame) {
      setNotice({ tone: 'error', text: 'Choose a last frame for first-and-last-frame generation.' })
      return
    }
    if (mode === 'reference' && referenceImages.length + referenceVideos.length + referenceAudios.length === 0) {
      setNotice({ tone: 'error', text: 'Add at least one reference image, video, or audio file.' })
      return
    }
    if (mode === 'reference' && (referenceImages.length > 9 || referenceVideos.length > 3 || referenceAudios.length > 3)) {
      setNotice({ tone: 'error', text: 'Reference limits are 9 pictures, 3 videos, and 3 audio files. Remove extras before rendering.' })
      return
    }

    const setTargetSubmitting = target === 'image' ? setStillSubmitting : setSubmitting
    setTargetSubmitting(true)
    setNotice({ tone: 'neutral', text: target === 'image' ? 'Preparing one Ref2VA reference still…' : 'Uploading inputs and preparing the ComfyUI graph…' })
    const workspaceBindings = workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)
    const renderReferenceImages = resolveRenderReferenceImages(referenceImages, workspaceBindings, clothingPolicy)
    const effectivePrompt = composeH3Prompt({ prompt, mode, duration, bindings: workspaceBindings, clothingPolicy, noDialogue, naturalMovement, referenceVideoCount: referenceVideos.length, referenceAudioCount: referenceAudios.length })
    const [width, height] = resolution.split('x').map(Number)
    const localId = createId()
    const job: GenerationJob = {
      id: localId,
      provider: 'minimax',
      mode,
      prompt: effectivePrompt,
      createdAt: Date.now(),
      status: 'queued',
      progress: 2,
      progressLabel: target === 'image' ? 'Preparing Ref2VA reference still' : 'Preparing and uploading inputs',
      mediaType: target,
      sourceMode: target === 'image' ? 'ref2va-still' : undefined,
      seed,
      referenceAssets: [...renderReferenceImages.map((file) => file.path), ...referenceVideos.map((file) => file.path), ...referenceAudios.map((file) => file.path)],
      modelName: mode === 'reference' ? selection.ref2va : selection.fl2va,
      sampler: experimentalSampling ? sampler : turbo === '8' ? turbo8Profile === 'stable' ? 'euler' : 'res_multistep' : 'res_multistep',
      scheduler: experimentalSampling ? scheduler : turbo === '8' && turbo8Profile === 'motion' ? 'beta' : 'simple',
      refImageSize,
      width: width * (target === 'video' && upscaleMode !== 'off' ? 2 : 1),
      height: height * (target === 'video' && upscaleMode !== 'off' ? 2 : 1),
      renderWidth: width,
      renderHeight: height,
      duration,
      turbo,
      steps,
      noDialogue,
      naturalMovement,
      loraStrength,
      userLoras: userLoras.filter((lora) => lora.name),
      movieLink: movieHandoff ?? undefined,
      characterProjectId: characterHandoff ?? undefined,
    }
    setJobs((current) => [job, ...current])
    setActiveJobId(localId)
    try {
      const upload = async (file: MediaFile, fitToOutput = false) => file.kind === 'image' && (fitToOutput || Boolean(file.crop))
        ? window.minimax.uploadImageData(settings.comfyUrl, await prepareImage(file, width, height))
        : window.minimax.uploadInput(settings.comfyUrl, file.path)
      const [first, last, images, videos, audios] = await Promise.all([
        firstFrame && (mode === 'image' || mode === 'frames') ? upload(firstFrame, true) : undefined,
        lastFrame && mode === 'frames' ? upload(lastFrame, true) : undefined,
        Promise.all(mode === 'reference' ? renderReferenceImages.map((file) => upload(file)) : []),
        Promise.all(mode === 'reference' ? referenceVideos.map((file) => upload(file)) : []),
        Promise.all(mode === 'reference' ? referenceAudios.map((file) => upload(file)) : []),
      ])
      if (cancellationRequests.current.has(localId)) throw new Error('Generation cancelled before submission.')
      const generationOptions = {
        mode,
        prompt: effectivePrompt,
        width,
        height,
        duration,
        seed,
        steps,
        turbo,
        experimentalSampling,
        loraStrength,
        userLoras: userLoras.filter((lora) => lora.name),
        sampler: experimentalSampling ? sampler : turbo === '8' ? turbo8Profile === 'stable' ? 'euler' : 'res_multistep' : 'res_multistep',
        scheduler: experimentalSampling ? scheduler : turbo === '8' && turbo8Profile === 'motion' ? 'beta' : 'simple',
        upscale: target === 'video' ? upscaleMode === 'ltx' ? { type: 'ltx' as const, model: upscaleModel, vae: upscaleVae } : upscaleMode === 'rtx' ? { type: 'rtx' as const, model: rtxModel } : undefined : undefined,
        refImageSize,
        sigmaShift: sigmaShiftMode === 'custom' ? { video: shiftVideo, audio: shiftAudio } : undefined,
        previewOverride: target === 'video' && liveEnabled && livePreviewMode === 'h3-override' && h3PreviewOverrideNode ? { frames: 50, fps: 12, nodeType: h3PreviewOverrideNode, vaeName: selection.previewVae, jpegQuality: 85 } : undefined,
        filenamePrefix: target === 'image' ? `image/MiniMax_Ref2VA_Still_${Date.now()}` : `video/MiniMax_H3_${Date.now()}`,
        firstFrame: firstFrame?.path,
        lastFrame: lastFrame?.path,
        referenceImages: renderReferenceImages.map((item) => item.path),
        referenceVideos: referenceVideos.map((item) => item.path),
        referenceAudios: referenceAudios.map((item) => item.path),
      }
      const graph = target === 'image'
        ? buildMiniMaxReferenceStillWorkflow(generationOptions, selection, { images, videos, audios })
        : buildMiniMaxWorkflow(generationOptions, selection, { first, last, images, videos, audios })
      const response = await window.minimax.submitPrompt(settings.comfyUrl, graph, live.clientId)
      if (cancellationRequests.current.has(localId)) {
        await window.minimax.cancelPrompt(settings.comfyUrl, response.prompt_id)
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'cancelled', error: undefined } : item))
        setNotice({ tone: 'success', text: target === 'image' ? 'Reference still cancelled.' : 'Generation cancelled.' })
      } else {
        setJobs((current) => current.map((item) => item.id === localId ? { ...item, promptId: response.prompt_id, status: 'running', progress: 4, progressLabel: target === 'image' ? 'Generating one Ref2VA reference still' : 'Waiting for ComfyUI to start' } : item))
        setNotice({ tone: 'success', text: target === 'image' ? 'Reference still added to the local ComfyUI queue.' : 'Generation added to the local ComfyUI queue.' })
        if (target === 'video') setCharacterHandoff(null)
      }
      setSeed(Math.floor(Math.random() * 1_000_000_000))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const cancelled = cancellationRequests.current.has(localId)
      setJobs((current) => current.map((item) => item.id === localId ? cancelled ? { ...item, status: 'cancelled', error: undefined } : { ...item, status: 'failed', error: message } : item))
      setNotice(cancelled ? { tone: 'success', text: 'Generation cancelled.' } : { tone: 'error', text: message })
    } finally {
      cancellationRequests.current.delete(localId)
      setCancellingIds((current) => { const next = new Set(current); next.delete(localId); return next })
      setTargetSubmitting(false)
    }
  }

  const addStillAsReference = async (job: GenerationJob) => {
    if (!job.localOutputPath) {
      setNotice({ tone: 'error', text: 'The completed still is not available as a local reference file.' })
      return
    }
    try {
      const preview = await window.minimax.mediaUrl(job.localOutputPath)
      setReferenceImages((current) => current.some((file) => file.path === job.localOutputPath) ? current : current.length < 9 ? [...current, { path: job.localOutputPath!, name: `Ref2VA still · ${new Date(job.createdAt).toLocaleString()}`, kind: 'image', preview }] : current)
      setMode('reference')
      setNotice({ tone: 'success', text: 'Reference still added to the current Ref2VA source media.' })
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }) }
  }

  const runH3Diagnostics = async () => {
    if (!settings || diagnosticRunning) return
    if (!status.connected) return setNotice({ tone: 'error', text: 'Connect ComfyUI before running the H3 diagnostic.' })
    const qualityModels = inferSelections(models, 'off', textEncoderPreference)
    const turboModels = inferSelections(models, '8', textEncoderPreference)
    if (![qualityModels.fl2va, qualityModels.textEncoder, qualityModels.videoVae, qualityModels.audioVae, turboModels.fl2vLora].every(Boolean)) {
      return setNotice({ tone: 'error', text: 'The FL2VA base stack and official 8-step Turbo LoRA are required for the diagnostic.' })
    }
    const tests = [
      { name: 'Native quality', turbo: 'off' as const, selection: qualityModels, filenamePrefix: 'video/MiniMax_DIAGNOSTIC_NATIVE' },
      { name: 'Official Turbo 8', turbo: '8' as const, selection: turboModels, filenamePrefix: 'video/MiniMax_DIAGNOSTIC_TURBO8' },
    ]
    setDiagnosticRunning(true)
    setNotice({ tone: 'neutral', text: 'Queuing the fixed-seed Native and Turbo 8 diagnostic pair…' })
    let queuedCount = 0
    for (const [index, test] of tests.entries()) {
      const id = createId()
      const job: GenerationJob = { id, provider: 'minimax', mode: 'text', prompt: `[H3 diagnostic · ${test.name}] ${diagnosticPrompt}`, createdAt: Date.now() + index, status: 'queued', progress: 2, progressLabel: 'Preparing diagnostic workflow', width: 1344, height: 768, duration: 5 }
      setJobs((current) => [job, ...current])
      try {
        const graph = buildMiniMaxWorkflow({ mode: 'text', prompt: diagnosticPrompt, width: 1344, height: 768, duration: 5, seed: 12345, steps: 20, turbo: test.turbo, sampler: 'res_multistep', scheduler: 'simple', refImageSize: 'match', filenamePrefix: test.filenamePrefix, referenceImages: [], referenceVideos: [], referenceAudios: [] }, test.selection, { images: [], videos: [], audios: [] })
        const response = await window.minimax.submitPrompt(settings.comfyUrl, graph, live.clientId)
        queuedCount += 1
        setJobs((current) => current.map((item) => item.id === id ? { ...item, promptId: response.prompt_id, status: 'running', progress: 4, progressLabel: index === 0 ? 'Native test queued' : 'Turbo 8 test queued behind Native' } : item))
        if (index === tests.length - 1) setActiveJobId(id)
      } catch (error) {
        setJobs((current) => current.map((item) => item.id === id ? { ...item, status: 'failed', error: error instanceof Error ? error.message : String(error) } : item))
      }
    }
    setDiagnosticRunning(false)
    setNotice(queuedCount === 2
      ? { tone: 'success', text: 'H3 diagnostic pair queued with identical prompt, seed, resolution, duration, and official sampling.' }
      : { tone: 'error', text: queuedCount ? 'Only one diagnostic render could be queued. Check the failed Queue entry.' : 'The diagnostic renders could not be queued. Check ComfyUI and try again.' })
    setView('queue')
  }

  if (!settings) {
    return <div className="boot"><LoaderCircle className="spin" /><span>Opening MiniMax Studio…</span></div>
  }
  const llmConnection = resolveLlmConnection(settings)

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <header className="titlebar" aria-label="Application title bar">
        <button className="titlebar-mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open workspace menu"><Menu size={18} /></button>
        <div className="titlebar-brand"><span className="brand-mark"><Film size={16} /></span><span>MiniMax Studio</span></div>
        <div className="titlebar-drag" />
        {activeRenderRuntime !== undefined && <span className={`titlebar-runtime ${activeRenderJob?.status === 'running' || activeRenderJob?.status === 'queued' ? 'active' : ''}`} role="status" title="Total time since this render was queued"><Clock3 size={13} />{activeRenderJob?.status === 'queued' ? 'Queued' : activeRenderJob?.status === 'running' ? 'Rendering' : 'Render'} · {formatRuntime(activeRenderRuntime)}</span>}
        {activeSamplerProgress && <span className="titlebar-sampler" role="status" title={`ComfyUI sampler progress: ${activeSamplerProgress.currentStep} of ${activeSamplerProgress.totalSteps}${activeSamplerProgress.rate ? `, averaging ${formatStepDuration(activeSamplerProgress.rate)}` : ''}${activeSamplerProgress.nextStepIn !== undefined ? `, approximately ${formatRuntime(activeSamplerProgress.nextStepIn)} until the next update` : ''}`}><Gauge size={13} /><strong>{activeSamplerProgress.progress}%</strong><span>{activeSamplerProgress.currentStep}/{activeSamplerProgress.totalSteps}</span>{activeSamplerProgress.rate && <span className="sampler-step-rate">{formatStepDuration(activeSamplerProgress.rate)}</span>}{activeSamplerProgress.nextStepIn !== undefined && <span>next ≈ {formatRuntime(activeSamplerProgress.nextStepIn)}</span>}</span>}
        {(view === 'create' || view === 'ltx25' || view === 'zimage') && <button className="titlebar-action titlebar-reset" onClick={resetCurrentWorkspace} title="Reset prompts, options, media, selections, and the current preview in this workspace"><RotateCcw size={14} />Reset workspace</button>}
        <GpuMeter value={gpu} />
        <button className="titlebar-action" onClick={() => { setLanOpen(true); void window.minimax.getLanStatus().then(setLanStatus) }} title="Share MiniMax Studio over your local network"><QrCode size={14} />LAN</button>
        <button className={`connection-chip ${status.connected ? 'online' : ''}`} onClick={() => void checkConnection(settings.comfyUrl)} title="Check ComfyUI connection">
          {checking ? <LoaderCircle size={14} className="spin" /> : <span className="status-dot" />}
          {status.connected ? `Local engine · ${status.latencyMs} ms` : 'Engine offline'}
        </button>
      </header>

      {sidebarOpen && <button className="mobile-sidebar-backdrop" aria-label="Close workspace menu" onClick={() => setSidebarOpen(false)} />}
      <aside className="sidebar" onClick={(event) => { if (window.innerWidth <= 680 && (event.target as HTMLElement).closest('button')) setSidebarOpen(false) }}>
        <div className="sidebar-top">
          <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}><PanelLeftClose size={18} /></button>
        </div>
        <nav aria-label="Primary navigation">
          <div className="nav-group"><span className="nav-section-label">Generate</span>
            <NavButton active={view === 'create'} icon={WandSparkles} label="Create" onClick={() => { setCharacterHandoff(null); setView('create') }} />
            <NavButton active={view === 'ltx25'} icon={Aperture} label="LTX 2.5" onClick={() => setView('ltx25')} />
            <NavButton active={view === 'music'} icon={Music2} label="Music" onClick={() => setView('music')} />
          </div>
          <div className="nav-group"><span className="nav-section-label">Plan</span>
            <NavButton active={view === 'zimage'} icon={ImageIcon} label="Create Image" onClick={() => setView('zimage')} />
            <NavButton active={view === 'characters'} icon={Users} label="Characters" itemType="character" onClick={() => setView('characters')} />
            <NavButton active={view === 'hair'} icon={Scissors} label="Hair" onClick={() => setView('hair')} />
            <NavButton active={view === 'wardrobes'} icon={Shirt} label="Wardrobe" itemType="wardrobe" onClick={() => setView('wardrobes')} />
            <NavButton active={view === 'accessories'} icon={Watch} label="Accessories" onClick={() => setView('accessories')} />
            <NavButton active={view === 'locations'} icon={MapPin} label="Locations" itemType="location" onClick={() => setView('locations')} />
          </div>
          <div className="nav-group"><span className="nav-section-label">Review</span>
            <NavButton active={view === 'queue'} icon={ListVideo} label="Queue" count={pendingJobs.length} onClick={() => setView('queue')} />
            <NavButton active={view === 'library'} icon={Library} label="Library" onClick={() => setView('library')} />
            <NavButton active={view === 'editor'} icon={Scissors} label="Clip editor" onClick={() => setView('editor')} />
          </div>
        </nav>
        <div className="sidebar-spacer" />
        <div className={`model-health ${modelReady ? 'healthy' : ''}`}>
          <HardDrive size={17} />
          <div><strong>{modelReady ? 'Models ready' : 'Models incomplete'}</strong><span>{models.length} local files indexed</span></div>
        </div>
        <nav className="sidebar-secondary" aria-label="Advanced tools"><div className="nav-group"><span className="nav-section-label">Advanced tools</span><NavButton active={view === 'movie'} icon={Clapperboard} label="Movie" onClick={() => setView('movie')} /></div></nav>
        <NavButton active={view === 'settings'} icon={Settings} label="Settings" onClick={() => setView('settings')} />
      </aside>

      <main className="main-area">
        {notice && <Notice tone={notice.tone} text={notice.text} onClose={() => setNotice(null)} />}
        <div hidden={view !== 'create'}>
          <CreateView key={`create-${createResetKey}`}
            info={info}
            sampler={sampler} setSampler={setSampler} scheduler={scheduler} setScheduler={setScheduler}
            experimentalSampling={experimentalSampling} setExperimentalSampling={setExperimentalSampling}
            refImageSize={refImageSize} setRefImageSize={setRefImageSize}
            noDialogue={noDialogue} setNoDialogue={setNoDialogue}
            naturalMovement={naturalMovement} setNaturalMovement={setNaturalMovement}
            clothingPolicy={clothingPolicy} setClothingPolicy={setClothingPolicy}
            sigmaShiftMode={sigmaShiftMode} setSigmaShiftMode={setSigmaShiftMode}
            shiftVideo={shiftVideo} setShiftVideo={setShiftVideo} shiftAudio={shiftAudio} setShiftAudio={setShiftAudio}
            loraStrength={loraStrength} setLoraStrength={setLoraStrength}
            liveEnabled={liveEnabled} setLiveEnabled={setLiveEnabled} livePreviewMode={livePreviewMode} setLivePreviewMode={setLivePreviewMode} liveConnected={live.connected} livePreview={live.preview}
            upscaleMode={upscaleMode} setUpscaleMode={setUpscaleMode} ltxAvailable={ltxUpscaleReady} ltxMissingNodes={missingLtxUpscaleNodes}
            rtxModels={rtxModels} rtxModel={rtxModel} setRtxModel={setRtxModel}
            updateReference={(index, file) => setReferenceImages((items) => items.map((item, i) => i === index ? file : item))}
            mode={mode}
            setMode={setMode}
            prompt={prompt}
            setPrompt={setPrompt}
            duration={duration}
            setDuration={setDuration}
            resolution={resolution}
            setResolution={setResolution}
            turbo={turbo}
            setTurbo={setTurbo}
            turbo8Profile={turbo8Profile}
            setTurbo8Profile={setTurbo8Profile}
            userLoras={userLoras}
            setUserLoras={setUserLoras}
            userLoraChoices={userLoraChoices}
            textEncoderPreference={textEncoderPreference}
            setTextEncoderPreference={setTextEncoderPreference}
            steps={steps}
            setSteps={setSteps}
            seed={seed}
            setSeed={setSeed}
            advanced={advanced}
            setAdvanced={setAdvanced}
            firstFrame={firstFrame}
            lastFrame={lastFrame}
            setFirstFrame={setFirstFrame}
            setLastFrame={setLastFrame}
            chooseMedia={chooseMedia}
            referenceImages={referenceImages}
            characters={characterProjects}
            wardrobes={wardrobeProjects}
            locations={locationProjects}
            selectedCharacterIds={selectedReferenceCharacterIds}
            selectedLocationIds={selectedReferenceLocationIds}
            characterDetailReferencesEnabled={settings.characterDetailReferencesEnabled}
            loadCharacter={(characterId) => void loadReferenceCharacter(characterId)}
            loadWardrobe={(wardrobeId) => void loadReferenceWardrobe(wardrobeId)}
            loadLocation={(locationId) => void loadReferenceLocation(locationId)}
            refreshSourceMedia={refreshSourceMedia}
            referenceVideos={referenceVideos}
            referenceAudios={referenceAudios}
            removeReference={(kind, index) => {
              if (kind === 'image') { setSelectedReferenceCharacterIds([]); setSelectedReferenceLocationIds([]); setReferenceImages((items) => items.filter((_, itemIndex) => itemIndex !== index)) }
              if (kind === 'video') setReferenceVideos((items) => items.filter((_, itemIndex) => itemIndex !== index))
              if (kind === 'audio') setReferenceAudios((items) => items.filter((_, itemIndex) => itemIndex !== index))
            }}
            chooseReference={chooseMany}
            editVideoReference={(index) => void editVideoReference(index)}
            h3Validated={h3Report.validated}
            modelReady={modelReady}
            selection={selection}
            submitting={submitting}
            stillSubmitting={stillSubmitting}
            cancelling={Boolean(activeJobId && cancellingIds.has(activeJobId))}
            connected={status.connected}
            onGenerate={() => void generate()}
            onGenerateImage={() => void generate('image')}
            onUseStillAsReference={(job) => void addStillAsReference(job)}
            latestJob={activeJobId ? jobs.find((job) => job.id === activeJobId) : undefined}
            onCancel={(job) => void cancelJob(job)}
            onContinue={startVideoContinuation}
            ollamaAvailable={ollamaModels.length > 0}
            ollamaModel={llmConnection.model}
            llmProviderLabel={llmConnection.label}
            promptSuggestion=""
            promptingTool={promptingTool}
            dialogueGenerating={dialogueGenerating}
            onPromptTool={(tool) => void runPromptTool(tool)}
            onGenerateDialogue={generateCharacterDialogue}
            onUseSuggestion={() => { setPrompt(promptSuggestion); setPromptSuggestion(''); setPromptSuggestionId('') }}
            onDismissSuggestion={() => { setPromptSuggestion(''); setPromptSuggestionId('') }}
          />
        </div>
        {view === 'ltx25' && <Ltx25Workspace key={`ltx-${ltxResetKey}`}
          settings={settings}
          models={ltxSelection}
          pipelineReady={LTX_NATIVE_REQUIRED_NODES.every((node) => Boolean(info[node]))}
          missingNodes={LTX_NATIVE_REQUIRED_NODES.filter((node) => !info[node])}
          connected={status.connected}
          liveConnected={live.connected}
          livePreview={live.preview}
          latestJob={jobs.find((job) => job.provider === 'ltx25' && job.createdAt > ltxResetAt)}
          submitting={ltxSubmitting}
          cancelling={Boolean(jobs.find((job) => job.provider === 'ltx25' && ['queued', 'running'].includes(job.status)) && cancellingIds.has(jobs.find((job) => job.provider === 'ltx25' && ['queued', 'running'].includes(job.status))!.id))}
          ollamaAvailable={ollamaModels.length > 0}
          onChooseImage={chooseLtxImage}
          onGenerate={(options, file) => void generateLtx(options, file)}
          onCancel={(job) => void cancelJob(job)}
        />}
        {view === 'music' && <AceStepWorkspace
          settings={settings}
          models={aceSelection}
          connected={status.connected}
          pipelineReady={ACE_STEP_REQUIRED_NODES.every((node) => Boolean(info[node]))}
          missingNodes={ACE_STEP_REQUIRED_NODES.filter((node) => !info[node])}
          latestJob={jobs.find((job) => job.provider === 'acestep')}
          submitting={aceSubmitting}
          cancelling={Boolean(jobs.find((job) => job.provider === 'acestep' && ['queued', 'running'].includes(job.status)) && cancellingIds.has(jobs.find((job) => job.provider === 'acestep' && ['queued', 'running'].includes(job.status))!.id))}
          ollamaAvailable={ollamaModels.length > 0}
          onGenerate={(options) => void generateAceStep(options)}
          onCancel={(job) => void cancelJob(job)}
        />}
        <div hidden={view !== 'zimage'}><ZImageWorkspace key={`first-frame-${zImageResetKey}`} url={settings.comfyUrl} info={info} connected={status.connected} ollamaAvailable={ollamaModels.length > 0} llmProvider={llmConnection.provider} ollamaUrl={llmConnection.url} ollamaModel={llmConnection.model} outputDirectory={settings.outputDirectory} onUse={(file, frameResolution) => {
          setFirstFrame(file); setResolution(frameResolution); setMode('image'); setActiveJobId(null); setView('create'); setNotice({ tone: 'success', text: 'Z-Image frame loaded into the MiniMax I2V workspace.' })
        }} /></div>
        {view === 'characters' && <CharacterStudio settings={settings} info={info} connected={status.connected} ollamaAvailable={ollamaModels.length > 0} automationJobs={jobs.filter((job) => job.characterProjectId)} onCopilotContext={setCharacterCopilotContext} onNotice={(tone, text) => setNotice({ tone, text })} onCreateTurntable={(project) => {
          if (!project.baseImage) return Promise.resolve('Approve a character identity image before rendering the survey.')
          const firstFrame = fitWholeCharacter(project.baseImage)
          return generateLtx({ mode: 'image', prompt: `Ten-second character identity coverage survey of ${project.name} in one continuous stabilized take. Preserve the exact identity, facial geometry, skin, hair, body proportions, clothing, and neutral studio background from the first frame. From 0 to 2 seconds hold a sharp neutral full-body front view with the entire head, hands, and feet visible. From 2 to 5 seconds make a slow stabilized camera push to a sharp head-and-shoulders close-up. From 5 to 7 seconds hold the face clearly while moving through frontal and gentle three-quarter facial angles so the eyes, nose, mouth, jawline, ears, hairline, and distinguishing marks remain readable. From 7 to 10 seconds pull back smoothly to a complete full-body view and continue a restrained orbit through three-quarter, side, and rear body angles. The character stays still with a neutral expression and unchanged pose. Even soft studio lighting, accurate anatomy, crisp individual frames, fast shutter. No cuts, no identity drift, no morphing, no pose changes, no expression changes, no clothing changes, no added objects, no motion blur, no smearing, no ghosting, no whip pans, no text, no dialogue.`, width: 768, height: 1024, duration: 10, preset: 'quality', seed: Math.floor(Math.random() * 1_000_000_000), filenamePrefix: 'MiniMax_character_identity_survey' }, firstFrame, { characterProjectId: project.id })
        }} />}
        {view === 'hair' && <HairStudio settings={settings} info={info} connected={status.connected} ollamaAvailable={ollamaModels.length > 0} onNotice={(tone, text) => setNotice({ tone, text })} />}
        {view === 'wardrobes' && <WardrobeStudio settings={settings} info={info} connected={status.connected} onNotice={(tone, text) => setNotice({ tone, text })} />}
        {view === 'accessories' && <AccessoryStudio settings={settings} info={info} connected={status.connected} onNotice={(tone, text) => setNotice({ tone, text })} />}
        {view === 'locations' && <LocationStudio settings={settings} info={info} connected={status.connected} ollamaAvailable={ollamaModels.length > 0} automationJobs={jobs.filter((job) => job.locationProjectId)} onNotice={(tone, text) => setNotice({ tone, text })} onCreateWalkthrough={(project: LocationProject, options?: { duration: number; cameraLanguage: string }) => {
          if (!project.baseImage) return Promise.resolve('Approve a location image before rendering the walkthrough.')
          const firstFrame = project.baseImage
          const walkthroughDirection = project.environmentMode === 'nature'
            ? `Comprehensive cinematic natural-landscape survey of ${project.name}. Begin with a wide establishing view, then move slowly through the terrain in one continuous stabilized path. Deliberately reveal landforms, vegetation zones, water features, rock formations, horizon lines, and their spatial relationships. Preserve the exact terrain, ecology, vegetation placement, lighting, weather, and geography from the first frame. Untouched nature only: no buildings, cabins, houses, ruins, roads, streets, bridges, fences, signs, vehicles, power lines, utility poles, constructed paths, or other human-made objects.`
            : `Comprehensive cinematic location walkthrough reference video of ${project.name}. Begin with a wide establishing view, then move slowly along the perimeter in one continuous stabilized path. Deliberately pan through every important zone and spatial connection, revealing entrances, landmarks, surfaces, fixtures, terrain, and object placement. Preserve exactly the same architecture, dimensions, materials, lighting, weather, and geography from the first frame.`
          const locationProfile = [project.description, project.atmosphere && `Atmosphere and lighting: ${project.atmosphere}.`, project.timeOfDay && `Time and weather: ${project.timeOfDay}.`, project.continuityAnchors && `Fixed continuity anchors: ${project.continuityAnchors}.`, project.visualStyle && `Visual treatment: ${project.visualStyle}.`].filter(Boolean).join(' ')
          const cameraLanguage = options?.cameraLanguage ?? 'Use only wide and extra-wide shots with an 18–24mm lens. Begin with a complete establishing view, then move slowly and smoothly to reveal the environment’s spatial relationships. Never use close-ups.'
          const clarityDirection = 'Maintain crisp, sharp frames with a fast shutter and slow stabilized camera movement. No motion blur, temporal smearing, ghosting, rolling-shutter distortion, speed ramps, whip pans, or rapid camera movement.'
          return generateLtx({ mode: 'image', prompt: `${walkthroughDirection} Location description: ${locationProfile} Camera language: ${cameraLanguage} Image clarity: ${clarityDirection} No cuts, no teleporting, no layout changes, no duplicated objects, no people as focal subjects, no dialogue, no text, no logos.`, width: 1344, height: 768, duration: Math.max(5, Math.min(20, options?.duration ?? 10)), preset: 'quality', seed: Math.floor(Math.random() * 1_000_000_000), filenamePrefix: 'MiniMax_location_walkthrough' }, firstFrame, { locationProjectId: project.id })
        }} />}
        {view === 'movie' && <MoviePlanner settings={settings} ollamaAvailable={ollamaModels.length > 0} ollamaModel={llmConnection.model} onNotice={(tone, text) => setNotice({ tone, text })} onOpenShot={async (shot: MovieShot, aspectRatio: MovieProject['aspectRatio'], resolved: ResolvedMovieShot, context: { projectId: string; sceneId: string; continuationSource?: string }) => {
          setCharacterHandoff(null)
          setSelectedReferenceCharacterIds([])
          setSelectedReferenceLocationIds([])
          setPrompt(resolved.compiledPrompt)
          setDuration(Math.max(2, Math.min(15, shot.duration)))
          setMode(resolved.effectiveMode)
          setResolution(aspectRatio === '9:16' ? '768x1344' : aspectRatio === '1:1' ? '768x768' : '1344x768')
          let inheritedFrame: MediaFile | null = null
          if (context.continuationSource) {
            try {
              const extracted = await window.minimax.extractVideoFrame(context.continuationSource, 'last', settings.outputDirectory, settings.ffmpegPath)
              inheritedFrame = { ...extracted, kind: 'image', preview: await window.minimax.mediaUrl(extracted.path) }
            } catch (error) {
              setNotice({ tone: 'error', text: `Could not prepare the continuation frame: ${error instanceof Error ? error.message : String(error)}` })
              return
            }
          }
          setMovieHandoff({ projectId: context.projectId, sceneId: context.sceneId, shotId: shot.id })
          const resolvedImages = resolved.references.map((binding) => binding.purpose === 'continuity' && inheritedFrame ? inheritedFrame : binding.file)
          setFirstFrame(resolved.effectiveMode === 'image' ? inheritedFrame : null); setLastFrame(null); setReferenceImages(resolved.effectiveMode === 'reference' ? resolvedImages : []); setReferenceVideos(resolved.effectiveMode === 'reference' ? shot.referenceVideos ?? [] : []); setReferenceAudios(resolved.effectiveMode === 'reference' ? shot.referenceAudios ?? [] : [])
          setActiveJobId(null); setView('create')
          const inputNote = resolved.effectiveMode === 'reference' ? ` Loaded ${resolvedImages.length} semantically resolved reference image${resolvedImages.length === 1 ? '' : 's'}.` : inheritedFrame ? ' The previous scene’s last frame was loaded automatically for continuous I2V.' : resolved.effectiveMode === 'image' ? ' Add the approved first frame before rendering.' : resolved.effectiveMode === 'frames' ? ' Add the approved first and last frames before rendering.' : ''
          setNotice({ tone: 'success', text: `${shot.title} loaded into Create.${inputNote}` })
        }} />}
        {view === 'queue' && <JobsView title="Queue" note="Running and recent local generations" jobs={jobs} empty="No generations have been queued." cancellingIds={cancellingIds} onCancel={cancelJob} />}
        {view === 'library' && <LibraryView jobs={jobs.filter((job) => job.status === 'completed')} settings={settings} onEdit={() => setView('editor')} onUseLtx={useStartFrameInLtx} onNotice={(tone, text) => setNotice({ tone, text })} />}
        {view === 'editor' && <ClipEditor settings={settings} jobs={jobs} onNotice={(tone, text) => setNotice({ tone, text })} onUseFrame={(file, target, clip) => {
          if (target === 'reference') { setSelectedReferenceCharacterIds([]); setSelectedReferenceLocationIds([]); setReferenceImages((items) => [...items, file].slice(0, 9)); setMode('reference') }
          else if (target === 'last') { setLastFrame(file); setMode('frames') }
          else { setFirstFrame(file); setMode(target === 'first' ? 'frames' : 'image') }
          setActiveJobId(null); setView('create')
          setNotice({ tone: 'success', text: target === 'i2v' ? `Frame loaded from ${clip.name} as the I2V first frame. The new render will remain a separate video until you add and export it in Clip Editor.` : 'Extracted frame loaded into Create.' })
        }} />}
        {view === 'settings' && <SettingsView settings={settings} setSettings={setSettings} info={info} models={models} h3Report={h3Report} scanning={scanning} status={status} checking={checking} diagnosticRunning={diagnosticRunning} ollamaModels={ollamaModels} onRefreshOllama={() => void refreshOllama(settings)} onScan={() => void scanModels(settings)} onCheck={() => void checkConnection(settings.comfyUrl)} onSave={() => void saveAppSettings()} onApplyDefaults={applyGenerationDefaults} onRunDiagnostics={() => void runH3Diagnostics()} />}
      </main>
      <AiChatHead available={ollamaModels.length > 0} provider={llmConnection.provider} ollamaUrl={llmConnection.url} ollamaModel={llmConnection.model} context={view === 'characters' ? characterCopilotContext : view === 'create' ? { label: `Create · ${mode} to video`, prompt, duration, noDialogue, referenceMap: mode === 'reference' ? [...referenceImages.map((file, index) => `<Picture ${index + 1}> = ${workspaceBindingsFor(selectedReferenceCharacterIds, selectedReferenceLocationIds)[index]?.label ?? file.name}`), ...referenceVideos.map((file, index) => `<Video ${index + 1}> = ${file.name}`), ...referenceAudios.map((file, index) => `<Audio ${index + 1}> = ${file.name}`)] : [], imagePaths: mode === 'reference' ? referenceImages.map((file) => file.path) : [firstFrame?.path, lastFrame?.path].filter(Boolean) as string[] } : { label: view === 'zimage' ? 'Create Image' : view.replace(/\b\w/g, (letter) => letter.toUpperCase()) }} onUseImage={(imagePrompt) => {
        setView('zimage')
        window.dispatchEvent(new CustomEvent('minimax:load-image-prompt', { detail: imagePrompt }))
        setNotice({ tone: 'success', text: 'Image prompt loaded into Create Image.' })
      }} onUseVideo={(videoPrompt) => {
        setPrompt((current) => appendPromptAddition(current, videoPrompt)); setActiveJobId(null); setView('create')
        setNotice({ tone: 'success', text: 'Timeline addition appended to the current video prompt.' })
      }} />
      {lanOpen && <LanCompanionDialog status={lanStatus} qr={lanQr} onRotate={async () => setLanStatus(await window.minimax.rotateLanToken())} onClose={() => setLanOpen(false)} />}
      {videoClipDraft && <VideoReferenceClipper source={videoClipDraft.source} onClose={() => setVideoClipDraft(null)} onCreate={createVideoReferenceClip} />}
    </div>
  )
}

function LanCompanionDialog({ status, qr, onRotate, onClose }: { status: LanStatus; qr: string; onRotate(): Promise<void>; onClose(): void }) {
  const [rotating, setRotating] = useState(false)
  return <div className="lan-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="lan-dialog" role="dialog" aria-modal="true" aria-labelledby="lan-dialog-title">
      <header><div><QrCode size={20} /><span><strong id="lan-dialog-title">Share over your LAN</strong><small>Touch-first mobile creation or the complete Studio interface</small></span></div><button className="icon-button" onClick={onClose} aria-label="Close LAN sharing"><X size={18} /></button></header>
      {status.running && status.url ? <div className="lan-dialog-body">
        <div className="lan-qr">{qr ? <img src={qr} alt="QR code for the MiniMax mobile companion" /> : <LoaderCircle className="spin" aria-label="Preparing QR code" />}</div>
        <div className="lan-instructions"><span className="lan-ready"><Check size={15} />LAN server ready</span><h2>Open on another device</h2><p>Scan for the touch-first mobile workspace, or open the full interface on a tablet or computer connected to the same trusted Wi-Fi or LAN.</p><label>Mobile address<input readOnly value={status.url} onFocus={(event) => event.currentTarget.select()} /></label><label>Full Studio address<input readOnly value={status.desktopUrl ?? status.url.replace('?mobile=1', '?desktop=1')} onFocus={(event) => event.currentTarget.select()} /></label><small>The full Studio view shares the interface and browser-local project state. Hardware generation and local-file access remain protected by the authenticated LAN services. Windows Firewall may ask to allow private-network access the first time.</small></div>
      </div> : <div className="lan-dialog-error"><AlertCircle size={22} /><span><strong>Mobile server unavailable</strong><p>{status.error ?? 'Restart MiniMax Studio, then try again.'}</p></span></div>}
      <footer><button className="secondary-button" disabled={rotating || !status.running} title="Invalidate previously scanned mobile links" onClick={async () => { if (!window.confirm('Rotate the mobile access link? Previously scanned links will stop working.')) return; setRotating(true); try { await onRotate() } finally { setRotating(false) } }}><RotateCcw size={14} />{rotating ? 'Rotating…' : 'Rotate access link'}</button><button className="primary-button" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}

function GpuMeter({ value }: { value: GpuTelemetry | null }) {
  const usage = value?.usagePercent
  const vram = value?.vramPercent
  const available = Boolean(value?.available && usage !== undefined && vram !== undefined)
  const title = available ? `${value?.name ?? 'GPU'} · ${usage}% utilization · ${vram}% VRAM (${value?.vramUsedMb ?? 0} / ${value?.vramTotalMb ?? 0} MB)` : 'GPU telemetry unavailable'
  return <div className={`gpu-meter ${available ? 'available' : ''}`} title={title} aria-label={title}><Gauge size={14} /><span><small>GPU</small><strong>{available ? `${usage}%` : '—'}</strong></span><i aria-hidden="true"><b style={{ width: `${available ? usage : 0}%` }} /></i><span><small>VRAM</small><strong>{available ? `${vram}%` : '—'}</strong></span></div>
}

function NavButton({ active, icon: Icon, label, count, itemType, onClick }: { active: boolean; icon: typeof Film; label: string; count?: number; itemType?: 'character' | 'wardrobe' | 'location'; onClick(): void }) {
  return <button className={`nav-button ${active ? 'active' : ''}`} data-item-type={itemType} aria-label={label} onClick={onClick}><Icon size={19} /><span>{label}</span>{count ? <em>{count}</em> : null}</button>
}

function Notice({ tone, text, onClose }: { tone: 'error' | 'success' | 'neutral'; text: string; onClose(): void }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'error' ? <AlertCircle size={17} /> : tone === 'success' ? <Check size={17} /> : <Activity size={17} />}<span>{text}</span><button onClick={onClose} aria-label="Dismiss"><X size={16} /></button></div>
}

type CreateViewProps = {
  info: ObjectInfo
  sampler: string; setSampler(value: string): void; scheduler: string; setScheduler(value: string): void
  experimentalSampling: boolean; setExperimentalSampling(value: boolean): void
  refImageSize: 'match' | 'max'; setRefImageSize(value: 'match' | 'max'): void
  sigmaShiftMode: 'model' | 'custom'; setSigmaShiftMode(value: 'model' | 'custom'): void
  shiftVideo: number; setShiftVideo(value: number): void; shiftAudio: number; setShiftAudio(value: number): void
  loraStrength: number; setLoraStrength(value: number): void
  userLoras: Array<{ name: string; strength: number }>; setUserLoras(value: Array<{ name: string; strength: number }>): void; userLoraChoices: string[]
  liveEnabled: boolean; setLiveEnabled(value: boolean): void; livePreviewMode: 'standard' | 'h3-override'; setLivePreviewMode(value: 'standard' | 'h3-override'): void; liveConnected: boolean; livePreview: LivePreview | null
  upscaleMode: UpscaleMode; setUpscaleMode(value: UpscaleMode): void; ltxAvailable: boolean; ltxMissingNodes: readonly string[]
  noDialogue: boolean; setNoDialogue(value: boolean): void
  naturalMovement: boolean; setNaturalMovement(value: boolean): void
  clothingPolicy: 'wardrobe' | 'underwear' | 'unrestricted'; setClothingPolicy(value: 'wardrobe' | 'underwear' | 'unrestricted'): void
  rtxModels: string[]; rtxModel: string; setRtxModel(value: string): void
  updateReference(index: number, file: MediaFile): void
  mode: GenerationMode; setMode(value: GenerationMode): void
  prompt: string; setPrompt(value: string): void
  duration: number; setDuration(value: number): void
  resolution: string; setResolution(value: string): void
  turbo: 'off' | '4' | '8'; setTurbo(value: 'off' | '4' | '8'): void
  turbo8Profile: Turbo8Profile; setTurbo8Profile(value: Turbo8Profile): void
  textEncoderPreference: 'fast' | 'quality'; setTextEncoderPreference(value: 'fast' | 'quality'): void
  steps: number; setSteps(value: number): void
  seed: number; setSeed(value: number): void
  advanced: boolean; setAdvanced(value: boolean): void
  firstFrame: MediaFile | null; lastFrame: MediaFile | null
  setFirstFrame(value: MediaFile | null): void; setLastFrame(value: MediaFile | null): void
  chooseMedia(kind: MediaKind, setter: (file: MediaFile) => void): Promise<void>
  referenceImages: MediaFile[]; referenceVideos: MediaFile[]; referenceAudios: MediaFile[]
  characters: CharacterProject[]; wardrobes: WardrobeProject[]; locations: LocationProject[]; selectedCharacterIds: string[]; selectedLocationIds: string[]; characterDetailReferencesEnabled: boolean; loadCharacter(characterId: string): void; loadWardrobe(wardrobeId: string): void; loadLocation(locationId: string): void
  refreshSourceMedia(): Promise<void>
  removeReference(kind: MediaKind, index: number): void
  chooseReference(kind: MediaKind): Promise<void>
  editVideoReference(index: number): void
  h3Validated: boolean
  modelReady: boolean; selection: ModelSelection; submitting: boolean; stillSubmitting: boolean; cancelling: boolean; connected: boolean
  ollamaAvailable: boolean; ollamaModel: string; llmProviderLabel: string; promptSuggestion: string
  promptingTool: 'enhance' | 'timeline' | 'audio' | null
  dialogueGenerating: boolean
  onPromptTool(tool: 'enhance' | 'timeline' | 'audio'): void
  onGenerateDialogue(draft: CharacterDialogueDraft): Promise<string>
  onUseSuggestion(): void; onDismissSuggestion(): void
  onGenerate(): void; onGenerateImage(): void; onUseStillAsReference(job: GenerationJob): void; onCancel(job: GenerationJob): void; onContinue(job: GenerationJob): Promise<void>; latestJob?: GenerationJob
}

function CreateView(props: CreateViewProps) {
  const {
    info, sampler, setSampler, scheduler, setScheduler, experimentalSampling, setExperimentalSampling, refImageSize, setRefImageSize,
    sigmaShiftMode, setSigmaShiftMode, shiftVideo, setShiftVideo, shiftAudio, setShiftAudio, loraStrength, setLoraStrength, userLoras, setUserLoras, userLoraChoices, liveEnabled, setLiveEnabled, livePreviewMode, setLivePreviewMode, liveConnected, livePreview,
    upscaleMode, setUpscaleMode, ltxAvailable, ltxMissingNodes, noDialogue, setNoDialogue, naturalMovement, setNaturalMovement, clothingPolicy, setClothingPolicy, rtxModels, rtxModel, setRtxModel, updateReference,
    mode, setMode, prompt, setPrompt, duration, setDuration, resolution, setResolution, turbo, setTurbo, turbo8Profile, setTurbo8Profile, textEncoderPreference, setTextEncoderPreference, steps, setSteps,
    seed, setSeed, advanced, setAdvanced, firstFrame, lastFrame, setFirstFrame, setLastFrame, chooseMedia,
    referenceImages, referenceVideos, referenceAudios, characters, wardrobes, locations, selectedCharacterIds, selectedLocationIds, characterDetailReferencesEnabled, loadCharacter, loadWardrobe, loadLocation, refreshSourceMedia, removeReference, chooseReference, editVideoReference, h3Validated, modelReady, selection,
    submitting, stillSubmitting, cancelling, connected, ollamaAvailable, ollamaModel, llmProviderLabel, promptSuggestion, promptingTool, dialogueGenerating,
    onPromptTool, onGenerateDialogue, onUseSuggestion, onDismissSuggestion, onGenerate, onGenerateImage, onUseStillAsReference, onCancel, onContinue, latestJob,
  } = props
  const promptRef = useRef<SmartPromptEditorHandle>(null)
  const sourceMediaTriggerRef = useRef<HTMLButtonElement>(null)
  const sourceMediaCloseRef = useRef<HTMLButtonElement>(null)
  const dialogueTriggerRef = useRef<HTMLButtonElement>(null)
  const [sourceMediaOpen, setSourceMediaOpen] = useState(false)
  const [automaticPromptOpen, setAutomaticPromptOpen] = useState(false)
  const [dialogueOpen, setDialogueOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const h3PreviewOverrideAvailable = Boolean(findH3PreviewOverrideNode(info))
  const ref2vaTurbo8TrainingShifts = mode === 'reference' && turbo === '8' && /^minimax_h3_ref2v_turbo_8step_v1\.0_768p_comfyui_bf16\.safetensors$/i.test(selection.ref2vLora)
  const selectedCharacters = selectedCharacterIds.map((id) => characters.find((character) => character.id === id)).filter(Boolean) as CharacterProject[]
  const selectedLocations = selectedLocationIds.map((id) => locations.find((location) => location.id === id)).filter(Boolean) as LocationProject[]
  const detailReferenceDirection = buildCharacterDetailInstructions(selectedCharacters, characterDetailReferencesEnabled)
  const selectedBindings = allocateWorkspaceReferences(selectedCharacters.map((character) => ({ id: character.id, name: character.name, identity: characterReferences(character), detailReferences: characterDetailReferencesEnabled ? character.detailReferences : [], hairStyleIds: character.hairStyleIds, wardrobeIds: character.wardrobeIds, accessoryIds: character.accessoryIds })), wardrobes, selectedLocations.map((location) => ({ id: location.id, name: location.name, images: locationReferences(location), environmentMode: location.environmentMode })))
  const activeSelectedBindings = clothingPolicy === 'wardrobe' ? selectedBindings : selectedBindings.filter((binding) => binding.purpose !== 'wardrobe')
  const builderReferenceImages = resolveRenderReferenceImages(referenceImages, selectedBindings, clothingPolicy)
  const composedPrompt = composeH3Prompt({ prompt, mode, duration, bindings: selectedBindings, clothingPolicy, noDialogue, naturalMovement, referenceVideoCount: referenceVideos.length, referenceAudioCount: referenceAudios.length })
  const sourceMediaCount = referenceImages.length + referenceVideos.length + referenceAudios.length
  const closeSourceMedia = useCallback(() => {
    setSourceMediaOpen(false)
    window.requestAnimationFrame(() => sourceMediaTriggerRef.current?.focus())
  }, [])
  const keepSourceMediaFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  useEffect(() => {
    if (!sourceMediaOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSourceMedia()
    }
    window.addEventListener('keydown', closeOnEscape)
    window.requestAnimationFrame(() => sourceMediaCloseRef.current?.focus())
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeSourceMedia, sourceMediaOpen])
  useEffect(() => {
    if (mode !== 'reference' && sourceMediaOpen) setSourceMediaOpen(false)
  }, [mode, sourceMediaOpen])
  const insertPromptText = (text: string) => promptRef.current?.insert(text)
  const copyComposedPrompt = async () => {
    if (!composedPrompt) return
    try {
      await navigator.clipboard.writeText(composedPrompt)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 2400)
    }
  }
  const closeDialogue = useCallback(() => {
    setDialogueOpen(false)
    window.requestAnimationFrame(() => dialogueTriggerRef.current?.focus())
  }, [])
  const smartCharacterOptions = characters.filter((character) => characterReferences(character, characterDetailReferencesEnabled).length > 0).map((character) => {
    const projected = selectedCharacterIds.includes(character.id) ? selectedCharacters : [...selectedCharacters, character]
    const projectedBindings = allocateWorkspaceReferences(projected.map((item) => ({ id: item.id, name: item.name, identity: characterReferences(item), detailReferences: characterDetailReferencesEnabled ? item.detailReferences : [], hairStyleIds: item.hairStyleIds, wardrobeIds: item.wardrobeIds, accessoryIds: item.accessoryIds })), wardrobes, selectedLocations.map((location) => ({ id: location.id, name: location.name, images: locationReferences(location), environmentMode: location.environmentMode })))
    const wardrobeCount = projectedBindings.filter((binding) => binding.characterId === character.id && binding.purpose === 'wardrobe').length
    return { id: `character.${character.id}`, category: 'character' as const, label: character.name, description: wardrobeCount ? `${character.description || 'Character Studio identity'} · wardrobe isolated` : character.description || 'Character Studio identity', insertion: `Character: ${character.name}.`, thumbnail: characterReferences(character, characterDetailReferencesEnabled)[0]?.preview, meta: `${projectedBindings.filter((binding) => binding.characterId === character.id).length} allocated refs`, onSelect: (nextPrompt: string) => { setPrompt(nextPrompt); loadCharacter(character.id) } }
  })
  const smartWardrobeOptions = wardrobes.filter((wardrobe) => wardrobeReferences(wardrobe).length > 0).map((wardrobe) => { const files = wardrobeReferences(wardrobe).slice(0, 9); const tags = files.map((_, index) => `<Picture ${index + 1}>`).join(', ').replace(/, ([^,]+)$/, ' and $1'); return { id: `wardrobe.${wardrobe.id}`, category: 'wardrobe' as const, label: wardrobe.name, description: wardrobe.description || 'Approved Wardrobe Studio outfit', insertion: `Wardrobe: apply the approved ${wardrobe.name} outfit from ${tags}; preserve its garments, materials, colors, fit, and accessories.`, thumbnail: files[0]?.preview, meta: `${files.length} approved`, onSelect: (nextPrompt: string) => { setPrompt(nextPrompt); loadWardrobe(wardrobe.id) } } })
  const smartLocationOptions = locations.filter((location) => locationReferences(location).length > 0).map((location) => { const files = locationReferences(location); const projected = selectedLocationIds.includes(location.id) ? selectedLocations : [...selectedLocations, location]; const projectedBindings = allocateWorkspaceReferences(selectedCharacters.map((character) => ({ id: character.id, name: character.name, identity: characterReferences(character), detailReferences: characterDetailReferencesEnabled ? character.detailReferences : [], hairStyleIds: character.hairStyleIds, wardrobeIds: character.wardrobeIds, accessoryIds: character.accessoryIds })), wardrobes, projected.map((item) => ({ id: item.id, name: item.name, images: locationReferences(item), environmentMode: item.environmentMode }))); return { id: `location.${location.id}`, category: 'location' as const, label: location.name, description: location.description || 'Approved Location Studio environment', insertion: `Location: ${location.name}.`, thumbnail: files[0]?.preview, meta: `${projectedBindings.filter((binding) => binding.locationId === location.id).length} allocated view${projectedBindings.filter((binding) => binding.locationId === location.id).length === 1 ? '' : 's'}`, onSelect: (nextPrompt: string) => { setPrompt(nextPrompt); loadLocation(location.id) } } })
  const applyCreatePreset = (preset: 'quality' | 'turbo' | 'preview') => {
    const [width, height] = resolution.split('x').map(Number)
    const portrait = height > width
    const square = height === width
    const base = preset === 'preview' ? square ? '640x640' : portrait ? '480x864' : '864x480' : square ? '768x768' : portrait ? '768x1344' : '1344x768'
    setResolution(base)
    setTurbo(preset === 'quality' ? 'off' : '8')
    setSteps(preset === 'quality' ? 30 : 8); setSampler('res_multistep'); setScheduler('simple'); setExperimentalSampling(false)
    setSigmaShiftMode('model'); setShiftVideo(12); setShiftAudio(3); setLoraStrength(1); setUpscaleMode('off')
  }
  const setUserLoraSlot = (index: number, patch: Partial<{ name: string; strength: number }>) => setUserLoras(userLoras.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot))
  return (
    <div className="create-page">
      <div className="page-heading">
        <div><p className="eyebrow">LOCAL VIDEO WORKSPACE</p><h1>Create with MiniMax H3</h1><p>Generate synchronized video and audio through your local ComfyUI engine.</p></div>
        <div className="heading-state"><span className={modelReady && h3Validated ? 'ok' : 'warn'}>{modelReady && h3Validated ? <Check size={15} /> : <AlertCircle size={15} />}{!modelReady ? 'Check model paths' : h3Validated ? 'Validated H3 stack' : 'Custom H3 stack'}</span></div>
      </div>

      <nav className="workspace-stage-nav" aria-label="Create workspace sections">
        <span>WORKFLOW</span>
        <button type="button" onClick={() => document.getElementById('workspace-direction')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><WandSparkles size={14} />Direction</button>
        {mode !== 'text' && <button type="button" onClick={() => document.getElementById('workspace-sources')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><ImageIcon size={14} />Sources</button>}
        <button type="button" onClick={() => document.getElementById('workspace-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Gauge size={14} />Render settings</button>
        <button type="button" onClick={() => document.getElementById('workspace-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Film size={14} />Preview</button>
      </nav>

      <div className="workspace-grid">
        <section className="composer-panel">
          <div className="mode-tabs" role="tablist" aria-label="Generation mode">
            {modeInfo.map((item) => <button key={item.id} role="tab" aria-selected={mode === item.id} className={mode === item.id ? 'selected' : ''} onClick={() => setMode(item.id)}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.note}</small></span></button>)}
          </div>

          <section id="workspace-direction" className={`create-section create-direction-section ${mode === 'reference' ? 'reference-prompt-builder' : ''}`}>
            <div className="create-section-heading"><span><WandSparkles size={15} /></span><div><strong>{mode === 'reference' ? 'Prompt Builder' : 'Shot direction'}</strong><small>{mode === 'reference' ? 'Compose the scene while reference assignments and safeguards stay synchronized.' : 'Describe the subject, action, camera, lighting, and sound.'}</small></div><em className={prompt.trim() ? 'complete' : ''}>{prompt.trim() ? 'Ready' : 'Required'}</em></div>
          <div className="field-group prompt-field">
            {mode === 'reference' && <>
              <AutomaticReferenceSummary bindings={activeSelectedBindings} onReview={() => setAutomaticPromptOpen(true)} onCopy={() => void copyComposedPrompt()} copyState={copyState} />
              <ReferenceMediaStrip files={builderReferenceImages} bindings={activeSelectedBindings} videoCount={referenceVideos.length} audioCount={referenceAudios.length} onManage={() => void refreshSourceMedia().then(() => setSourceMediaOpen(true))} />
              <div className="reference-editor-heading"><span><WandSparkles size={15} /></span><div><strong>Edit your prompt</strong><small>Use <code>//</code> commands to insert characters, wardrobe, locations, camera, action, and more.</small></div></div>
            </>}
            <div className="field-label"><label htmlFor="prompt">{mode === 'reference' ? 'Scene prompt' : 'Prompt'}</label><span>{prompt.length.toLocaleString()} characters</span></div>
            <SmartPromptEditor ref={promptRef} id="prompt" value={prompt} onChange={setPrompt} options={[...smartCharacterOptions, ...smartWardrobeOptions, ...smartLocationOptions]} placeholder={mode === 'reference' ? 'Describe the scene and references. Type // for production presets…' : 'Describe the shot, subject, movement, camera, lighting, and audio…'} />
            <div className="prompt-policy-toggles" aria-label="Prompt safeguards">
              <label className="no-dialogue-toggle" title={`Adds a render instruction that blocks spoken words, narration, singing, lip-sync, captions, and text overlays${mode === 'reference' ? ' in this Reference render' : ''}.`}><input type="checkbox" checked={noDialogue} onChange={(event) => setNoDialogue(event.target.checked)} /><span><strong>{mode === 'reference' ? 'No dialogue · Reference mode' : 'No dialogue'}</strong><small>{noDialogue ? 'Ambient sound only' : 'Dialogue and lip-sync allowed'}</small></span></label>
              <label className="no-dialogue-toggle natural-movement-toggle" title="Adds restrained breathing, blinking, eye movement, and posture adjustment without changing the requested action, pose, camera, identity, wardrobe, or scene."><input type="checkbox" checked={naturalMovement} onChange={(event) => setNaturalMovement(event.target.checked)} /><span><strong>Natural movement</strong><small>{naturalMovement ? 'Subtle subject motion' : 'No added motion direction'}</small></span></label>
            </div>
            {mode === 'reference' && <PromptInspector bindings={activeSelectedBindings} prompt={prompt} duration={duration} videoCount={referenceVideos.length} audioCount={referenceAudios.length} onOptimize={() => onPromptTool('enhance')} optimizing={Boolean(promptingTool)} canOptimize={ollamaAvailable} />}
            {mode === 'reference' && <ReferencePromptHelper pictureCount={builderReferenceImages.length} videoCount={referenceVideos.length} audioCount={referenceAudios.length} referenceInstructions={[...composeReferenceInstructions(activeSelectedBindings), ...detailReferenceDirection]} onInsert={insertPromptText} />}
            <div className="prompt-tools" aria-label="Local AI prompt tools">
              <div className="prompt-tool-buttons">
                <button type="button" onClick={() => onPromptTool('enhance')} disabled={!ollamaAvailable || Boolean(promptingTool)} title="Rewrite the prompt for stronger MiniMax video direction">
                  {promptingTool === 'enhance' ? <LoaderCircle size={14} className="spin" /> : <WandSparkles size={14} />}Enhance
                </button>
                <button type="button" onClick={() => onPromptTool('timeline')} disabled={!ollamaAvailable || Boolean(promptingTool)} title="Add a concise sequence of timed shots">
                  {promptingTool === 'timeline' ? <LoaderCircle size={14} className="spin" /> : <Clock3 size={14} />}Shot timeline
                </button>
                <button type="button" onClick={() => onPromptTool('audio')} disabled={!ollamaAvailable || Boolean(promptingTool)} title="Improve ambience, dialogue, and sound cues">
                  {promptingTool === 'audio' ? <LoaderCircle size={14} className="spin" /> : <Volume2 size={14} />}Audio pass
                </button>
                {mode === 'reference' && <button ref={dialogueTriggerRef} type="button" className="dialogue-tool-button" onClick={() => setDialogueOpen(true)} title="Write performable dialogue for a selected character"><MessageSquareText size={14} />Character dialogue</button>}
              </div>
              <span className={`local-model-chip ${ollamaAvailable ? 'online' : ''}`} title={ollamaAvailable ? `Local ${llmProviderLabel} model: ${ollamaModel}` : `Configure ${llmProviderLabel} in Settings`}>
                <span />{ollamaAvailable ? ollamaModel : `${llmProviderLabel} offline`}
              </span>
            </div>
            {promptSuggestion && (
              <div className="assistant-result" role="status">
                <div className="assistant-result-heading"><span><Sparkles size={14} />Local suggestion</span><small>Review before replacing your prompt</small></div>
                <textarea aria-label={`${llmProviderLabel} prompt suggestion`} value={promptSuggestion} readOnly />
                <div className="assistant-actions"><button type="button" className="secondary-button" onClick={onDismissSuggestion}>Dismiss</button><button type="button" className="primary-button" onClick={onUseSuggestion}><Check size={14} />Use suggestion</button></div>
              </div>
            )}
          </div>
          </section>

          {(mode === 'image' || mode === 'frames' || mode === 'reference') && <section id="workspace-sources" className={`create-section create-input-section ${mode === 'reference' ? 'source-media-section' : ''}`}>
            <div className="create-section-heading"><span><ImageIcon size={15} /></span><div><strong>Source media</strong><small>{mode === 'reference' ? 'Choose reusable identity, motion, and audio references.' : mode === 'frames' ? 'Set the opening and closing composition.' : 'Choose the frame this shot begins from.'}</small></div><em className={(mode === 'reference' ? referenceImages.length + referenceVideos.length + referenceAudios.length > 0 : firstFrame && (mode !== 'frames' || lastFrame)) ? 'complete' : ''}>{mode === 'reference' ? `${referenceImages.length + referenceVideos.length + referenceAudios.length} loaded` : mode === 'frames' ? `${Number(Boolean(firstFrame)) + Number(Boolean(lastFrame))} of 2` : firstFrame ? 'Ready' : 'Required'}</em></div>
          {(mode === 'image' || mode === 'frames') && (
            <div className={`frame-grid ${mode === 'image' ? 'single' : ''}`}>
              <div><MediaDrop label="First frame" note="PNG, JPG or WebP" file={firstFrame} onChoose={() => void chooseMedia('image', (file) => setFirstFrame(file))} onRemove={() => setFirstFrame(null)} />{firstFrame && <ImageCrop label="First frame" file={firstFrame} resolution={resolution} onChange={setFirstFrame} />}</div>
              {mode === 'frames' && <div><MediaDrop label="Last frame" note="Automatically fitted to output size" file={lastFrame} onChoose={() => void chooseMedia('image', (file) => setLastFrame(file))} onRemove={() => setLastFrame(null)} />{lastFrame && <ImageCrop label="Last frame" file={lastFrame} resolution={resolution} onChange={setLastFrame} />}</div>}
            </div>
          )}
          {mode === 'reference' && (
            <div className="source-media-summary">
              <div className="source-media-overview" aria-label="Selected source media summary">
                <SourceMediaStat icon={Users} label="Cast" value={selectedCharacterIds.length ? `${selectedCharacterIds.length} selected` : 'None'} />
                <SourceMediaStat icon={MapPin} label="Locations" value={selectedLocationIds.length ? `${selectedLocationIds.length} selected` : 'None'} />
                <SourceMediaStat icon={ImageIcon} label="Pictures" value={`${referenceImages.length} of 9`} />
                <SourceMediaStat icon={Film} label="Video + audio" value={`${referenceVideos.length} + ${referenceAudios.length}`} />
              </div>
              <div className="source-media-summary-footer">
                <span><strong>{clothingPolicy === 'wardrobe' ? 'Assigned wardrobe' : clothingPolicy === 'underwear' ? 'Underwear' : 'Unrestricted'}</strong><small>{refImageSize === 'max' ? 'Maximum identity' : 'Balanced fidelity'}</small></span>
                <button ref={sourceMediaTriggerRef} type="button" className="primary-button source-media-manage" onClick={() => void refreshSourceMedia().then(() => setSourceMediaOpen(true))}><SlidersHorizontal size={15} />Manage source media</button>
              </div>
            </div>
          )}
          </section>}

          {automaticPromptOpen && mode === 'reference' && <AutomaticReferenceModal bindings={activeSelectedBindings} detailInstructions={detailReferenceDirection} onClose={() => setAutomaticPromptOpen(false)} onManage={() => { setAutomaticPromptOpen(false); void refreshSourceMedia().then(() => setSourceMediaOpen(true)) }} />}

          {sourceMediaOpen && mode === 'reference' && (
            <div className="modal-backdrop source-media-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSourceMedia() }}>
              <section className="source-media-modal" role="dialog" aria-modal="true" aria-labelledby="source-media-modal-title" aria-describedby="source-media-modal-description" onKeyDown={keepSourceMediaFocus}>
                <header>
                  <div><span><ImageIcon size={18} /></span><div><small>REFERENCE WORKSPACE</small><strong id="source-media-modal-title">Source media</strong><p id="source-media-modal-description">Build the cast, locations, look, motion, and sound for this render.</p></div></div>
                  <div className="source-media-header-actions"><em>{sourceMediaCount} loaded</em><button ref={sourceMediaCloseRef} type="button" aria-label="Close source media" onClick={closeSourceMedia}><X size={18} /></button></div>
                </header>
                <div className="source-media-modal-body">
                  <section className="source-media-modal-section"><div className="source-media-section-title"><span>01</span><div><strong>Libraries</strong><small>Select reusable people and environments. Their approved pictures share the 9-picture budget.</small></div></div><div className="reference-groups source-media-library-groups"><CharacterReferencePicker characters={characters} wardrobes={wardrobes} values={selectedCharacterIds} onChange={loadCharacter} /><LocationReferencePicker locations={locations} values={selectedLocationIds} onChange={loadLocation} /></div>{selectedBindings.length > 0 && <details className="source-media-auto-prompt"><summary><Sparkles size={14} /><span><strong>Automatic reference direction</strong><small>{selectedBindings.length} numbered picture assignment{selectedBindings.length === 1 ? '' : 's'} synced to the prompt</small></span><ChevronDown size={14} /></summary><ol>{composeReferenceInstructions(selectedBindings).map((line) => <li key={line}>{line}</li>)}</ol></details>}</section>
                  <section className="source-media-modal-section"><div className="source-media-section-title"><span>02</span><div><strong>Clothing behavior</strong><small>Decide whether assigned wardrobe or identity-photo clothing is authoritative.</small></div></div><div className="reference-groups source-media-policy-groups"><fieldset className="reference-fidelity clothing-policy"><legend><Shirt size={15} /><span><strong>Clothing intent</strong><small>Controls whether identity-photo clothing or assigned wardrobe is authoritative.</small></span></legend><div><label className={clothingPolicy === 'wardrobe' ? 'selected' : ''}><input type="radio" name="clothing-policy" checked={clothingPolicy === 'wardrobe'} onChange={() => setClothingPolicy('wardrobe')} /><span><strong>Assigned wardrobe</strong><small>Wardrobe Studio images exclusively control clothing. Identity-photo clothes are discarded.</small></span></label><label className={clothingPolicy === 'underwear' ? 'selected' : ''}><input type="radio" name="clothing-policy" checked={clothingPolicy === 'underwear'} onChange={() => setClothingPolicy('underwear')} /><span><strong>Underwear</strong><small>Use each adult character's own identity reference without assigned outerwear.</small></span></label><label className={clothingPolicy === 'unrestricted' ? 'selected' : ''}><input type="radio" name="clothing-policy" checked={clothingPolicy === 'unrestricted'} onChange={() => setClothingPolicy('unrestricted')} /><span><strong>Unrestricted</strong><small>Follow explicit adult fictional clothing or nudity direction in the scene prompt.</small></span></label></div></fieldset></div></section>
                  <section className="source-media-modal-section"><div className="source-media-section-title"><span>03</span><div><strong>Files and crops</strong><small>Add standalone pictures, motion references, and audio cues.</small></div></div><div className="reference-groups source-media-file-groups"><ReferenceRow icon={ImageIcon} label="Pictures" limit="Up to 9" kind="image" files={referenceImages} onAdd={() => void chooseReference('image')} onRemove={(index) => removeReference('image', index)} />{referenceImages.length > 0 && <div className="reference-crops">{referenceImages.map((file, i) => <details key={`${file.path}-${i}`}><summary>Picture {i + 1} · crop to output</summary><ImageCrop label={`Picture ${i + 1}`} file={file} resolution={resolution} onChange={(next) => updateReference(i, next)} /></details>)}</div>}<ReferenceRow icon={Film} label="Videos" limit="Up to 3 · trim longer sources to 2–15 seconds" kind="video" files={referenceVideos} onAdd={() => void chooseReference('video')} onEdit={editVideoReference} onRemove={(index) => removeReference('video', index)} /><ReferenceRow icon={Volume2} label="Audio" limit="Up to 3" kind="audio" files={referenceAudios} onAdd={() => void chooseReference('audio')} onRemove={(index) => removeReference('audio', index)} /></div></section>
                </div>
                <footer><span>{sourceMediaCount ? `${sourceMediaCount} file${sourceMediaCount === 1 ? '' : 's'} ready for this render` : 'No standalone files added yet'}</span><button type="button" className="primary-button" onClick={closeSourceMedia}><Check size={15} />Done</button></footer>
              </section>
            </div>
          )}

          {dialogueOpen && mode === 'reference' && <CharacterDialogueModal
            characters={selectedCharacters}
            duration={duration}
            generating={dialogueGenerating}
            ollamaAvailable={ollamaAvailable}
            providerLabel={llmProviderLabel}
            onClose={closeDialogue}
            onGenerate={onGenerateDialogue}
            onInsert={(text) => { setNoDialogue(false); insertPromptText(text); closeDialogue() }}
          />}

        </section>

        <aside id="workspace-preview" className="preview-panel">
          <div className="panel-heading"><div><span>OUTPUT</span><strong>Current workspace</strong></div>{latestJob && <StatusBadge status={latestJob.status} />}</div>
          {latestJob?.mediaType !== 'image' && liveEnabled && livePreview && livePreview.promptId === latestJob?.promptId && latestJob && ['running', 'queued'].includes(latestJob.status) && <figure className={`live-preview ${livePreview.animated ? 'animated' : ''}`}>{livePreview.mime === 'video/mp4' ? <video key={livePreview.url} src={livePreview.url} aria-label="Animated MiniMax H3 generation preview" autoPlay loop muted playsInline /> : <img key={livePreview.url} src={livePreview.url} alt={livePreview.animated ? 'Animated MiniMax H3 generation preview' : 'Live generation preview'} />}<figcaption>{livePreview.animated ? `Animated H3 preview · 50 frames${livePreview.fps ? ` · ${livePreview.fps} fps` : ''}${livePreview.step && livePreview.totalSteps ? ` · sampler step ${livePreview.step} of ${livePreview.totalSteps}` : ''}` : 'Live preview · intermediate frame'}</figcaption></figure>}
          <div className="preview-stage">
            {latestJob?.outputUrl ? latestJob.mediaType === 'image' ? <img className="reference-still-output" src={latestJob.outputUrl} alt="Generated Ref2VA reference still" /> : <VideoPlayer src={latestJob.outputUrl} /> : latestJob && ['queued', 'running'].includes(latestJob.status) ? <div className="render-state constructing"><RenderConstruction /><strong>{latestJob.progressLabel ?? (latestJob.status === 'queued' ? 'Waiting in queue' : latestJob.mediaType === 'image' ? 'Generating one reference still' : 'Rendering locally')}</strong><span>{latestJob.currentStep !== undefined && latestJob.totalSteps ? `Live sampler step ${latestJob.currentStep} of ${latestJob.totalSteps}` : `${latestJob.width} × ${latestJob.height}${latestJob.mediaType === 'image' ? ' · one still' : ` · ${latestJob.duration}s`}`}</span><div className="progress"><i style={{ width: `${latestJob.progress}%` }} /></div><small>{Math.round(latestJob.progress)}% · live ComfyUI status</small></div> : <div className="empty-preview"><div className="preview-icon"><Film size={28} /></div><strong>Your video will appear here</strong><span>Configure a shot, then send it to the local engine.</span></div>}
          </div>
          {latestJob?.mediaType !== 'image' && latestJob?.provider === 'minimax' && latestJob.status === 'completed' && latestJob.outputUrl && <VideoContinuationControls job={latestJob} onContinue={onContinue} />}
          {latestJob?.mediaType === 'image' && latestJob.status === 'completed' && latestJob.outputUrl && <div className="still-result-actions"><a className="secondary-button" href={latestJob.outputUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open image</a><button className="primary-button" onClick={() => onUseStillAsReference(latestJob)}><ImagePlus size={15} />Use as Reference</button></div>}
          <div className="pipeline-summary">
            <PipelineItem ready={Boolean(mode === 'reference' ? selection.ref2va : selection.fl2va)} label="Diffusion" value={mode === 'reference' ? selection.ref2va : selection.fl2va} />
            <PipelineItem ready={Boolean(selection.textEncoder)} label="Encoder" value={selection.textEncoder} />
            <PipelineItem ready={Boolean(selection.videoVae && selection.audioVae)} label="Video + audio VAE" value={selection.videoVae && selection.audioVae ? 'Both detected' : 'Missing component'} />
            <PipelineItem ready={turbo === 'off' || Boolean(mode === 'reference' ? selection.ref2vLora : selection.fl2vLora)} label="Acceleration" value={turbo === 'off' ? 'Native sampling' : (mode === 'reference' ? selection.ref2vLora : selection.fl2vLora)} />
          </div>
          <section id="workspace-output" className="create-section create-output-section preview-output-settings">
            <div className="create-section-heading"><span><Gauge size={15} /></span><div><strong>Output and quality</strong><small>Tune the next render directly beneath its preview.</small></div><em className="complete">{resolution.replace('x', ' × ')} · {duration}s</em></div>
            {mode !== 'reference' && <div className="create-presets" aria-label="Recommended H3 presets"><button type="button" onClick={() => applyCreatePreset('quality')}><strong>Native Quality</strong><small>1344 × 768 · 30 steps</small></button><button type="button" onClick={() => applyCreatePreset('turbo')}><strong>Turbo 8</strong><small>Native canvas · official LoRA</small></button><button type="button" onClick={() => applyCreatePreset('preview')}><strong>Preview</strong><small>864 × 480 · Turbo 8</small></button></div>}
            <RenderSize value={resolution} onChange={setResolution} />
            {mode === 'reference' && <details className="output-reference-fidelity"><summary><Gauge size={16} /><span><small>REFERENCE FIDELITY</small><strong>{refImageSize === 'max' ? 'Maximum identity' : 'Balanced'}</strong><em>{refImageSize === 'max' ? 'Keep more original source detail' : 'Fit references to the output canvas'}</em></span><ChevronDown size={15} /></summary><fieldset><legend>Choose how much source-image detail H3 preserves</legend><label className={refImageSize === 'match' ? 'selected' : ''}><input type="radio" name="output-reference-fidelity" checked={refImageSize === 'match'} onChange={() => setRefImageSize('match')} /><span><strong>Balanced</strong><small>Fit references to the output canvas. Faster and uses less memory.</small></span></label><label className={refImageSize === 'max' ? 'selected' : ''}><input type="radio" name="output-reference-fidelity" checked={refImageSize === 'max'} onChange={() => setRefImageSize('max')} /><span><strong>Maximum identity</strong><small>Keep more original image detail. Slower and uses more memory.</small></span></label></fieldset></details>}
            <div className="render-controls"><div className="field-group"><label htmlFor="duration">Duration</label><div className="range-line"><input id="duration" type="range" min="2" max="15" step="0.5" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /><output>{duration}s</output></div></div><SelectField label="Sampling quality" value={turbo === '4' && mode !== 'reference' ? '8' : turbo} onChange={(value) => { if (mode !== 'reference') applyCreatePreset(value === 'off' ? 'quality' : 'turbo'); else { setTurbo(value as 'off' | '4' | '8'); setSampler('res_multistep'); setScheduler('simple'); setExperimentalSampling(false); setSigmaShiftMode('model'); setShiftVideo(12); setShiftAudio(3); setLoraStrength(1); setUpscaleMode('off'); if (value === 'off' || value === '8') { const [rw, rh] = resolution.split('x').map(Number); setResolution(rw === rh ? '768x768' : rw > rh ? '1344x768' : '768x1344') } if (value === 'off') setSteps(30) } }} options={mode === 'reference' ? [["off", 'Native quality · 30 steps'], ["8", 'Turbo 8 · Ref2VA v1.0 · 768p'], ["4", 'Turbo 4 · Ref2VA v0.1']] : [["off", 'Native quality · 30 steps'], ["8", 'Official Turbo 8']]} /></div>
            {turbo === '8' && <><SelectField label="Turbo 8 profile" value={turbo8Profile} onChange={(value) => setTurbo8Profile(value as Turbo8Profile)} options={[["stable", 'Stable · Euler + Simple · faces/dialogue'], ["balanced", 'Balanced · res_multistep + Simple'], ["motion", 'Motion · res_multistep + Beta']]}/><NumberField label="Turbo 8 steps" value={steps} min={4} max={12} onChange={setSteps} /><p className="field-help">8 is the trained default. Use 9–10 steps when you want to test for a small coherence or detail gain; values are capped at 12 to keep the Turbo recipe practical.</p></>}
            {ref2vaTurbo8TrainingShifts && <p className="field-help"><strong>Ref2VA Turbo 8 training recipe active:</strong> 6 video / 3 audio shifts are applied automatically for this official 768p v1.0 LoRA. The adapter requirement overrides both native and custom shift fields.</p>}
            <section className="user-lora-slots" aria-labelledby="user-lora-title"><div><span><strong id="user-lora-title">Additional ComfyUI LoRAs</strong><small>Apply up to two adapters from your configured LoRAs folder.</small></span><em>{userLoras.filter((slot) => slot.name).length}/2 selected</em></div>{userLoras.map((slot, index) => <div className="user-lora-slot" key={index}><label>LoRA {index + 1}<select value={slot.name} disabled={!userLoraChoices.length} onChange={(event) => setUserLoraSlot(index, { name: event.target.value })}><option value="">No additional LoRA</option>{userLoraChoices.filter((name) => name === slot.name || !userLoras.some((other, otherIndex) => otherIndex !== index && other.name === name)).map((name) => <option key={name} value={name}>{name}</option>)}</select></label><NumberField label="Strength" value={slot.strength} min={0} max={2} step={0.05} disabled={!slot.name} onChange={(strength) => setUserLoraSlot(index, { strength })} /></div>)}<p className="field-help">Official H3 Turbo LoRAs stay automatic and do not consume these slots. Additional adapters are loaded after Turbo; use short fixed-seed tests because unsupported model adapters can reduce stability.</p>{!userLoraChoices.length && <p className="field-help">No extra LoRAs were found. Add compatible files to the configured ComfyUI LoRAs folder, then rescan in Settings.</p>}</section>
            <div className="render-extras"><label><input type="checkbox" checked={liveEnabled} onChange={(event) => setLiveEnabled(event.target.checked)} />Live preview <small>{liveEnabled ? liveConnected ? 'Connected · waiting for preview frames' : 'Connecting to ComfyUI…' : 'Off'}</small></label><label className="live-preview-mode"><span>Preview source</span><select value={livePreviewMode} disabled={!liveEnabled} onChange={(event) => setLivePreviewMode(event.target.value as 'standard' | 'h3-override')}><option value="standard">Standard first frame</option><option value="h3-override">MiniMax H3 animated · 50 frames at 12 fps</option></select></label><p className={`field-help ${livePreviewMode === 'h3-override' && !h3PreviewOverrideAvailable ? 'upscale-warning' : ''}`}>{livePreviewMode === 'h3-override' && h3PreviewOverrideAvailable ? 'The installed MiniMax H3 Preview Override node is wired between the model and sampler and streams a 50-frame, 12 fps animated preview.' : livePreviewMode === 'h3-override' ? 'Animated preview is selected, but the required Preview Override node is not detected. Install or enable it, restart ComfyUI, then click the Local engine status to refresh before generating.' : h3PreviewOverrideAvailable ? 'MiniMax H3 Preview Override is installed. Select the animated option to preview motion while sampling.' : 'You can select animated preview now. Generation will wait until the MiniMax H3 Preview Override custom node is installed and detected.'}</p><div className="upscale-options" role="group" aria-labelledby="upscale-label"><span id="upscale-label">Post-render upscale</span><label><input type="radio" name="upscale" checked={upscaleMode === 'off'} onChange={() => setUpscaleMode('off')} />Off</label><label><input type="radio" name="upscale" checked={upscaleMode === 'ltx'} disabled={!ltxAvailable} onChange={() => setUpscaleMode('ltx')} />LTX 2.5 latent · 2×</label><label><input type="radio" name="upscale" checked={upscaleMode === 'rtx'} disabled={rtxModels.length === 0} onChange={() => setUpscaleMode('rtx')} />RTX / CUDA frames · 2× · experimental</label></div>{upscaleMode === 'rtx' && <SelectField label="AI upscale model" value={rtxModel} onChange={setRtxModel} options={rtxModels.map((name) => [name, name])} />}<p className={`field-help ${upscaleMode === 'rtx' ? 'upscale-warning' : ''}`}>{upscaleMode === 'ltx' ? `Verified latent pipeline: MiniMax frames are encoded with the LTX‑2.5 video VAE, spatially upsampled exactly 2× in latent space, decoded, trimmed to the original duration, and joined to the untouched MiniMax audio. Final size: ${resolution.split('x').map((value) => Number(value) * 2).join(' × ')}.` : upscaleMode === 'rtx' ? `Experimental frame-by-frame upscale using ${rtxModel || 'the selected model'}. It does not understand motion and can amplify noise, flicker, or temporal shimmer. Diagnose output quality with upscale Off first.` : !ltxAvailable && ltxMissingNodes.length ? `LTX 2× is unavailable until ComfyUI provides: ${ltxMissingNodes.join(', ')}.` : !ltxAvailable && rtxModels.length === 0 ? 'No compatible upscale models were reported by ComfyUI.' : 'The original MiniMax video is saved without post-processing.'}</p></div>
            <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><SlidersHorizontal size={16} />Advanced controls<ChevronDown size={15} className={advanced ? 'rotated' : ''} /></button>
            {advanced && <div className="advanced-grid"><SelectField label="Text encoder" value={textEncoderPreference} onChange={(value) => setTextEncoderPreference(value as 'fast' | 'quality')} options={[["fast", 'Fast · NVFP4-AWQ · 15.7 GB'], ["quality", 'Slower · better encoding · INT8 ConvRot · 27.1 GB']]} /><p className="field-help">The slower quality option requires <strong>qwen3vl_32b_minimax_h3_int8_convrot.safetensors</strong> in Text encoders. It is never selected unless you choose it.</p><NumberField label="Full-quality steps" value={steps} min={16} max={30} onChange={setSteps} disabled={turbo !== 'off'} /><NumberField label="Seed" value={seed} min={0} max={999999999999} onChange={setSeed} /><NumberField label="LoRA strength" value={loraStrength} min={0} max={2} step={0.05} onChange={setLoraStrength} disabled={turbo === 'off'} /><label className="sampling-opt-in"><input type="checkbox" checked={experimentalSampling} onChange={(event) => setExperimentalSampling(event.target.checked)} />Use custom sampler and scheduler</label><SelectField label="Experimental Turbo override" value={turbo} onChange={(value) => setTurbo(value as 'off' | '4' | '8')} options={[["off", 'Off · native quality'], ["8", 'Official 8-step'], ["4", '4-step · preview testing']]} /><SelectField label="Sampler" value={experimentalSampling ? sampler : turbo === '8' && turbo8Profile === 'stable' ? 'euler' : 'res_multistep'} onChange={setSampler} disabled={!experimentalSampling} options={[...new Set([sampler, 'euler', 'res_multistep', ...choices(info, 'KSamplerSelect', 'sampler_name')])].map((value) => [value, value])} /><SelectField label="Scheduler" value={experimentalSampling ? scheduler : turbo === '8' && turbo8Profile === 'motion' ? 'beta' : 'simple'} onChange={setScheduler} disabled={!experimentalSampling} options={[...new Set([scheduler, 'simple', 'beta', ...choices(info, 'BasicScheduler', 'scheduler')])].map((value) => [value, value])} /><SelectField label="Sigma shifts" value={sigmaShiftMode} onChange={(value) => setSigmaShiftMode(value as 'model' | 'custom')} options={[["model", ref2vaTurbo8TrainingShifts ? 'Ref2VA Turbo 8 recipe · video 6 / audio 3' : 'Model defaults · video 12 / audio 3'], ["custom", 'Custom official sigma-shift node']]} /><NumberField label="Video sigma shift" value={ref2vaTurbo8TrainingShifts ? 6 : shiftVideo} min={0.01} max={100} step={0.01} onChange={setShiftVideo} disabled={sigmaShiftMode !== 'custom' || ref2vaTurbo8TrainingShifts} /><NumberField label="Audio sigma shift" value={ref2vaTurbo8TrainingShifts ? 3 : shiftAudio} min={0.01} max={100} step={0.01} onChange={setShiftAudio} disabled={sigmaShiftMode !== 'custom' || ref2vaTurbo8TrainingShifts} /><p className="field-help">Turbo 8 profiles execute as shown: Stable uses Euler + Simple for faces and dialogue; Balanced uses res_multistep + Simple; Motion uses res_multistep + Beta. Full quality retains <strong>res_multistep + simple</strong>, CFG 1, denoise 1, and native shifts. Other sampler combinations remain experimental and should be compared at a fixed seed.</p></div>}
            <p className="field-help render-duration">{frameCount(duration)} frames · {(frameCount(duration) / 24).toFixed(2)}s actual duration at 24 fps. Rounded up to MiniMax’s frame grid.</p>
          </section>
          <div className="generate-bar preview-generate-bar"><div className="generation-summary"><Gauge size={17} /><span><strong>{resolution.replace('x', ' × ')}</strong><small>{duration}s · 24 fps · {turbo === 'off' ? `${steps} steps` : `${turbo}-step turbo`}</small></span></div><div className="generate-actions">{latestJob && ['queued', 'running'].includes(latestJob.status) && <button className="danger-button" onClick={() => onCancel(latestJob)} disabled={cancelling}><CircleStop size={16} />{cancelling ? 'Stopping…' : latestJob.mediaType === 'image' ? 'Cancel image' : 'Cancel generation'}</button>}<button className="primary-button generation-button" onClick={onGenerate} disabled={submitting || !connected || !modelReady}>{submitting ? <LoaderCircle size={18} className="spin" /> : <Play size={18} fill="currentColor" />}{submitting ? 'Submitting…' : 'Generate video'}</button>{mode === 'reference' && <button className="secondary-button generation-image-button" onClick={onGenerateImage} disabled={stillSubmitting || !connected || !modelReady}>{stillSubmitting ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}{stillSubmitting ? 'Generating image…' : 'Generate image'}</button>}</div></div>
        </aside>
      </div>
    </div>
  )
}

function SourceMediaStat({ icon: Icon, label, value }: { icon: typeof Film; label: string; value: string }) {
  return <span className="source-media-stat"><Icon size={15} /><span><small>{label}</small><strong>{value}</strong></span></span>
}

function referenceBindingLabel(binding: MovieReferenceBinding, index: number) {
  const title = binding.label.replace(/^(Character|Wardrobe|Hair|Accessory|Location):\s*/i, '').replace(/\s*\/\s*(identity|wardrobe|hair|accessory|location).*$/i, '')
  const type = binding.purpose === 'wardrobe' ? 'Outfit' : binding.purpose === 'hair' ? 'Hair' : binding.purpose === 'location' ? 'Location' : binding.purpose === 'accessory' ? 'Accessory' : binding.purpose === 'detail' ? 'Detail' : 'Identity'
  return { title: title || `Picture ${index + 1}`, type }
}

function PromptInspector({ bindings, prompt, duration, videoCount, audioCount, onOptimize, optimizing, canOptimize }: { bindings: MovieReferenceBinding[]; prompt: string; duration: number; videoCount: number; audioCount: number; onOptimize(): void; optimizing: boolean; canOptimize: boolean }) {
  const text = prompt.toLowerCase()
  const characterGroups = new Map<string, MovieReferenceBinding[]>()
  bindings.filter((binding) => binding.characterId).forEach((binding) => characterGroups.set(binding.characterId!, [...(characterGroups.get(binding.characterId!) ?? []), binding]))
  const locationGroups = new Map<string, MovieReferenceBinding[]>()
  bindings.filter((binding) => binding.purpose === 'location').forEach((binding) => locationGroups.set(binding.locationId ?? binding.label, [...(locationGroups.get(binding.locationId ?? binding.label) ?? []), binding]))
  const has = (pattern: RegExp) => pattern.test(text)
  const checks: Array<[string, boolean]> = [
    ['Camera', has(/\b(camera|shot|push(?:es)? in|pull(?:s)? back|pan(?:s)?|tilt(?:s)?|track(?:s|ing)?|dolly|orbit|static)\b/)],
    ['Action', has(/\b(walk(?:s|ing)?|turn(?:s|ing)?|look(?:s|ing)?|sit(?:s|ting)?|stand(?:s|ing)?|reach(?:es|ing)?|hold(?:s|ing)?|open(?:s|ing)?|smile(?:s|ing)?|move(?:s|ment|ing)?|breath(?:es|ing)?)\b/)],
    ['Lighting', has(/\b(light|lighting|sun|window|neon|shadow|overcast|golden hour|daylight|night)\b/)],
    ['Dialogue', has(/<d>|\b(dialogue|says|whispers|shouts|asks|replies)\b|["“][^"”]+["”]/)],
    ['Audio', has(/\b(sound|audio|ambience|ambient|music|score|footstep|wind|rain|room tone|silent)\b/) || audioCount > 0 || videoCount > 0],
  ]
  const actionCount = (text.match(/\b(walk(?:s|ing)?|turn(?:s|ing)?|look(?:s|ing)?|sit(?:s|ting)?|stand(?:s|ing)?|reach(?:es|ing)?|hold(?:s|ing)?|open(?:s|ing)?|close(?:s|ing)?|smile(?:s|ing)?|run(?:s|ning)?|embrace(?:s|ing)?|pick(?:s|ing)?|place(?:s|ing)?)\b/g) ?? []).length
  const warnings = [
    bindings.length >= 8 && `${bindings.length} of 9 picture slots are allocated. Add a source only if it is more important than an existing view.`,
    actionCount > Math.max(3, Math.ceil(duration / 1.5)) && `${actionCount} major actions are described for ${duration} seconds. Simplifying the action path will improve temporal coherence.`,
    !checks.find(([label]) => label === 'Camera')?.[1] && 'No camera direction detected. H3 can infer one, but a deliberate camera choice is more controllable.',
    !checks.find(([label]) => label === 'Audio')?.[1] && 'No sound direction detected. Add ambience or choose “No dialogue” for a more deterministic audio pass.',
  ].filter(Boolean) as string[]
  return <aside className="prompt-inspector" aria-labelledby="prompt-inspector-title">
    <header><span><Gauge size={15} /><span><strong id="prompt-inspector-title">Prompt inspector</strong><small>Live production checks · automatic context is protected</small></span></span><em>{bindings.length} / 9 refs</em></header>
    <div className="prompt-inspector-grid">
      <section><span className="prompt-inspector-label">Characters</span>{characterGroups.size ? [...characterGroups.values()].map((group) => { const name = group.find((binding) => binding.purpose === 'character' || binding.purpose === 'character-angle')?.label.replace(/^Character:\s*/, '').split(' / ')[0] ?? group[0].label.split(' for ').at(-1); const roles = new Set(group.map((binding) => binding.purpose)); return <p key={group[0].characterId}><Check size={12} /><span><strong>{name}</strong><small>{group.length} assigned · {[...roles].map((role) => role === 'character-angle' ? 'identity' : role).join(', ')}</small></span></p> }) : <p className="empty"><AlertCircle size={12} /><span>No linked character</span></p>}</section>
      <section><span className="prompt-inspector-label">Location</span>{locationGroups.size ? [...locationGroups.values()].map((group) => <p key={group[0].locationId ?? group[0].label}><Check size={12} /><span><strong>{group[0].label.replace(/^Location:\s*/, '')}</strong><small>{group.length} approved view{group.length === 1 ? '' : 's'}</small></span></p>) : <p className="empty"><AlertCircle size={12} /><span>No linked location</span></p>}</section>
      <section><span className="prompt-inspector-label">Creative direction</span><div className="prompt-inspector-checks">{checks.map(([label, complete]) => <span className={complete ? 'complete' : 'missing'} key={label}>{complete ? <Check size={11} /> : <AlertCircle size={11} />}{label}</span>)}</div></section>
    </div>
    {warnings.length > 0 && <div className="prompt-inspector-warnings"><span><AlertCircle size={13} />Warnings</span>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    <footer><span>{videoCount ? `${videoCount} motion reference${videoCount === 1 ? '' : 's'}` : 'No motion reference'} · {audioCount ? `${audioCount} audio reference${audioCount === 1 ? '' : 's'}` : 'no audio reference'}</span><button type="button" className="secondary-button" onClick={onOptimize} disabled={!canOptimize || optimizing || !prompt.trim()}>{optimizing ? <LoaderCircle className="spin" size={13} /> : <WandSparkles size={13} />}Optimize</button></footer>
  </aside>
}

function AutomaticReferenceSummary({ bindings, onReview, onCopy, copyState }: { bindings: MovieReferenceBinding[]; onReview(): void; onCopy(): void; copyState: 'idle' | 'copied' | 'failed' }) {
  return <section className="automatic-reference-summary" aria-labelledby="automatic-reference-title">
    <header><span><Sparkles size={15} /><span><strong id="automatic-reference-title">Automatic references <em>Locked</em></strong><small>Generated from approved source assignments</small></span></span><span className="automatic-reference-actions"><button type="button" className="secondary-button" onClick={onReview}><LockKeyhole size={14} />Review & edit</button><button type="button" className="secondary-button" onClick={onCopy} aria-label="Copy full render prompt"><Copy size={14} />{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy full prompt'}</button></span></header>
    <button type="button" className="automatic-reference-body" onClick={onReview} aria-describedby="automatic-reference-note">
      {bindings.length ? <div className="automatic-reference-chips">{bindings.map((binding, index) => { const label = referenceBindingLabel(binding, index); return <span key={`${binding.file.path}-${index}`} className={`reference-role-chip ${binding.purpose}`}><b>{index + 1}</b><span><strong>{label.title}</strong><small>{label.type}</small></span></span> })}</div> : <span className="automatic-reference-empty">No source assignments yet. Add approved references to lock their identity, wardrobe, and location instructions.</span>}
      <span className="automatic-reference-note" id="automatic-reference-note">{bindings.length ? `${bindings.length} protected assignment${bindings.length === 1 ? '' : 's'} · click to review the generated instructions` : 'Click to open the reference workspace'}</span>
    </button>
  </section>
}

function AutomaticReferenceModal({ bindings, detailInstructions, onClose, onManage }: { bindings: MovieReferenceBinding[]; detailInstructions: string[]; onClose(): void; onManage(): void }) {
  const instructions = [...composeReferenceInstructions(bindings), ...detailInstructions]
  return <div className="modal-backdrop automatic-reference-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="automatic-reference-modal" role="dialog" aria-modal="true" aria-labelledby="automatic-reference-modal-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header><span><LockKeyhole size={18} /><span><strong id="automatic-reference-modal-title">Reference instructions</strong><small>These are generated from your approved source assignments and are protected from accidental edits in the scene prompt.</small></span></span><button className="icon-button" autoFocus onClick={onClose} aria-label="Close reference instructions"><X size={18} /></button></header>
      <div className="automatic-reference-modal-body">{instructions.length ? instructions.map((instruction, index) => <article key={`${instruction}-${index}`}><span>{index + 1}</span><p>{instruction}</p></article>) : <div className="automatic-reference-modal-empty"><ImageIcon size={24} /><strong>No reference instructions yet</strong><span>Add a character, wardrobe, location, or standalone reference to build this protected section.</span></div>}</div>
      <footer><span><LockKeyhole size={14} />Edit the source assignments—not the generated prompt—to keep picture tags and render inputs synchronized.</span><div><button className="secondary-button" onClick={onClose}>Done</button><button className="primary-button" onClick={onManage}><SlidersHorizontal size={14} />Manage sources</button></div></footer>
    </section>
  </div>
}

function ReferenceMediaStrip({ files, bindings, videoCount, audioCount, onManage }: { files: MediaFile[]; bindings: MovieReferenceBinding[]; videoCount: number; audioCount: number; onManage(): void }) {
  const labelFor = (file: MediaFile, index: number) => {
    const binding = bindings.find((item) => item.file.path === file.path)
    if (!binding) return { title: file.name, type: 'Picture' }
    return referenceBindingLabel(binding, index)
  }
  return <section className="reference-media-strip" aria-labelledby="reference-media-title">
    <header><span><ImageIcon size={15} /><strong id="reference-media-title">Reference images <em>{files.length}</em></strong></span><small>{videoCount ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : ''}{videoCount && audioCount ? ' · ' : ''}{audioCount ? `${audioCount} audio` : ''}</small></header>
    <div>{files.map((file, index) => { const label = labelFor(file, index); return <figure key={`${file.path}-${index}`}>{file.preview ? <img src={file.preview} alt="" /> : <span><ImageIcon size={22} /></span>}<figcaption><b>{index + 1}</b><span><strong title={label.title}>{label.title}</strong><small>{label.type}</small></span></figcaption></figure> })}<button type="button" className="reference-add-card" onClick={onManage}><Plus size={22} /><span>{files.length ? 'Manage references' : 'Add references'}</span></button></div>
  </section>
}

function VideoPlayer({ src, onDuration }: { src: string; onDuration?(duration: number): void }) {
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => setFailure(''), [src])

  if (failure) {
    return <div className="playback-error" role="alert"><AlertCircle size={25} /><strong>Video could not be decoded</strong><span>{failure}</span><button className="secondary-button" onClick={() => { setFailure(''); setAttempt((value) => value + 1) }}><RefreshCw size={15} />Retry playback</button></div>
  }

  return <video key={`${src}-${attempt}`} src={src} controls autoPlay loop playsInline preload="auto" onLoadedMetadata={(event) => onDuration?.(event.currentTarget.duration)} onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)} onError={(event) => { const mediaError = event.currentTarget.error; setFailure(mediaError?.message || `Electron media error ${mediaError?.code ?? 'unknown'}`) }} />
}

function VideoContinuationControls({ job, onContinue }: { job: GenerationJob; onContinue(job: GenerationJob): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const run = async () => { setBusy(true); try { await onContinue(job) } finally { setBusy(false) } }
  return <section className="video-continuation" aria-labelledby="video-continuation-title"><div><span><strong id="video-continuation-title">Continue exactly</strong><small>Locks this render’s final frame into the next I2V shot and retains its source canvas and sampling configuration. No manual frame selection or duplicate source render.</small></span><button className="primary-button" disabled={busy} onClick={() => void run()}>{busy ? <LoaderCircle className="spin" size={14} /> : <SkipForward size={14} />}Prepare continuation</button></div></section>
}

function MediaDrop({ label, note, file, onChoose, onRemove }: { label: string; note: string; file: MediaFile | null; onChoose(): void; onRemove(): void }) {
  return <div className={`media-drop ${file ? 'has-file' : ''}`}>{file?.preview ? <img src={file.preview} alt="" /> : null}<div className="media-drop-content"><span className="upload-icon"><Upload size={19} /></span><strong>{file?.name ?? label}</strong><small>{file ? 'Ready to use' : note}</small><button onClick={onChoose}>{file ? 'Replace' : 'Choose image'}</button></div>{file && <button className="remove-media" onClick={onRemove} aria-label={`Remove ${label}`}><X size={15} /></button>}</div>
}

function ReferenceRow({ icon: Icon, label, limit, kind, files, onAdd, onEdit, onRemove }: { icon: typeof Film; label: string; limit: string; kind: MediaKind; files: MediaFile[]; onAdd(): void; onEdit?(index: number): void; onRemove(index: number): void }) {
  return <div className="reference-row"><div className="reference-title"><span><Icon size={17} /></span><div><strong>{label}</strong><small>{limit}</small></div></div><div className="reference-files">{files.map((file, index) => <div className="file-pill" key={`${file.path}-${index}`}>{file.preview && kind === 'image' ? <img src={file.preview} alt="" /> : <Icon size={15} />}<span><strong>{kind === 'image' ? `Picture ${index + 1}` : kind === 'video' ? `Video ${index + 1}` : `Audio ${index + 1}`}</strong><small>{file.clip ? `${(file.clip.end - file.clip.start).toFixed(1)}s · ${file.name}` : file.name}</small></span>{onEdit && <button onClick={() => onEdit(index)} aria-label={`Edit clip ${file.name}`} title="Change reference clip"><Scissors size={13} /></button>}<button onClick={() => onRemove(index)} aria-label={`Remove ${file.name}`}><X size={14} /></button></div>)}<button className="add-reference" onClick={onAdd} disabled={files.length >= (kind === 'image' ? 9 : 3)}><Plus size={16} />Add {kind}</button></div></div>
}

function CharacterReferencePicker({ characters, wardrobes, values, onChange }: { characters: CharacterProject[]; wardrobes: WardrobeProject[]; values: string[]; onChange(value: string): void }) {
  return <fieldset className="character-reference-picker multi-character-picker"><legend>Characters in this render</legend><div><span><Users size={17} /></span><span><strong>Character library</strong><small>Select several people. Their identity, assigned hair, wardrobe, and accessories are imported together within the 9-picture limit.</small></span></div><div className="character-reference-choices">{characters.map((character) => { const references = characterReferences(character); const selected = values.includes(character.id); const wardrobe = wardrobes.find((item) => item.id === character.wardrobeIds[0]); const wardrobeCount = wardrobe ? wardrobeReferences(wardrobe).length : 0; const hair = loadHairStyleProjects().find((item) => item.id === character.hairStyleIds[0]); return <label className={selected ? 'selected' : ''} key={character.id}><input type="checkbox" checked={selected} disabled={!references.length} onChange={() => onChange(character.id)} />{references[0]?.preview ? <img className="reference-choice-thumbnail" src={references[0].preview} alt="" /> : <span className="reference-choice-placeholder"><Users size={18} /></span>}<span><strong>{character.name}</strong><small>{references.length ? `${references.length} identity image${references.length === 1 ? '' : 's'}` : 'No approved identity images'}</small><em>{hair?.referenceImage ? `Hair · ${hair.name}` : character.hairStyleIds.length ? 'Hair needs an approved image' : 'No assigned hair'} · {wardrobeCount ? `Wardrobe · ${wardrobe?.name}` : character.wardrobeIds.length ? 'Wardrobe needs an approved image' : 'No assigned wardrobe'}</em></span>{wardrobeCount > 0 && wardrobeReferences(wardrobe!)[0]?.preview && <img className="reference-choice-asset" src={wardrobeReferences(wardrobe!)[0].preview} alt={`${wardrobe!.name} assigned wardrobe`} />}</label> })}</div>{values.length > 0 && <button type="button" className="secondary-button" onClick={() => onChange('')}>Clear cast</button>}</fieldset>
}

function LocationReferencePicker({ locations, values, onChange }: { locations: LocationProject[]; values: string[]; onChange(value: string): void }) {
  if (!locations.length) return null
  return <fieldset className="character-reference-picker multi-character-picker location-reference-picker"><legend>Locations in this render</legend><div><span><MapPin size={17} /></span><span><strong>Location library</strong><small>Add environments alongside the cast. All selected assets share the 9-picture limit.</small></span></div><div className="character-reference-choices">{locations.map((location) => { const references = locationReferences(location); const selected = values.includes(location.id); return <label className={selected ? 'selected' : ''} key={location.id}><input type="checkbox" checked={selected} disabled={!references.length} onChange={() => onChange(location.id)} />{references[0]?.preview ? <img className="reference-choice-thumbnail location" src={references[0].preview} alt="" /> : <span className="reference-choice-placeholder"><MapPin size={18} /></span>}<span><strong>{location.name}</strong><small>{references.length ? `${location.environmentMode === 'nature' ? 'Nature only · ' : ''}${references.length} approved view${references.length === 1 ? '' : 's'}` : 'No approved location views'}</small></span></label> })}</div>{values.length > 0 && <button type="button" className="secondary-button" onClick={() => onChange('')}>Clear locations</button>}</fieldset>
}

function ReferencePromptHelper({ pictureCount, videoCount, audioCount, referenceInstructions, onInsert }: { pictureCount: number; videoCount: number; audioCount: number; referenceInstructions: string[]; onInsert(value: string): void }) {
  const pictureTags = Array.from({ length: pictureCount }, (_, index) => `<Picture ${index + 1}>`)
  const identityText = referenceInstructions.join(' ')
  const directionSections = [
    ['Scene', 'Scene: '],
    ['Action', 'Action: '],
    ['Camera', 'Camera: '],
    ['Lighting', 'Lighting: '],
    ['Sound', 'Sound: '],
    ['Continuity', 'Continuity: '],
  ] as const
  const starter = [
    identityText,
    'Scene: ',
    'Action: ',
    'Camera: ',
    'Lighting: ',
    'Sound: ',
    referenceInstructions.length ? 'Continuity: Keep each named person distinct. Never exchange faces, bodies, garments, colors, or accessories between characters.' : '',
  ].filter(Boolean).join('\n')
  return <div className="reference-prompt-helper" aria-label="Reference prompt helpers"><div><strong>Quick-build prompt</strong><small>Insert media tags or production sections at the cursor.</small></div><div className="reference-tag-actions">{pictureTags.map((tag) => <button type="button" key={tag} onClick={() => onInsert(tag)}>{tag}</button>)}{Array.from({ length: videoCount }, (_, index) => <button type="button" key={`video-${index}`} onClick={() => onInsert(`<Video ${index + 1}>`)}>{`<Video ${index + 1}>`}</button>)}{Array.from({ length: audioCount }, (_, index) => <button type="button" key={`audio-${index}`} onClick={() => onInsert(`<Audio ${index + 1}>`)}>{`<Audio ${index + 1}>`}</button>)}{identityText && <button className="reference-identity-insert" type="button" onClick={() => onInsert(identityText)}>Cast + wardrobe rules</button>}</div><div className="reference-tag-actions reference-direction-actions">{directionSections.map(([label, value]) => <button type="button" key={label} onClick={() => onInsert(value)}>{label}</button>)}<button className="reference-template-insert" type="button" onClick={() => onInsert(starter)}>Insert full template</button></div>{pictureTags.length === 0 && videoCount === 0 && audioCount === 0 && <small className="reference-tag-empty">Load a picture, video, or audio reference to create matching tags.</small>}</div>
}

function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[][]; onChange(value: string): void; disabled?: boolean }) {
  const id = useId()
  return <div className="field-group"><label htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, text]) => <option value={optionValue} key={optionValue}>{text}</option>)}</select><ChevronDown size={15} /></div></div>
}

function NumberField({ label, value, min, max, step, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange(value: number): void; disabled?: boolean }) {
  return <div className="field-group"><label>{label}</label><input className="number-input" type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /></div>
}

function PipelineItem({ ready, label, value }: { ready: boolean; label: string; value: string }) {
  return <div className="pipeline-item"><span className={ready ? 'ready' : ''}>{ready ? <Check size={13} /> : <AlertCircle size={13} />}</span><div><strong>{label}</strong><small title={value}>{value || 'Not detected'}</small></div></div>
}

function StatusBadge({ status }: { status: GenerationJob['status'] }) {
  return <span className={`status-badge ${status}`}>{status === 'running' && <LoaderCircle size={12} className="spin" />}{status}</span>
}

function LibraryView({ jobs, settings, onEdit, onUseLtx, onNotice }: { jobs: GenerationJob[]; settings: AppSettings; onEdit(): void; onUseLtx(file: MediaFile): void; onNotice(tone: 'error' | 'success' | 'neutral', text: string): void }) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<'all' | 'minimax' | 'ltx25'>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [bookmarkVideo, setBookmarkVideo] = useState<BookmarkVideo | null>(null)
  const available = jobs.filter((job) => job.mediaType !== 'audio' && Boolean(job.outputUrl))
  const filtered = available.filter((job) => (provider === 'all' || (job.provider ?? 'minimax') === provider) && (!query.trim() || job.prompt.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt)
  const videos: BookmarkVideo[] = available.map((job) => ({ id: `job-${job.id}`, name: shortPrompt(job.prompt), source: job.outputUrl!, duration: job.duration, provider: job.provider === 'ltx25' ? 'ltx25' : 'minimax' }))
  return <div className="standard-page library-page"><div className="page-heading"><div><p className="eyebrow">LOCAL LIBRARY</p><h1>Video library</h1><p>Review renders, collect reusable frames, or assemble clips without changing the originals.</p></div><button className="primary-button" onClick={onEdit}><Scissors size={16} />Open clip editor</button></div>
    <div className="library-toolbar"><label><span>Search renders</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts…" /></label><label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="all">All providers</option><option value="minimax">MiniMax H3</option><option value="ltx25">LTX 2.5</option></select></label><label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label><div><strong>{filtered.length}</strong><span>of {available.length} videos</span></div></div>
    {available.length === 0 ? <div className="empty-page"><History size={28} /><strong>Completed generations will appear here.</strong><span>New work is saved automatically on this device.</span></div> : filtered.length === 0 ? <div className="empty-page compact"><Film size={25} /><strong>No results match these filters.</strong><button className="secondary-button" onClick={() => { setQuery(''); setProvider('all') }}>Clear filters</button></div> : <div className="library-grid">{filtered.map((job) => { const image = job.mediaType === 'image'; const video = videos.find((item) => item.id === `job-${job.id}`); return <article className="library-card" key={job.id}>{image ? <img src={job.outputUrl} alt="Generated Ref2VA reference still" /> : <video src={job.outputUrl} controls preload="metadata" />}<div><div className="library-card-meta"><span className={`library-provider ${job.provider === 'ltx25' ? 'ltx' : ''}`}>{image ? 'Ref2VA still' : job.provider === 'ltx25' ? 'LTX 2.5' : 'MiniMax H3'}</span><time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleDateString()}</time></div><strong title={job.prompt}>{shortPrompt(job.prompt)}</strong><small>{job.width} × {job.height} · {image ? 'one image' : `${job.duration}s · ${job.mode}`}</small><div className="library-card-actions">{!image && video && <button className="primary-button" onClick={() => setBookmarkVideo(video)}><Bookmark size={15} />Frame bookmarks</button>}<a className="secondary-button" href={job.outputUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open</a></div></div></article> })}</div>}
    {bookmarkVideo && <FrameBookmarkStudio key={bookmarkVideo.id} initialVideo={bookmarkVideo} videos={videos} settings={settings} onClose={() => setBookmarkVideo(null)} onUseLtx={onUseLtx} onNotice={onNotice} />}
  </div>
}

function JobsView({ title, note, jobs, empty, cancellingIds, onCancel }: { title: string; note: string; jobs: GenerationJob[]; empty: string; cancellingIds: Set<string>; onCancel(job: GenerationJob): Promise<void> }) {
  return <div className="standard-page"><div className="page-heading"><div><p className="eyebrow">LOCAL WORKSPACE</p><h1>{title}</h1><p>{note}</p></div></div>{jobs.length === 0 ? <div className="empty-page"><History size={28} /><strong>{empty}</strong><span>New work is saved automatically on this device.</span></div> : <div className="job-list">{jobs.map((job) => { const audio = job.mediaType === 'audio'; const image = job.mediaType === 'image'; return <article className={`job-row ${['running', 'queued'].includes(job.status) ? 'constructing' : ''}`} key={job.id}><div className={`job-thumbnail ${audio ? 'audio' : ''}`}>{job.outputUrl ? audio ? <Music2 /> : image ? <img src={job.outputUrl} alt="Generated reference still" /> : <video src={job.outputUrl} muted /> : job.status === 'running' ? <LoaderCircle className="spin" /> : audio ? <Music2 /> : image ? <ImageIcon /> : <Film />}</div><div className="job-copy"><div><StatusBadge status={job.status} /><span>{new Date(job.createdAt).toLocaleString()}</span></div><strong>{shortPrompt(job.prompt)}</strong><small>{audio ? `ACE-Step · ${job.duration}s · audio` : `${job.width} × ${job.height} · ${image ? 'Ref2VA still' : `${job.duration}s · ${job.mode}`}`}</small>{job.outputUrl && audio && <audio className="job-audio" src={job.outputUrl} controls preload="metadata" />}{['running', 'queued'].includes(job.status) && <><small className="job-progress-label">{job.progressLabel ?? (job.status === 'queued' ? 'Waiting in queue' : audio ? 'Generating music locally' : image ? 'Generating one reference still' : 'Rendering locally')}{job.currentStep !== undefined && job.totalSteps ? ` · ${job.currentStep}/${job.totalSteps}` : ''}</small><div className="progress compact"><i style={{ width: `${job.progress}%` }} /></div></>}{job.error && <p className="job-error">{job.error}</p>}</div><div className="job-actions">{job.outputUrl && <a className="secondary-button" href={job.outputUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open</a>}{['running', 'queued'].includes(job.status) && <button className="danger-button" disabled={cancellingIds.has(job.id)} onClick={() => void onCancel(job)}>{cancellingIds.has(job.id) ? <LoaderCircle size={15} className="spin" /> : <CircleStop size={15} />}{cancellingIds.has(job.id) ? 'Stopping…' : 'Stop'}</button>}</div></article> })}</div>}</div>
}

function SettingsView({ settings, setSettings, info, models, h3Report, scanning, status, checking, diagnosticRunning, ollamaModels, onRefreshOllama, onScan, onCheck, onSave, onApplyDefaults, onRunDiagnostics }: { settings: AppSettings; setSettings(value: AppSettings): void; info: ObjectInfo; models: ModelFile[]; h3Report: ReturnType<typeof h3StackReport>; scanning: boolean; status: ComfyStatus; checking: boolean; diagnosticRunning: boolean; ollamaModels: OllamaModel[]; onRefreshOllama(): void; onScan(): void; onCheck(): void; onSave(): void; onApplyDefaults(): void; onRunDiagnostics(): void }) {
  const pathRows: Array<{ kind: ModelKind; label: string; note: string }> = [
    { kind: 'diffusion_models', label: 'Diffusion models', note: 'FL2VA and Ref2VA checkpoints' },
    { kind: 'text_encoders', label: 'Text encoders', note: 'Qwen3-VL MiniMax encoder' },
    { kind: 'vae', label: 'VAE models', note: 'Video and audio decoders' },
    { kind: 'loras', label: 'LoRAs', note: '4-step and 8-step turbo adapters' },
    { kind: 'vae_approx', label: 'Preview models', note: 'Tiny H3 preview decoder' },
    { kind: 'clip_vision', label: 'Vision encoders', note: 'Optional reference encoders' },
  ]
  const defaults = settings.generationDefaults
  const llm = resolveLlmConnection(settings)
  const activeModelField = settings.llmProvider === 'lmstudio' ? 'lmStudioModel' : 'ollamaModel'
  const activeUrlField = settings.llmProvider === 'lmstudio' ? 'lmStudioUrl' : 'ollamaUrl'
  const updateDefaults = (patch: Partial<AppSettings['generationDefaults']>) => setSettings({ ...settings, generationDefaults: { ...defaults, ...patch } })
  const [presetName, setPresetName] = useState('')
  const saveRenderPreset = () => {
    const name = presetName.trim()
    if (!name) return
    const now = Date.now()
    const existing = settings.renderSettingsPresets.find((preset) => preset.name.toLowerCase() === name.toLowerCase())
    const preset: RenderSettingsPreset = { id: existing?.id ?? createId(), name, values: { ...defaults }, createdAt: existing?.createdAt ?? now, updatedAt: now }
    setSettings({ ...settings, renderSettingsPresets: [...settings.renderSettingsPresets.filter((item) => item.id !== preset.id), preset] })
    setPresetName('')
  }
  const applyRenderPreset = (preset: RenderSettingsPreset) => updateDefaults({ ...preset.values })
  const renameRenderPreset = (preset: RenderSettingsPreset) => {
    const name = window.prompt('Preset name', preset.name)?.trim()
    if (!name) return
    setSettings({ ...settings, renderSettingsPresets: settings.renderSettingsPresets.map((item) => item.id === preset.id ? { ...item, name: name.slice(0, 60), updatedAt: Date.now() } : item) })
  }
  const deleteRenderPreset = (preset: RenderSettingsPreset) => {
    if (!window.confirm(`Delete render preset “${preset.name}”?`)) return
    setSettings({ ...settings, renderSettingsPresets: settings.renderSettingsPresets.filter((item) => item.id !== preset.id) })
  }
  const applyPreset = (preset: 'quality' | 'official-turbo' | 'preview') => {
    const common = { resolution: '1344x768', duration: 5, steps: 30, loraStrength: 1, shiftVideo: 12, upscaleMode: 'off' as const }
    if (preset === 'quality') updateDefaults({ ...common, turbo: 'off', sampler: 'res_multistep', scheduler: 'simple', experimentalSampling: false, sigmaShiftMode: 'model', shiftAudio: 3 })
    else if (preset === 'official-turbo') updateDefaults({ ...common, turbo: '8', sampler: 'res_multistep', scheduler: 'simple', experimentalSampling: false, sigmaShiftMode: 'model', shiftAudio: 3 })
    else updateDefaults({ ...common, resolution: '864x480', turbo: '8', sampler: 'res_multistep', scheduler: 'simple', experimentalSampling: false, sigmaShiftMode: 'model', shiftAudio: 3 })
  }
  const samplerOptions = [...new Set([defaults.sampler, 'res_multistep', 'euler', 'gradient_estimation', 'ipndm', 'deis', 'heun', ...choices(info, 'KSamplerSelect', 'sampler_name')])]
  const schedulerOptions = [...new Set([defaults.scheduler, 'simple', 'beta', 'normal', ...choices(info, 'BasicScheduler', 'scheduler')])]
  const warnedSampler = ['euler_ancestral', 'lcm', 'dpmpp_3m_sde'].includes(defaults.sampler)
  return <div className="standard-page settings-page"><div className="page-heading"><div><p className="eyebrow">APPLICATION</p><h1>Settings</h1><p>Point the studio at your existing local engine and model folders.</p></div><button className="primary-button" onClick={onSave}><Save size={17} />Save settings</button></div>
    <section className="settings-section"><div className="settings-heading"><div><Activity size={19} /><span><strong>ComfyUI engine</strong><small>The desktop app communicates only with this local address.</small></span></div><span className={`health-pill ${status.connected ? 'online' : ''}`}>{status.connected ? 'Connected' : 'Offline'}</span></div><div className="connection-row"><div className="field-group grow"><label htmlFor="comfy-url">Server URL</label><input id="comfy-url" value={settings.comfyUrl} onChange={(event) => setSettings({ ...settings, comfyUrl: event.target.value })} /></div><button className="secondary-button test-button" onClick={onCheck} disabled={checking}>{checking ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}Test connection</button></div>{status.connected && status.stats?.devices?.[0] && <div className="device-strip"><Gauge size={17} /><span><strong>{status.stats.devices[0].name ?? 'Compute device'}</strong><small>{status.stats.devices[0].vram_total ? `${formatBytes(status.stats.devices[0].vram_total)} VRAM · ${formatBytes(status.stats.devices[0].vram_free ?? 0)} free` : 'ComfyUI device detected'}</small></span></div>}</section>
    <section className="settings-section h3-stack-section">
      <div className="settings-heading"><div><Gauge size={19} /><span><strong>H3 engine stack</strong><small>Compares the selected files with the validated official ComfyUI stack.</small></span></div><span className={`health-pill ${h3Report.validated ? 'online' : ''}`}>{h3Report.validated ? 'Validated' : h3Report.ready ? 'Custom' : 'Incomplete'}</span></div>
      <div className="h3-stack-list">{h3Report.rows.map((row) => <div key={row.label} className={row.validated ? 'validated' : row.optional && !row.selected ? 'optional' : 'custom'}><span>{row.validated ? <Check size={14} /> : row.optional && !row.selected ? <Minus size={14} /> : <AlertCircle size={14} />}</span><div><strong>{row.label}</strong><small title={row.selected || row.expected}>{row.selected || `${row.optional ? 'Optional' : 'Missing'} · expected ${row.expected}`}</small></div><em>{row.validated ? 'Recommended' : row.selected ? 'Non-standard' : row.optional ? 'Optional' : 'Missing'}</em></div>)}</div>
      {!h3Report.validated && <p className="settings-warning"><AlertCircle size={15} />Some components differ from the validated H3 stack. Generation remains available, but output quality may differ.</p>}
      <div className="diagnostic-action"><span><strong>Fixed quality comparison</strong><small>Queues Native Quality and Turbo 8 at 1344 × 768, 5 seconds, seed 12345, with no upscale.</small></span><button className="secondary-button" disabled={!status.connected || diagnosticRunning || !h3Report.ready} onClick={onRunDiagnostics}>{diagnosticRunning ? <LoaderCircle className="spin" size={15} /> : <Activity size={15} />}{diagnosticRunning ? 'Queuing tests…' : 'Run H3 Quality Test'}</button></div>
    </section>
    <section className="settings-section generation-defaults-section">
      <div className="settings-heading"><div><SlidersHorizontal size={19} /><span><strong>Generation defaults</strong><small>Choose the starting values for the main Create workspace.</small></span></div><button className="secondary-button" onClick={onApplyDefaults}>Apply to Create</button></div>
      <div className="preset-row" aria-label="Generation presets">
        <button type="button" onClick={() => applyPreset('quality')}><strong>Native Quality</strong><small>1344 × 768 · 30 steps · no upscale</small></button>
        <button type="button" onClick={() => applyPreset('official-turbo')}><strong>Turbo 8</strong><small>Native canvas · official LoRA 1.0</small></button>
        <button type="button" onClick={() => applyPreset('preview')}><strong>Preview</strong><small>864 × 480 · official Turbo 8</small></button>
      </div>
      <div className="render-preset-manager" aria-labelledby="render-preset-manager-title"><div><span><Save size={15} /><span><strong id="render-preset-manager-title">Saved render presets</strong><small>Save resolution, duration, Turbo profile, steps, fidelity, sampling, shifts, and upscale settings. Prompts and source media are never included.</small></span></span><span>{settings.renderSettingsPresets.length} saved</span></div><form onSubmit={(event) => { event.preventDefault(); saveRenderPreset() }}><label><span>Save current defaults as</span><input value={presetName} maxLength={60} onChange={(event) => setPresetName(event.target.value)} placeholder="e.g. Dialogue close-up" /></label><button className="secondary-button" type="submit" disabled={!presetName.trim()}><Plus size={14} />Save preset</button></form>{settings.renderSettingsPresets.length > 0 && <div className="render-preset-list">{settings.renderSettingsPresets.map((preset) => <article key={preset.id}><span><strong>{preset.name}</strong><small>{preset.values.resolution.replace('x', ' × ')} · {preset.values.duration}s · {preset.values.turbo === 'off' ? `${preset.values.steps} steps` : `Turbo ${preset.values.turbo} · ${preset.values.turbo === '8' ? `${preset.values.steps} steps · ${preset.values.turbo8Profile}` : '4 steps'}`}</small></span><div><button type="button" className="secondary-button" onClick={() => applyRenderPreset(preset)}>Load</button><button type="button" className="icon-button" onClick={() => renameRenderPreset(preset)} aria-label={`Rename ${preset.name}`}><Pencil size={14} /></button><button type="button" className="icon-button" onClick={() => deleteRenderPreset(preset)} aria-label={`Delete ${preset.name}`}><Trash2 size={14} /></button></div></article>)}</div>}</div>
      <div className="generation-defaults-grid">
        <SelectField label="Default resolution" value={defaults.resolution} onChange={(resolution) => updateDefaults({ resolution })} options={['608x352', '864x480', '1056x608', '1344x768', '768x1344', '768x768'].map((value) => [value, value.replace('x', ' × ')])} />
        <NumberField label="Default duration (seconds)" value={defaults.duration} min={2} max={15} step={0.5} onChange={(duration) => updateDefaults({ duration })} />
        <SelectField label="Default quality" value={defaults.turbo === '4' ? '8' : defaults.turbo} onChange={(turbo) => updateDefaults({ turbo: turbo as 'off' | '8', ...(turbo === 'off' ? { steps: 30 } : {}) })} options={[["off", 'Native quality · 30 steps'], ["8", 'Official Turbo 8']]} />
        <SelectField label="Turbo 8 profile" value={defaults.turbo8Profile} onChange={(turbo8Profile) => updateDefaults({ turbo8Profile: turbo8Profile as Turbo8Profile })} options={[["stable", 'Stable · Euler + Simple'], ["balanced", 'Balanced · res_multistep + Simple'], ["motion", 'Motion · res_multistep + Beta']]} />
        <SelectField label="Default text encoder" value={defaults.textEncoderPreference} onChange={(textEncoderPreference) => updateDefaults({ textEncoderPreference: textEncoderPreference as 'fast' | 'quality' })} options={[["fast", 'Fast · NVFP4-AWQ · 15.7 GB'], ["quality", 'Slower · better encoding · INT8 ConvRot · 27.1 GB']]} />
        <NumberField label="Full-quality steps" value={defaults.steps} min={16} max={30} onChange={(steps) => updateDefaults({ steps })} />
        <SelectField label="Reference image fidelity" value={defaults.refImageSize} onChange={(refImageSize) => updateDefaults({ refImageSize: refImageSize as 'match' | 'max' })} options={[["match", 'Match output · faster'], ["max", 'Maximum identity · slower']]} />
        <SelectField label="Default post-render upscale" value={defaults.upscaleMode} onChange={(upscaleMode) => updateDefaults({ upscaleMode: upscaleMode as UpscaleMode })} options={[["off", 'Off · recommended for diagnosis'], ["ltx", 'LTX 2.5 latent · 2×'], ["rtx", 'RTX/CUDA frames · 2× · experimental']]} />
        <label className="settings-check"><input type="checkbox" checked={defaults.livePreview} onChange={(event) => updateDefaults({ livePreview: event.target.checked })} /><span><strong>Live preview by default</strong><small>Uses ComfyUI progress and preview events.</small></span></label>
      </div>
      <details className="experimental-settings"><summary><AlertCircle size={15} /><span><strong>Experimental sampling</strong><small>Custom samplers, shifts, LoRA strength, and 4-step FL2V can make output less stable.</small></span><ChevronDown size={15} /></summary><div className="generation-defaults-grid"><label className="settings-check"><input type="checkbox" checked={defaults.experimentalSampling} onChange={(event) => updateDefaults({ experimentalSampling: event.target.checked })} /><span><strong>Enable custom sampler</strong><small>Otherwise res_multistep + simple is forced.</small></span></label><SelectField label="Experimental Turbo override" value={defaults.turbo} onChange={(turbo) => updateDefaults({ turbo: turbo as 'off' | '4' | '8' })} options={[["off", 'Off'], ["8", 'Official 8-step'], ["4", '4-step preview testing']]} /><NumberField label="Turbo LoRA strength" value={defaults.loraStrength} min={0} max={2} step={0.05} onChange={(loraStrength) => updateDefaults({ loraStrength })} /><SelectField label="Sampler" value={defaults.experimentalSampling ? defaults.sampler : 'res_multistep'} disabled={!defaults.experimentalSampling} onChange={(sampler) => updateDefaults({ sampler })} options={samplerOptions.map((value) => [value, value])} /><SelectField label="Scheduler" value={defaults.experimentalSampling ? defaults.scheduler : 'simple'} disabled={!defaults.experimentalSampling} onChange={(scheduler) => updateDefaults({ scheduler })} options={schedulerOptions.map((value) => [value, value])} /><SelectField label="Sigma shifts" value={defaults.sigmaShiftMode} onChange={(sigmaShiftMode) => updateDefaults({ sigmaShiftMode: sigmaShiftMode as 'model' | 'custom' })} options={[["model", 'Native model defaults · 12 / 3'], ["custom", 'Custom MiniMaxH3SigmaShift node']]} /><NumberField label="Video sigma shift" value={defaults.shiftVideo} min={0.01} max={100} step={0.01} disabled={defaults.sigmaShiftMode !== 'custom'} onChange={(shiftVideo) => updateDefaults({ shiftVideo })} /><NumberField label="Audio sigma shift" value={defaults.shiftAudio} min={0.01} max={100} step={0.01} disabled={defaults.sigmaShiftMode !== 'custom'} onChange={(shiftAudio) => updateDefaults({ shiftAudio })} /></div></details>
      {warnedSampler && <p className="settings-warning"><AlertCircle size={15} />This sampler is on the compatibility-risk list you supplied. Test a short clip before committing to a final render.</p>}
      <p className="settings-note">The production path is 1344 × 768, 30 steps, res_multistep + simple, CFG 1, denoise 1, 24 fps, native 12/3 shifts, and upscale off. Custom sampling is intentionally separated because it complicates quality diagnosis.</p>
    </section>
    <section className="settings-section character-detail-addon-section">
      <div className="settings-heading"><div><ImageIcon size={19} /><span><strong>Character detail references</strong><small>Optional add-on for focused, custom-named visual references on a character.</small></span></div><span className={`health-pill ${settings.characterDetailReferencesEnabled ? 'online' : ''}`}>{settings.characterDetailReferencesEnabled ? 'Enabled' : 'Off'}</span></div>
      <label className="settings-check"><input type="checkbox" checked={settings.characterDetailReferencesEnabled} onChange={(event) => setSettings({ ...settings, characterDetailReferencesEnabled: event.target.checked })} /><span><strong>Enable character detail references</strong><small>Character Studio can store an uploaded image and optional render notes for any body area or visual detail you name. When enabled, these references are included in the character’s MiniMax reference budget; no fixed body-part categories are imposed by the app.</small></span></label>
    </section>
    <section className="settings-section ollama-section">
      <div className="settings-heading">
        <div><Sparkles size={19} /><span><strong>Local AI prompt assistant</strong><small>Ollama remains the default; LM Studio is an optional local provider.</small></span></div>
        <span className={`health-pill ${ollamaModels.length > 0 ? 'online' : ''}`}>{ollamaModels.length > 0 ? `${ollamaModels.length} local` : 'Offline'}</span>
      </div>
      <fieldset className="llm-provider-picker">
        <legend>Provider</legend>
        <label className={settings.llmProvider === 'ollama' ? 'selected' : ''}><input type="radio" name="llm-provider" value="ollama" checked={settings.llmProvider === 'ollama'} onChange={() => setSettings({ ...settings, llmProvider: 'ollama' })} /><span><strong>Ollama</strong><small>Default · native local API</small></span></label>
        <label className={settings.llmProvider === 'lmstudio' ? 'selected' : ''}><input type="radio" name="llm-provider" value="lmstudio" checked={settings.llmProvider === 'lmstudio'} onChange={() => setSettings({ ...settings, llmProvider: 'lmstudio' })} /><span><strong>LM Studio</strong><small>Optional · enable explicitly</small></span></label>
      </fieldset>
      <div className="ollama-grid">
        <div className="field-group"><label htmlFor="llm-url">{llm.label} URL</label><input id="llm-url" value={settings[activeUrlField]} onChange={(event) => setSettings({ ...settings, [activeUrlField]: event.target.value })} /></div>
        <div className="field-group"><label htmlFor="llm-model">Local model</label><div className="select-wrap"><select id="llm-model" value={settings[activeModelField]} onChange={(event) => setSettings({ ...settings, [activeModelField]: event.target.value })} disabled={ollamaModels.length === 0}>{ollamaModels.length === 0 ? <option value="">No local models detected</option> : ollamaModels.map((model) => <option value={model.name} key={model.name}>{model.name}{model.parameterSize ? ` · ${model.parameterSize}` : ''}</option>)}</select><ChevronDown size={15} /></div></div>
        <button className="secondary-button test-button" onClick={onRefreshOllama}><RefreshCw size={16} />Refresh models</button>
      </div>
      <p className="settings-note">{settings.llmProvider === 'lmstudio' ? 'LM Studio is opt-in and restricted to loopback addresses (localhost, 127.0.0.1, or ::1). Start its Local Server, choose a loaded model, then save settings.' : 'Prompts go directly to the local Ollama server. Embedding and cloud-backed models are excluded.'}</p>
    </section>
    <section className="settings-section"><div className="settings-heading"><div><HardDrive size={19} /><span><strong>Model locations</strong><small>Files are indexed in place and are never moved or copied.</small></span></div><button className="secondary-button" onClick={onScan} disabled={scanning}>{scanning ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{scanning ? 'Scanning…' : 'Rescan'}</button></div><div className="path-table">{pathRows.map((row) => { const count = models.filter((model) => model.kind === row.kind).length; return <div className="path-row" key={row.kind}><div className="path-kind"><Folder size={17} /><span><strong>{row.label}</strong><small>{row.note}</small></span></div><div className="path-input"><input value={settings.paths[row.kind]} onChange={(event) => setSettings({ ...settings, paths: { ...settings.paths, [row.kind]: event.target.value } })} /><button onClick={async () => { const path = await window.minimax.chooseDirectory(settings.paths[row.kind]); if (path) setSettings({ ...settings, paths: { ...settings.paths, [row.kind]: path } }) }} aria-label={`Browse for ${row.label}`}><FolderOpen size={17} /></button></div><span className="file-count">{count} files</span></div>})}</div></section>
    <section className="settings-section"><div className="settings-heading"><div><FolderOpen size={19} /><span><strong>Output & clip tools</strong><small>Completed videos, extracted frames, and editor exports stay local.</small></span></div></div><div className="connection-row"><div className="field-group grow"><label htmlFor="output-path">Output directory</label><input id="output-path" value={settings.outputDirectory} onChange={(event) => setSettings({ ...settings, outputDirectory: event.target.value })} /></div><button className="secondary-button test-button" onClick={async () => { const path = await window.minimax.chooseDirectory(settings.outputDirectory); if (path) setSettings({ ...settings, outputDirectory: path }) }}><FolderOpen size={16} />Browse</button></div><div className="connection-row clip-tool-path"><div className="field-group grow"><label htmlFor="ffmpeg-path">FFmpeg executable</label><input id="ffmpeg-path" value={settings.ffmpegPath} onChange={(event) => setSettings({ ...settings, ffmpegPath: event.target.value })} /></div></div><p className="settings-note">The clip editor uses FFmpeg for frame extraction, trim points, joining, and full-project export.</p></section>
  </div>
}

export default App
