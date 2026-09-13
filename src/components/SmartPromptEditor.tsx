import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Aperture, AudioLines, Camera, ChevronRight, Clock3, Lightbulb, MapPin, Move, Plus, Scan, Search, Shirt, Sparkles, Star, Users } from 'lucide-react'
import { promptPresetCategories, promptPresets } from '../lib/promptPresets'
import type { PromptPreset, PromptPresetCategory } from '../types'

export type SmartInsertOption = { id: string; category: 'character' | 'wardrobe' | 'location'; label: string; description: string; insertion: string; thumbnail?: string; meta?: string; onSelect?: (nextValue: string) => void }
export type SmartPromptEditorHandle = { open(): void; focus(): void; insert(text: string): void }

type PaletteItem = SmartInsertOption | (PromptPreset & { meta?: string })
type PaletteFilter = 'all' | 'favorites' | 'recent'
type SortMode = 'suggested' | 'az'

const FAVORITES_KEY = 'minimax.prompt-command-favorites'
const RECENT_KEY = 'minimax.prompt-command-recent'
const categoryIcons: Record<string, typeof Camera> = { camera: Camera, shot: Scan, angle: Aperture, lens: Aperture, lighting: Lightbulb, audio: AudioLines, style: Sparkles, movement: Move, transition: ChevronRight, character: Users, wardrobe: Shirt, location: MapPin }

function loadStoredIds(key: string, limit: number) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(stored) ? [...new Set(stored.filter((value): value is string => typeof value === 'string'))].slice(0, limit) : []
  } catch { return [] }
}

function saveStoredIds(key: string, ids: string[]) { localStorage.setItem(key, JSON.stringify(ids)) }

function matches(item: PaletteItem, query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const searchable = `${item.category} ${item.label} ${item.description} ${'keywords' in item ? item.keywords.join(' ') : ''} ${item.meta ?? ''}`.toLowerCase()
  const fuzzy = (word: string) => { let index = 0; for (const character of searchable) if (character === word[index]) index += 1; return index === word.length }
  return words.every((word) => searchable.includes(word) || fuzzy(word))
}

export const SmartPromptEditor = forwardRef<SmartPromptEditorHandle, { id: string; value: string; onChange(value: string): void; placeholder?: string; ariaLabel?: string; options?: SmartInsertOption[]; className?: string; disabled?: boolean; rows?: number }>(function SmartPromptEditor({ id, value, onChange, placeholder, ariaLabel, options = [], className = '', disabled = false, rows }, forwardedRef) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<PaletteFilter>('all')
  const [selectedCategory, setSelectedCategory] = useState<PromptPresetCategory | undefined>()
  const [sort, setSort] = useState<SortMode>('suggested')
  const [favorites, setFavorites] = useState(() => loadStoredIds(FAVORITES_KEY, 80))
  const [recent, setRecent] = useState(() => loadStoredIds(RECENT_KEY, 24))
  const [commandStart, setCommandStart] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const allItems = useMemo<PaletteItem[]>(() => [...options, ...promptPresets.map((item) => ({ ...item, meta: item.category }))], [options])
  const normalized = query.toLowerCase().trim()
  const queryWords = normalized.split(/\s+/).filter(Boolean)
  const inlineCategory = promptPresetCategories.some((item) => item.id === queryWords[0]) ? queryWords[0] as PromptPresetCategory : undefined
  const category = selectedCategory ?? inlineCategory
  const searchTerm = selectedCategory || !inlineCategory ? normalized : queryWords.slice(1).join(' ')
  const favoriteSet = useMemo(() => new Set(favorites), [favorites])
  const recentIndex = useMemo(() => new Map(recent.map((item, index) => [item, index])), [recent])
  const results = useMemo(() => allItems
    .filter((item) => !category || item.category === category)
    .filter((item) => filter !== 'favorites' || favoriteSet.has(item.id))
    .filter((item) => filter !== 'recent' || recentIndex.has(item.id))
    .filter((item) => matches(item, searchTerm))
    .sort((left, right) => {
      if (sort === 'az') return left.label.localeCompare(right.label)
      const leftRecent = recentIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER
      const rightRecent = recentIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER
      if (!searchTerm && leftRecent !== rightRecent) return leftRecent - rightRecent
      const leftFavorite = favoriteSet.has(left.id) ? 0 : 1
      const rightFavorite = favoriteSet.has(right.id) ? 0 : 1
      if (leftFavorite !== rightFavorite) return leftFavorite - rightFavorite
      return left.label.localeCompare(right.label)
    }), [allItems, category, favoriteSet, filter, recentIndex, searchTerm, sort])
  const categoryCounts = useMemo(() => new Map(promptPresetCategories.map((item) => [item.id, allItems.filter((preset) => preset.category === item.id).length])), [allItems])

  useEffect(() => setActive(0), [query, filter, selectedCategory, sort])
  useEffect(() => { if (open) resultsRef.current?.querySelector<HTMLElement>(`[data-preset-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, results])

  const remember = (item: PaletteItem) => setRecent((current) => {
    const next = [item.id, ...current.filter((id) => id !== item.id)].slice(0, 24)
    saveStoredIds(RECENT_KEY, next)
    return next
  })
  const toggleFavorite = (item: PaletteItem) => setFavorites((current) => {
    const next = current.includes(item.id) ? current.filter((id) => id !== item.id) : [item.id, ...current].slice(0, 80)
    saveStoredIds(FAVORITES_KEY, next)
    return next
  })
  const openPalette = () => { setCommandStart(null); setQuery(''); setFilter('all'); setSelectedCategory(undefined); setOpen(true); requestAnimationFrame(() => searchRef.current?.focus()) }

  const insert = (text: string, option?: SmartInsertOption) => {
    const input = inputRef.current
    if (!input) return
    let start = commandStart ?? input.selectionStart
    let end = commandStart === null ? input.selectionEnd : input.selectionStart
    const label = text.match(/^([A-Za-z ]+):/)?.[1]
    if (commandStart === null && label) {
      const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const lineEndIndex = value.indexOf('\n', end)
      const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex
      if (value.slice(lineStart, lineEnd).trimStart().startsWith(`${label}:`)) { start = lineStart; end = lineEnd }
    }
    const before = value.slice(0, start)
    const after = value.slice(end)
    const inserted = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s/.test(after) ? ' ' : ''}`
    input.setRangeText(inserted, start, end, 'end')
    if (option?.onSelect) option.onSelect(input.value)
    else onChange(input.value)
    const item = results[active]
    if (item) remember(item)
    setOpen(false); setCommandStart(null); setQuery('')
    requestAnimationFrame(() => input.focus())
  }

  useImperativeHandle(forwardedRef, () => ({ open: openPalette, focus: () => inputRef.current?.focus(), insert }))

  const updateCommand = (input: HTMLTextAreaElement) => {
    const before = input.value.slice(0, input.selectionStart)
    const match = before.match(/(?:^|\s)\/\/([a-zA-Z0-9-]*(?:\s+[a-zA-Z0-9-]*)?)$/)
    if (!match) { if (commandStart !== null) { setOpen(false); setCommandStart(null) }; return }
    setCommandStart(input.selectionStart - match[1].length - 2)
    setQuery(match[1]); setFilter('all'); setSelectedCategory(undefined); setOpen(true)
  }
  const selectResult = (index: number) => { const item = results[index]; if (item) insert(item.insertion, 'onSelect' in item ? item as SmartInsertOption : undefined) }
  const handlePaletteKey = (event: React.KeyboardEvent) => {
    if (!open) return
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 1)) }
    else if (event.key === 'PageDown') { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 8)) }
    else if (event.key === 'PageUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 8)) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, results.length - 1)) }
    else if (event.key === 'Enter' || (event.key === 'Tab' && results.length > 0)) { event.preventDefault(); selectResult(active) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setCommandStart(null); inputRef.current?.focus() }
  }

  return (
    <div className={`smart-prompt-editor ${className}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) window.setTimeout(() => setOpen(false), 100) }}>
      <textarea ref={inputRef} id={id} aria-label={ariaLabel} value={value} placeholder={placeholder} disabled={disabled} rows={rows} onChange={(event) => { onChange(event.target.value); updateCommand(event.currentTarget) }} onClick={(event) => updateCommand(event.currentTarget)} onKeyDown={handlePaletteKey} />
      {open && <div className="smart-insert-menu" role="dialog" aria-label="Production prompt command palette">
        <header><Search size={15} /><input ref={searchRef} aria-label="Search production commands" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handlePaletteKey} placeholder="Search commands, e.g. dolly, rain, 85mm…" /><span>{results.length} matches</span><kbd>Esc</kbd></header>
        <div className="smart-insert-toolbar">
          <div className="smart-insert-filters" aria-label="Command filters">
            <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onMouseDown={(event) => event.preventDefault()} onClick={() => setFilter('all')}>All</button>
            <button type="button" className={filter === 'favorites' ? 'active' : ''} aria-pressed={filter === 'favorites'} onMouseDown={(event) => event.preventDefault()} onClick={() => setFilter('favorites')}><Star size={12} />Favorites <small>{favorites.length}</small></button>
            <button type="button" className={filter === 'recent' ? 'active' : ''} aria-pressed={filter === 'recent'} onMouseDown={(event) => event.preventDefault()} onClick={() => setFilter('recent')}><Clock3 size={12} />Recent <small>{recent.length}</small></button>
          </div>
          <label className="smart-insert-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="suggested">Suggested</option><option value="az">A–Z</option></select></label>
        </div>
        <div className="smart-insert-categories" aria-label="Command categories">
          <button type="button" className={!category ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelectedCategory(undefined); setQuery('') }}>All categories <small>{allItems.length}</small></button>
          {promptPresetCategories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelectedCategory(item.id); setQuery('') }}>{item.label}<small>{categoryCounts.get(item.id) ?? 0}</small></button>)}
        </div>
        <div ref={resultsRef} className="smart-insert-results" role="listbox" aria-label="Matching commands">
          {results.length ? results.map((item, index) => {
            const Icon = categoryIcons[item.category] ?? Sparkles
            const favorite = favoriteSet.has(item.id)
            return <div role="option" data-preset-index={index} data-item-type={item.category} aria-selected={index === active} className={`smart-insert-result ${index === active ? 'active' : ''}`} key={item.id} onMouseEnter={() => setActive(index)}>
              <button type="button" className="smart-insert-result-main" onMouseDown={(event) => event.preventDefault()} onClick={() => selectResult(index)}>
                {'thumbnail' in item && item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span><Icon size={15} /></span>}
                <div><strong>{item.label}</strong><small>{item.description}</small></div>
                <em>{item.meta ?? item.category}</em>
              </button>
              <button type="button" className={favorite ? 'favorite active' : 'favorite'} aria-pressed={favorite} aria-label={`${favorite ? 'Remove' : 'Add'} ${item.label} ${favorite ? 'from' : 'to'} favorites`} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFavorite(item)}><Star size={14} fill={favorite ? 'currentColor' : 'none'} /></button>
            </div>
          }) : <div className="smart-insert-empty"><Search size={18} /><strong>No matching command</strong><span>Try a different word, choose a category, or return to All.</span></div>}
        </div>
        <footer><span>{category ? `${promptPresetCategories.find((item) => item.id === category)?.label} commands` : 'Type a category first, e.g. // camera dolly'}</span><span>↑↓ move · Enter insert · ☆ save</span></footer>
      </div>}
      <div className="smart-prompt-footer"><button type="button" disabled={disabled} onClick={openPalette}><Plus size={13} />Insert command</button><span>Type <code>//</code> to search {allItems.length} production commands</span></div>
    </div>
  )
})
