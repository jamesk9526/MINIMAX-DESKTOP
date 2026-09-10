import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, LoaderCircle, MessageSquareText, Sparkles, X } from 'lucide-react'
import type { CharacterProject } from '../types'

export type CharacterDialogueDraft = {
  character: CharacterProject
  intent: string
  requiredWords: string
  delivery: string
  length: string
  language: string
}

type CharacterDialogueModalProps = {
  characters: CharacterProject[]
  duration: number
  generating: boolean
  ollamaAvailable: boolean
  providerLabel: string
  onClose(): void
  onGenerate(draft: CharacterDialogueDraft): Promise<string>
  onInsert(text: string): void
}

const deliveryOptions = ['Natural and conversational', 'Warm and reassuring', 'Quiet and intimate', 'Confident and direct', 'Tense and restrained', 'Urgent and breathless', 'Dry and understated', 'Playful and energetic']

export function CharacterDialogueModal({ characters, duration, generating, ollamaAvailable, providerLabel, onClose, onGenerate, onInsert }: CharacterDialogueModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? '')
  const [intent, setIntent] = useState('')
  const [requiredWords, setRequiredWords] = useState('')
  const [delivery, setDelivery] = useState(deliveryOptions[0])
  const [length, setLength] = useState('One concise sentence')
  const [language, setLanguage] = useState('English')
  const [line, setLine] = useState('')
  const [error, setError] = useState('')
  const character = characters.find((item) => item.id === characterId)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !generating) onClose() }
    window.addEventListener('keydown', closeOnEscape)
    window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [generating, onClose])

  const keepFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    const first = controls[0]
    const last = controls.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const generate = async () => {
    if (!character || !intent.trim()) return
    setError('')
    try {
      setLine((await onGenerate({ character, intent: intent.trim(), requiredWords: requiredWords.trim(), delivery, length, language: language.trim() || 'English' })).trim().replace(/^['“"]|['”"]$/g, ''))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const insert = () => {
    if (!character || !line.trim()) return
    const voice = character.voiceNotes.trim()
    const direction = `Dialogue: ${character.name} says, “${line.trim().replace(/^['“"]|['”"]$/g, '')}” Delivery: ${delivery.toLowerCase()}${voice ? `; preserve ${character.name}'s established voice (${voice})` : ''}. Spoken in ${language.trim() || 'English'}, with natural lip-sync and clean production audio.`
    onInsert(direction)
  }

  return <div className="modal-backdrop character-dialogue-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !generating) onClose() }}>
    <section className="character-dialogue-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={keepFocus}>
      <header>
        <div><span><MessageSquareText size={18} /></span><div><small>REFERENCE MODE</small><strong id={titleId}>Character dialogue</strong><p id={descriptionId}>Shape a brief, performable line and insert it at the prompt cursor.</p></div></div>
        <button ref={closeRef} type="button" aria-label="Close character dialogue" disabled={generating} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="character-dialogue-body">
        {characters.length ? <>
          <section className="dialogue-speaker-section">
            <div className="dialogue-section-heading"><span>01</span><div><strong>Speaker</strong><small>Uses the character identity and voice notes already selected for this render.</small></div></div>
            <div className="dialogue-character-row">
              <div className="dialogue-character-preview">{character?.baseImage?.preview || character?.referenceImages[0]?.preview ? <img src={character.baseImage?.preview ?? character.referenceImages[0]?.preview} alt="" /> : <MessageSquareText size={21} />}</div>
              <label><span>Character</span><select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>{characters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
              <div className="dialogue-voice-note"><strong>Voice profile</strong><span>{character?.voiceNotes || 'No saved voice notes — use a natural performance.'}</span></div>
            </div>
          </section>
          <section>
            <div className="dialogue-section-heading"><span>02</span><div><strong>Line direction</strong><small>Describe meaning and subtext. Add exact words only when they must be preserved.</small></div></div>
            <label className="dialogue-wide-field"><span>What should {character?.name ?? 'the character'} communicate?</span><textarea autoFocus value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="For example: reassure the team that the plan is still on track, while hiding some doubt." /></label>
            <div className="dialogue-form-grid">
              <label><span>Delivery</span><select value={delivery} onChange={(event) => setDelivery(event.target.value)}>{deliveryOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>Length</span><select value={length} onChange={(event) => setLength(event.target.value)}><option>Very short phrase</option><option>One concise sentence</option><option>Two short sentences</option></select></label>
              <label><span>Language</span><input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="English" /></label>
              <label><span>Required words <em>Optional</em></span><input value={requiredWords} onChange={(event) => setRequiredWords(event.target.value)} placeholder="Exact phrase to preserve" /></label>
            </div>
            <div className="dialogue-generate-row"><small>{ollamaAvailable ? `Designed for a ${duration}-second shot. Keep room for action and reaction.` : `${providerLabel} is offline. You can still write the spoken line manually below.`}</small><button className="secondary-button" type="button" title={ollamaAvailable ? 'Generate one dialogue line with the configured local model' : `Configure ${providerLabel} in Settings`} disabled={!character || !intent.trim() || generating || !ollamaAvailable} onClick={() => void generate()}>{generating ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}{generating ? 'Writing…' : `Generate with ${providerLabel}`}</button></div>
          </section>
          <section>
            <div className="dialogue-section-heading"><span>03</span><div><strong>Review</strong><small>Edit the exact spoken words before adding them to the production prompt.</small></div></div>
            <label className="dialogue-wide-field"><span>Spoken line</span><textarea className="dialogue-line-editor" value={line} onChange={(event) => setLine(event.target.value)} placeholder="Generate a line, or write the exact dialogue here yourself." /></label>
            {error && <p className="dialogue-error" role="alert">{error}</p>}
          </section>
        </> : <div className="dialogue-empty"><MessageSquareText size={28} /><strong>Select a character first</strong><p>Open Source media, choose at least one character from your library, then return here to write dialogue in that character's voice.</p></div>}
      </div>
      <footer><span>{line.trim() ? `Ready to insert ${line.trim().split(/\s+/).length} spoken words.` : 'Your current prompt stays unchanged until you insert.'}</span><div><button className="secondary-button" type="button" disabled={generating} onClick={onClose}>Cancel</button><button className="primary-button" type="button" disabled={!character || !line.trim() || generating} onClick={insert}><Check size={14} />Insert into prompt</button></div></footer>
    </section>
  </div>
}
