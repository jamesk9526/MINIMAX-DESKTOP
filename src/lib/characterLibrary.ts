import type { CharacterProject, MediaFile, ReferenceImageType } from '../types'
import { createId } from './createId'

const KEY = 'minimax.character-projects'
export const CHARACTER_LIBRARY_EVENT = 'minimax-character-library-changed'

export function newCharacterProject(index = 1): CharacterProject {
  const now = Date.now()
  return { id: createId(), name: `Character ${index}`, description: '', wardrobe: '', voiceNotes: '', visualStyle: 'cinematic photorealism', referencePrompt: '', createdAt: now, updatedAt: now, referenceMode: 'set', referenceImages: [], detailReferences: [], wardrobeIds: [], accessoryIds: [], hairStyleIds: [], identityTemplate: 'cinematic', hairPreset: '', skinTone: '' }
}

function validImageReference(value: unknown): value is MediaFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<MediaFile>
  return typeof file.path === 'string' && Boolean(file.path.trim()) && typeof file.name === 'string' && Boolean(file.name.trim()) && (file.kind === 'image' || typeof file.kind === 'undefined')
}

const referenceImageTypes = new Set<ReferenceImageType>(['master', 'face', 'full-body', 'three-quarter', 'profile', 'back', 'detail', 'other'])
const normalizedReferenceType = (value: unknown, fallback: ReferenceImageType = 'other'): ReferenceImageType => typeof value === 'string' && referenceImageTypes.has(value as ReferenceImageType) ? value as ReferenceImageType : fallback

function uniqueImageReferences(files: unknown[], limit = 9): MediaFile[] {
  return files.filter(validImageReference).map((file) => ({ ...file, kind: 'image' as const, referenceType: normalizedReferenceType(file.referenceType) })).filter((file, index, all) => all.findIndex((item) => item.path === file.path) === index).slice(0, limit)
}

export function loadCharacterProjects(): CharacterProject[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Partial<CharacterProject>[]
    return raw.filter((item) => item.id).map((item, index) => ({
      ...newCharacterProject(index + 1),
      ...item,
      wardrobe: '',
      referencePrompt: item.wardrobe && item.referencePrompt?.includes(item.wardrobe) ? '' : item.referencePrompt ?? '',
      referenceMode: item.referenceMode === 'single' ? 'single' : 'set',
      baseImage: validImageReference(item.baseImage) ? { ...item.baseImage, kind: 'image', referenceType: normalizedReferenceType(item.baseImage.referenceType, 'master') } : undefined,
      referenceImages: uniqueImageReferences(item.referenceImages ?? []),
      detailReferences: (item.detailReferences ?? []).filter((detail) => detail && typeof detail.id === 'string').slice(0, 8).map((detail) => ({ ...detail, label: String(detail.label ?? '').slice(0, 120), notes: String(detail.notes ?? '').slice(0, 1200), images: uniqueImageReferences(detail.images ?? (detail.image ? [detail.image] : []), 2) })),
      selectedReferencePaths: Array.isArray(item.selectedReferencePaths) ? [...new Set(item.selectedReferencePaths.filter((path): path is string => typeof path === 'string' && Boolean(path.trim())))] : undefined,
      wardrobeIds: Array.isArray(item.wardrobeIds) ? [...new Set(item.wardrobeIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))] : [],
      accessoryIds: Array.isArray(item.accessoryIds) ? [...new Set(item.accessoryIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))] : [],
      hairStyleIds: Array.isArray(item.hairStyleIds) ? [...new Set(item.hairStyleIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())))] : [],
    }))
  } catch { return [] }
}

export function saveCharacterProjects(projects: CharacterProject[]) {
  localStorage.setItem(KEY, JSON.stringify(projects))
  window.dispatchEvent(new CustomEvent(CHARACTER_LIBRARY_EVENT))
}

export function updateCharacterProject(id: string, change: Partial<CharacterProject>) {
  const projects = loadCharacterProjects().map((project) => project.id === id ? { ...project, ...change, updatedAt: Date.now() } : project)
  saveCharacterProjects(projects)
}

export function characterIdentityReferences(project: CharacterProject): MediaFile[] {
  const approved = uniqueImageReferences(project.referenceImages ?? [])
  const selected = project.selectedReferencePaths === undefined ? approved : approved.filter((file) => project.selectedReferencePaths?.includes(file.path))
  // A stale empty selection must never make an otherwise approved character
  // disappear from a production render. The master remains the safe anchor.
  if (project.referenceMode === 'single' || !selected.length) return project.baseImage && validImageReference(project.baseImage) ? [{ ...project.baseImage, kind: 'image', referenceType: normalizedReferenceType(project.baseImage.referenceType, 'master') }] : approved.slice(0, 1)
  return selected
}

export function characterReferences(project: CharacterProject, includeDetailReferences = false): MediaFile[] {
  const identity = characterIdentityReferences(project)
  const details = includeDetailReferences ? uniqueImageReferences((project.detailReferences ?? []).flatMap((detail) => detail.images ?? []), 8) : []
  return [...identity, ...details].filter((file, index, all) => all.findIndex((item) => item.path === file.path) === index).slice(0, 9)
}
