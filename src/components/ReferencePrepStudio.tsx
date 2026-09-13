import { useEffect, useMemo, useState } from 'react'
import { Check, CircleStop, ImagePlus, Layers3, Scan, Send, Users, Watch, X } from 'lucide-react'
import { buildBiRefNetWorkflow } from '../lib/birefnetWorkflow'
import { buildReferenceBackgroundFillWorkflow } from '../lib/referenceBackgroundFillWorkflow'
import type { AppSettings, MediaFile } from '../types'
import type { ObjectInfo } from '../lib/comfyInfo'
import { CHARACTER_LIBRARY_EVENT, loadCharacterProjects, updateCharacterProject } from '../lib/characterLibrary'
import { ACCESSORY_LIBRARY_EVENT, loadAccessoryProjects, saveAccessoryProjects } from '../lib/accessoryLibrary'

type OutputImage = { filename: string; subfolder?: string; type?: string }
type PrepJob = { id: string; url: string; startedAt: number; completedPolls: number }
type PrepResult = { cutout: MediaFile; mask: MediaFile }
type AssignmentKind = 'character' | 'prop'
type FillStyle = 'studio' | 'scene'

const canvasSizes = {
  '1:1': [1024, 1024],
  '3:2': [1248, 832],
  '2:3': [832, 1248],
  '16:9': [1344, 756],
  '9:16': [756, 1344],
} as const

function loadPreview(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The selected preview could not be read for background fill.'))
    image.src = src
  })
}

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

async function makeCharacterFill(sourcePreview: string, cutoutPreview: string, width: number, height: number, style: FillStyle) {
  const [source, cutout] = await Promise.all([loadPreview(sourcePreview), loadPreview(cutoutPreview)])
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Your browser could not create the background-fill canvas.')
  if (style === 'scene') {
    ctx.save()
    ctx.filter = 'blur(28px) saturate(0.8) brightness(0.72)'
    drawCover(ctx, source, source.naturalWidth, source.naturalHeight, width, height)
    ctx.restore()
    const shade = ctx.createLinearGradient(0, 0, 0, height)
    shade.addColorStop(0, 'rgba(7, 13, 20, 0.12)')
    shade.addColorStop(1, 'rgba(7, 13, 20, 0.38)')
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, width, height)
  } else {
    const plate = ctx.createLinearGradient(0, 0, width, height)
    plate.addColorStop(0, '#edf1f4')
    plate.addColorStop(1, '#cbd2d9')
    ctx.fillStyle = plate
    ctx.fillRect(0, 0, width, height)
  }
  const scale = Math.min((width * 0.88) / cutout.naturalWidth, (height * 0.88) / cutout.naturalHeight)
  const drawWidth = cutout.naturalWidth * scale
  const drawHeight = cutout.naturalHeight * scale
  ctx.drawImage(cutout, (width - drawWidth) / 2, height - drawHeight - height * 0.055, drawWidth, drawHeight)
  return canvas.toDataURL('image/png')
}

export function ReferencePrepStudio({ settings, info, connected, onUseCutout, onNotice, onOpenStudio }: {
  settings: AppSettings
  info: ObjectInfo
  connected: boolean
  onUseCutout(file: MediaFile): void
  onNotice(tone: 'error' | 'success' | 'neutral', text: string): void
  onOpenStudio(view: 'characters' | 'accessories'): void
}) {
  const [source, setSource] = useState<MediaFile | null>(null)
  const [job, setJob] = useState<PrepJob | null>(null)
  const [result, setResult] = useState<PrepResult | null>(null)
  const [characters, setCharacters] = useState(() => loadCharacterProjects())
  const [props, setProps] = useState(() => loadAccessoryProjects().filter((item) => item.category === 'prop' || item.category === 'other'))
  const [assignmentKind, setAssignmentKind] = useState<AssignmentKind>('character')
  const [assignmentId, setAssignmentId] = useState('')
  const [canvasRatio, setCanvasRatio] = useState<keyof typeof canvasSizes>('3:2')
  const [fillStyle, setFillStyle] = useState<FillStyle>('studio')
  const [assigning, setAssigning] = useState(false)
  const [message, setMessage] = useState('Choose a reference image to create a transparent identity or object cutout.')
  const nativeReady = connected && Boolean(info.LoadBackgroundRemovalModel && info.RemoveBackground && info.JoinImageWithAlpha && info.MaskToImage)
  const busy = Boolean(job)
  const sourceLabel = useMemo(() => source?.name || 'No source selected', [source])
  const assignmentTargets = assignmentKind === 'character' ? characters : props

  useEffect(() => {
    const refreshCharacters = () => setCharacters(loadCharacterProjects())
    const refreshProps = () => setProps(loadAccessoryProjects().filter((item) => item.category === 'prop' || item.category === 'other'))
    refreshCharacters(); refreshProps()
    window.addEventListener(CHARACTER_LIBRARY_EVENT, refreshCharacters)
    window.addEventListener(ACCESSORY_LIBRARY_EVENT, refreshProps)
    return () => { window.removeEventListener(CHARACTER_LIBRARY_EVENT, refreshCharacters); window.removeEventListener(ACCESSORY_LIBRARY_EVENT, refreshProps) }
  }, [])

  useEffect(() => {
    if (assignmentTargets.some((target) => target.id === assignmentId)) return
    setAssignmentId(assignmentTargets[0]?.id ?? '')
  }, [assignmentId, assignmentTargets])

  const chooseSource = async () => {
    try {
      const picked = await window.minimax.chooseMedia('image')
      if (!picked) return
      setSource({ ...picked, kind: 'image', preview: await window.minimax.mediaUrl(picked.path), referenceRole: 'subject', referenceRetention: 'preserve' })
      setResult(null)
      setMessage('Reference ready. BiRefNet will produce a transparent PNG and a separate editable foreground mask.')
    } catch (error) { onNotice('error', `Could not open the reference image: ${error instanceof Error ? error.message : String(error)}`) }
  }

  const run = async () => {
    if (!source || !nativeReady || busy) return
    setMessage('Uploading the reference to ComfyUI…')
    try {
      const uploaded = await window.minimax.uploadInput(settings.comfyUrl, source.path)
      const response = await window.minimax.submitPrompt(settings.comfyUrl, buildBiRefNetWorkflow(uploaded, `reference-prep/BiRefNet_${Date.now()}`))
      setJob({ id: response.prompt_id, url: settings.comfyUrl, startedAt: Date.now(), completedPolls: 0 })
      setMessage('BiRefNet is isolating the foreground and writing the alpha mask…')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  const cancel = async () => {
    if (!job) return
    try { await window.minimax.cancelPrompt(job.url, job.id) }
    finally { setJob(null); setMessage('Background removal cancelled.') }
  }

  const waitForBackgroundFill = async (promptId: string): Promise<MediaFile> => {
    for (;;) {
      const history = await window.minimax.getHistory(settings.comfyUrl, promptId)
      const entry = history[promptId] as { status?: { status_str?: string }; outputs?: Record<string, { images?: OutputImage[] }> } | undefined
      if (entry?.status?.status_str === 'error') throw new Error('Background fill failed in ComfyUI. Check the local engine log and retry.')
      const output = Object.values(entry?.outputs ?? {}).flatMap((item) => item.images ?? [])[0]
      if (output) {
        const [preview, saved] = await Promise.all([
          window.minimax.getOutputImage(settings.comfyUrl, output),
          window.minimax.saveComfyOutputImage(settings.comfyUrl, output, settings.outputDirectory),
        ])
        return { ...saved, preview, kind: 'image', referenceRole: 'subject', referenceRetention: 'preserve', referenceType: 'full-body' }
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1200))
    }
  }

  const assignPreparedReference = async () => {
    if (!result || !source?.preview || !result.cutout.preview || !assignmentId || assigning) return
    const [width, height] = canvasSizes[canvasRatio]
    setAssigning(true)
    setMessage(`Preparing a ${canvasRatio} ${fillStyle === 'studio' ? 'neutral studio' : 'scene-matched'} background fill…`)
    try {
      const data = await makeCharacterFill(source.preview, result.cutout.preview, width, height, fillStyle)
      const uploaded = await window.minimax.uploadImageData(settings.comfyUrl, data)
      const response = await window.minimax.submitPrompt(settings.comfyUrl, buildReferenceBackgroundFillWorkflow(uploaded, `reference-prep/character-fill_${Date.now()}`))
      setMessage('ComfyUI is saving the background-filled production reference…')
      const filled = await waitForBackgroundFill(response.prompt_id)
      if (assignmentKind === 'character') {
        const character = loadCharacterProjects().find((item) => item.id === assignmentId)
        if (!character) throw new Error('The selected character is no longer available.')
        const alreadyAdded = character.referenceImages.some((item) => item.path === filled.path)
        if (!alreadyAdded && character.referenceImages.length >= 9) throw new Error(`${character.name} already has the maximum of 9 reference images. Remove an unused angle before adding another.`)
        const referenceImages = alreadyAdded ? character.referenceImages : [...character.referenceImages, filled]
        const selectedReferencePaths = [...new Set([...(character.selectedReferencePaths ?? character.referenceImages.map((item) => item.path)), filled.path])]
        updateCharacterProject(character.id, { referenceImages, referenceMode: 'set', selectedReferencePaths })
        onNotice('success', `Background-filled reference added to ${character.name}'s approved reference images. The master and source remain unchanged.`)
        onOpenStudio('characters')
      } else {
        const prop = loadAccessoryProjects().find((item) => item.id === assignmentId)
        if (!prop) throw new Error('The selected prop is no longer available.')
        const next = loadAccessoryProjects().map((item) => item.id === prop.id ? { ...item, referenceImage: { ...filled, referenceRole: 'prop' as const }, updatedAt: Date.now() } : item)
        saveAccessoryProjects(next)
        onNotice('success', `Background-filled reference assigned to ${prop.name}.`)
        onOpenStudio('accessories')
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setMessage(text)
      onNotice('error', text)
    } finally { setAssigning(false) }
  }

  useEffect(() => {
    if (!job) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const history = await window.minimax.getHistory(job.url, job.id)
        const entry = history[job.id] as { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, { images?: OutputImage[] }> } | undefined
        if (entry?.status?.status_str === 'error') throw new Error('BiRefNet failed in ComfyUI. Confirm the current ComfyUI build and model are installed.')
        // Read the two named SaveImage nodes first. Depending on the ComfyUI
        // version, history can include other UI-bearing node outputs as well,
        // so raw object-value order is not a reliable cutout/mask contract.
        const outputs = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])
        const cutoutOutput = entry?.outputs?.['6']?.images?.[0] ?? outputs.find((output) => /_cutout(?:_|\.|$)/i.test(output.filename))
        const maskOutput = entry?.outputs?.['8']?.images?.[0] ?? outputs.find((output) => /_mask(?:_|\.|$)/i.test(output.filename))
        if (cutoutOutput && maskOutput) {
          const [cutoutPreview, maskPreview, cutoutSaved, maskSaved] = await Promise.all([
            window.minimax.getOutputImage(job.url, cutoutOutput),
            window.minimax.getOutputImage(job.url, maskOutput),
            window.minimax.saveComfyOutputImage(job.url, cutoutOutput, settings.outputDirectory),
            window.minimax.saveComfyOutputImage(job.url, maskOutput, settings.outputDirectory),
          ])
          if (!disposed) {
            setResult({
              cutout: { ...cutoutSaved, preview: cutoutPreview, kind: 'image', referenceRole: 'subject', referenceRetention: 'preserve' },
              mask: { ...maskSaved, preview: maskPreview, kind: 'image', referenceRole: 'subject', referenceRetention: 'guide' },
            })
            setJob(null)
            setMessage('Cutout and foreground mask are ready. Keep the original for composition; use the cutout for identity or object reference.')
          }
          return
        }
        const completed = entry?.status?.completed || entry?.status?.status_str === 'success'
        if (completed) {
          if (job.completedPolls >= 2) throw new Error('BiRefNet completed in ComfyUI, but its saved cutout and mask were not returned in history. Check that both SaveImage nodes completed and that ComfyUI can write to its output folder.')
          if (!disposed) {
            setJob({ ...job, completedPolls: job.completedPolls + 1 })
            setMessage('BiRefNet completed. Collecting the saved cutout and alpha mask…')
          }
          return
        }
      } catch (error) {
        if (!disposed) { setJob(null); setMessage(error instanceof Error ? error.message : String(error)) }
        return
      }
      timer = setTimeout(poll, 1600)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [job, settings.outputDirectory])

  return <div className="standard-page reference-prep-studio">
    <div className="page-heading"><div><p className="eyebrow">REFERENCE PREP · LOCAL COMFYUI</p><h1>Reference Prep</h1><p>Turn a source image into a clean identity or object reference without losing the original composition source.</p></div><div className="heading-state"><span className={nativeReady ? 'ok' : 'warn'}>{nativeReady ? <Check size={15} /> : <Layers3 size={15} />}{nativeReady ? 'BiRefNet ready' : 'BiRefNet setup required'}</span></div></div>
    <div className="reference-prep-grid">
      <section className="reference-prep-panel"><header><span><Scan size={18} /><span><strong>1. Source reference</strong><small>Use a clean, well-lit subject or prop image. The original remains available for composition and style.</small></span></span><button type="button" className="secondary-button" disabled={busy} onClick={() => void chooseSource()}><ImagePlus size={15} />Choose image</button></header>{source?.preview ? <figure className="reference-prep-source"><img src={source.preview} alt={source.name} /><figcaption>{sourceLabel}</figcaption></figure> : <div className="reference-prep-empty"><ImagePlus size={28} /><strong>Choose an image</strong><span>Nothing is uploaded until you run the local workflow.</span></div>}<footer><span>{message}</span>{busy ? <button type="button" className="danger-button" onClick={() => void cancel()}><CircleStop size={15} />Cancel</button> : <button type="button" className="primary-button" disabled={!source || !nativeReady} onClick={() => void run()}><Scan size={15} />Remove background</button>}</footer></section>
      <section className="reference-prep-panel"><header><span><Layers3 size={18} /><span><strong>2. Review outputs</strong><small>BiRefNet writes a transparent RGBA cutout and a separate grayscale foreground mask.</small></span></span></header>{result ? <div className="reference-prep-results"><figure><img src={result.cutout.preview} alt="Transparent foreground cutout" /><figcaption><strong>Cutout</strong><small>Use directly for a H3 shot reference, or add a filled background before assigning it to an asset.</small><button type="button" className="secondary-button" onClick={() => onUseCutout(result.cutout)}><Send size={14} />Use in shot</button></figcaption></figure><figure><img src={result.mask.preview} alt="Foreground mask" /><figcaption><strong>Mask</strong><small>Saved locally for cleanup or compositing.</small></figcaption></figure></div> : <div className="reference-prep-empty"><Layers3 size={28} /><strong>No prepared outputs</strong><span>After processing, inspect the alpha edges before using the cutout in a generation.</span></div>}<footer><span>Native node chain: LoadBackgroundRemovalModel → RemoveBackground → JoinImageWithAlpha.</span>{result && <button type="button" className="secondary-button" onClick={() => setResult(null)}><X size={14} />Clear review</button>}</footer></section>
    </div>
    <section className="reference-prep-assignment" aria-labelledby="reference-prep-assignment-title"><header><span><Users size={18} /><span><strong id="reference-prep-assignment-title">3. Assign to an asset</strong><small>Character assignments receive a canvas-sized background fill, then are saved through ComfyUI before joining the library.</small></span></span></header><div className="reference-prep-assignment-fields"><label>Asset type<select value={assignmentKind} disabled={assigning} onChange={(event) => setAssignmentKind(event.target.value as AssignmentKind)}><option value="character">Character</option><option value="prop">Prop / accessory</option></select></label><label>{assignmentKind === 'character' ? 'Character' : 'Prop'}<select value={assignmentId} disabled={assigning || !assignmentTargets.length} onChange={(event) => setAssignmentId(event.target.value)}><option value="">{assignmentTargets.length ? `Choose a ${assignmentKind}` : `Create a ${assignmentKind} first`}</option>{assignmentTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label><label>Canvas aspect ratio<select value={canvasRatio} disabled={assigning} onChange={(event) => setCanvasRatio(event.target.value as keyof typeof canvasSizes)}>{Object.entries(canvasSizes).map(([ratio, [width, height]]) => <option key={ratio} value={ratio}>{ratio} · {width} × {height}</option>)}</select></label><label>Background fill<select value={fillStyle} disabled={assigning} onChange={(event) => setFillStyle(event.target.value as FillStyle)}><option value="studio">Neutral studio plate</option><option value="scene">Blurred source scene</option></select></label></div><footer><span>{assignmentKind === 'character' ? 'The first image becomes a character master; later assignments become selected character references.' : 'The filled image becomes the prop’s authoritative library reference.'}</span><button type="button" className="primary-button" disabled={!result || !source?.preview || !assignmentId || assigning || !connected} onClick={() => void assignPreparedReference()}>{assignmentKind === 'character' ? <Users size={15} /> : <Watch size={15} />}{assigning ? 'Filling background…' : `Assign to ${assignmentKind === 'character' ? 'character' : 'prop'}`}</button></footer></section>
    {!nativeReady && <section className="reference-prep-install" role="status"><strong>One-time ComfyUI setup</strong><span>Update ComfyUI, place <code>birefnet.safetensors</code> in <code>ComfyUI/models/background_removal/</code>, then rescan models. This tool requires the native <code>LoadBackgroundRemovalModel</code>, <code>RemoveBackground</code>, <code>JoinImageWithAlpha</code>, and <code>MaskToImage</code> nodes.</span></section>}
  </div>
}
