import type { CharacterProject, MediaFile } from '../types'
import { createId } from './createId'

const KEY = 'minimax.character-projects'
export const CHARACTER_LIBRARY_EVENT = 'minimax-character-library-changed'

export function newCharacterProject(index = 1): CharacterProject {
  const now = Date.now()
  return { id: createId(), name: `Character ${index}`, description: '', wardrobe: '', voiceNotes: '', visualStyle: 'cinematic photorealism', referencePrompt: '', createdAt: now, updatedAt: now, referenceMode: 'set', referenceImages: [], detailReferences: [], wardrobeIds: [], accessoryIds: [], hairStyleIds: [], identityTemplate: 'cinematic', hairPreset: '', skinTone: '' }
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
      referenceImages: item.referenceImages ?? [],
      detailReferences: item.detailReferences ?? [],
      wardrobeIds: item.wardrobeIds ?? [],
      accessoryIds: item.accessoryIds ?? [],
      hairStyleIds: item.hairStyleIds ?? [],
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

export function characterReferences(project: CharacterProject, includeDetailReferences = false): MediaFile[] {
  const identity = project.referenceMode === 'single' ? (project.baseImage ? [project.baseImage] : [])
    : !project.referenceImages.length ? (project.baseImage ? [project.baseImage] : [])
    : project.selectedReferencePaths === undefined
    ? project.referenceImages
    : project.referenceImages.filter((file) => project.selectedReferencePaths?.includes(file.path))
  const details = includeDetailReferences ? (project.detailReferences ?? []).flatMap((detail) => detail.image ? [detail.image] : []) : []
  return [...identity, ...details].filter((file, index, all) => all.findIndex((item) => item.path === file.path) === index)
}
