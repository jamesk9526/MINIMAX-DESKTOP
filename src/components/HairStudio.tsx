import { useEffect, useMemo, useState } from 'react'
import { Check, CircleStop, ImagePlus, LoaderCircle, Plus, Scissors, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import { HAIR_LIBRARY_EVENT, loadHairStyleProjects, newHairStyleProject, saveHairStyleProjects } from '../lib/hairLibrary'
import { choices, type ObjectInfo } from '../lib/comfyInfo'
import { buildZImage } from '../lib/zimage'
import { resolveAttentionBackend } from '../lib/attentionBackend'
import type { AppSettings, HairStyleProject, MediaFile } from '../types'
import { ReferenceApprovalModal } from './ReferenceApprovalModal'
import { resolveLlmConnection } from '../lib/llmProvider'
import { analyzeReferenceImage } from '../lib/referenceAnalysis'

function cleanPrompt(value: string) {
  return value.replace(/\\\s*(?:\r?\n|$)/g, ' ').replace(/[*_#`]+/g, '').replace(/\s+/g, ' ').trim()
}

export function HairStudio({ settings, info, connected, ollamaAvailable, onNotice }: { settings: AppSettings; info: ObjectInfo; connected: boolean; ollamaAvailable: boolean; onNotice(tone: 'error' | 'success' | 'neutral', text: string): void }) {
  const initial = useMemo(() => { const saved = loadHairStyleProjects(); return saved.length ? saved : [newHairStyleProject()] }, [])
  const [projects, setProjects] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0].id)
  const [job, setJob] = useState<{ id: string; url: string; hairStyleId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [candidate, setCandidate] = useState<{ hairStyleId: string; file: MediaFile } | null>(null)
  const active = projects.find((item) => item.id === activeId) ?? projects[0]
  const llm = resolveLlmConnection(settings)
  const commit = (next: HairStyleProject[]) => { setProjects(next); saveHairStyleProjects(next) }
  const patch = (change: Partial<HairStyleProject>) => commit(projects.map((item) => item.id === active.id ? { ...item, ...change, updatedAt: Date.now() } : item))
  const patchById = (id: string, change: Partial<HairStyleProject>) => setProjects((current) => { const next = current.map((item) => item.id === id ? { ...item, ...change, updatedAt: Date.now() } : item); saveHairStyleProjects(next); return next })
  useEffect(() => { const refresh = () => { const next = loadHairStyleProjects(); if (next.length) setProjects(next) }; window.addEventListener(HAIR_LIBRARY_EVENT, refresh); return () => window.removeEventListener(HAIR_LIBRARY_EVENT, refresh) }, [])

  const prompt = active.referencePrompt.trim() || [
    `Professional three-view hairstyle design board for “${active.name}”.`,
    active.description,
    `Hair texture: ${active.texture}. Hair length: ${active.length}.`,
    active.color && `Exact hair color and tonal variation: ${active.color}.`,
    `Hairline and part: ${active.hairline}. Finish: ${active.finish}.`,
    `${active.visualStyle}. Show the exact same hairstyle from front, clean side profile, and back on one neutral featureless salon mannequin head. Hair is the only subject: preserve exact silhouette, volume, parting, fringe, layers, curl or braid pattern, edges, length, and color in every view. Crop from upper shoulders to above the head. Seamless mid-gray background, soft even salon lighting, sharp individual strands, no facial identity, no clothing details, no jewelry, no hat, no hands, no text, no labels, no logo, no duplicate hairstyle, no fantasy ornaments unless specified.`,
  ].filter(Boolean).join(' ')
  const zModel = choices(info, 'UNETLoader', 'unet_name').find((name) => /z[_-]?image.*turbo/i.test(name)) ?? 'z_image_turbo_bf16.safetensors'
  const zEncoder = choices(info, 'CLIPLoader', 'clip_name').find((name) => /qwen[_-]?3[_-]?4b/i.test(name)) ?? 'qwen_3_4b.safetensors'
  const zVae = choices(info, 'VAELoader', 'vae_name').find((name) => /^ae\.safetensors$/i.test(name)) ?? 'ae.safetensors'
  const zReady = connected && choices(info, 'UNETLoader', 'unet_name').includes(zModel) && choices(info, 'CLIPLoader', 'clip_name').includes(zEncoder) && choices(info, 'VAELoader', 'vae_name').includes(zVae)

  const enhance = async () => {
    if (!ollamaAvailable || assisting) return
    setAssisting(true)
    try {
      const result = await window.minimax.generateWithOllama(llm.url, llm.model, `Rewrite these notes as one precise hairstyle reference prompt. Preserve exact texture, curl or braid pattern, silhouette, length, layers, part, fringe, hairline, edges, color, tonal variation, volume, and finish. Describe hair only; never invent a face, person, outfit, jewelry, headwear, or accessory. End with: the same hairstyle shown from front, side, and back on a neutral featureless salon mannequin head, upper-shoulder crop, mid-gray background, even studio lighting, sharp individual strands, no text or labels. Return one plain-text paragraph only.\n\nName: ${active.name}\nDesign: ${active.description}\nTexture: ${active.texture}\nLength: ${active.length}\nColor: ${active.color}\nHairline and part: ${active.hairline}\nFinish: ${active.finish}`, llm.provider)
      patch({ referencePrompt: cleanPrompt(result) }); onNotice('success', `Hair design prompt refined locally with ${llm.label}.`)
    } catch (cause) { onNotice('error', cause instanceof Error ? cause.message : String(cause)) }
    finally { setAssisting(false) }
  }
  const chooseImage = async () => { const picked = await window.minimax.chooseMedia('image'); if (!picked) return; const projectId = active.id; patch({ referenceImage: { ...picked, kind: 'image', preview: await window.minimax.mediaUrl(picked.path) } }); if (!ollamaAvailable) { onNotice('neutral', 'Image added. Connect a local vision model to fill the hair profile automatically.'); return } onNotice('neutral', 'Image added. The local vision model is filling empty hair fields…'); try { const result = await analyzeReferenceImage(settings, picked.path, 'hair'); const current = loadHairStyleProjects().find((item) => item.id === projectId); if (!current) return; const textures = ['straight and sleek','soft waves','defined waves','loose curls','tight curls','coily natural texture','locs','box braids','cornrows','twists','buzzed texture','natural texture']; const lengths = ['shaved','cropped','ear length','chin length','shoulder length','medium length','mid-back length','waist length']; patchById(projectId, { name: !current.name.trim() || /^Hair design \d+$/i.test(current.name) ? result.name || current.name : current.name, description: current.description.trim() ? current.description : result.description, texture: current.texture !== 'natural texture' || !textures.includes(result.texture) ? current.texture : result.texture, length: current.length !== 'medium length' || !lengths.includes(result.length) ? current.length : result.length, color: current.color.trim() ? current.color : result.color, hairline: current.hairline !== 'natural hairline' ? current.hairline : result.hairline || current.hairline, finish: current.finish !== 'soft natural finish' ? current.finish : result.finish || current.finish, visualStyle: current.visualStyle !== 'high-end salon reference photography' ? current.visualStyle : result.visualStyle || current.visualStyle }); onNotice('success', 'Existing image analyzed; empty hair fields were filled for review.') } catch (reason) { onNotice('error', `The image was added, but automatic description failed: ${reason instanceof Error ? reason.message : String(reason)}`) } }
  const createReference = async () => {
    if (!zReady || busy || !active.name.trim()) return
    setBusy(true); setError(false); setMessage('Submitting the hairstyle design board…')
    try { const response = await window.minimax.submitPrompt(settings.comfyUrl, buildZImage(prompt, 1024, 1024, Math.floor(Math.random() * 1_000_000_000), zModel, zEncoder, zVae, 8, 1, 'turbo', '', resolveAttentionBackend(settings.attentionBackend, choices(info, 'ModelAttentionBackend', 'attention')))); setJob({ id: response.prompt_id, url: settings.comfyUrl, hairStyleId: active.id }); setMessage('Rendering the hairstyle in ComfyUI…') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); setError(true); setBusy(false) }
  }
  const cancel = async () => { if (!job) return; try { await window.minimax.cancelPrompt(job.url, job.id) } finally { setJob(null); setBusy(false); setMessage('Hair design render cancelled.') } }
  useEffect(() => {
    if (!job) return
    let disposed = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const history = await window.minimax.getHistory(job.url, job.id)
        const entry = history[job.id] as { status?: { status_str?: string }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> } | undefined
        if (entry?.status?.status_str === 'error') throw new Error('Hair design generation failed. Check the ComfyUI log.')
        const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0]
        if (image) { const preview = await window.minimax.getOutputImage(job.url, image); const saved = await window.minimax.saveComfyOutputImage(job.url, image, settings.outputDirectory); if (!disposed) { setCandidate({ hairStyleId: job.hairStyleId, file: { ...saved, preview, kind: 'image' } }); setBusy(false); setJob(null); setMessage('Hair design ready for approval.') }; return }
      } catch (cause) { if (!disposed) { setMessage(cause instanceof Error ? cause.message : String(cause)); setError(true); setBusy(false); setJob(null) }; return }
      timer = setTimeout(poll, 2000)
    }
    void poll(); return () => { disposed = true; clearTimeout(timer) }
  }, [job, settings.outputDirectory])

  const add = () => { const item = newHairStyleProject(projects.length + 1); commit([...projects, item]); setActiveId(item.id) }
  const remove = () => { if (!window.confirm(`Delete hair design “${active.name}”? The image remains on disk.`)) return; const next = projects.filter((item) => item.id !== active.id); const fallback = next.length ? next : [newHairStyleProject()]; commit(fallback); setActiveId(fallback[0].id) }

  return <><div className="standard-page character-studio hair-studio"><div className="page-heading"><div><p className="eyebrow">GLOBAL HAIR LIBRARY</p><h1>Hair Studio</h1><p>Design reusable hairstyles, approve a clean reference board, and assign one style to any character.</p></div><div className="heading-state"><span className={active.referenceImage ? 'ok' : 'warn'}>{active.referenceImage ? <Check size={15} /> : <Scissors size={15} />}{active.referenceImage ? 'Hair reference ready' : 'Create one hair reference'}</span></div></div><div className="character-studio-grid"><aside className="character-project-list"><header><span><strong>Hair designs</strong><small>{projects.length} saved globally</small></span><button onClick={add}><Plus size={14} />New</button></header><div>{projects.map((item) => <button key={item.id} className={item.id === active.id ? 'active' : ''} onClick={() => setActiveId(item.id)}>{item.referenceImage?.preview ? <img src={item.referenceImage.preview} alt="" /> : <span><Scissors size={18} /></span>}<span><strong>{item.name}</strong><small>{item.texture} · {item.referenceImage ? 'approved' : 'image needed'}</small></span></button>)}</div></aside><section className="character-workbench"><header><div><Scissors size={18} /><span><strong>Hairstyle identity</strong><small>Hair stays separate from face identity so one character can change styles cleanly.</small></span></div><button className="danger-button" onClick={remove}><Trash2 size={14} />Delete design</button></header><div className="wardrobe-workspace"><section className="character-setup-panel"><div className="character-section-heading"><span><Scissors size={15} /></span><div><strong>Design profile</strong><small>Define the silhouette, texture, structure, color, and finish.</small></div></div><div className="character-form"><label>Design name<input value={active.name} onChange={(event) => patch({ name: event.target.value, referencePrompt: '' })} /></label><label>Texture<select value={active.texture} onChange={(event) => patch({ texture: event.target.value, referencePrompt: '' })}>{['straight and sleek','soft waves','defined waves','loose curls','tight curls','coily natural texture','locs','box braids','cornrows','twists','buzzed texture','natural texture'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Length<select value={active.length} onChange={(event) => patch({ length: event.target.value, referencePrompt: '' })}>{['shaved','cropped','ear length','chin length','shoulder length','medium length','mid-back length','waist length'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Color<input value={active.color} onChange={(event) => patch({ color: event.target.value, referencePrompt: '' })} placeholder="Deep espresso brown with subtle warm highlights" /></label><label className="wide">Cut, shape, and styling details<textarea value={active.description} onChange={(event) => patch({ description: event.target.value, referencePrompt: '' })} placeholder="Silhouette, layers, fringe, fade, braiding pattern, volume, loose strands…" /></label><label>Hairline and part<input value={active.hairline} onChange={(event) => patch({ hairline: event.target.value, referencePrompt: '' })} /></label><label>Finish<input value={active.finish} onChange={(event) => patch({ finish: event.target.value, referencePrompt: '' })} placeholder="Glossy, soft, wet look, flyaways…" /></label></div><div className="character-assist"><span><WandSparkles size={15} /><span><strong>Prompt assistant</strong><small>Turns the design profile into a precise hair-only reference prompt.</small></span></span><button className="secondary-button" disabled={!ollamaAvailable || assisting} onClick={() => void enhance()}>{assisting ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />}{assisting ? 'Refining…' : 'Refine prompt'}</button></div></section><section className="character-setup-panel wardrobe-render-panel"><div className="character-section-heading"><span><Sparkles size={15} /></span><div><strong>Three-view hair reference</strong><small>A neutral mannequin board avoids importing another person's face.</small></div><em>{zReady ? 'Ready' : 'Unavailable'}</em></div><label className="character-reference-prompt"><span><strong>Editable render prompt</strong><small>Front, side, and back consistency.</small></span><textarea value={prompt} onChange={(event) => patch({ referencePrompt: event.target.value })} /></label>{message && <div className={`character-master-message ${error ? 'error' : ''}`} role="status">{busy && <LoaderCircle className="spin" size={13} />}<span>{message}</span></div>}<footer><button className="secondary-button" disabled={busy} onClick={() => void chooseImage()}><ImagePlus size={14} />Choose existing</button>{busy && <button className="danger-button" onClick={() => void cancel()}><CircleStop size={14} />Cancel</button>}<button className="primary-button" disabled={busy || !zReady || !active.name.trim()} onClick={() => void createReference()}><Sparkles size={14} />{busy ? 'Creating…' : active.referenceImage ? 'Regenerate hair' : 'Create hair reference'}</button></footer>{active.referenceImage && <figure className="accessory-reference-preview hair-reference-preview"><img src={active.referenceImage.preview} alt={`${active.name} hairstyle reference`} /><figcaption><span><Check size={13} />Approved hair reference</span><button aria-label="Remove hair reference" onClick={() => patch({ referenceImage: undefined })}><X size={13} /></button></figcaption></figure>}</section></div></section></div></div>{candidate && <ReferenceApprovalModal title="Approve hair design" description="Confirm that front, side, and back show one consistent hairstyle with the intended texture, silhouette, hairline, length, and color." image={candidate.file.preview ?? ''} approveLabel="Approve hair reference" nextStep="Assign this style in Character Studio. Reference mode will keep it paired with that character." onClose={() => setCandidate(null)} onRetry={() => { setCandidate(null); void createReference() }} onApprove={() => { patchById(candidate.hairStyleId, { referenceImage: candidate.file }); setCandidate(null); onNotice('success', 'Hair design approved and added to the global library.') }} />}</>
}
