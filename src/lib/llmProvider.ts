import type { AppSettings } from '../types'

export type LlmConnection = { provider: AppSettings['llmProvider']; url: string; model: string; label: 'Ollama' | 'LM Studio' }

export function resolveLlmConnection(settings: AppSettings): LlmConnection {
  return settings.llmProvider === 'lmstudio'
    ? { provider: 'lmstudio', url: settings.lmStudioUrl, model: settings.lmStudioModel, label: 'LM Studio' }
    : { provider: 'ollama', url: settings.ollamaUrl, model: settings.ollamaModel, label: 'Ollama' }
}
