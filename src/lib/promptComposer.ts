import { characterReferences } from './characterLibrary'
import { fitWholeCharacter } from './imageCrop'
import { loadWardrobeProjects, wardrobeReferences } from './wardrobeLibrary'
import { loadAccessoryProjects } from './accessoryLibrary'
import { loadHairStyleProjects } from './hairLibrary'
import type { CharacterProject, GenerationMode, MediaFile, MovieProject, MovieReferenceBinding, MovieScene, MovieShot, ResolvedMovieShot, WardrobeProject } from '../types'

export type PromptAssistantTool = 'enhance' | 'timeline' | 'audio'

const uniqueBindings = (bindings: MovieReferenceBinding[]) => bindings.filter((binding, index) => bindings.findIndex((item) => item.file.path === binding.file.path && item.characterId === binding.characterId && item.purpose === binding.purpose) === index)
const sentenceKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9<>]+/g, ' ').trim()

type CharacterReferenceInput = { id: string; name: string; identity: MediaFile[]; detailReferences?: CharacterProject['detailReferences']; hairStyleIds?: string[]; wardrobeIds: string[]; accessoryIds?: string[] }

function detailBindings(character: CharacterReferenceInput) {
  return (character.detailReferences ?? []).flatMap((detail) => detail.image ? [{
    file: detail.image,
    purpose: 'detail' as const,
    label: `Detail: ${detail.label.trim() || 'approved visual detail'} for ${character.name}`,
    detailNotes: detail.notes.trim(),
    characterId: character.id,
    source: 'character-studio' as const,
  }] : [])
}

export function allocateCharacterReferences(characters: CharacterReferenceInput[], wardrobes: WardrobeProject[], limit = 9): MovieReferenceBinding[] {
  const accessories = loadAccessoryProjects()
  const hairStyles = loadHairStyleProjects()
  const queues = characters.map((character) => ({
    character,
    identity: character.identity.map((file, index) => ({ file: fitWholeCharacter(file), purpose: (index === 0 ? 'character' : 'character-angle') as MovieReferenceBinding['purpose'], label: `Character: ${character.name} / ${index === 0 ? 'master' : `angle ${index + 1}`}`, characterId: character.id, source: 'character-studio' as const })),
    hair: (character.hairStyleIds ?? []).slice(0, 1).flatMap((hairStyleId) => { const hair = hairStyles.find((item) => item.id === hairStyleId); return hair?.referenceImage ? [{ file: hair.referenceImage, purpose: 'hair' as const, label: `Hair: ${hair.name} for ${character.name}`, characterId: character.id, hairStyleId: hair.id, source: 'hair-studio' as const }] : [] }),
    // One outfit per character and render. Combining several assigned wardrobes
    // creates an ambiguous clothing target and causes the model to blend them.
    wardrobe: character.wardrobeIds.slice(0, 1).flatMap((wardrobeId) => { const wardrobe = wardrobes.find((item) => item.id === wardrobeId); return wardrobe ? wardrobeReferences(wardrobe).map((file) => ({ file: fitWholeCharacter(file), purpose: 'wardrobe' as const, label: `Wardrobe: ${wardrobe.name} for ${character.name}`, characterId: character.id, wardrobeId: wardrobe.id, source: 'wardrobe-studio' as const })) : [] }),
    accessories: (character.accessoryIds ?? []).flatMap((accessoryId) => { const accessory = accessories.find((item) => item.id === accessoryId); return accessory?.referenceImage ? [{ file: accessory.referenceImage, purpose: 'accessory' as const, label: `Accessory: ${accessory.name} for ${character.name}`, characterId: character.id, accessoryId: accessory.id, source: 'accessory-studio' as const }] : [] }),
    details: detailBindings(character),
  }))
  const result: MovieReferenceBinding[] = []
  const takeRound = (key: 'identity' | 'hair' | 'wardrobe' | 'accessories' | 'details') => { for (const queue of queues) { const next = queue[key].shift(); if (next && result.length < limit) result.push(next) } }
  takeRound('identity')
  takeRound('hair')
  takeRound('wardrobe')
  takeRound('accessories')
  takeRound('details')
  while (result.length < limit && queues.some((queue) => queue.identity.length || queue.hair.length || queue.wardrobe.length || queue.accessories.length || queue.details.length)) { takeRound('identity'); takeRound('hair'); takeRound('wardrobe'); takeRound('accessories'); takeRound('details') }
  return uniqueBindings(result).slice(0, limit)
}

export function allocateWorkspaceReferences(
  characters: CharacterReferenceInput[],
  wardrobes: WardrobeProject[],
  locations: Array<{ id: string; name: string; images: MediaFile[]; environmentMode?: 'mixed' | 'nature' | 'built' }>,
  limit = 9,
): MovieReferenceBinding[] {
  const accessories = loadAccessoryProjects()
  const hairStyles = loadHairStyleProjects()
  const characterQueues = characters.map((character) => ({
    identity: character.identity.map((file, index) => ({ file: fitWholeCharacter(file), purpose: (index === 0 ? 'character' : 'character-angle') as MovieReferenceBinding['purpose'], label: `Character: ${character.name} / ${index === 0 ? 'master' : `angle ${index + 1}`}`, characterId: character.id, source: 'character-studio' as const })),
    hair: (character.hairStyleIds ?? []).slice(0, 1).flatMap((hairStyleId) => { const hair = hairStyles.find((item) => item.id === hairStyleId); return hair?.referenceImage ? [{ file: hair.referenceImage, purpose: 'hair' as const, label: `Hair: ${hair.name} for ${character.name}`, characterId: character.id, hairStyleId: hair.id, source: 'hair-studio' as const }] : [] }),
    wardrobe: character.wardrobeIds.slice(0, 1).flatMap((wardrobeId) => { const wardrobe = wardrobes.find((item) => item.id === wardrobeId); return wardrobe ? wardrobeReferences(wardrobe).map((file) => ({ file: fitWholeCharacter(file), purpose: 'wardrobe' as const, label: `Wardrobe: ${wardrobe.name} for ${character.name}`, characterId: character.id, wardrobeId: wardrobe.id, source: 'wardrobe-studio' as const })) : [] }),
    accessories: (character.accessoryIds ?? []).flatMap((accessoryId) => { const accessory = accessories.find((item) => item.id === accessoryId); return accessory?.referenceImage ? [{ file: accessory.referenceImage, purpose: 'accessory' as const, label: `Accessory: ${accessory.name} for ${character.name}`, characterId: character.id, accessoryId: accessory.id, source: 'accessory-studio' as const }] : [] }),
    details: detailBindings(character),
  }))
  const locationQueues = locations.map((location) => location.images.map((file) => ({ file, purpose: 'location' as const, label: `Location: ${location.name}`, locationId: location.id, locationEnvironmentMode: location.environmentMode, source: 'location-studio' as const })))
  const result: MovieReferenceBinding[] = []
  const take = (queue: MovieReferenceBinding[]) => { const next = queue.shift(); if (next && result.length < limit) result.push(next) }

  // Give every selected subject, assigned outfit, and location one authoritative
  // picture before distributing the remaining slots across their extra views.
  characterQueues.forEach((queue) => take(queue.identity))
  characterQueues.forEach((queue) => take(queue.hair))
  characterQueues.forEach((queue) => take(queue.wardrobe))
  characterQueues.forEach((queue) => take(queue.accessories))
  characterQueues.forEach((queue) => take(queue.details))
  locationQueues.forEach(take)
  while (result.length < limit && (characterQueues.some((queue) => queue.identity.length || queue.hair.length || queue.wardrobe.length || queue.accessories.length || queue.details.length) || locationQueues.some((queue) => queue.length))) {
    characterQueues.forEach((queue) => take(queue.identity))
    characterQueues.forEach((queue) => take(queue.hair))
    characterQueues.forEach((queue) => take(queue.wardrobe))
    characterQueues.forEach((queue) => take(queue.accessories))
    characterQueues.forEach((queue) => take(queue.details))
    locationQueues.forEach(take)
  }
  return uniqueBindings(result).slice(0, limit)
}

export function resolveMovieShotReferences(project: MovieProject, scene: MovieScene, shot: MovieShot, library: CharacterProject[], continuityFrame?: MediaFile): MovieReferenceBinding[] {
  const bindings: MovieReferenceBinding[] = []
  const wardrobes = loadWardrobeProjects()
  const cast = project.characters.filter((item) => shot.characterIds.includes(item.id))
  const characterInputs = cast.map((character) => { const source = character.libraryCharacterId ? library.find((item) => item.id === character.libraryCharacterId) : undefined; return { id: character.id, name: character.name, identity: source ? characterReferences(source) : character.referenceImages, detailReferences: source?.detailReferences, hairStyleIds: source?.hairStyleIds ?? [], wardrobeIds: source?.wardrobeIds ?? [], accessoryIds: source?.accessoryIds ?? [] } })
  const location = project.locations.find((item) => item.id === scene.locationId)
  const nonCharacterCount = (location?.referenceImages.length ?? 0) + (shot.referenceImages?.length ?? 0) + Number(Boolean(continuityFrame))
  bindings.push(...allocateCharacterReferences(characterInputs, wardrobes, Math.max(0, 9 - nonCharacterCount)))
  location?.referenceImages.forEach((file) => bindings.push({ file, purpose: 'location', label: `Location: ${location.name}`, locationId: location.id, locationEnvironmentMode: location.environmentMode, source: 'movie' }))
  shot.referenceImages?.forEach((file) => bindings.push({ file, purpose: 'generic', label: `Shot reference: ${file.name}`, source: 'shot' }))
  if (continuityFrame) bindings.push({ file: continuityFrame, purpose: 'continuity', label: 'Previous-shot continuity frame', source: 'continuity' })
  return uniqueBindings(bindings)
}

export function resolveMovieShotGenerationMode(shot: MovieShot, references: MovieReferenceBinding[]) {
  const preferredMode = shot.preferredMode ?? shot.mode
  // A continuation is an image-to-video handoff by definition. Reference-to-
  // video can guide the first moment, but cannot hard-pin it to the preceding
  // render's final pixel frame, so it is not acceptable for a seamless cut.
  if (references.some((item) => item.purpose === 'continuity')) return { preferredMode, effectiveMode: 'image' as GenerationMode }
  const hasReferenceMedia = references.some((item) => item.purpose !== 'continuity') || Boolean(shot.referenceVideos?.length || shot.referenceAudios?.length)
  const continuationOnly = references.some((item) => item.purpose === 'continuity') && !hasReferenceMedia
  return { preferredMode, effectiveMode: (hasReferenceMedia || preferredMode === 'reference' ? 'reference' : continuationOnly ? 'image' : preferredMode) as GenerationMode }
}

export function composeReferenceInstructions(bindings: MovieReferenceBinding[]) {
  const numbered = bindings.map((binding, index) => ({ ...binding, number: index + 1 }))
  const groups = new Map<string, typeof numbered>()
  for (const binding of numbered.filter((item) => item.characterId && (item.purpose === 'character' || item.purpose === 'character-angle'))) groups.set(binding.characterId!, [...(groups.get(binding.characterId!) ?? []), binding])
  const lines: string[] = []
  for (const group of groups.values()) {
    const name = group[0].label.replace(/^Character:\s*/, '').split(' / ')[0]
    const tags = group.map((item) => `<Picture ${item.number}>`).join(', ').replace(/, ([^,]+)$/, ' and $1')
    const characterId = group[0].characterId
    const hair = numbered.find((item) => item.characterId === characterId && item.purpose === 'hair')
    const assignedWardrobe = numbered.filter((item) => item.characterId === characterId && item.purpose === 'wardrobe')
    const accessories = numbered.filter((item) => item.characterId === characterId && item.purpose === 'accessory')
    const mapping = [`identity and body from ${tags}`, hair && `hairstyle from <Picture ${hair.number}>`, assignedWardrobe.length && `complete clothing from ${assignedWardrobe.map((item) => `<Picture ${item.number}>`).join(' and ')}`, accessories.length && `accessories from ${accessories.map((item) => `<Picture ${item.number}>`).join(' and ')}`].filter(Boolean).join('; ')
    lines.push(`CHARACTER ASSEMBLY — ${name}: create one unified person using ${mapping}. Apply every source to ${name} only; do not show the source sheets, mannequins, panels, or reference backgrounds in the scene.`)
    const assignedHair = Boolean(hair)
    lines.push(`${tags} depict ${name}. Use these pictures only for ${name}'s identity, face, skin, ${assignedHair ? 'natural hairline,' : 'hair,'} and body proportions. ${assignedHair ? `Ignore and replace the hairstyle, hair length, texture, styling, and color visible in these identity pictures with ${name}'s assigned hair reference.` : ''} Ignore and replace every garment, accessory, and styling detail visible in these identity pictures.`)
  }
  const hairGroups = new Map<string, typeof numbered>()
  for (const binding of numbered.filter((item) => item.purpose === 'hair' && item.characterId)) hairGroups.set(binding.characterId!, [...(hairGroups.get(binding.characterId!) ?? []), binding])
  for (const group of hairGroups.values()) {
    const [hairName, characterName] = group[0].label.replace(/^Hair:\s*/, '').split(' for ')
    const tag = `<Picture ${group[0].number}>`
    lines.push(`${characterName} must have the approved ${hairName} hairstyle shown in ${tag}. Transfer only its exact silhouette, hairline and part, texture or braid pattern, length, layers, volume, edges, finish, and color to ${characterName}; preserve ${characterName}'s face, skin, head shape, and body identity from their character pictures. Do not copy the mannequin or any facial identity from the hair reference.`)
  }
  const wardrobeGroups = new Map<string, typeof numbered>()
  for (const binding of numbered.filter((item) => item.purpose === 'wardrobe' && item.wardrobeId)) wardrobeGroups.set(`${binding.characterId}:${binding.wardrobeId}`, [...(wardrobeGroups.get(`${binding.characterId}:${binding.wardrobeId}`) ?? []), binding])
  for (const group of wardrobeGroups.values()) {
    const [wardrobeName, characterName] = group[0].label.replace(/^Wardrobe:\s*/, '').split(' for ')
    const tags = group.map((item) => `<Picture ${item.number}>`).join(', ').replace(/, ([^,]+)$/, ' and $1')
    lines.push(`${characterName} must wear the complete approved ${wardrobeName} outfit shown in ${tags}. These are the only clothing references for ${characterName}: match their garments, layers, materials, colors, patterns, fit, and footwear exactly. Do not borrow, blend, or retain clothing from ${characterName}'s identity pictures or from another character.`)
  }
  for (const binding of numbered.filter((item) => item.purpose === 'accessory')) lines.push(`${binding.label.replace(/^Accessory:\s*/, '').replace(' for ', ' must be used by ')} exactly as shown in <Picture ${binding.number}>. Preserve the single item's shape, material, color, scale, and placement; do not duplicate it or blend it into clothing.`)
  for (const binding of numbered.filter((item) => item.purpose === 'detail')) {
    const detail = binding.label.replace(/^Detail:\s*/, '').replace(` for ${groups.get(binding.characterId ?? '')?.[0]?.label.replace(/^Character:\s*/, '').split(' / ')[0] ?? ''}`, '')
    const owner = groups.get(binding.characterId ?? '')?.[0]?.label.replace(/^Character:\s*/, '').split(' / ')[0] ?? 'the assigned character'
    lines.push(`<Picture ${binding.number}> is the approved ${detail} reference for ${owner}. Preserve this visible feature exactly on ${owner}; ${binding.detailNotes || 'transfer only this feature'}; keep it attached and correctly scaled to ${owner}'s anatomy, and do not copy its background or introduce a second person.`)
  }
  if (groups.size > 1) lines.push('Render each named character as a separate, distinct person. Keep every face, body, and assigned outfit paired with its own name; do not merge identities, swap garments, or blend features between people.')
  const locationGroups = new Map<string, typeof numbered>()
  for (const binding of numbered.filter((item) => item.purpose === 'location')) locationGroups.set(binding.locationId ?? binding.label, [...(locationGroups.get(binding.locationId ?? binding.label) ?? []), binding])
  for (const group of locationGroups.values()) {
    const name = group[0].label.replace(/^Location:\s*/, '')
    const tags = group.map((item) => `<Picture ${item.number}>`).join(', ').replace(/, ([^,]+)$/, ' and $1')
    lines.push(group[0].locationEnvironmentMode === 'nature'
      ? `${tags} depict the approved ${name} natural landscape. Preserve its terrain, landforms, ecology, vegetation, water features, rock formations, lighting, atmosphere, landmarks, and spatial geography. Nature only: do not add buildings, houses, cabins, sheds, ruins, roads, streets, bridges, fences, signs, vehicles, power lines, utility poles, constructed paths, furniture, or any other human-made structures or objects.`
      : `${tags} depict the approved ${name} location. Preserve its architecture, layout, materials, lighting, landmarks, atmosphere, and spatial geography.`)
  }
  for (const binding of numbered.filter((item) => item.purpose === 'continuity')) lines.push(`Continue the framing, lighting, pose, screen direction, and motion state shown in <Picture ${binding.number}>.`)
  for (const binding of numbered.filter((item) => item.purpose === 'generic')) lines.push(`Use <Picture ${binding.number}> as ${binding.label.replace(/^Shot reference:\s*/, 'the visual reference for ')}.`)
  return lines
}

export function compileMovieShotPrompt(project: MovieProject, scene: MovieScene, shot: MovieShot, bindings: MovieReferenceBinding[]) {
  const location = project.locations.find((item) => item.id === scene.locationId)
  const parts = [shot.prompt.trim()]
  if (location && !sentenceKey(shot.prompt).includes(sentenceKey(location.name))) parts.push(`Environment: ${location.name}. ${location.description}`)
  if (project.visualStyle) parts.push(`Visual treatment: ${project.visualStyle}`)
  if (project.visualRules) parts.push(`Continuity: ${project.visualRules}`)
  if (shot.dialogue && !shot.prompt.includes(shot.dialogue)) parts.push(`Dialogue: "${shot.dialogue}"`)
  parts.push(...composeReferenceInstructions(bindings))
  shot.referenceVideos?.forEach((file, index) => parts.push(`Use <Video ${index + 1}> (${file.name}) as the motion and temporal reference.`))
  shot.referenceAudios?.forEach((file, index) => parts.push(`Use <Audio ${index + 1}> (${file.name}) as the voice, performance, and sound reference.`))
  const seen = new Set<string>()
  return parts.filter(Boolean).filter((part) => { const key = sentenceKey(part); if (!key || seen.has(key)) return false; seen.add(key); return true }).join(' ')
}

export function buildPromptAssistantRequest(tool: PromptAssistantTool, draft: string, context: { duration: number; mode: GenerationMode; referenceMap?: string[]; noDialogue?: boolean }) {
  const preservation = 'Preserve named characters, exact quoted dialogue, specified camera and lens choices, timing, negative constraints, continuity instructions, and every existing <Picture N>, <Video N>, and <Audio N> assignment. Treat the supplied reference map as authoritative: describe what each source contributes and never swap, merge, renumber, or vaguely refer to sources. Never rename characters, invent replacement wardrobe, remove reference tags, add unnecessary cuts, or turn one continuous shot into a montage.'
  const order = 'Write concrete MiniMax-ready production language in this order when relevant: subject/identity and reference assignment, starting state, environment, literal chronological action, shot size, camera angle, lens/depth of field, camera movement, lighting, visual treatment, continuity, dialogue, ambient sound/effects, and exclusions. Prefer observable actions over abstract mood words.'
  const task = tool === 'enhance'
    ? `Rewrite the draft as one polished MiniMax H3 ${context.mode === 'reference' ? 'reference-to-video' : context.mode === 'image' ? 'image-to-video' : context.mode === 'frames' ? 'first/last-frame' : 'text-to-video'} prompt. ${order}`
    : tool === 'timeline'
      ? `Rewrite the draft as one continuous MiniMax H3 shot lasting exactly ${context.duration} seconds. Start each beat with a non-overlapping time range such as 0.0–2.0s; cover the entire duration with no gaps, overlaps, or time beyond ${context.duration}s. Use ${context.duration <= 6 ? '2–3' : context.duration <= 10 ? '3–5' : '4–6'} meaningful beats. Every beat must state the subject action, camera behavior, and continuity from the prior beat. Keep motion physically achievable, preserve screen direction and identity, avoid cuts or montages, and reserve enough time for the final action to settle. ${order}`
      : `Preserve the visual direction and strengthen synchronized dialogue/vocal intent, ambience, sound effects, spatial placement, timing, and clean transitions. State no music when a score is not requested. ${order}`
  return [task, preservation, context.noDialogue ? 'Audio constraint: no spoken dialogue, narration, voice-over, singing, lip-sync, subtitles, captions, or text overlays. Preserve ambient sound effects only.' : '', `Effective duration: ${context.duration} seconds`, `Effective generation route: ${context.mode}`, context.referenceMap?.length ? `REFERENCE MAP (authoritative):\n${context.referenceMap.join('\n')}` : '', 'Return only the finished prompt, with no analysis, preface, Markdown fence, or alternatives.', `DRAFT:\n${draft.trim()}`].filter(Boolean).join('\n\n')
}

export function resolveMovieShot(project: MovieProject, scene: MovieScene, shot: MovieShot, library: CharacterProject[], continuityFrame?: MediaFile): ResolvedMovieShot {
  const all = resolveMovieShotReferences(project, scene, shot, library, continuityFrame)
  const continuationOnly = all.some((item) => item.purpose === 'continuity')
  // The source frame is loaded as I2V's actual first_frame, not as a numbered
  // Ref2V asset. Exclude the other references here so no <Picture N> text can
  // be emitted without a matching uploaded input.
  const references = continuationOnly ? all.filter((item) => item.purpose === 'continuity') : all.slice(0, 9)
  const route = resolveMovieShotGenerationMode(shot, references)
  const characterNames = [...new Set(references.filter((item) => item.characterId && (item.purpose === 'character' || item.purpose === 'character-angle')).map((item) => item.label.replace(/^Character:\s*/, '').split(' / ')[0]))]
  const routeReason = continuationOnly ? 'Exact continuation selected: the prior shot’s final frame is hard-pinned as this shot’s I2V opening frame.' : route.effectiveMode === 'reference' && characterNames.length ? `Reference mode selected automatically because ${characterNames.join(' and ')} ${characterNames.length === 1 ? 'has' : 'have'} approved references.` : route.effectiveMode === 'reference' ? 'Reference mode selected because this shot has reusable reference media.' : `Using the preferred ${route.effectiveMode} route.`
  const compiledBindings = continuationOnly ? [] : route.effectiveMode === 'reference' ? references : references.filter((item) => item.purpose !== 'continuity')
  const continuationDirection = route.effectiveMode === 'image' && references.some((item) => item.purpose === 'continuity') ? ' Continue directly from the supplied first frame, preserving its framing, lighting, pose, screen direction, and motion state.' : ''
  return { ...route, references, omittedReferences: continuationOnly ? [] : all.slice(9), compiledPrompt: `${compileMovieShotPrompt(project, scene, shot, compiledBindings)}${continuationDirection}`, routeReason }
}
