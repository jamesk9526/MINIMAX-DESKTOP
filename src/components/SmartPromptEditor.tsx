import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Aperture, AudioLines, Camera, ChevronRight, Lightbulb, MapPin, Move, Plus, Scan, Search, Shirt, Sparkles, Users } from 'lucide-react'
import { promptPresetCategories, promptPresets, searchPromptPresets } from '../lib/promptPresets'
import type { PromptPresetCategory } from '../types'

export type SmartInsertOption = { id: string; category: 'character' | 'wardrobe' | 'location'; label: string; description: string; insertion: string; thumbnail?: string; meta?: string; onSelect?: (nextValue: string) => void }
export type SmartPromptEditorHandle = { open(): void; focus(): void; insert(text: string): void }

const categoryIcons: Record<string, typeof Camera> = { camera: Camera, shot: Scan, angle: Aperture, lens: Aperture, lighting: Lightbulb, audio: AudioLines, style: Sparkles, movement: Move, transition: ChevronRight, character: Users, wardrobe: Shirt, location: MapPin }

export const SmartPromptEditor = forwardRef<SmartPromptEditorHandle, { id: string; value: string; onChange(value: string): void; placeholder?: string; ariaLabel?: string; options?: SmartInsertOption[]; className?: string; disabled?: boolean; rows?: number }>(function SmartPromptEditor({ id, value, onChange, placeholder, ariaLabel, options = [], className = '', disabled = false, rows }, forwardedRef) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [commandStart, setCommandStart] = useState<number | null>(null)
  const [active, setActive] = useState(0)
  const normalized = query.toLowerCase().trim()
  const [categoryQuery, term] = normalized.split(/\s+/, 2)
  const category = promptPresetCategories.some((item) => item.id === categoryQuery) ? categoryQuery as PromptPresetCategory : undefined
  const results = useMemo(() => {
    const dynamic = options.filter((item) => !category || item.category === category).filter((item) => !term || `${item.label} ${item.description}`.toLowerCase().includes(term))
    const presets = (category ? searchPromptPresets(term ?? '').filter((item) => item.category === category) : searchPromptPresets(normalized))
    return [...dynamic, ...presets.map((item) => ({ ...item, meta: item.category }))]
  }, [category, normalized, options, term])
  const categoryCounts = useMemo(() => new Map(promptPresetCategories.map((item) => [item.id, promptPresets.filter((preset) => preset.category === item.id).length + options.filter((option) => option.category === item.id).length])), [options])

  useEffect(() => setActive(0), [query])
  useEffect(() => { if (open) resultsRef.current?.querySelector<HTMLElement>(`[data-preset-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active, open, results])

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
    setOpen(false); setCommandStart(null); setQuery('')
    requestAnimationFrame(() => input.focus())
  }

  useImperativeHandle(forwardedRef, () => ({ open: () => { setCommandStart(null); setQuery(''); setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }, focus: () => inputRef.current?.focus(), insert }))

  const updateCommand = (input: HTMLTextAreaElement) => {
    const before = input.value.slice(0, input.selectionStart)
    const match = before.match(/(?:^|\s)\/\/([a-zA-Z0-9-]*(?:\s+[a-zA-Z0-9-]*)?)$/)
    if (!match) { if (commandStart !== null) { setOpen(false); setCommandStart(null) }; return }
    setCommandStart(input.selectionStart - match[1].length - 2)
    setQuery(match[1]); setOpen(true)
  }

  const selectResult = (index: number) => {
    const item = results[index]
    if (!item) return
    insert(item.insertion, 'onSelect' in item ? item as SmartInsertOption : undefined)
  }

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

  return <div className={`smart-prompt-editor ${className}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) window.setTimeout(() => setOpen(false), 100) }}>
    <textarea ref={inputRef} id={id} aria-label={ariaLabel} value={value} placeholder={placeholder} disabled={disabled} rows={rows} onChange={(event) => { onChange(event.target.value); updateCommand(event.currentTarget) }} onClick={(event) => updateCommand(event.currentTarget)} onKeyDown={handlePaletteKey} />
    {open && <div className="smart-insert-menu" role="dialog" aria-label="Production prompt commands"><header><Search size={14} /><input ref={searchRef} aria-label="Search production presets" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={handlePaletteKey} placeholder="Search camera, lighting, sound…" /><span>{results.length} items</span><kbd>Esc</kbd></header><div className="smart-insert-categories" aria-label="Preset categories"><button type="button" className={!category ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery('')}>All <small>{promptPresets.length + options.length}</small></button>{promptPresetCategories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => setQuery(item.id)}>{item.label}<small>{categoryCounts.get(item.id) ?? 0}</small></button>)}</div><div ref={resultsRef} className="smart-insert-results" role="listbox">{results.length ? results.map((item, index) => { const Icon = categoryIcons[item.category] ?? Sparkles; return <button type="button" role="option" data-preset-index={index} data-item-type={item.category} aria-selected={index === active} className={index === active ? 'active' : ''} key={item.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => selectResult(index)}>{'thumbnail' in item && item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span><Icon size={15} /></span>}<div><strong>{item.label}</strong><small>{item.description}</small></div><em>{item.meta ?? item.category}</em></button> }) : <div className="smart-insert-empty">No matching production preset</div>}</div><footer><span>Browse categories or type to filter</span><span>↑↓ / PgUp PgDn · Enter insert</span></footer></div>}
    <div className="smart-prompt-footer"><button type="button" disabled={disabled} onClick={() => { setCommandStart(null); setQuery(''); setOpen((value) => { const next = !value; if (next) requestAnimationFrame(() => searchRef.current?.focus()); return next }) }}><Plus size={13} />Insert</button><span>Type <code>//</code> or browse {promptPresets.length + options.length} production commands</span></div>
  </div>
})
