import { resolveLlmConnection } from './llmProvider'
import type { AppSettings } from '../types'

export type ReferenceAnalysisKind = 'character' | 'wardrobe' | 'location' | 'hair' | 'accessory'

const fieldInstructions: Record<ReferenceAnalysisKind, string> = {
  character: 'Return keys name, description, hairPreset, visualStyle. Describe only stable visible appearance, face geometry, hair, build, clothing-neutral distinguishing details, and photographic style. Do not infer identity, ethnicity, health, personality, age as an exact number, or any other sensitive or hidden trait.',
  wardrobe: 'Return keys name, description, colors, materials, visualStyle. Describe the visible garments, footwear, fit, construction, closures, patterns, colors, and materials. Exclude the wearer, jewelry, bags, and handheld props.',
  location: 'Return keys name, environmentMode, description, atmosphere, timeOfDay, continuityAnchors, visualStyle. environmentMode must be mixed, nature, or built. Describe visible layout, terrain or architecture, spatial relationships, landmarks, weather, light, materials, and repeatable continuity anchors.',
  hair: 'Return keys name, description, texture, length, color, hairline, finish, visualStyle. texture must be one of: straight and sleek, soft waves, defined waves, loose curls, tight curls, coily natural texture, locs, box braids, cornrows, twists, buzzed texture, natural texture. length must be one of: shaved, cropped, ear length, chin length, shoulder length, medium length, mid-back length, waist length. Describe only the visible hairstyle: silhouette, cut, layers, curl or braid pattern, volume, part, fringe, hairline, length, color, and finish.',
  accessory: 'Return keys name, category, description, colors, materials, visualStyle. category must be jewelry, eyewear, watch, bag, headwear, prop, or other. Describe only the visible item, including shape, construction, scale cues, colors, materials, closures, and identifying details.',
}

export async function analyzeReferenceImage(settings: AppSettings, imagePath: string, kind: ReferenceAnalysisKind) {
  const llm = resolveLlmConnection(settings)
  if (!llm.model.trim()) throw new Error(`Choose a local vision-capable ${llm.label} model in Settings to analyze existing images.`)
  const prompt = `Analyze this existing ${kind} reference for MiniMax Studio. ${fieldInstructions[kind]} Return one strict JSON object only. Every value must be a concise plain string; use an empty string when a field cannot be determined. Do not use Markdown, commentary, arrays, or extra keys.`
  const response = await window.minimax.generateWithOllamaVision(llm.url, llm.model, prompt, [imagePath], llm.provider)
  const start = response.indexOf('{')
  const end = response.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`${llm.label} inspected the image but did not return usable field data.`)
  const raw = JSON.parse(response.slice(start, end + 1)) as Record<string, unknown>
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 2000) : ''])) as Record<string, string>
}
