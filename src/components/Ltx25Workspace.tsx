import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CircleStop, Film, Gauge, Image as ImageIcon, LoaderCircle, Play, RotateCcw, Sparkles, WandSparkles } from 'lucide-react'
import { ImageCrop } from './ImageCrop'
import { RenderConstruction } from './RenderConstruction'
import type { AppSettings, GenerationJob, Ltx25GenerationOptions, Ltx25ModelSelection, MediaFile } from '../types'
import { ltx25FrameCount } from '../lib/ltx25Workflow'
import { applyDialoguePolicy } from '../lib/dialogPolicy'
import { resolveLlmConnection } from '../lib/llmProvider'

type WorkspaceState = {
  mode: 'text' | 'image'
  prompt: string
  identityPrompt: string
  referenceMode: 'start-frame' | 'msr'
  msrReferences: MediaFile[]
  msrLora: string
  duration: number
  resolution: string
  preset: 'quality' | 'turbo'
  seed: number
  liveEnabled: boolean
  livePreviewMode: 'standard' | 'sampling-override'
  noDialogue: boolean
  firstFrame: MediaFile | null
}

const defaults: WorkspaceState = {
  mode: 'text', prompt: '', identityPrompt: '', referenceMode: 'start-frame', msrReferences: [], msrLora: '', duration: 5, resolution: '1280x736', preset: 'quality',
  seed: Math.floor(Math.random() * 1_000_000_000), liveEnabled: true, livePreviewMode: 'standard', noDialogue: true, firstFrame: null,
}

const LTX25_MAX_DURATION = 20

const resolutions = {
  landscape: ['608x352', '736x416', '864x480', '960x544', '1056x608', '1152x640', '1216x672', '1280x736', '1376x768'],
  portrait: ['352x608', '416x736', '480x864', '544x960', '608x1056', '640x1152', '672x1216', '736x1280', '768x1376'],
  square: ['512x512', '640x640', '768x768'],
}

function readWorkspace(): WorkspaceState {
  try {
    const stored = JSON.parse(localStorage.getItem('ltx25.workspace') ?? '{}') as Partial<WorkspaceState>
    return { ...defaults, ...stored, duration: Math.max(2, Math.min(LTX25_MAX_DURATION, Number(stored.duration) || defaults.duration)) }
  }
  catch { return defaults }
}

function withoutPreview(file: MediaFile | null) {
  if (!file) return null
  const result = { ...file }
  delete result.preview
  return result
}

export function Ltx25Workspace({ settings, models, pipelineReady, missingNodes, connected, liveConnected, livePreview, samplingPreviewNodeType, msrEnabled, msrReady, msrLoras, latestJob, submitting, cancelling, ollamaAvailable, onChooseImage, onGenerate, onCancel }: {
  settings: AppSettings
  models: Ltx25ModelSelection
  pipelineReady: boolean
  missingNodes: readonly string[]
  connected: boolean
  liveConnected: boolean
  livePreview: { promptId: string; url: string } | null
  samplingPreviewNodeType?: string
  msrEnabled: boolean
  msrReady: boolean
  msrLoras: string[]
  latestJob?: GenerationJob
  submitting: boolean
  cancelling: boolean
  ollamaAvailable: boolean
  onChooseImage(): Promise<MediaFile | null>
  onGenerate(options: Ltx25GenerationOptions, firstFrame: MediaFile | null, liveEnabled: boolean): void
  onCancel(job: GenerationJob): void
}) {
  const initial = useMemo(readWorkspace, [])
  const [state, setState] = useState(initial)
  const llm = resolveLlmConnection(settings)
  const [refining, setRefining] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const set = <K extends keyof WorkspaceState>(key: K, value: WorkspaceState[K]) => setState((current) => ({ ...current, [key]: value }))
  const requiredNodes = 13
  const modelReady = Boolean(models.diffusion && models.textEncoder && models.videoVae && models.audioVae && models.latentUpscaler && pipelineReady)
  const samplingPreviewAvailable = Boolean(samplingPreviewNodeType)
  const msrAvailable = msrEnabled && msrReady && msrLoras.length > 0
  const [width, height] = state.resolution.split('x').map(Number)
  const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait'

  useEffect(() => {
    localStorage.setItem('ltx25.workspace', JSON.stringify({ ...state, firstFrame: withoutPreview(state.firstFrame) }))
  }, [state])

  useEffect(() => {
    const file = state.firstFrame
    if (!file || file.preview || file.kind !== 'image') return
    void window.minimax.fileDataUrl(file.path).then((preview) => set('firstFrame', { ...file, preview })).catch(() => undefined)
  }, [state.firstFrame])

  useEffect(() => {
    if (state.referenceMode === 'msr' && !state.msrLora && msrLoras[0]) set('msrLora', msrLoras[0])
  }, [msrLoras, state.msrLora, state.referenceMode])

  const refine = async () => {
    if (!state.prompt.trim() || !llm.model) return
    setRefining(true); setSuggestion('')
    try {
      const audioDirection = state.noDialogue ? 'Specify only ambient sound; do not add dialogue, narration, singing, lip-sync, subtitles, captions, or text overlays.' : 'Specify synchronized dialogue or sound when useful.'
      const result = await window.minimax.generateWithOllama(llm.url, llm.model, `Rewrite this as one production-ready LTX-2.5 ${state.mode === 'image' ? 'image-to-video motion' : 'text-to-video'} prompt. Preserve intent. Specify subject action, camera, lighting, physical motion, pacing, and audio. ${audioDirection} Return only the prompt.\n\nDRAFT:\n${state.prompt.trim()}`, llm.provider)
      setSuggestion(result)
    } finally { setRefining(false) }
  }

  return <div className="create-page ltx-workspace">
    <div className="page-heading">
      <div><p className="eyebrow">SEPARATE PROVIDER WORKSPACE</p><h1>Create with LTX‑2.5</h1><p>Native LTX text-to-video and image-to-video with synchronized audio.</p></div>
      <div className="heading-state"><span className={modelReady ? 'ok' : 'warn'}>{modelReady ? <Check size={15} /> : <AlertCircle size={15} />}{modelReady ? 'Verified LTX pipeline' : missingNodes.length ? 'Update ComfyUI nodes' : 'LTX models missing'}</span></div>
    </div>
    <div className="workspace-grid">
      <section className="composer-panel">
        <div className="provider-note"><Sparkles size={17} /><span><strong>Independent from MiniMax</strong><small>This workspace keeps separate prompts, media, resolution, seed, quality preset, live preview, and output.</small></span><button type="button" onClick={() => { setState({ ...defaults, seed: Math.floor(Math.random() * 1_000_000_000) }); setSuggestion('') }}><RotateCcw size={14} />Reset LTX</button></div>
        <div className="mode-tabs ltx-mode-tabs" role="tablist" aria-label="LTX generation mode">
          <button role="tab" aria-selected={state.mode === 'text'} className={state.mode === 'text' ? 'selected' : ''} onClick={() => set('mode', 'text')}><WandSparkles size={18} /><span><strong>Text</strong><small>Prompt to video</small></span></button>
          <button role="tab" aria-selected={state.mode === 'image'} className={state.mode === 'image' ? 'selected' : ''} onClick={() => set('mode', 'image')}><ImageIcon size={18} /><span><strong>Image</strong><small>Animate a first frame</small></span></button>
        </div>
        <div className="field-group prompt-field">
          <div className="field-label"><label htmlFor="ltx-prompt">Creative direction</label><span>{state.prompt.length.toLocaleString()} characters</span></div>
          {state.mode === 'image' && state.identityPrompt.trim() && <details className="prompt-system-chip"><summary><span>Identity Prompt</span><small>Applied with this image handoff</small></summary><p>{state.identityPrompt}</p></details>}
          <textarea id="ltx-prompt" value={state.prompt} onChange={(event) => set('prompt', event.target.value)} placeholder={state.mode === 'image' ? 'Describe how the first frame moves, camera direction, dialogue, and sound…' : 'Describe the scene, action, camera, lighting, dialogue, and sound…'} />
          <label className="no-dialogue-toggle" title="Adds a render instruction that blocks spoken words, narration, singing, lip-sync, captions, and text overlays."><input type="checkbox" checked={state.noDialogue} onChange={(event) => set('noDialogue', event.target.checked)} /><span><strong>No dialogue</strong><small>{state.noDialogue ? 'Ambient sound only' : 'Dialogue and lip-sync allowed'}</small></span></label>
          <div className="prompt-tools"><div className="prompt-tool-buttons"><button type="button" onClick={() => void refine()} disabled={!ollamaAvailable || refining || !state.prompt.trim()}>{refining ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}Refine for LTX</button></div><span className={`local-model-chip ${ollamaAvailable ? 'online' : ''}`}><span />{ollamaAvailable ? llm.model : `${llm.label} offline`}</span></div>
          {suggestion && <div className="assistant-result"><div className="assistant-result-heading"><span><Sparkles size={14} />Local suggestion</span><small>Review before applying</small></div><textarea aria-label="LTX prompt suggestion" value={suggestion} readOnly /><div className="assistant-actions"><button className="secondary-button" onClick={() => setSuggestion('')}>Dismiss</button><button className="primary-button" onClick={() => { set('prompt', suggestion); setSuggestion('') }}><Check size={14} />Use suggestion</button></div></div>}
        </div>
        {state.mode === 'image' && <div className="ltx-image-input"><div className={`media-drop ${state.firstFrame ? 'has-file' : ''}`}>{state.firstFrame?.preview && <img src={state.firstFrame.preview} alt="Selected LTX first frame" />}<div className="media-drop-content"><span className="upload-icon"><ImageIcon size={19} /></span><strong>{state.firstFrame?.name ?? 'First frame'}</strong><small>{state.firstFrame ? 'Ready for LTX I2V' : 'PNG, JPG, or WebP'}</small><button onClick={async () => { const file = await onChooseImage(); if (file) set('firstFrame', file) }}>{state.firstFrame ? 'Replace' : 'Choose image'}</button></div>{state.firstFrame && <button className="remove-media" onClick={() => set('firstFrame', null)} aria-label="Remove first frame">×</button>}</div>{state.firstFrame && <ImageCrop label="LTX first frame" file={state.firstFrame} resolution={state.resolution} onChange={(file) => set('firstFrame', file)} />}</div>}
        <fieldset className="render-size"><legend>Output size</legend><label>Orientation<select value={orientation} onChange={(event) => { const next = event.target.value as keyof typeof resolutions; set('resolution', next === 'square' ? '768x768' : resolutions[next][7] ?? resolutions[next][0]) }}><option value="landscape">Landscape</option><option value="portrait">Portrait</option><option value="square">Square</option></select></label><label>Resolution<select value={state.resolution} onChange={(event) => set('resolution', event.target.value)}>{resolutions[orientation].map((size) => <option key={size}>{size}</option>)}</select></label><p className="field-help">32-pixel aligned for LTX‑2.5. Quality renders stage one at half size, then use the official latent 2× refinement pipeline.</p></fieldset>
        <div className="render-controls"><div className="field-group"><label htmlFor="ltx-duration">Duration</label><div className="range-line"><input id="ltx-duration" type="range" min="2" max={LTX25_MAX_DURATION} step="1" value={state.duration} onChange={(event) => set('duration', Number(event.target.value))} /><output>{state.duration}s</output></div><p className="field-help">LTX‑2.5 supports clips up to {LTX25_MAX_DURATION} seconds.</p></div><div className="field-group"><label htmlFor="ltx-preset">Render preset</label><select id="ltx-preset" value={state.preset} onChange={(event) => set('preset', event.target.value as 'quality' | 'turbo')}><option value="quality">Quality · official two-stage 8 + 3</option><option value="turbo">Turbo · distilled single-stage 8</option></select></div></div>
        <div className="render-extras"><label><input type="checkbox" checked={state.liveEnabled} onChange={(event) => set('liveEnabled', event.target.checked)} />Live preview <small>{state.liveEnabled ? liveConnected ? 'Connected · waiting for LTX frames' : 'Connecting to ComfyUI…' : 'Off'}</small></label><label className="live-preview-mode"><span>Preview source</span><select value={state.livePreviewMode} disabled={!state.liveEnabled} onChange={(event) => set('livePreviewMode', event.target.value as WorkspaceState['livePreviewMode'])}><option value="standard">Standard decoded frame</option><option value="sampling-override" disabled={!samplingPreviewAvailable}>LTX sampling override · 8 fps</option></select></label><p className={`field-help ${state.livePreviewMode === 'sampling-override' && !samplingPreviewAvailable ? 'upscale-warning' : ''}`}>{state.livePreviewMode === 'sampling-override' && samplingPreviewAvailable ? 'LTX2 Sampling Preview Override is wired from the diffusion model to both LTX guiders and uses the video VAE for sampling-time frames. The latent upscaler is intentionally not attached.' : state.livePreviewMode === 'sampling-override' ? 'LTX sampling preview requires LTX2SamplingPreviewOverride from ComfyUI-KJNodes. Install or enable it, restart ComfyUI, then refresh the Local engine.' : samplingPreviewAvailable ? 'The LTX sampling override is available. Select it to receive sampling-time frames during the render.' : 'A decoded first frame is always published; install ComfyUI-KJNodes to enable sampling-time LTX previews.'}</p></div>
        <details className="ltx-advanced"><summary>Advanced</summary><div className="advanced-grid"><div className="field-group"><label htmlFor="ltx-seed">Seed</label><input id="ltx-seed" className="number-input" type="number" min="0" max="999999999999" value={state.seed} onChange={(event) => set('seed', Number(event.target.value))} /></div><div className="readonly-value">Euler ancestral · CFG 1</div><div className="readonly-value">{state.preset === 'quality' ? 'Official 8 + 3 sigmas' : 'Official distilled 8 sigmas'}</div></div></details>
        <p className="field-help render-duration">{ltx25FrameCount(state.duration)} frames · 24 fps · native synchronized audio. {requiredNodes} LTX core node families verified.{missingNodes.length ? ` Missing: ${missingNodes.join(', ')}.` : ''}</p>
        <div className="generate-bar"><div className="generation-summary"><Gauge size={17} /><span><strong>{state.resolution.replace('x', ' × ')}</strong><small>{state.duration}s · {state.preset === 'quality' ? 'two-stage quality' : '8-step turbo'}</small></span></div><div className="generate-actions">{latestJob && ['queued', 'running'].includes(latestJob.status) && <button className="danger-button" onClick={() => onCancel(latestJob)} disabled={cancelling}><CircleStop size={16} />{cancelling ? 'Stopping…' : 'Cancel'}</button>}<button className="primary-button" disabled={submitting || !connected || !modelReady || !(state.prompt.trim() || state.identityPrompt.trim()) || (state.mode === 'image' && !state.firstFrame) || (state.liveEnabled && state.livePreviewMode === 'sampling-override' && !samplingPreviewAvailable)} onClick={() => onGenerate({ mode: state.mode, prompt: applyDialoguePolicy([state.identityPrompt.trim(), state.referenceMode === 'msr' ? state.msrReferences.map((file, index) => `Image ${index + 1}: ${file.name} is an authoritative identity, subject, item, or background reference.`).join('\n') : '', state.prompt.trim()].filter(Boolean).join('\n\n'), state.noDialogue), width, height, duration: state.duration, seed: state.seed, preset: state.preset, previewOverride: state.liveEnabled && state.livePreviewMode === 'sampling-override' && samplingPreviewNodeType ? { nodeType: samplingPreviewNodeType, fps: 8 } : undefined, msr: state.referenceMode === 'msr' && state.msrLora ? { loraName: state.msrLora, references: state.msrReferences.map((file) => file.path) } : undefined, filenamePrefix: `video/LTX_2.5_${Date.now()}` }, state.firstFrame, state.liveEnabled)}>{submitting ? <LoaderCircle size={18} className="spin" /> : <Play size={18} fill="currentColor" />}{submitting ? 'Submitting…' : 'Generate with LTX'}</button></div></div>
      </section>
      <aside className="preview-panel"><div className="panel-heading"><div><span>LTX OUTPUT</span><strong>Current LTX workspace</strong></div>{latestJob && <span className={`status-badge ${latestJob.status}`}>{latestJob.status}</span>}</div>{state.liveEnabled && livePreview?.promptId === latestJob?.promptId && latestJob && ['queued', 'running'].includes(latestJob.status) && <figure className="live-preview"><img src={livePreview?.url ?? ''} alt="Live LTX generation preview" /><figcaption>LTX live preview · intermediate frame</figcaption></figure>}<div className="preview-stage">{latestJob?.outputUrl ? <video src={latestJob.outputUrl} controls autoPlay loop playsInline /> : latestJob && ['queued', 'running'].includes(latestJob.status) ? <div className="render-state constructing"><RenderConstruction /><strong>{latestJob.progressLabel ?? (latestJob.status === 'queued' ? 'Waiting in queue' : 'Rendering with LTX‑2.5')}</strong><span>{latestJob.currentStep !== undefined && latestJob.totalSteps ? `Live sampler step ${latestJob.currentStep} of ${latestJob.totalSteps}` : `${latestJob.width} × ${latestJob.height} · ${latestJob.duration}s`}</span><div className="progress"><i style={{ width: `${latestJob.progress}%` }} /></div><small>{Math.round(latestJob.progress)}% · live ComfyUI status</small></div> : <div className="empty-preview"><div className="preview-icon"><Film size={28} /></div><strong>Your LTX video will appear here</strong><span>Choose Text or Image, then send the shot to ComfyUI.</span></div>}</div><div className="pipeline-summary"><Pipeline ready={Boolean(models.diffusion)} label="LTX diffusion" value={models.diffusion} /><Pipeline ready={Boolean(models.textEncoder)} label="Gemma encoder" value={models.textEncoder} /><Pipeline ready={Boolean(models.videoVae && models.audioVae && models.latentUpscaler)} label="Video pipeline" value={models.videoVae && models.audioVae && models.latentUpscaler ? 'Video/audio VAEs + latent 2×' : 'Missing component'} /></div></aside>
    </div>
  </div>
}

function Pipeline({ ready, label, value }: { ready: boolean; label: string; value: string }) {
  return <div className="pipeline-item"><span className={ready ? 'ready' : ''}>{ready ? <Check size={13} /> : <AlertCircle size={13} />}</span><div><strong>{label}</strong><small title={value}>{value || 'Not detected'}</small></div></div>
}
