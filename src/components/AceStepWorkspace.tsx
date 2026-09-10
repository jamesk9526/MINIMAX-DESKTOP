import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CircleStop, Disc3, Gauge, Headphones, LoaderCircle, Music2, Play, RotateCcw, Sparkles, WandSparkles } from 'lucide-react'
import type { AceStepGenerationOptions, AceStepModelSelection, AppSettings, GenerationJob } from '../types'
import { resolveLlmConnection } from '../lib/llmProvider'

type MusicState = {
  model: 'sft' | 'base'
  tags: string
  lyrics: string
  instrumental: boolean
  duration: number
  bpm: number
  timeSignature: string
  language: string
  keyScale: string
  seed: number
  generateAudioCodes: boolean
}

const defaults: MusicState = {
  model: 'sft', tags: '', lyrics: '', instrumental: false, duration: 60, bpm: 120,
  timeSignature: '4', language: 'en', keyScale: 'C major',
  seed: Math.floor(Math.random() * 1_000_000_000), generateAudioCodes: true,
}

const keys = ['C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor', 'E♭ major', 'E♭ minor', 'E major', 'E minor', 'F major', 'F minor', 'F# major', 'F# minor', 'G major', 'G minor', 'A♭ major', 'A♭ minor', 'A major', 'A minor', 'B♭ major', 'B♭ minor', 'B major', 'B minor']
const languages = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']] as const

function readState(): MusicState {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('acestep.workspace') ?? '{}') } }
  catch { return defaults }
}

export function AceStepWorkspace({ settings, models, connected, pipelineReady, missingNodes, latestJob, submitting, cancelling, ollamaAvailable, onGenerate, onCancel }: {
  settings: AppSettings
  models: AceStepModelSelection
  connected: boolean
  pipelineReady: boolean
  missingNodes: readonly string[]
  latestJob?: GenerationJob
  submitting: boolean
  cancelling: boolean
  ollamaAvailable: boolean
  onGenerate(options: AceStepGenerationOptions): void
  onCancel(job: GenerationJob): void
}) {
  const initial = useMemo(readState, [])
  const [state, setState] = useState(initial)
  const llm = resolveLlmConnection(settings)
  const [refining, setRefining] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const set = <K extends keyof MusicState>(key: K, value: MusicState[K]) => setState((current) => ({ ...current, [key]: value }))
  const selectedModel = state.model === 'sft' ? models.sft : models.base
  const sharedReady = Boolean(models.vae && models.textEncoderSmall && models.textEncoderLarge)
  const modelReady = Boolean(selectedModel && sharedReady && pipelineReady)

  useEffect(() => { localStorage.setItem('acestep.workspace', JSON.stringify(state)) }, [state])
  useEffect(() => {
    if (state.model === 'sft' && !models.sft && models.base) set('model', 'base')
    if (state.model === 'base' && !models.base && models.sft) set('model', 'sft')
  }, [models.base, models.sft, state.model])

  const refine = async () => {
    if (!state.tags.trim() || !llm.model) return
    setRefining(true); setSuggestion('')
    try {
      const result = await window.minimax.generateWithOllama(llm.url, llm.model, `Rewrite this as a concise production brief for ACE-Step 1.5 music generation. Preserve the intent and specify genre, mood, tempo feel, instruments, vocal character, arrangement, and production texture. Do not write lyrics. Return only the finished music direction.\n\nDRAFT:\n${state.tags.trim()}`, llm.provider)
      setSuggestion(result)
    } finally { setRefining(false) }
  }

  const reset = () => { setState({ ...defaults, seed: Math.floor(Math.random() * 1_000_000_000), model: models.sft ? 'sft' : 'base' }); setSuggestion('') }
  const running = latestJob && ['queued', 'running'].includes(latestJob.status)
  const generate = () => onGenerate({ ...state, lyrics: state.instrumental ? '' : state.lyrics, filenamePrefix: `audio/ACE_Step_1.5_${state.model}_${Date.now()}` })

  return <div className="create-page ace-workspace">
    <div className="page-heading">
      <div><p className="eyebrow">COMFYUI MUSIC WORKSPACE</p><h1>Music with ACE‑Step 1.5</h1><p>Generate complete songs and instrumentals locally with the official ACE-Step audio pipeline.</p></div>
      <div className="heading-state"><span className={modelReady ? 'ok' : 'warn'}>{modelReady ? <Check size={15} /> : <AlertCircle size={15} />}{modelReady ? `${state.model.toUpperCase()} pipeline ready` : missingNodes.length ? 'Update ComfyUI' : 'ACE-Step models missing'}</span></div>
    </div>
    <div className="workspace-grid ace-workspace-grid">
      <section className="composer-panel">
        <div className="provider-note ace-provider-note"><Music2 size={18} /><span><strong>Native ComfyUI generation</strong><small>Choose XL SFT or XL Base. Music settings and history stay separate from video projects.</small></span><button type="button" onClick={reset}><RotateCcw size={14} />Reset music</button></div>

        <fieldset className="model-picker"><legend>ACE-Step model</legend><div className="model-choice-grid">
          <label className={state.model === 'sft' ? 'selected' : ''}><input type="radio" name="ace-model" checked={state.model === 'sft'} disabled={!models.sft} onChange={() => set('model', 'sft')} /><span><strong>XL SFT</strong><small>Instruction-tuned · official CFG 7</small></span><em>{models.sft ? 'Ready' : 'Missing'}</em></label>
          <label className={state.model === 'base' ? 'selected' : ''}><input type="radio" name="ace-model" checked={state.model === 'base'} disabled={!models.base} onChange={() => set('model', 'base')} /><span><strong>XL Base</strong><small>Base model · official CFG 6</small></span><em>{models.base ? 'Ready' : 'Missing'}</em></label>
        </div></fieldset>

        <div className="field-group prompt-field ace-direction-field"><div className="field-label"><label htmlFor="ace-tags">Music direction</label><span>{state.tags.length.toLocaleString()} characters</span></div><textarea id="ace-tags" value={state.tags} onChange={(event) => set('tags', event.target.value)} placeholder="Genre, mood, instruments, vocal style, arrangement, and production texture…" />
          <div className="prompt-tools"><div className="prompt-tool-buttons"><button type="button" onClick={() => void refine()} disabled={!ollamaAvailable || refining || !state.tags.trim()}>{refining ? <LoaderCircle size={14} className="spin" /> : <WandSparkles size={14} />}Refine music direction</button></div><span className={`local-model-chip ${ollamaAvailable ? 'online' : ''}`}><span />{ollamaAvailable ? llm.model : `${llm.label} offline`}</span></div>
          {suggestion && <div className="assistant-result"><div className="assistant-result-heading"><span><Sparkles size={14} />Local suggestion</span><small>Review before applying</small></div><textarea aria-label="ACE-Step music direction suggestion" value={suggestion} readOnly /><div className="assistant-actions"><button className="secondary-button" onClick={() => setSuggestion('')}>Dismiss</button><button className="primary-button" onClick={() => { set('tags', suggestion); setSuggestion('') }}><Check size={14} />Use suggestion</button></div></div>}
        </div>

        <div className="ace-lyrics-heading"><span><strong>Lyrics</strong><small>Use section labels such as [Verse], [Chorus], and [Bridge].</small></span><label className="compact-toggle"><input type="checkbox" checked={state.instrumental} onChange={(event) => set('instrumental', event.target.checked)} /><span>Instrumental</span></label></div>
        <textarea className="ace-lyrics" aria-label="Song lyrics" disabled={state.instrumental} value={state.lyrics} onChange={(event) => set('lyrics', event.target.value)} placeholder={state.instrumental ? 'Instrumental mode uses no sung lyrics.' : '[Verse 1]\nWrite lyrics here…\n\n[Chorus]\nAdd the hook…'} />

        <div className="ace-control-grid">
          <div className="field-group"><label htmlFor="ace-duration">Duration</label><div className="range-line"><input id="ace-duration" type="range" min="10" max="240" step="5" value={state.duration} onChange={(event) => set('duration', Number(event.target.value))} /><output>{state.duration}s</output></div></div>
          <div className="field-group"><label htmlFor="ace-bpm">Tempo</label><div className="number-suffix"><input id="ace-bpm" type="number" min="10" max="300" value={state.bpm} onChange={(event) => set('bpm', Math.max(10, Math.min(300, Number(event.target.value))))} /><span>BPM</span></div></div>
          <div className="field-group"><label htmlFor="ace-key">Key</label><select id="ace-key" value={state.keyScale} onChange={(event) => set('keyScale', event.target.value)}>{keys.map((key) => <option key={key}>{key}</option>)}</select></div>
          <div className="field-group"><label htmlFor="ace-time">Time signature</label><select id="ace-time" value={state.timeSignature} onChange={(event) => set('timeSignature', event.target.value)}><option value="4">4/4</option><option value="3">3/4</option><option value="6">6/8</option></select></div>
          <div className="field-group"><label htmlFor="ace-language">Lyrics language</label><select id="ace-language" value={state.language} disabled={state.instrumental} onChange={(event) => set('language', event.target.value)}>{languages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="field-group"><label htmlFor="ace-seed">Seed</label><input id="ace-seed" className="number-input" type="number" min="0" max="999999999999" value={state.seed} onChange={(event) => set('seed', Number(event.target.value))} /></div>
        </div>
        <label className="audio-code-option"><input type="checkbox" checked={state.generateAudioCodes} onChange={(event) => set('generateAudioCodes', event.target.checked)} /><span><strong>Generate audio codes</strong><small>Recommended for quality; adds language-model processing before diffusion.</small></span></label>
        {!modelReady && <div className="pipeline-warning" role="status"><AlertCircle size={16} /><span><strong>ACE-Step is not ready</strong><small>{missingNodes.length ? `Missing ComfyUI nodes: ${missingNodes.join(', ')}.` : `Add ${!selectedModel ? `the ${state.model.toUpperCase()} checkpoint, ` : ''}${!models.vae ? 'ace_1.5_vae, ' : ''}${!models.textEncoderSmall || !models.textEncoderLarge ? 'and both Qwen ACE 1.5 encoders' : ''} to the configured model folders.`}</small></span></div>}
        <div className="generate-bar"><div className="generation-summary"><Gauge size={17} /><span><strong>{state.duration}s · {state.bpm} BPM</strong><small>{state.model.toUpperCase()} · 50 Euler steps · FLAC</small></span></div><div className="generate-actions">{running && <button className="danger-button" onClick={() => onCancel(latestJob)} disabled={cancelling}><CircleStop size={16} />{cancelling ? 'Stopping…' : 'Cancel'}</button>}<button className="primary-button" disabled={submitting || !connected || !modelReady || !state.tags.trim() || (!state.instrumental && !state.lyrics.trim())} onClick={generate}>{submitting ? <LoaderCircle size={18} className="spin" /> : <Play size={18} fill="currentColor" />}{submitting ? 'Submitting…' : 'Generate music'}</button></div></div>
      </section>

      <aside className="preview-panel ace-preview-panel"><div className="panel-heading"><div><span>ACE-STEP OUTPUT</span><strong>Current music workspace</strong></div>{latestJob && <span className={`status-badge ${latestJob.status}`}>{latestJob.status}</span>}</div>
        <div className="ace-preview-stage">{latestJob?.outputUrl ? <div className="audio-result"><div className="album-placeholder"><Disc3 size={64} /><span>{state.model.toUpperCase()}</span></div><strong>{state.tags || 'Generated track'}</strong><audio src={latestJob.outputUrl} controls preload="metadata" /><a className="secondary-button" href={latestJob.outputUrl} target="_blank" rel="noreferrer">Open audio file</a></div> : running ? <div className="render-state"><LoaderCircle className="spin" size={36} /><strong>{latestJob.progressLabel ?? 'Generating music with ACE-Step'}</strong><span>{state.duration}s · {state.bpm} BPM · {state.model.toUpperCase()}</span><div className="progress"><i style={{ width: `${latestJob.progress}%` }} /></div><small>{Math.round(latestJob.progress)}% · live ComfyUI status</small></div> : <div className="empty-preview"><div className="preview-icon"><Headphones size={30} /></div><strong>Your track will appear here</strong><span>Describe the music, add lyrics or choose Instrumental, then send it to ComfyUI.</span></div>}</div>
        <div className="pipeline-summary"><Pipeline ready={Boolean(selectedModel)} label={`${state.model.toUpperCase()} diffusion`} value={selectedModel} /><Pipeline ready={Boolean(models.textEncoderSmall && models.textEncoderLarge)} label="ACE text encoders" value={models.textEncoderSmall && models.textEncoderLarge ? `${models.textEncoderSmall} + ${models.textEncoderLarge}` : ''} /><Pipeline ready={Boolean(models.vae)} label="Audio VAE" value={models.vae} /></div>
      </aside>
    </div>
  </div>
}

function Pipeline({ ready, label, value }: { ready: boolean; label: string; value: string }) {
  return <div className="pipeline-item"><span className={ready ? 'ready' : ''}>{ready ? <Check size={13} /> : <AlertCircle size={13} />}</span><div><strong>{label}</strong><small title={value}>{value || 'Not detected'}</small></div></div>
}
