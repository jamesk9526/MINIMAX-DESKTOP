import type { GenerationMode, MovieReferenceBinding } from '../types'

export type PromptAudit = { errors: string[]; warnings: string[]; suggestions: string[] }

const referenceToken = /<(Picture|Video|Audio)\s+(\d+)>/gi

export function auditH3Prompt(prompt: string, input: { mode: GenerationMode; duration: number; bindings?: MovieReferenceBinding[]; imageCount?: number; videoCount?: number; audioCount?: number; noDialogue?: boolean }): PromptAudit {
  const errors: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  const text = prompt.trim()
  if (!text) errors.push('Add a shot direction before rendering.')
  if (text.length > 12000) errors.push('Prompt is too long for a reliable single-shot render. Split the action into smaller shots.')
  const cameras = (text.match(/\b(?:camera|lens|shot|camera angle)\s*:/gi) ?? []).length
  if (cameras > 5) warnings.push('Several camera instructions compete in one shot. Keep one primary move and one framing decision.')
  if (/\b(?:then|after that|next)\b/gi.test(text) && input.duration <= 5) warnings.push('This short render contains several sequential beats. Reduce it to one clear action and one camera move.')
  if (input.noDialogue && /(?:<d>|\b(?:says|dialogue|speaks|whispers|narrat))/i.test(text)) errors.push('No dialogue is enabled, but the direction includes speech or dialogue. Remove it or disable No dialogue.')
  const counts = { Picture: input.imageCount ?? input.bindings?.length ?? 0, Video: input.videoCount ?? 0, Audio: input.audioCount ?? 0 }
  const used = new Set<string>()
  for (const match of text.matchAll(referenceToken)) {
    const kind = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() as keyof typeof counts
    const index = Number(match[2])
    used.add(`${kind}:${index}`)
    if (index < 1 || index > counts[kind]) errors.push(`<${kind} ${index}> does not match an attached ${kind.toLowerCase()} reference.`)
  }
  if (input.mode === 'reference' && counts.Picture + counts.Video + counts.Audio === 0) errors.push('Reference mode needs at least one image or video reference.')
  if (input.mode === 'reference' && counts.Audio && !counts.Picture && !counts.Video) errors.push('Audio references need at least one visual reference.')
  if (input.mode === 'reference' && counts.Picture && ![...used].some((item) => item.startsWith('Picture:'))) suggestions.push('Name each important picture reference in the direction so its role remains explicit.')
  if (input.mode === 'image') suggestions.push('Treat the first frame as the exact opening composition; describe only the motion that follows it.')
  if (input.mode === 'frames') suggestions.push('Describe one physically continuous transition between the opening and ending frames.')
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], suggestions: [...new Set(suggestions)] }
}

export function auditCopilotReferences(text: string, referenceMap: string[] = []) {
  const available = new Map<string, number>()
  referenceMap.forEach((entry) => {
    const source = entry.match(/<((?:Picture|Video|Audio)\s+\d+)>/i)?.[1]
    if (!source) return
    const [kind, number] = source.split(/\s+/)
    available.set(kind.toLowerCase(), Math.max(available.get(kind.toLowerCase()) ?? 0, Number(number)))
  })
  const invalid: string[] = []
  for (const match of text.matchAll(referenceToken)) {
    const kind = match[1].toLowerCase()
    if (Number(match[2]) > (available.get(kind) ?? 0)) invalid.push(match[0])
  }
  return [...new Set(invalid)]
}
