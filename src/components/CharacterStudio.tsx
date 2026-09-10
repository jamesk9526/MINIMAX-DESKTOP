import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CircleStop, Film, ImagePlus, Images, LoaderCircle, Orbit, Plus, Scissors, Shirt, Sparkles, Trash2, UserRound, WandSparkles, Watch, X } from 'lucide-react'
import { CHARACTER_LIBRARY_EVENT, characterReferences, loadCharacterProjects, newCharacterProject, saveCharacterProjects } from '../lib/characterLibrary'
import { choices, type ObjectInfo } from '../lib/comfyInfo'
import { buildZImage } from '../lib/zimage'
import { loadWardrobeProjects, wardrobeReferences, WARDROBE_LIBRARY_EVENT } from '../lib/wardrobeLibrary'
import { ACCESSORY_LIBRARY_EVENT, loadAccessoryProjects } from '../lib/accessoryLibrary'
import { HAIR_LIBRARY_EVENT, loadHairStyleProjects } from '../lib/hairLibrary'
import { ReferenceApprovalModal } from './ReferenceApprovalModal'
import type { CopilotWorkspaceContext } from './AiChatHead'
import { characterAppearancePresets, characterPerformancePresets, characterVisualStylePresets, characterVoicePresets, appendPreset } from '../lib/characterPresets'
import { COPILOT_DECISION_EVENT, offerCopilotSuggestion } from '../lib/copilot'
import { createId } from '../lib/createId'
import { resolveLlmConnection } from '../lib/llmProvider'
import type { AppSettings, CharacterProject, GenerationJob, MediaFile } from '../types'

function cleanSinglePrompt(value: string) {
  return value
    .replace(/\\\s*(?:\r?\n|$)/g, ' ')
    .replace(/[*_#`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function CharacterStudio({ settings, info, connected, ollamaAvailable, automationJobs, onCopilotContext, onCreateTurntable, onNotice }: {
  settings: AppSettings
  info: ObjectInfo
  connected: boolean
  ollamaAvailable: boolean
  automationJobs?: GenerationJob[]
  onCopilotContext(context: CopilotWorkspaceContext): void
  onCreateTurntable(project: CharacterProject): Promise<string | null>
  onNotice(tone: 'error' | 'success' | 'neutral', text: string): void
}) {
  const initial = useMemo(() => {
    const stored = loadCharacterProjects()
    return stored.length ? stored : [newCharacterProject()]
  }, [])
  const [projects, setProjects] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0].id)
  const [videoDuration, setVideoDuration] = useState(0)
  const [splitting, setSplitting] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [masterJob, setMasterJob] = useState<{ id: string; url: string; characterId: string; target: 'master' | 'sheet' } | null>(null)
  const [masterBusy, setMasterBusy] = useState(false)
  const [masterMessage, setMasterMessage] = useState('')
  const [masterError, setMasterError] = useState(false)
  const [candidate, setCandidate] = useState<{ characterId: string; target: 'master' | 'sheet'; file: MediaFile } | null>(null)
  const [batchJobs, setBatchJobs] = useState<Array<{ id: string; url: string; characterId: string }>>([])
  const [identityCandidates, setIdentityCandidates] = useState<MediaFile[]>([])
  const [selectedCandidatePaths, setSelectedCandidatePaths] = useState<string[]>([])
  const [candidateStep, setCandidateStep] = useState<'choose' | 'survey'>('choose')
  const [approvedFlowProject, setApprovedFlowProject] = useState<CharacterProject | null>(null)
  const [identitySurveyStartedAt, setIdentitySurveyStartedAt] = useState<number | null>(null)
  const [identitySurveySubmitting, setIdentitySurveySubmitting] = useState(false)
  const [identitySurveyError, setIdentitySurveyError] = useState('')
  const [refinementSuggestionId, setRefinementSuggestionId] = useState('')
  const [refinementSuggestion, setRefinementSuggestion] = useState('')
  const [wardrobes, setWardrobes] = useState(loadWardrobeProjects)
  const [accessories, setAccessories] = useState(loadAccessoryProjects)
  const [hairStyles, setHairStyles] = useState(loadHairStyleProjects)
  const active = projects.find((project) => project.id === activeId) ?? projects[0]
  const llm = resolveLlmConnection(settings)
  const activeAutomation = automationJobs?.find((job) => job.characterProjectId === active.id)

  useEffect(() => {
    const refresh = () => {
      const next = loadCharacterProjects()
      if (next.length) setProjects(next)
    }
    window.addEventListener(CHARACTER_LIBRARY_EVENT, refresh)
    return () => window.removeEventListener(CHARACTER_LIBRARY_EVENT, refresh)
  }, [])
  useEffect(() => { const refresh = () => setWardrobes(loadWardrobeProjects()); window.addEventListener(WARDROBE_LIBRARY_EVENT, refresh); return () => window.removeEventListener(WARDROBE_LIBRARY_EVENT, refresh) }, [])
  useEffect(() => { const refresh = () => setAccessories(loadAccessoryProjects()); window.addEventListener(ACCESSORY_LIBRARY_EVENT, refresh); return () => window.removeEventListener(ACCESSORY_LIBRARY_EVENT, refresh) }, [])
  useEffect(() => { const refresh = () => setHairStyles(loadHairStyleProjects()); window.addEventListener(HAIR_LIBRARY_EVENT, refresh); return () => window.removeEventListener(HAIR_LIBRARY_EVENT, refresh) }, [])
  useEffect(() => {
    const decide = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; decision: 'approve' | 'dismiss' }>).detail
      if (!refinementSuggestionId || detail.id !== refinementSuggestionId) return
      if (detail.decision === 'approve') { patchProject(active.id, { referencePrompt: cleanSinglePrompt(refinementSuggestion) }); onNotice('success', 'Approved identity refinement applied to the master prompt.') }
      setRefinementSuggestionId(''); setRefinementSuggestion('')
    }
    window.addEventListener(COPILOT_DECISION_EVENT, decide)
    return () => window.removeEventListener(COPILOT_DECISION_EVENT, decide)
  }, [active.id, onNotice, refinementSuggestion, refinementSuggestionId])

  const commit = (next: CharacterProject[]) => { setProjects(next); saveCharacterProjects(next) }
  const patchProject = (id: string, change: Partial<CharacterProject>) => setProjects((current) => {
    const next = current.map((project) => project.id === id ? { ...project, ...change, updatedAt: Date.now() } : project)
    saveCharacterProjects(next)
    return next
  })
  const patch = (change: Partial<CharacterProject>) => commit(projects.map((project) => project.id === active.id ? { ...project, ...change, updatedAt: Date.now() } : project))
  const add = () => {
    const project = newCharacterProject(projects.length + 1)
    commit([...projects, project]); setActiveId(project.id)
  }
  const remove = () => {
    if (!window.confirm(`Delete the character project “${active.name}”? The original image and video files will remain on disk.`)) return
    const next = projects.filter((project) => project.id !== active.id)
    const fallback = next.length ? next : [newCharacterProject()]
    commit(fallback); setActiveId(fallback[0].id)
  }
  const chooseImage = async (target: 'base' | 'reference') => {
    const picked = await window.minimax.chooseMedia('image')
    if (!picked) return
    const file: MediaFile = { ...picked, kind: 'image', preview: await window.minimax.mediaUrl(picked.path) }
    patch(target === 'base' ? { baseImage: file } : {
      referenceImages: [...active.referenceImages, file],
      selectedReferencePaths: active.selectedReferencePaths === undefined ? undefined : [...active.selectedReferencePaths, file.path],
    })
  }
  const addDetailReference = () => patch({ detailReferences: [...active.detailReferences, { id: createId(), label: '', notes: '', images: [] }] })
  const patchDetailReference = (id: string, change: Partial<CharacterProject['detailReferences'][number]>) => patch({ detailReferences: active.detailReferences.map((detail) => detail.id === id ? { ...detail, ...change } : detail) })
  const removeDetailReference = (id: string) => patch({ detailReferences: active.detailReferences.filter((detail) => detail.id !== id) })
  const chooseDetailReferenceImage = async (id: string, imageIndex: number) => {
    const picked = await window.minimax.chooseMedia('image')
    if (!picked) return
    const image = { ...picked, kind: 'image' as const, preview: await window.minimax.mediaUrl(picked.path) }
    const detail = active.detailReferences.find((item) => item.id === id)
    if (!detail) return
    const images = [...detail.images]
    images[imageIndex] = image
    patchDetailReference(id, { images: images.filter(Boolean) })
  }
  const removeDetailReferenceImage = (id: string, imageIndex: number) => {
    const detail = active.detailReferences.find((item) => item.id === id)
    if (detail) patchDetailReference(id, { images: detail.images.filter((_, index) => index !== imageIndex) })
  }
  const chooseTurntable = async () => {
    const picked = await window.minimax.chooseMedia('video')
    if (!picked) return
    patch({ turntableVideo: { ...picked, kind: 'video', preview: await window.minimax.mediaUrl(picked.path) } })
    setVideoDuration(0)
  }
  const enhance = async () => {
    if (!ollamaAvailable || assisting) return
    setAssisting(true)
    try {
      const instruction = `Rewrite the character notes below as one concise, production-ready Z-Image identity reference prompt. Preserve every intentional identity detail, but remove repeated facts. Include the name, complexion when supplied, stable face geometry, age range, assigned hair, build, distinguishing marks, and the visible performance baseline. If reference images are attached, inspect them and express only stable visible traits that agree across the images; never infer sensitive traits or invent hidden details. Do not introduce wardrobe, jewelry, accessories, or recurring props; those are managed by their own studios. End with the requested visual style and these constraints: plain neutral studio background, even soft lighting, eye-level 50mm lens, relaxed symmetrical stance, hands visible, accurate anatomy, plain fitted neutral studio clothing, no text, no props, one adult person only. Return exactly one plain-text paragraph with no Markdown or line breaks.\n\nName: ${active.name}\nAppearance: ${active.description}\nAssigned hair: ${hairDirection || 'No separate hair design assigned.'}\nVoice and performance: ${active.voiceNotes}\nVisual style: ${active.visualStyle}`
      const imagePaths = [active.baseImage?.path, ...active.referenceImages.map((file) => file.path), activeHairStyle?.referenceImage?.path].filter(Boolean) as string[]
      let result: string
      if (imagePaths.length) {
        try { result = await window.minimax.generateWithOllamaVision(llm.url, llm.model, instruction, imagePaths, llm.provider) }
        catch { result = await window.minimax.generateWithOllama(llm.url, llm.model, instruction, llm.provider) }
      } else result = await window.minimax.generateWithOllama(llm.url, llm.model, instruction, llm.provider)
      const id = createId(); const cleaned = cleanSinglePrompt(result)
      setRefinementSuggestionId(id); setRefinementSuggestion(cleaned)
      offerCopilotSuggestion({ id, title: `Refine ${active.name}'s identity`, text: cleaned, target: 'character-identity', targetId: active.id, sourceLabel: `${llm.model} · ${llm.label} · ${imagePaths.length ? `${Math.min(6, imagePaths.length)} visual reference${imagePaths.length === 1 ? '' : 's'}` : 'profile notes'}` })
      onNotice('neutral', 'Identity refinement is ready to approve or dismiss in Studio copilot.')
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setAssisting(false) }
  }
  const activeHairStyle = hairStyles.find((item) => item.id === active.hairStyleIds[0])
  const hairDirection = activeHairStyle ? `Hair design: ${activeHairStyle.name}. ${activeHairStyle.description} Texture: ${activeHairStyle.texture}. Length: ${activeHairStyle.length}. ${activeHairStyle.color ? `Color: ${activeHairStyle.color}.` : ''} Hairline and part: ${activeHairStyle.hairline}. Finish: ${activeHairStyle.finish}.` : active.hairPreset ? `Hair: ${active.hairPreset}.` : ''
  const defaultZPrompt = [
    `Full-body neutral character identity reference portrait of ${active.name}.`, active.identityTemplate !== 'custom' && `${active.identityTemplate} casting reference treatment.`, active.skinTone && `Skin tone: ${active.skinTone}.`, hairDirection, active.description,
    `${active.visualStyle}. Plain fitted neutral studio clothing without jewelry or accessories. Plain neutral studio background, even soft lighting, eye-level 50mm lens, relaxed symmetrical stance, hands visible, accurate anatomy, no text, no props, one person only.`,
  ].filter(Boolean).join(' ')
  const zPrompt = active.referencePrompt.trim() || defaultZPrompt
  useEffect(() => {
    const referenceMap = [active.baseImage && `<Picture 1> = ${active.name} master identity`, ...active.referenceImages.map((file, index) => `<Picture ${index + 2}> = ${active.name} approved identity angle ${index + 1}`)].filter(Boolean) as string[]
    onCopilotContext({ label: `Character · ${active.name}`, prompt: zPrompt, referenceMap, imagePaths: [active.baseImage?.path, ...active.referenceImages.map((file) => file.path), activeHairStyle?.referenceImage?.path].filter(Boolean) as string[] })
  }, [active.baseImage, active.name, active.referenceImages, activeHairStyle?.referenceImage?.path, onCopilotContext, zPrompt])
  const sheetPrompt = [
    `Four-view character identity reference sheet for ${active.name}.`, active.description, hairDirection,
    `${active.visualStyle}. Show the exact same person in four evenly spaced full-body panels: straight front view, left side profile, right side profile, and straight back view. Keep face, hairstyle, body proportions, and skin tone identical in every panel. Use plain fitted neutral studio clothing without jewelry or accessories. Plain neutral studio background, even soft lighting, eye-level 50mm lens, relaxed neutral stance, hands visible, accurate anatomy, no text, no labels, no logos, no props, no other people.`,
  ].filter(Boolean).join(' ')
  const zModel = choices(info, 'UNETLoader', 'unet_name').find((name) => /z[_-]?image.*turbo/i.test(name)) ?? 'z_image_turbo_bf16.safetensors'
  const zEncoder = choices(info, 'CLIPLoader', 'clip_name').find((name) => /qwen[_-]?3[_-]?4b/i.test(name)) ?? 'qwen_3_4b.safetensors'
  const zVae = choices(info, 'VAELoader', 'vae_name').find((name) => /^ae\.safetensors$/i.test(name)) ?? 'ae.safetensors'
  const zReady = connected && choices(info, 'UNETLoader', 'unet_name').includes(zModel) && choices(info, 'CLIPLoader', 'clip_name').includes(zEncoder) && choices(info, 'VAELoader', 'vae_name').includes(zVae)
  const createMaster = async (target: 'master' | 'sheet' = 'master') => {
    const renderPrompt = target === 'sheet' ? sheetPrompt : zPrompt
    if (!zReady || masterBusy || !renderPrompt.trim()) return
    setMasterBusy(true); setMasterError(false); setMasterMessage(target === 'sheet' ? 'Submitting the four-view character sheet to Z-Image Turbo…' : 'Submitting the master reference to Z-Image Turbo…')
    try {
      const response = await window.minimax.submitPrompt(settings.comfyUrl, buildZImage(renderPrompt.trim(), target === 'sheet' ? 1024 : 768, target === 'sheet' ? 1024 : 1024, Math.floor(Math.random() * 1_000_000_000), zModel, zEncoder, zVae))
      setMasterJob({ id: response.prompt_id, url: settings.comfyUrl, characterId: active.id, target })
      setMasterMessage(target === 'sheet' ? 'Constructing the character sheet in ComfyUI…' : 'Rendering the character master reference in ComfyUI…')
    } catch (error) {
      setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true); setMasterBusy(false)
    }
  }
  const createIdentityBatch = async (count = 4) => {
    if (!zReady || masterBusy || !zPrompt.trim()) return
    setMasterBusy(true); setMasterError(false); setIdentityCandidates([]); setSelectedCandidatePaths([]); setCandidateStep('choose'); setApprovedFlowProject(null); setIdentitySurveyStartedAt(null); setMasterMessage(`Queueing ${count} distinct identity candidates…`)
    try {
      const responses = await Promise.allSettled(Array.from({ length: count }, () => window.minimax.submitPrompt(settings.comfyUrl, buildZImage(zPrompt.trim(), 768, 1024, Math.floor(Math.random() * 1_000_000_000), zModel, zEncoder, zVae))))
      const queued = responses.flatMap((response) => response.status === 'fulfilled' ? [{ id: response.value.prompt_id, url: settings.comfyUrl, characterId: active.id }] : [])
      if (!queued.length) throw new Error(responses.find((response) => response.status === 'rejected')?.reason instanceof Error ? responses.find((response) => response.status === 'rejected')!.reason.message : 'No identity candidates could be queued.')
      setBatchJobs(queued)
      setMasterMessage(queued.length === count ? `${count} candidates queued. They will appear together for approval.` : `${queued.length} of ${count} candidates queued. The successful renders will still appear for approval.`)
    } catch (error) { setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true); setMasterBusy(false) }
  }
  const cancelBatch = async () => { await Promise.allSettled(batchJobs.map((item) => window.minimax.cancelPrompt(item.url, item.id))); setBatchJobs([]); setMasterBusy(false); setMasterMessage('Identity batch cancelled.') }
  const cancelMaster = async () => {
    if (!masterJob) return
    try { await window.minimax.cancelPrompt(masterJob.url, masterJob.id); setMasterMessage('Master-reference render cancelled.'); setMasterError(false) }
    catch (error) { setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true) }
    finally { setMasterJob(null); setMasterBusy(false) }
  }

  useEffect(() => {
    if (!masterJob) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const history = await window.minimax.getHistory(masterJob.url, masterJob.id)
        const entry = history[masterJob.id] as { status?: { status_str?: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> } | undefined
        if (entry?.status?.status_str === 'error') throw new Error('Master-reference generation failed. Check the ComfyUI log.')
        const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0]
        if (image) {
          const preview = await window.minimax.getOutputImage(masterJob.url, image)
          const saved = await window.minimax.saveComfyOutputImage(masterJob.url, image, settings.outputDirectory)
          if (!disposed) {
            const file = { ...saved, preview, kind: 'image' as const }
            setCandidate({ characterId: masterJob.characterId, target: masterJob.target, file })
            setMasterMessage('Reference ready for approval.'); setMasterJob(null); setMasterBusy(false); setMasterError(false)
          }
          return
        }
      } catch (error) {
        if (!disposed) { setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true); setMasterBusy(false); setMasterJob(null) }
        return
      }
      if (!disposed) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [masterJob, onNotice, settings.outputDirectory])
  useEffect(() => {
    if (!batchJobs.length) return
    let disposed = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const completed: Array<{ batchJob: (typeof batchJobs)[number]; image: { filename: string; subfolder?: string; type?: string } }> = []
        for (const batchJob of batchJobs) {
          const history = await window.minimax.getHistory(batchJob.url, batchJob.id)
          const entry = history[batchJob.id] as { status?: { status_str?: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> } | undefined
          if (entry?.status?.status_str === 'error') throw new Error('One identity candidate failed. Check the ComfyUI log.')
          const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0]
          if (image) completed.push({ batchJob, image })
        }
        if (completed.length === batchJobs.length) {
          const ready = await Promise.all(completed.map(async ({ batchJob, image }) => { const preview = await window.minimax.getOutputImage(batchJob.url, image); const saved = await window.minimax.saveComfyOutputImage(batchJob.url, image, settings.outputDirectory); return { ...saved, preview, kind: 'image' as const } }))
          if (!disposed) { setIdentityCandidates(ready); setSelectedCandidatePaths(ready.map((file) => file.path)); setBatchJobs([]); setMasterBusy(false); setMasterMessage(`${ready.length} identity candidates ready. Approve one or more.`) }; return
        }
        if (!disposed) setMasterMessage(`Rendering identity batch… ${completed.length} of ${batchJobs.length} ready`)
      } catch (error) { if (!disposed) { setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true); setBatchJobs([]); setMasterBusy(false) }; return }
      timer = setTimeout(poll, 2000)
    }
    void poll(); return () => { disposed = true; clearTimeout(timer) }
  }, [batchJobs, settings.outputDirectory])
  const splitTurntable = async () => {
    if (!active.turntableVideo || videoDuration <= 0 || splitting) return
    setSplitting(true)
    try {
      const positions = [0.05, 0.25, 0.5, 0.75, 0.95].map((ratio) => Math.max(0, Math.min(videoDuration - 0.04, videoDuration * ratio)))
      const extracted = await Promise.all(positions.map(async (position) => {
        const result = await window.minimax.extractVideoFrame(active.turntableVideo!.path, position, settings.outputDirectory, settings.ffmpegPath)
        return { ...result, kind: 'image' as const, preview: await window.minimax.mediaUrl(result.path) }
      }))
      patch({ referenceImages: extracted, referenceMode: 'set', selectedReferencePaths: undefined })
      onNotice('success', 'Five turntable angles were extracted into this character reference set.')
    } catch (error) { onNotice('error', error instanceof Error ? error.message : String(error)) }
    finally { setSplitting(false) }
  }
  const approveCandidate = () => {
    if (!candidate) return
    const project = loadCharacterProjects().find((item) => item.id === candidate.characterId)
    if (!project) { setCandidate(null); return }
    if (candidate.target === 'sheet') {
      patchProject(project.id, { referenceMode: 'set', referenceImages: [...project.referenceImages, candidate.file], selectedReferencePaths: [...new Set([...(project.selectedReferencePaths ?? project.referenceImages.map((item) => item.path)), candidate.file.path])] })
      setCandidate(null); setMasterMessage('Four-view character sheet approved.'); onNotice('success', 'Character sheet added to the approved reference set.')
      return
    }
    patchProject(project.id, { baseImage: candidate.file })
    setCandidate(null); setMasterMessage('Master approved. Preparing the turntable…')
    void onCreateTurntable({ ...project, baseImage: candidate.file })
  }
  const closeIdentityFlow = () => { setIdentityCandidates([]); setApprovedFlowProject(null); setIdentitySurveyStartedAt(null); setIdentitySurveySubmitting(false); setIdentitySurveyError(''); setCandidateStep('choose') }
  const approveIdentitySelection = () => {
    const chosen = selectedCandidatePaths.map((path) => identityCandidates.find((file) => file.path === path)).filter(Boolean) as MediaFile[]
    if (!chosen.length) return
    const references = [...active.referenceImages, ...chosen].filter((file, index, all) => all.findIndex((item) => item.path === file.path) === index)
    const project = { ...active, baseImage: chosen[0], referenceImages: references, referenceMode: 'set' as const, selectedReferencePaths: references.map((file) => file.path) }
    patchProject(active.id, { baseImage: chosen[0], referenceMode: 'set', referenceImages: references, selectedReferencePaths: references.map((file) => file.path) })
    setApprovedFlowProject(project); setCandidateStep('survey'); setIdentitySurveyError(''); setMasterMessage(`${chosen.length} identity candidate${chosen.length === 1 ? '' : 's'} approved. Ready for the LTX 2.5 angle survey.`)
    onNotice('success', `${chosen.length} identity candidate${chosen.length === 1 ? '' : 's'} approved. Review the LTX 2.5 angle survey next.`)
  }
  const identitySurveyJob = identitySurveyStartedAt !== null && activeAutomation && activeAutomation.createdAt >= identitySurveyStartedAt - 1000 ? activeAutomation : undefined
  const startIdentitySurvey = async () => {
    if (!approvedFlowProject || !connected) return
    setIdentitySurveyStartedAt(Date.now()); setIdentitySurveySubmitting(true); setIdentitySurveyError('')
    try {
      const failure = await onCreateTurntable(approvedFlowProject)
      if (failure) { setIdentitySurveyStartedAt(null); setIdentitySurveyError(failure) }
    } catch (error) { setIdentitySurveyStartedAt(null); setIdentitySurveyError(error instanceof Error ? error.message : String(error)) }
    finally { setIdentitySurveySubmitting(false) }
  }
  const renderTurntable = async () => {
    if (!active.baseImage) return
    setIdentitySurveyError(''); setMasterMessage('Preparing the LTX 2.5 identity survey…'); setMasterError(false)
    try {
      const failure = await onCreateTurntable(active)
      if (failure) { setMasterMessage(failure); setMasterError(true) }
      else setMasterMessage('Identity survey queued in LTX 2.5. Progress is shown here and in Queue.')
    } catch (error) { setMasterMessage(error instanceof Error ? error.message : String(error)); setMasterError(true) }
  }

  return <><div className="standard-page character-studio">
    <div className="page-heading"><div><p className="eyebrow">GLOBAL CHARACTER LIBRARY</p><h1>Character Studio</h1><p>Create reusable character identities, master images, turntables, and reference sets.</p></div><div className="heading-state"><span className={active.baseImage ? 'ok' : 'warn'}>{active.baseImage ? <Check size={15} /> : <UserRound size={15} />}{active.baseImage ? 'Master reference ready' : 'Create a master image'}</span></div></div>
    <div className="character-studio-grid">
      <aside className="character-project-list"><header><span><strong>Character projects</strong><small>{projects.length} saved globally</small></span><button onClick={add}><Plus size={14} />New</button></header><div>{projects.map((project) => <button key={project.id} className={project.id === active.id ? 'active' : ''} onClick={() => { setActiveId(project.id); setVideoDuration(0) }}>{project.baseImage?.preview ? <img src={project.baseImage.preview} alt="" /> : <span><UserRound size={18} /></span>}<span><strong>{project.name}</strong><small>{characterReferences(project).length} usable reference{characterReferences(project).length === 1 ? '' : 's'}</small></span></button>)}</div></aside>
      <section className="character-workbench">
        <header><div><UserRound size={18} /><span><strong>Identity and continuity</strong><small>These details and approved references can be imported into any movie.</small></span></div><button className="danger-button" onClick={remove}><Trash2 size={14} />Delete project</button></header>
        <div className="character-setup-grid">
          <section className="character-setup-panel"><div className="character-section-heading"><span><UserRound size={15} /></span><div><strong>Identity profile</strong><small>Stable physical and performance details only. Hair, clothing, and accessories can use reusable libraries.</small></div><em>{active.name.trim() ? 'Saved locally' : 'Name required'}</em></div><div className="character-preset-row"><label>Identity template<select value={active.identityTemplate} onChange={(event) => patch({ identityTemplate: event.target.value as CharacterProject['identityTemplate'], referencePrompt: '' })}><option value="cinematic">Cinematic · recommended</option><option value="editorial">Editorial casting</option><option value="everyday">Natural everyday</option><option value="custom">Custom</option></select></label><label>Appearance preset<select defaultValue="custom" onChange={(event) => { const preset = characterAppearancePresets.find(([id]) => id === event.target.value); if (preset?.[2]) patch({ description: appendPreset(active.description, preset[2]), referencePrompt: '' }) }} >{characterAppearancePresets.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Visual style preset<select value={characterVisualStylePresets.includes(active.visualStyle as typeof characterVisualStylePresets[number]) ? active.visualStyle : 'custom'} onChange={(event) => { if (event.target.value !== 'custom') patch({ visualStyle: event.target.value, referencePrompt: '' }) }}><option value="custom">Custom visual style</option>{characterVisualStylePresets.map((style) => <option value={style} key={style}>{style}</option>)}</select></label><label>Voice preset<select defaultValue="custom" onChange={(event) => { const preset = characterVoicePresets.find(([id]) => id === event.target.value); if (preset?.[2]) patch({ voiceNotes: appendPreset(active.voiceNotes, preset[2]), referencePrompt: '' }) }}>{characterVoicePresets.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Performance preset<select defaultValue="custom" onChange={(event) => { const preset = characterPerformancePresets.find(([id]) => id === event.target.value); if (preset?.[2]) patch({ voiceNotes: appendPreset(active.voiceNotes, preset[2]), referencePrompt: '' }) }}>{characterPerformancePresets.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label><label>Skin tone<select value={active.skinTone} onChange={(event) => patch({ skinTone: event.target.value, referencePrompt: '' })}><option value="">Describe manually</option>{['MST 1 · very light','MST 2 · light','MST 3 · light-medium','MST 4 · medium-light','MST 5 · medium','MST 6 · medium-deep','MST 7 · deep','MST 8 · deep-rich','MST 9 · very deep','MST 10 · deepest'].map((tone) => <option key={tone}>{tone}</option>)}</select></label><label>Manual hair fallback<select value={active.hairPreset} disabled={Boolean(activeHairStyle)} onChange={(event) => patch({ hairPreset: event.target.value, referencePrompt: '' })}><option value="">Describe manually</option><option>short straight hair</option><option>long straight hair</option><option>short wavy hair</option><option>long wavy hair</option><option>short curly hair</option><option>long curly hair</option><option>coily natural hair</option><option>braided hair</option><option>locs</option><option>buzz cut</option><option>shaved head</option></select></label></div><div className="character-form"><label>Character name<input value={active.name} onChange={(event) => patch({ name: event.target.value, referencePrompt: '' })} /></label><label>Visual style details<input list="character-visual-styles" value={active.visualStyle} onChange={(event) => patch({ visualStyle: event.target.value, referencePrompt: '' })} placeholder="Cinematic photorealism" /><datalist id="character-visual-styles">{characterVisualStylePresets.map((style) => <option value={style} key={style} />)}</datalist></label><label className="wide">Repeatable appearance<textarea value={active.description} onChange={(event) => patch({ description: event.target.value, referencePrompt: '' })} placeholder="Age, face geometry, eyes, build, distinguishing marks…" /></label><label className="wide">Voice and performance baseline<textarea value={active.voiceNotes} onChange={(event) => patch({ voiceNotes: event.target.value, referencePrompt: '' })} placeholder="Register, pace, accent, diction, emotional range, posture, gaze, gesture, and reaction style…" /></label></div>
          <fieldset className="character-wardrobe-picker character-hair-picker"><legend>Assigned hair design · one active style per character</legend>{hairStyles.length ? <div>{hairStyles.map((hair) => { const checked = active.hairStyleIds[0] === hair.id; return <label className={checked ? 'selected' : ''} key={hair.id}><input type="checkbox" checked={checked} disabled={!hair.referenceImage} onChange={(event) => patch({ hairStyleIds: event.target.checked ? [hair.id] : [], referencePrompt: '' })} />{hair.referenceImage?.preview ? <img src={hair.referenceImage.preview} alt="" /> : <span><Scissors size={14} /></span>}<span><strong>{hair.name}{checked ? ' · Active hair' : ''}</strong><small>{hair.referenceImage ? `${hair.texture} · ${hair.length}` : 'Reference image needed'}</small></span></label> })}</div> : <p>Create designs in Hair Studio, then assign one here.</p>}</fieldset>
          {activeHairStyle?.referenceImage && <div className="character-hair-render-callout"><Scissors size={16} /><span><strong>Render this hair onto the character master</strong><small>The assigned hair is mapped during Reference renders. Creating a fresh master also bakes the hairstyle into the character identity image and gives H3 one unambiguous person reference.</small></span><button className="primary-button" disabled={masterBusy || !zReady || !active.name.trim()} onClick={() => void createMaster('master')}>{masterBusy ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{active.baseImage ? 'Render updated master' : 'Render character with hair'}</button></div>}
          <fieldset className="character-wardrobe-picker"><legend>Assigned wardrobes · first selected is the active render outfit</legend>{wardrobes.length ? <div>{wardrobes.map((wardrobe) => { const count = wardrobeReferences(wardrobe).length; const checked = active.wardrobeIds.includes(wardrobe.id); const primary = active.wardrobeIds[0] === wardrobe.id; return <label className={checked ? 'selected' : ''} key={wardrobe.id}><input type="checkbox" checked={checked} disabled={!count} onChange={(event) => patch({ wardrobeIds: event.target.checked ? [...new Set([...active.wardrobeIds, wardrobe.id])] : active.wardrobeIds.filter((id) => id !== wardrobe.id) })} />{wardrobe.referenceImages[0]?.preview ? <img src={wardrobe.referenceImages[0].preview} alt="" /> : <span><Shirt size={14} /></span>}<span><strong>{wardrobe.name}{primary ? ' · Active outfit' : ''}</strong><small>{count ? `${count} approved image${count === 1 ? '' : 's'}` : 'No approved images'}</small></span></label> })}</div> : <p>Create outfits in Wardrobe Studio, then assign them here.</p>}</fieldset>
          <fieldset className="character-wardrobe-picker character-accessory-picker"><legend>Assigned accessories · each uses one isolated reference image</legend>{accessories.length ? <div>{accessories.map((accessory) => { const checked = active.accessoryIds.includes(accessory.id); return <label className={checked ? 'selected' : ''} key={accessory.id}><input type="checkbox" checked={checked} disabled={!accessory.referenceImage} onChange={(event) => patch({ accessoryIds: event.target.checked ? [...new Set([...active.accessoryIds, accessory.id])] : active.accessoryIds.filter((id) => id !== accessory.id) })} />{accessory.referenceImage?.preview ? <img src={accessory.referenceImage.preview} alt="" /> : <span><Watch size={14} /></span>}<span><strong>{accessory.name}</strong><small>{accessory.referenceImage ? '1 approved image' : 'Reference image needed'}</small></span></label> })}</div> : <p>Create reusable items in Accessory Studio, then assign them here.</p>}</fieldset>
          <div className="character-assist"><span><Sparkles size={16} /><span><strong>{llm.label} continuity assistant</strong><small>Turns rough notes into stable identity anchors.</small></span></span><button className="secondary-button" disabled={!ollamaAvailable || assisting} onClick={() => void enhance()}>{assisting ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />}Refine identity</button></div></section>
          <section className="character-setup-panel character-prompt-panel"><div className="character-section-heading"><span><Sparkles size={15} /></span><div><strong>Master prompt</strong><small>The exact single-box prompt sent to Z-Image.</small></div><em>{zPrompt.length.toLocaleString()} characters</em></div><label className="character-reference-prompt"><span><strong>Editable render prompt</strong><small>Changes here apply to the next master render.</small></span><textarea aria-label="Master reference prompt" value={zPrompt} onChange={(event) => patch({ referencePrompt: event.target.value })} /></label></section>
        </div>
        {settings.characterDetailReferencesEnabled && <section className="character-detail-references" aria-labelledby="character-detail-references-title"><header><div><span><Images size={16} /></span><span><strong id="character-detail-references-title">Character detail references</strong><small>Add up to two focused images for each named body area or visual detail. They use the character’s shared 9-picture render budget only while this add-on is enabled.</small></span></div><button type="button" className="secondary-button" onClick={addDetailReference}><Plus size={14} />Add detail</button></header>{active.detailReferences.length ? <div className="character-detail-reference-list">{active.detailReferences.map((detail, index) => <article key={detail.id}><div className="character-detail-image-pair">{[0, 1].map((imageIndex) => { const image = detail.images[imageIndex]; return <div className="character-detail-image-slot" key={imageIndex}><button type="button" className="character-detail-image" onClick={() => void chooseDetailReferenceImage(detail.id, imageIndex)} aria-label={image ? `Replace detail ${index + 1}, view ${imageIndex + 1}` : `Upload detail ${index + 1}, view ${imageIndex + 1}`}>{image?.preview ? <img src={image.preview} alt={`${detail.label || `Character detail reference ${index + 1}`} view ${imageIndex + 1}`} /> : <><ImagePlus size={17} /><span>View {imageIndex + 1}</span></>}</button>{image && <button type="button" className="character-detail-image-remove" onClick={() => removeDetailReferenceImage(detail.id, imageIndex)} aria-label={`Remove detail ${index + 1}, view ${imageIndex + 1}`}><X size={11} /></button>}</div> })}</div><div><label>Detail name or body area<input value={detail.label} onChange={(event) => patchDetailReference(detail.id, { label: event.target.value })} placeholder="Use any name you need" /></label><label>Rendering notes<textarea value={detail.notes} onChange={(event) => patchDetailReference(detail.id, { notes: event.target.value })} placeholder="Describe exactly what both views must preserve" /></label></div><button type="button" className="icon-button" onClick={() => removeDetailReference(detail.id)} aria-label={`Remove detail reference ${index + 1}`}><X size={16} /></button></article>)}</div> : <p className="character-detail-empty">No extra detail references yet. Add only the details that need more precision so the 9-picture render budget stays useful.</p>}</section>}
        {!settings.characterDetailReferencesEnabled && <div className="character-detail-disabled" role="status"><Images size={16} /><span><strong>Character detail references are off</strong><small>Enable the optional add-on in Settings to upload focused body-area or visual-detail references.</small></span></div>}
        <div className="character-production-heading"><span>Reference production</span><small>Build the master, create the turntable, then approve the useful angles.</small><em>{Number(Boolean(active.baseImage)) + Number(Boolean(active.turntableVideo)) + Number(characterReferences(active, settings.characterDetailReferencesEnabled).length > 0)} of 3 ready</em></div>
        <div className="character-production-grid">
          <article className="character-master-card"><header><span><strong>1. Identity candidates</strong><small>Queue four distinct portraits, then approve one or more.</small></span><span className={`master-engine-state ${zReady ? 'ready' : ''}`}>{zReady ? <Check size={12} /> : <AlertCircle size={12} />}{zReady ? 'Z-Image ready' : 'Z-Image unavailable'}</span></header><div className="character-media-stage">{active.baseImage?.preview ? <img src={active.baseImage.preview} alt={`${active.name} master reference`} /> : masterBusy ? <div><LoaderCircle className="spin" size={26} /><span>Creating character candidates…</span></div> : <div><ImagePlus size={26} /><span>No approved identity</span></div>}</div>{masterMessage && <div className={`character-master-message ${masterError ? 'error' : ''}`} role={masterError ? 'alert' : 'status'}>{masterBusy && <LoaderCircle className="spin" size={13} />}<span>{masterMessage}</span></div>}<footer><button className="secondary-button" disabled={masterBusy} onClick={() => void chooseImage('base')}><ImagePlus size={14} />Choose existing</button>{masterBusy && <button className="danger-button" onClick={() => batchJobs.length ? void cancelBatch() : void cancelMaster()}><CircleStop size={14} />Cancel queue</button>}<button className="secondary-button" disabled={masterBusy || !active.name.trim() || !zReady} onClick={() => void createMaster('sheet')}><Images size={14} />Create 4-view sheet</button><button className="primary-button" disabled={masterBusy || !active.name.trim() || !zReady || !zPrompt.trim()} onClick={() => void createIdentityBatch(4)}><Sparkles size={14} />{masterBusy ? 'Rendering queue…' : 'Generate 4 candidates'}</button></footer></article>
          <article><header><span><strong>2. Turntable / identity survey</strong><small>Generate a neutral face-to-full-body coverage pass with usable angles.</small></span>{activeAutomation && <span className={`status-badge ${activeAutomation.status}`}>{activeAutomation.status}</span>}</header><div className="character-media-stage">{active.turntableVideo?.preview ? <video key={active.turntableVideo.preview} src={active.turntableVideo.preview} controls preload="metadata" onLoadedMetadata={(event) => setVideoDuration(event.currentTarget.duration)} /> : activeAutomation && ['queued', 'running'].includes(activeAutomation.status) ? <div><LoaderCircle className="spin" size={26} /><span>{activeAutomation.progressLabel ?? 'Rendering identity survey…'} · {Math.round(activeAutomation.progress)}%</span></div> : <div><Orbit size={26} /><span>No turntable video</span></div>}</div><footer><button className="secondary-button" onClick={() => void chooseTurntable()}><Film size={14} />Choose rendered video</button><button className="primary-button" disabled={!connected || !active.baseImage || Boolean(activeAutomation && ['queued', 'running'].includes(activeAutomation.status))} title={!connected ? 'Connect ComfyUI before rendering' : !active.baseImage ? 'Approve a master identity first' : ''} onClick={() => void renderTurntable()}><Orbit size={14} />{activeAutomation && ['queued', 'running'].includes(activeAutomation.status) ? 'Rendering…' : 'Render turntable'}</button></footer></article>
        </div>
        <section className="character-reference-set"><header><span><strong>3. Approved references</strong><small>Choose exactly which character images are available to movies and MiniMax Reference.</small></span><button className="secondary-button" disabled={!active.turntableVideo || !videoDuration || splitting} onClick={() => void splitTurntable()}>{splitting ? <LoaderCircle className="spin" size={14} /> : <Images size={14} />}{splitting ? 'Extracting…' : 'Split into 5 angles'}</button></header><fieldset><legend>Use in movies</legend><label><input type="radio" name="character-reference-mode" checked={active.referenceMode === 'single'} onChange={() => patch({ referenceMode: 'single' })} />Single master image</label><label><input type="radio" name="character-reference-mode" checked={active.referenceMode === 'set'} onChange={() => patch({ referenceMode: 'set' })} />Selected reference images</label></fieldset><div className="character-reference-grid">{active.referenceImages.map((file, index) => { const selected = active.selectedReferencePaths === undefined || active.selectedReferencePaths.includes(file.path); return <figure className={selected ? 'selected' : ''} key={`${file.path}-${index}`}><img src={file.preview} alt={`${active.name} reference ${index + 1}`} /><figcaption><label><input type="checkbox" checked={selected} onChange={(event) => { const current = active.selectedReferencePaths ?? active.referenceImages.map((item) => item.path); patch({ referenceMode: 'set', selectedReferencePaths: event.target.checked ? [...new Set([...current, file.path])] : current.filter((path) => path !== file.path) }) }} />Use angle {index + 1}</label></figcaption><button aria-label={`Remove reference angle ${index + 1}`} onClick={() => patch({ referenceImages: active.referenceImages.filter((_, itemIndex) => itemIndex !== index), selectedReferencePaths: active.selectedReferencePaths?.filter((path) => path !== file.path) })}><X size={13} /></button></figure> })}<button className="character-add-reference" onClick={() => void chooseImage('reference')}><ImagePlus size={19} /><span>Add reference</span></button></div></section>
      </section>
    </div>
  </div>{identityCandidates.length > 0 && <div className="character-candidate-backdrop"><section className="character-candidate-modal" role="dialog" aria-modal="true" aria-labelledby="character-candidate-title"><header><span><strong id="character-candidate-title">{candidateStep === 'choose' ? 'Choose identity candidates' : 'Create identity angle survey'}</strong><small>{candidateStep === 'choose' ? 'Approve one or more. The first selected image becomes the master; every selection joins the approved reference set.' : 'LTX 2.5 records the face up close and the complete body in one crisp, stabilized survey.'}</small></span><button className="icon-button" aria-label="Close character builder" onClick={closeIdentityFlow}><X size={18} /></button></header>{candidateStep === 'choose' ? <><div className="character-candidate-grid">{identityCandidates.map((file, index) => { const selected = selectedCandidatePaths.includes(file.path); return <label className={selected ? 'selected' : ''} key={file.path}><img src={file.preview} alt={`${active.name} identity candidate ${index + 1}`} /><span><input type="checkbox" checked={selected} onChange={(event) => setSelectedCandidatePaths(event.target.checked ? [...selectedCandidatePaths, file.path] : selectedCandidatePaths.filter((path) => path !== file.path))} /><strong>Candidate {index + 1}</strong>{selectedCandidatePaths[0] === file.path && <em>Master</em>}</span></label> })}</div><footer><span>{selectedCandidatePaths.length} of {identityCandidates.length} selected</span><div><button className="secondary-button" onClick={() => { closeIdentityFlow(); void createIdentityBatch(4) }}>Generate another set</button><button className="primary-button" disabled={!selectedCandidatePaths.length} onClick={approveIdentitySelection}><Check size={14} />Approve and continue</button></div></footer></> : <><div className="character-survey-stage">{identitySurveySubmitting && !identitySurveyJob ? <div className="character-survey-progress"><LoaderCircle className="spin" size={30} /><strong>Preparing the approved identity image…</strong><p>Building and submitting the LTX 2.5 image-to-video workflow.</p><small>Please keep this window open.</small></div> : identitySurveyJob && ['queued', 'running'].includes(identitySurveyJob.status) ? <div className="character-survey-progress"><LoaderCircle className="spin" size={30} /><strong>{identitySurveyJob.progressLabel ?? 'Rendering the LTX 2.5 identity survey'}</strong><p>Close face coverage and full-body angles are being generated in the same clip.</p><div className="progress"><i style={{ width: `${identitySurveyJob.progress}%` }} /></div><small>{Math.round(identitySurveyJob.progress)}%</small></div> : identitySurveyJob?.status === 'completed' ? <div className="character-survey-result"><div>{active.turntableVideo?.preview ? <video key={active.turntableVideo.preview} src={active.turntableVideo.preview} controls preload="metadata" /> : <Film size={30} />}</div><span><Check size={18} /><span><strong>Identity survey complete</strong><small>Five frames are extracted automatically into Approved references. Review and deselect any weak angle there.</small></span></span></div> : <div className="character-survey-plan"><figure>{approvedFlowProject?.baseImage?.preview && <img src={approvedFlowProject.baseImage.preview} alt={`${active.name} approved identity master`} />}<figcaption>Approved master · visual anchor</figcaption></figure><div><span className="recommended-badge">Recommended · 10 seconds</span><strong>Face + full-body coverage</strong><ol><li><b>0–2s</b><span>Neutral full-body front view with hands and feet visible.</span></li><li><b>2–5s</b><span>Slow stabilized push to a sharp head-and-shoulders close-up.</span></li><li><b>5–7s</b><span>Front and three-quarter facial geometry held clearly.</span></li><li><b>7–10s</b><span>Pull back to full body, then reveal side and rear angles.</span></li></ol><p>No cuts, pose changes, expression changes, wardrobe changes, motion blur, smearing, or identity drift.</p>{identitySurveyError && <div className="character-survey-error" role="alert"><AlertCircle size={15} /><span><strong>Survey did not start</strong><small>{identitySurveyError}</small></span></div>}{!connected && <small className="location-builder-note">Start ComfyUI to render this LTX 2.5 survey.</small>}</div></div>}</div><footer><span>{identitySurveyJob?.status === 'completed' ? `${characterReferences(active).length} approved reference images ready` : identitySurveySubmitting ? 'Preparing LTX 2.5…' : 'Step 2 of 2 · LTX 2.5 identity survey'}</span><div>{identitySurveyJob?.status === 'completed' ? <button className="primary-button" onClick={closeIdentityFlow}><Check size={14} />Finish character</button> : <><button className="secondary-button" disabled={identitySurveySubmitting || Boolean(identitySurveyJob && ['queued', 'running'].includes(identitySurveyJob.status))} onClick={() => setCandidateStep('choose')}>Back to candidates</button><button className="primary-button" disabled={!connected || identitySurveySubmitting || Boolean(identitySurveyJob && ['queued', 'running'].includes(identitySurveyJob.status))} onClick={() => void startIdentitySurvey()}>{identitySurveySubmitting ? <LoaderCircle className="spin" size={14} /> : <Orbit size={14} />}{identitySurveySubmitting ? 'Preparing survey…' : identitySurveyJob && ['queued', 'running'].includes(identitySurveyJob.status) ? 'Rendering survey…' : 'Render LTX 2.5 survey'}</button></>}</div></footer></>}</section></div>}{candidate && <ReferenceApprovalModal title={candidate.target === 'sheet' ? 'Approve character sheet' : 'Approve character master'} description={candidate.target === 'sheet' ? 'Review identity consistency across the front, side, and back views.' : 'Approve this identity anchor before the automated turntable begins.'} image={candidate.file.preview ?? ''} approveLabel={candidate.target === 'sheet' ? 'Approve sheet' : 'Approve & make turntable'} nextStep={candidate.target === 'sheet' ? 'Approval adds the sheet to this character’s selected reference images.' : 'Approval saves this master, queues the turntable in the background, then imports the video and five reference angles here.'} approveStartsGeneration={candidate.target !== 'sheet'} onClose={() => setCandidate(null)} onRetry={() => { const target = candidate.target; setCandidate(null); void createMaster(target) }} onApprove={approveCandidate} />}</>
}
