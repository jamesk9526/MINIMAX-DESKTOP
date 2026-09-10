import type { ComfyPrompt } from './workflow'

export type ZImageVariant = 'turbo' | 'base'

// Comfy-Org workflow_templates/templates/image_z_image_turbo.json
// Comfy-Org workflow_templates/templates/image_z_image.json
export function buildZImage(prompt: string, width: number, height: number, seed: number, model: string, encoder: string, vae: string, steps = 8, cfg = 1, variant: ZImageVariant = 'turbo', negativePrompt = '', attentionBackend?: string): ComfyPrompt {
  const diffusionModel: [string, number] = attentionBackend ? ['85', 0] : ['1', 0]
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
    ...(attentionBackend ? { '85': { class_type: 'ModelAttentionBackend', inputs: { model: ['1', 0], attention: attentionBackend } } } : {}),
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: encoder, type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '5': variant === 'base'
      ? { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: negativePrompt } }
      : { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    '7': { class_type: 'ModelSamplingAuraFlow', inputs: { model: diffusionModel, shift: 3 } },
    '8': { class_type: 'KSampler', inputs: { model: ['7', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed, steps, cfg, sampler_name: 'res_multistep', scheduler: 'simple', denoise: 1 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'MiniMax_first_frames/ZImage' } },
  }
}
