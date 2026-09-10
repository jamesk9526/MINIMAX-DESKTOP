export type CopilotSuggestionTarget = 'create-prompt' | 'character-identity'

export type CopilotSuggestion = {
  id: string
  title: string
  text: string
  target: CopilotSuggestionTarget
  targetId?: string
  sourceLabel?: string
}

export const COPILOT_SUGGESTION_EVENT = 'minimax:copilot-suggestion'
export const COPILOT_DECISION_EVENT = 'minimax:copilot-decision'

export function offerCopilotSuggestion(suggestion: CopilotSuggestion) {
  window.dispatchEvent(new CustomEvent<CopilotSuggestion>(COPILOT_SUGGESTION_EVENT, { detail: suggestion }))
}

export function decideCopilotSuggestion(id: string, decision: 'approve' | 'dismiss') {
  window.dispatchEvent(new CustomEvent(COPILOT_DECISION_EVENT, { detail: { id, decision } }))
}
