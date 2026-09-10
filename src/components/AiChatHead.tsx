import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Check, Copy, Eye, Film, Image as ImageIcon, LoaderCircle, MessageCircle, PanelTopClose, PanelTopOpen, Pin, PinOff, Send, Sparkles, WandSparkles, X } from 'lucide-react'
import { createId } from '../lib/createId'
import { COPILOT_SUGGESTION_EVENT, decideCopilotSuggestion, type CopilotSuggestion } from '../lib/copilot'

type ChatMode = 'prompt' | 'image' | 'video'
type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; format?: 'text' | 'prompt'; promptMode?: 'image' | 'video' }

const modeCopy: Record<ChatMode, { label: string; placeholder: string; instruction: string }> = {
  prompt: { label: 'Ask', placeholder: 'Ask about the current prompt or references…', instruction: 'Act as the MiniMax Studio copilot. Answer concisely using the current workspace, reference map, and inspected image content. Identify conflicts or missing continuity anchors and give actionable production guidance.' },
  image: { label: 'Image', placeholder: 'Describe or refine the still image…', instruction: 'Return one polished production-ready Z-Image prompt. Include only details that are missing from the current draft. Do not repeat existing style, identity, reference, wardrobe, or location instructions. Do not include motion, sound, timelines, or multiple shots. Return only text that can be appended directly to the current prompt.' },
  video: { label: 'Video', placeholder: 'Describe the action you want added to this shot…', instruction: '' },
}

const userDirectedInstruction = 'Creative control belongs to the user. Do not moralize, sanitize, euphemize, or silently change the requested tone or mature fictional content. Preserve explicit wording and artistic intent when it is relevant. Do not add unsolicited warnings, lectures, refusals, or content-policy commentary; answer the production request directly.'

export type CopilotWorkspaceContext = { label: string; prompt?: string; duration?: number; noDialogue?: boolean; referenceMap?: string[]; imagePaths?: string[] }

export function AiChatHead({ available, provider, ollamaUrl, ollamaModel, context, onUseImage, onUseVideo }: {
  available: boolean
  provider: 'ollama' | 'lmstudio'
  ollamaUrl: string
  ollamaModel: string
  context: CopilotWorkspaceContext
  onUseImage(prompt: string): void
  onUseVideo(prompt: string): void
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ChatMode>('prompt')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [suggestion, setSuggestion] = useState<CopilotSuggestion | null>(null)
  const [popupRoot, setPopupRoot] = useState<HTMLElement | null>(null)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<Window | null>(null)
  const latestPrompt = [...messages].reverse().find((message) => message.role === 'assistant' && message.format === 'prompt')

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [busy, messages])
  useEffect(() => {
    const receive = (event: Event) => { const next = (event as CustomEvent<CopilotSuggestion>).detail; setSuggestion(next); setOpen(true) }
    window.addEventListener(COPILOT_SUGGESTION_EVENT, receive)
    return () => window.removeEventListener(COPILOT_SUGGESTION_EVENT, receive)
  }, [])
  useEffect(() => () => { popupRef.current?.close() }, [])

  const dockChat = async () => {
    if (alwaysOnTop) await window.minimax.setWindowAlwaysOnTop(false).catch(() => false)
    popupRef.current?.close()
    popupRef.current = null
    setPopupRoot(null)
    setAlwaysOnTop(false)
  }

  const closeChat = () => {
    void dockChat()
    setOpen(false)
  }

  const popOut = () => {
    if (popupRef.current && !popupRef.current.closed) { popupRef.current.focus(); return }
    const popup = window.open('', 'minimax-studio-copilot', 'popup=yes,width=560,height=780,resizable=yes')
    if (!popup) return
    popup.document.title = 'MiniMax Studio copilot'
    popup.document.documentElement.className = 'copilot-popout-document'
    popup.document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => node.remove())
    document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
      const clone = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement
      if (clone.tagName === 'LINK' && node.tagName === 'LINK') (clone as HTMLLinkElement).href = (node as HTMLLinkElement).href
      popup.document.head.appendChild(clone)
    })
    popup.document.body.className = 'copilot-popout-body'
    popup.document.body.replaceChildren()
    const root = popup.document.createElement('div')
    root.id = 'copilot-popout-root'
    popup.document.body.appendChild(root)
    popupRef.current = popup
    setPopupRoot(root)
    setOpen(true)
    popup.addEventListener('beforeunload', () => {
      popupRef.current = null
      setPopupRoot(null)
      setAlwaysOnTop(false)
    }, { once: true })
    popup.focus()
  }

  const toggleAlwaysOnTop = async () => {
    const pinned = await window.minimax.setWindowAlwaysOnTop(!alwaysOnTop).catch(() => false)
    setAlwaysOnTop(pinned)
  }

  const copyPrompt = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? '' : current), 1800)
    } catch { setCopiedMessageId('') }
  }

  const send = async () => {
    const request = draft.trim()
    if (!request || !available || busy) return
    const activeMode = mode
    const asksForPrompt = /\b(?:write|create|make|generate|draft|rewrite|enhance|revise|improve|build|give|add|need)\b[\s\S]{0,80}\bprompt\b|\bprompt\b[\s\S]{0,80}\b(?:write|create|make|generate|draft|rewrite|enhance|revise|improve|build|give|add)\b|\b(?:timeline|timed beats?|shot direction)\b/i.test(request)
    const promptMode: 'image' | 'video' | undefined = activeMode === 'image' ? 'image' : activeMode === 'video' ? 'video' : asksForPrompt ? (context.duration ? 'video' : 'image') : undefined
    const shotDuration = Math.max(1, context.duration ?? 6)
    setDraft(''); setBusy(true)
    setMessages((current) => [...current, { id: createId(), role: 'user', text: request }])
    try {
      const recent = messages.slice(-6).map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`).join('\n')
      const workspace = [`WORKSPACE: ${context.label}`, context.duration ? `Duration: ${context.duration} seconds` : '', context.prompt ? `Current draft:\n${context.prompt}` : '', context.referenceMap?.length ? `Reference map:\n${context.referenceMap.join('\n')}` : ''].filter(Boolean).join('\n\n')
      const videoInstruction = `Act as a precise MiniMax H3 prompt editor. The current draft is authoritative. Do not rewrite, summarize, or repeat any existing style, character assembly, identity, body, clothing, reference, location, lighting, continuity, or negative instructions. Return only the new shot direction needed to satisfy the request so it can be appended to the current draft without duplication.\n\nWrite one continuous ${shotDuration}-second shot as a compact timeline. Start every beat with an exact non-overlapping range such as 0.0–2.0s. Cover 0.0–${shotDuration.toFixed(1)}s completely with no gaps, overlaps, cuts, montage, or time beyond the duration. Use ${shotDuration <= 6 ? '2–3' : shotDuration <= 10 ? '3–5' : '4–6'} meaningful beats. In each beat, state literal subject action, camera behavior, and relevant synchronized sound${context.noDialogue ? '. Do not add dialogue, narration, singing, lip-sync, captions, or text overlays' : ' or dialogue'}. Keep movement physically achievable and preserve screen direction, identity, wardrobe, environment, and visual style from the draft. Return only append-ready prompt text—no preface, explanation, headings outside the timeline, Markdown fence, or alternative.`
      const activeInstruction = `${userDirectedInstruction}\n\n${promptMode === 'video' ? videoInstruction : promptMode === 'image' ? modeCopy.image.instruction : modeCopy.prompt.instruction}`
      const instruction = `${activeInstruction}\n\n${workspace}\n\n${recent ? `RECENT CONVERSATION:\n${recent}\n\n` : ''}REQUEST:\n${request}`
      let response: string
      // Timeline additions use the authoritative text/reference map. Skipping a
      // redundant vision pass keeps local Ollama prompt requests responsive.
      const images = promptMode === 'video' ? [] : context.imagePaths?.slice(0, 6) ?? []
      if (images.length) {
        try { response = await window.minimax.generateWithOllamaVision(ollamaUrl, ollamaModel, `${instruction}\n\nInspect the attached images in the exact order shown by the reference map. State only details you can actually see; do not invent hidden traits.`, images, provider) }
        catch (visionError) {
          response = await window.minimax.generateWithOllama(ollamaUrl, ollamaModel, `${instruction}\n\nThe configured model could not inspect the attached image pixels. Use the semantic reference map only and do not claim visual observations.`, provider)
          response = `${response.trim()}\n\n[Reference pixel inspection unavailable: ${visionError instanceof Error ? visionError.message : String(visionError)}]`
        }
      } else response = await window.minimax.generateWithOllama(ollamaUrl, ollamaModel, instruction, provider)
      const cleaned = response.trim().replace(/^```(?:markdown|text|prompt)?\s*/i, '').replace(/\s*```$/, '').trim()
      setMessages((current) => [...current, { id: createId(), role: 'assistant', text: cleaned, format: promptMode ? 'prompt' : 'text', promptMode }])
    } catch (error) {
      setMessages((current) => [...current, { id: createId(), role: 'assistant', text: `I could not reach the local assistant: ${error instanceof Error ? error.message : String(error)}` }])
    } finally { setBusy(false) }
  }

  const panel = <section className={`ai-chat-panel ${popupRoot ? 'popped-out' : ''}`} role="dialog" aria-label="AI creation assistant">
      <header><div><span><Bot size={17} /></span><div><strong>Studio copilot</strong><small>{available ? `${ollamaModel} · ${provider === 'lmstudio' ? 'LM Studio' : 'Ollama'}` : `Configure ${provider === 'lmstudio' ? 'LM Studio' : 'Ollama'} in Settings`}</small></div></div><div className="ai-chat-window-actions">{popupRoot ? <><button className={`icon-button ${alwaysOnTop ? 'active' : ''}`} onClick={() => void toggleAlwaysOnTop()} aria-pressed={alwaysOnTop} aria-label={alwaysOnTop ? 'Stop keeping copilot on top' : 'Keep copilot on top'} title={alwaysOnTop ? 'Always on top is on' : 'Keep on top'}>{alwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}</button><button className="icon-button" onClick={() => void dockChat()} aria-label="Return copilot to main window" title="Return to main window"><PanelTopClose size={17} /></button></> : <button className="icon-button" onClick={popOut} aria-label="Open copilot in a new window" title="Open in new window"><PanelTopOpen size={17} /></button>}<button className="icon-button" onClick={closeChat} aria-label="Close Studio copilot"><X size={17} /></button></div></header>
      <div className="ai-chat-modes" role="tablist" aria-label="Assistant mode">
        {(['prompt', 'image', 'video'] as const).map((item) => <button key={item} role="tab" aria-selected={mode === item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>{item === 'prompt' ? <WandSparkles size={14} /> : item === 'image' ? <ImageIcon size={14} /> : <Film size={14} />}{modeCopy[item].label}</button>)}
      </div>
      <div className="ai-chat-context"><span>{context.label}</span>{Boolean(context.imagePaths?.length) && <span><Eye size={12} />{Math.min(6, context.imagePaths!.length)} image{context.imagePaths!.length === 1 ? '' : 's'} available for inspection</span>}</div>
      <div className="ai-chat-log" ref={logRef} aria-live="polite">
        {messages.length === 0 && <div className="ai-chat-empty"><Sparkles size={22} /><strong>What are you making?</strong><span>Ask for guidance, an image prompt, or a timed addition to the current video prompt.</span></div>}
        {messages.map((message) => <article key={message.id} className={`${message.role}${message.format === 'prompt' ? ' prompt-response' : ''}`}><small>{message.role === 'user' ? 'You' : 'Copilot'}</small>{message.format === 'prompt' ? <section className="ai-prompt-box" aria-label={`${message.promptMode === 'video' ? 'Video' : 'Image'} prompt addition`}><header><span>{message.promptMode === 'video' ? 'Timeline addition' : 'Prompt addition'}</span><button type="button" onClick={() => void copyPrompt(message)} aria-label="Copy prompt addition"><Copy size={12} />{copiedMessageId === message.id ? 'Copied' : 'Copy'}</button></header><pre><code>{message.text}</code></pre></section> : <p>{message.text}</p>}</article>)}
        {busy && <article className="assistant thinking"><LoaderCircle className="spin" size={15} /><span>Thinking locally…</span></article>}
      </div>
      {suggestion && <section className="ai-chat-review" aria-label="Copilot suggestion awaiting review"><header><span><Sparkles size={13} /><strong>{suggestion.title}</strong></span><small>{suggestion.sourceLabel ?? `${provider === 'lmstudio' ? 'LM Studio' : 'Ollama'} suggestion`}</small></header><p>{suggestion.text}</p><div><button className="secondary-button" onClick={() => { decideCopilotSuggestion(suggestion.id, 'dismiss'); setSuggestion(null) }}>Dismiss</button><button className="primary-button" onClick={() => { decideCopilotSuggestion(suggestion.id, 'approve'); setSuggestion(null) }}><Check size={13} />Approve change</button></div></section>}
      {latestPrompt && <div className="ai-chat-handoff"><button onClick={() => latestPrompt.promptMode === 'image' ? onUseImage(latestPrompt.text) : onUseVideo(latestPrompt.text)}>{latestPrompt.promptMode === 'image' ? <ImageIcon size={14} /> : <Film size={14} />}{latestPrompt.promptMode === 'image' ? 'Use in Create Image' : 'Add to current video prompt'}</button></div>}
      <form onSubmit={(event) => { event.preventDefault(); void send() }}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={modeCopy[mode].placeholder} disabled={busy || !available} rows={3} /><button type="submit" disabled={busy || !available || !draft.trim()} aria-label="Send message"><Send size={16} /></button></form>
    </section>

  return <div className={`ai-chat-head ${open ? 'open' : ''}`}>
    {open && !popupRoot && panel}
    {popupRoot && createPortal(panel, popupRoot)}
    <button className="ai-chat-toggle" aria-expanded={open} aria-label={open ? 'Close Studio copilot' : 'Open Studio copilot'} onClick={() => open ? closeChat() : setOpen(true)}>{open ? <X size={21} /> : <><MessageCircle size={22} /><span>AI</span></>}</button>
  </div>
}
