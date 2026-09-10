import type { AttentionBackendPreference } from '../types'

/** Resolve a saved preference to the exact enum value advertised by this
 * ComfyUI instance. Never invent a backend name: an unavailable accelerator
 * must leave a workflow unpatched rather than make a render fail validation. */
export function resolveAttentionBackend(preference: AttentionBackendPreference, available: string[]) {
  const kitchen = available.find((value) => /comfy[ _-]?kitchen|kitchen.*int8|int8.*kitchen/i.test(value))
  const sage = available.find((value) => /sage/i.test(value))
  const native = available.find((value) => /pytorch|native|sdpa/i.test(value))
  if (preference === 'kitchen') return kitchen
  if (preference === 'sage') return sage
  if (preference === 'native') return native
  return kitchen ?? sage ?? native
}

export function attentionBackendLabel(backend?: string) {
  if (!backend) return 'ComfyUI default attention'
  if (/kitchen|int8/i.test(backend)) return 'Kitchen INT8 attention'
  if (/sage/i.test(backend)) return 'SageAttention'
  if (/pytorch|native|sdpa/i.test(backend)) return 'Native PyTorch attention'
  return backend
}
