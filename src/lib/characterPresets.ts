export const characterAppearancePresets = [
  ['custom', 'Custom appearance', ''],
  ['hero', 'Cinematic lead', 'Adult cinematic lead with balanced facial proportions, expressive eyes, a clear silhouette, natural skin texture, and a fit believable build.'],
  ['character-actor', 'Character actor', 'Adult character actor with memorable facial geometry, expressive asymmetry, lived-in skin detail, and a distinctive but believable silhouette.'],
  ['editorial', 'Editorial model', 'Adult editorial model with sculptural facial planes, long clean lines, controlled posture, and camera-ready natural skin texture.'],
  ['everyday', 'Natural everyday', 'Adult with approachable everyday features, realistic proportions, subtle facial asymmetry, natural skin texture, and an unforced posture.'],
  ['athletic', 'Athletic performer', 'Adult athletic performer with functional muscle definition, balanced proportions, grounded posture, and a physically capable silhouette.'],
  ['mature', 'Mature dramatic', 'Mature adult with age-authentic facial structure, fine lines, textured skin, confident posture, and strong dramatic presence.'],
  ['comedian', 'Expressive comedy', 'Adult comedy performer with highly readable eyes and brows, flexible facial expression, approachable proportions, and energetic body language.'],
  ['action', 'Action protagonist', 'Adult action protagonist with a resilient athletic build, focused eyes, defined facial planes, grounded balance, and a strong readable silhouette.'],
  ['period', 'Period drama', 'Adult period-drama performer with classically composed facial proportions, restrained posture, natural skin texture, and timeless screen presence.'],
] as const

export const characterVisualStylePresets = [
  'cinematic photorealism',
  'naturalistic 35mm film',
  'large-format cinematic realism',
  'prestige television realism',
  'documentary naturalism',
  'editorial fashion photography',
  'commercial beauty photography',
  'neo-noir cinematic realism',
  'warm romantic drama',
  'gritty independent film',
  'retro 1970s film realism',
  'high-key studio realism',
  'stylized graphic realism',
  'premium 3D animation',
  'hand-painted storybook animation',
  'anime-inspired cinematic illustration',
] as const

export const characterVoicePresets = [
  ['custom', 'Custom voice', ''],
  ['warm-grounded', 'Warm and grounded', 'Warm grounded speaking voice, medium-low register, measured pace, clear diction, subtle breath, and emotionally honest delivery.'],
  ['bright-quick', 'Bright and quick', 'Bright agile voice, medium register, quick conversational pace, crisp diction, playful timing, and responsive energy.'],
  ['quiet-intense', 'Quiet intensity', 'Quiet controlled voice, low volume, deliberate pace, precise diction, restrained emotion, and strong subtext.'],
  ['authoritative', 'Calm authority', 'Calm authoritative voice, steady low register, unhurried pace, concise phrasing, and assured presence without shouting.'],
  ['vulnerable', 'Intimate and vulnerable', 'Intimate close-mic voice, soft register, natural pauses, audible thought, delicate breath, and emotionally vulnerable restraint.'],
  ['comic', 'Expressive comic', 'Expressive conversational voice, elastic pacing, readable reactions, clean comic timing, and spontaneous but controlled energy.'],
  ['documentary', 'Natural documentary', 'Unpolished natural voice, conversational pace, regional character preserved, small hesitations, and authentic non-performative delivery.'],
  ['elegant', 'Elegant precision', 'Elegant composed voice, clear resonance, precise diction, controlled tempo, and understated emotional intelligence.'],
  ['weathered', 'Weathered and textured', 'Weathered textured voice, lower register, economical phrasing, rough warmth, deliberate pauses, and lived-in emotional weight.'],
] as const

export const characterPerformancePresets = [
  ['custom', 'Custom performance', ''],
  ['natural', 'Naturalistic', 'Performance baseline: naturalistic, grounded, minimal gestures, responsive eye focus, and emotion carried through small facial changes.'],
  ['restrained', 'Restrained drama', 'Performance baseline: restrained dramatic presence, still posture, deliberate movement, held eye contact, and layered subtext.'],
  ['energetic', 'Energetic', 'Performance baseline: energetic and physically expressive, quick reactions, open posture, clear gesture shapes, and lively timing.'],
  ['deadpan', 'Deadpan', 'Performance baseline: dry deadpan delivery, economical movement, steady gaze, minimal facial reaction, and precise comic timing.'],
  ['charismatic', 'Charismatic lead', 'Performance baseline: confident charismatic presence, relaxed posture, direct eye focus, controlled gestures, and easy emotional access.'],
  ['nervous', 'Nervous tension', 'Performance baseline: contained nervous energy, guarded posture, darting eye focus, small self-soothing gestures, and interrupted breath.'],
  ['physical', 'Physical performer', 'Performance baseline: body-led acting, clear weight shifts, readable silhouette, precise spatial awareness, and controlled physical storytelling.'],
  ['voiceover', 'Voice-forward', 'Performance baseline: voice-forward acting with disciplined breath, precise phrasing, controlled facial movement, and restrained body language.'],
] as const

export function appendPreset(current: string, addition: string) {
  if (!addition || current.toLowerCase().includes(addition.toLowerCase())) return current
  return [current.trim().replace(/[.\s]+$/, ''), addition].filter(Boolean).join('. ')
}
