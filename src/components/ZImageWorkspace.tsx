import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CircleStop, Dices, Film, Gauge, ImagePlus, LoaderCircle, Sparkles, WandSparkles } from 'lucide-react'
import { buildZImage, type ZImageVariant } from '../lib/zimage'
import { choices, type ObjectInfo } from '../lib/comfyInfo'
import { RenderSize } from './RenderSize'
import type { MediaFile } from '../types'

type StoredWorkspace = {
  prompt: string
  negativePrompt: string
  resolution: string
  variant: ZImageVariant
  model: string
  encoder: string
  vae: string
  seed: number
  steps: number
  guidance: number
}

const defaults: StoredWorkspace = {
  prompt: '',
  negativePrompt: '',
  resolution: '1344x768',
  variant: 'turbo',
  model: 'z_image_turbo_bf16.safetensors',
  encoder: 'qwen_3_4b.safetensors',
  vae: 'ae.safetensors',
  seed: Math.floor(Math.random() * 1_000_000_000),
  steps: 8,
  guidance: 1,
}

function readWorkspace(): StoredWorkspace {
  try {
    const saved = JSON.parse(localStorage.getItem('minimax.zimage-workspace') ?? '{}') as Partial<StoredWorkspace>
    return { ...defaults, ...saved, variant: saved.variant === 'base' ? 'base' : 'turbo' }
  }
  catch { return defaults }
}

const isZImageModel = (name: string) => /z[_\s-]?image/i.test(name)
const isTurboModel = (name: string) => isZImageModel(name) && /turbo/i.test(name)
const isBaseModel = (name: string) => isZImageModel(name) && !/turbo/i.test(name)
const preferredModel = (models: string[], variant: ZImageVariant) => models.find(variant === 'turbo' ? isTurboModel : isBaseModel)
  ?? (variant === 'turbo' ? 'z_image_turbo_bf16.safetensors' : 'z_image_bf16.safetensors')

export function ZImageWorkspace({
  url, info, connected, ollamaAvailable, llmProvider, ollamaUrl, ollamaModel, outputDirectory, attentionBackend, onUse, onUseLtx,
}: {
  url: string
  info: ObjectInfo
  connected: boolean
  ollamaAvailable: boolean
  llmProvider: 'ollama' | 'lmstudio'
  ollamaUrl: string
  ollamaModel: string
  outputDirectory: string
  attentionBackend?: string
  onUse(file: MediaFile, resolution: string): void
  onUseLtx(file: MediaFile): void
}) {
  const initial = useMemo(readWorkspace, [])
  const [prompt, setPrompt] = useState(initial.prompt)
  const [negativePrompt, setNegativePrompt] = useState(initial.negativePrompt)
  const [resolution, setResolution] = useState(initial.resolution)
  const [variant, setVariant] = useState<ZImageVariant>(initial.variant)
  const [model, setModel] = useState(initial.model)
  const [encoder, setEncoder] = useState(initial.encoder)
  const [vae, setVae] = useState(initial.vae)
  const [seed, setSeed] = useState(initial.seed)
  const [steps, setSteps] = useState(initial.steps)
  const [guidance, setGuidance] = useState(initial.guidance)
  const [job, setJob] = useState<{ id: string; url: string } | null>(null)
  const [result, setResult] = useState<MediaFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    const loadPrompt = (event: Event) => {
      const value = (event as CustomEvent<string>).detail
      if (value?.trim()) { setPrompt(value.trim()); setMessage('Image prompt loaded from Studio copilot.'); setError(false) }
    }
    window.addEventListener('minimax:load-image-prompt', loadPrompt)
    return () => window.removeEventListener('minimax:load-image-prompt', loadPrompt)
  }, [])

  useEffect(() => {
    localStorage.setItem('minimax.zimage-workspace', JSON.stringify({ prompt, negativePrompt, resolution, variant, model, encoder, vae, seed, steps, guidance }))
  }, [encoder, guidance, model, negativePrompt, prompt, resolution, seed, steps, vae, variant])

  useEffect(() => {
    if (!job) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const history = await window.minimax.getHistory(job.url, job.id)
        const entry = history[job.id] as { status?: { status_str: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> } | undefined
        if (entry?.status?.status_str === 'error') throw new Error('Z-Image failed. Check the selected components and ComfyUI log.')
        const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0]
        if (image) {
          const preview = await window.minimax.getOutputImage(job.url, image)
          const saved = await window.minimax.saveComfyOutputImage(job.url, image, outputDirectory)
          if (!disposed) {
            setResult({ ...saved, preview, kind: 'image' })
            setJob(null); setBusy(false); setError(false); setMessage('Image complete and ready to use.')
          }
          return
        }
        if (!disposed) setMessage('Rendering the image in ComfyUI…')
      } catch (caught) {
        if (!disposed) { setMessage(caught instanceof Error ? caught.message : String(caught)); setError(true); setBusy(false); setJob(null) }
        return
      }
      if (!disposed) timer = setTimeout(poll, 2000)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [job, outputDirectory])

  const installedModels = choices(info, 'UNETLoader', 'unet_name')
  const turboInstalled = installedModels.some(isTurboModel)
  const baseInstalled = installedModels.some(isBaseModel)
  const modelMatchesVariant = variant === 'turbo' ? isTurboModel(model) : isBaseModel(model)
  const available = installedModels.includes(model) && modelMatchesVariant
    && choices(info, 'CLIPLoader', 'clip_name').includes(encoder)
    && choices(info, 'VAELoader', 'vae_name').includes(vae)
  const switchVariant = (next: ZImageVariant) => {
    if (busy || next === variant) return
    setVariant(next)
    setModel(preferredModel(installedModels, next))
    setSteps(next === 'turbo' ? 8 : 40)
    setGuidance(next === 'turbo' ? 1 : 4)
    setMessage(next === 'turbo' ? 'Turbo mode selected: fast 8-step generation.' : 'Original Z-Image selected: 40-step detail mode with CFG and negative prompting.')
    setError(false)
  }
  const fields = [
    { label: 'Z-Image model', value: model, set: setModel, node: 'UNETLoader', field: 'unet_name' },
    { label: 'Text encoder', value: encoder, set: setEncoder, node: 'CLIPLoader', field: 'clip_name' },
    { label: 'Image VAE', value: vae, set: setVae, node: 'VAELoader', field: 'vae_name' },
  ]

  const create = async () => {
    if (!connected || !available || !prompt.trim()) return
    setBusy(true); setResult(null); setError(false); setMessage(`Submitting ${variant === 'turbo' ? 'Z-Image Turbo' : 'Original Z-Image'} workflow…`)
    try {
      const [width, height] = resolution.split('x').map(Number)
      const response = await window.minimax.submitPrompt(url, buildZImage(prompt.trim(), width, height, seed, model, encoder, vae, steps, guidance, variant, variant === 'base' ? negativePrompt.trim() : '', attentionBackend))
      setJob({ id: response.prompt_id, url })
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught)); setError(true); setBusy(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    try {
      await window.minimax.cancelPrompt(job.url, job.id)
      setMessage('Image generation cancelled.'); setError(false)
    } catch (caught) {
      setMessage(`Could not cancel: ${caught instanceof Error ? caught.message : String(caught)}`); setError(true)
    } finally { setJob(null); setBusy(false) }
  }

  const enhance = async () => {
    if (!ollamaAvailable || !prompt.trim() || assisting) return
    setAssisting(true); setError(false); setMessage('Asking the local prompt assistant…')
    try {
      const instruction = `Rewrite this as one polished still-image prompt for ${variant === 'turbo' ? 'Z-Image Turbo' : 'the original Z-Image base model'}. Preserve the subject and intent while improving composition, lens, lighting, environment, texture, color, and clarity. Do not describe motion, sound, timelines, or multiple shots. Return only the finished prompt.\n\nDRAFT:\n${prompt.trim()}`
      setPrompt(await window.minimax.generateWithOllama(ollamaUrl, ollamaModel, instruction, llmProvider))
      setMessage('Prompt enhanced locally. Review it before generating.')
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : String(caught)); setError(true) }
    finally { setAssisting(false) }
  }

  return <div className="standard-page zimage-workspace">
    <div className="page-heading">
      <div><p className="eyebrow">LOCAL IMAGE WORKSPACE</p><h1>Create Image</h1><p>Choose fast Z-Image Turbo or the original full-capacity model for detailed production stills.</p></div>
      <div className="heading-state"><span className={connected && available ? 'ok' : 'warn'}>{connected && available ? <Check size={15} /> : <AlertCircle size={15} />}{connected ? available ? variant === 'turbo' ? 'Turbo ready' : 'Original ready' : `${variant === 'turbo' ? 'Turbo' : 'Original'} model needed` : 'Engine offline'}</span></div>
    </div>

    <div className="zimage-workspace-grid">
      <section className="zimage-composer">
        <fieldset className="zimage-mode-picker" disabled={busy}>
          <legend>Generation mode</legend>
          <label className={variant === 'turbo' ? 'selected' : ''}><input type="radio" name="zimage-variant" checked={variant === 'turbo'} onChange={() => switchVariant('turbo')} /><Gauge size={18} /><span><strong>Z-Image Turbo</strong><small>Fast preview and everyday creation · 8 steps</small></span><em className={turboInstalled ? 'installed' : ''}>{turboInstalled ? 'Installed' : 'Model needed'}</em></label>
          <label className={variant === 'base' ? 'selected' : ''}><input type="radio" name="zimage-variant" checked={variant === 'base'} onChange={() => switchVariant('base')} /><Sparkles size={18} /><span><strong>Original Z-Image</strong><small>Full-capacity detail and stronger prompt control · 40 steps</small></span><em className={baseInstalled ? 'installed' : ''}>{baseInstalled ? 'Installed' : 'Model needed'}</em></label>
        </fieldset>
        <div className="field-group">
          <div className="field-label"><label htmlFor="zimage-prompt">Image prompt</label><span>{prompt.length.toLocaleString()} characters</span></div>
          <textarea id="zimage-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the subject, environment, composition, lens, lighting, color, and opening-frame details…" disabled={busy} />
          <div className="zimage-prompt-actions"><button className="secondary-button" onClick={() => void enhance()} disabled={busy || assisting || !ollamaAvailable || !prompt.trim()} title={ollamaAvailable ? `Enhance with ${ollamaModel}` : `Configure ${llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'} in Settings`}>{assisting ? <LoaderCircle size={15} className="spin" /> : <WandSparkles size={15} />}Enhance with {llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'}</button><small>{ollamaAvailable ? `${ollamaModel} · local` : `${llmProvider === 'lmstudio' ? 'LM Studio' : 'Ollama'} unavailable`}</small></div>
        </div>

        {variant === 'base' && <div className="field-group zimage-negative-prompt"><div className="field-label"><label htmlFor="zimage-negative-prompt">Negative prompt <small>Optional</small></label><span>{negativePrompt.length.toLocaleString()} characters</span></div><textarea id="zimage-negative-prompt" value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} placeholder="Describe artifacts or unwanted elements to suppress…" disabled={busy} /></div>}

        <RenderSize value={resolution} onChange={setResolution} provider="zimage" />
        <div className="zimage-seed-row"><label>Seed<input type="number" min="0" max="999999999999" value={seed} disabled={busy} onChange={(event) => setSeed(Number(event.target.value))} /></label><button className="secondary-button" disabled={busy} onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}><Dices size={15} />Randomize</button></div>

        <details className="zimage-model-settings">
          <summary>Model components <small>Advanced</small></summary>
          <div className="zimage-quality-controls"><label>Sampling steps<input type="number" min={variant === 'turbo' ? 4 : 28} max={variant === 'turbo' ? 20 : 50} value={steps} disabled={busy} onChange={(event) => { const min = variant === 'turbo' ? 4 : 28; const max = variant === 'turbo' ? 20 : 50; setSteps(Math.max(min, Math.min(max, Number(event.target.value)))) }} /></label><label>Guidance<input type="number" min={variant === 'turbo' ? 1 : 3} max={variant === 'turbo' ? 3 : 5} step="0.1" value={guidance} disabled={busy} onChange={(event) => { const min = variant === 'turbo' ? 1 : 3; const max = variant === 'turbo' ? 3 : 5; setGuidance(Math.max(min, Math.min(max, Number(event.target.value)))) }} /></label></div>
          <p className="field-help">{variant === 'turbo' ? 'Turbo uses 8 steps and guidance 1. It is optimized for speed and does not use negative prompting.' : 'Original Z-Image is undistilled. The official range is 28–50 steps and guidance 3–5; 40 steps and guidance 4 balance detail and render time.'}</p>
          <div className="zimage-models">{fields.map((field) => <label key={field.label}>{field.label}<select value={field.value} disabled={busy} onChange={(event) => field.set(event.target.value)}>{!choices(info, field.node, field.field).includes(field.value) && <option value={field.value}>{field.value} · unavailable</option>}{choices(info, field.node, field.field).map((name) => <option key={name}>{name}</option>)}</select></label>)}</div>
          {!available && <p className="field-help">Choose a matching {variant === 'turbo' ? 'Z-Image Turbo' : 'original Z-Image'} model registered with ComfyUI. The expected diffusion model is {variant === 'turbo' ? 'z_image_turbo_bf16.safetensors' : 'z_image_bf16.safetensors'}.</p>}
        </details>

        {message && <div className={`zimage-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{busy && <LoaderCircle size={16} className="spin" />}<span>{message}</span></div>}
        <div className="zimage-generate-bar">{busy && <button className="danger-button" onClick={() => void cancel()}><CircleStop size={16} />Cancel</button>}<button className="primary-button" disabled={busy || !connected || !available || !prompt.trim()} onClick={() => void create()}>{busy ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{busy ? 'Creating image…' : 'Create image'}</button></div>
      </section>

      <aside className="zimage-preview-panel">
        <div className="panel-heading"><div><span>OUTPUT</span><strong>Image preview</strong></div>{result && <span className="zimage-complete"><Check size={13} />Ready</span>}</div>
        <div className="zimage-preview-stage">{result?.preview ? <img src={result.preview} alt="Generated Z-Image output" /> : busy ? <div className="render-state"><LoaderCircle className="spin" /><strong>Creating your image</strong><span>{resolution.replace('x', ' × ')}</span></div> : <div className="empty-preview"><div className="preview-icon"><ImagePlus size={28} /></div><strong>Your image will appear here</strong><span>Describe the still, select a canvas, and generate it locally.</span></div>}</div>
        <div className="zimage-preview-actions"><span>{result ? `${result.name} · ${resolution.replace('x', ' × ')}` : 'Saved to ComfyUI · MiniMax_first_frames'}</span><div><button className="secondary-button" disabled={!result} onClick={() => result && onUse(result, resolution)}><ImagePlus size={16} />MiniMax I2V</button><button className="primary-button" disabled={!result} onClick={() => result && onUseLtx(result)} title="Loads an identity-preserving LTX image-to-video prompt"><Film size={16} />Send to LTX 2.5</button></div></div>
      </aside>
    </div>
  </div>
}
