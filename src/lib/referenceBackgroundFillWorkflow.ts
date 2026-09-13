import type { UploadedFile } from '../types'
import type { ComfyPrompt } from './workflow'

/** Persists the prepared, canvas-sized character reference through ComfyUI so it
 * lands beside other production outputs and can be assigned to the library. */
export function buildReferenceBackgroundFillWorkflow(image: UploadedFile, filenamePrefix: string): ComfyPrompt {
  const uploadedName = image.subfolder ? `${image.subfolder}/${image.name}` : image.name
  return {
    '1': { class_type: 'LoadImage', inputs: { image: uploadedName } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: filenamePrefix } },
  }
}
