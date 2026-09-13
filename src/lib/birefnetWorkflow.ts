import type { UploadedFile } from '../types'
import type { ComfyPrompt } from './workflow'

/** Native ComfyUI BiRefNet graph. The model lives in models/background_removal
 * and returns a foreground mask; JoinImageWithAlpha turns that into a portable
 * RGBA PNG, while MaskToImage preserves an editable matte alongside it. */
export function buildBiRefNetWorkflow(input: UploadedFile, filenamePrefix: string): ComfyPrompt {
  const image = input.subfolder ? `${input.subfolder.replace(/\\/g, '/')}/${input.name}` : input.name
  return {
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: 'birefnet.safetensors' } },
    '3': { class_type: 'RemoveBackground', inputs: { image: ['1', 0], bg_removal_model: ['2', 0] } },
    '4': { class_type: 'InvertMask', inputs: { mask: ['3', 0] } },
    '5': { class_type: 'JoinImageWithAlpha', inputs: { image: ['1', 0], alpha: ['4', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: `${filenamePrefix}_cutout` } },
    '7': { class_type: 'MaskToImage', inputs: { mask: ['3', 0] } },
    '8': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: `${filenamePrefix}_mask` } },
  }
}
