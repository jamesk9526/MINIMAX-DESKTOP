import type { AceStepGenerationOptions, AceStepModelSelection, ModelFile } from '../types'
import type { ComfyPrompt } from './workflow'

export const ACE_STEP_REQUIRED_NODES = [
  'UNETLoader', 'DualCLIPLoader', 'VAELoader', 'TextEncodeAceStepAudio1.5',
  'EmptyAceStep1.5LatentAudio', 'ConditioningZeroOut', 'ModelSamplingAuraFlow',
  'KSampler', 'VAEDecodeAudio', 'SaveAudioAdvanced',
] as const

function matching(models: ModelFile[], kind: ModelFile['kind'], pattern: RegExp) {
  return models.find((model) => model.kind === kind && pattern.test(model.name))?.name ?? ''
}

export function inferAceStepSelections(models: ModelFile[]): AceStepModelSelection {
  return {
    base: matching(models, 'diffusion_models', /^acestep_v1\.5_xl_base_bf16(?:\.safetensors)?$/i),
    sft: matching(models, 'diffusion_models', /^acestep_v1\.5_xl_sft_bf16(?:\.safetensors)?$/i),
    textEncoderSmall: matching(models, 'text_encoders', /^qwen_0\.6b_ace15(?:\.safetensors)?$/i),
    textEncoderLarge: matching(models, 'text_encoders', /^qwen_4b_ace15(?:\.safetensors)?$/i),
    vae: matching(models, 'vae', /^ace_1\.5_vae(?:\.safetensors)?$/i),
  }
}

export function buildAceStepWorkflow(options: AceStepGenerationOptions, models: AceStepModelSelection): ComfyPrompt {
  const diffusion = options.model === 'sft' ? models.sft : models.base
  const lyrics = options.instrumental ? '[Instrumental]' : options.lyrics.trim()
  const model: [string, number] = options.attentionBackend ? ['85', 0] : ['1', 0]
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: diffusion, weight_dtype: 'default' } },
    ...(options.attentionBackend ? { '85': { class_type: 'ModelAttentionBackend', inputs: { model: ['1', 0], attention: options.attentionBackend } } } : {}),
    '2': { class_type: 'DualCLIPLoader', inputs: { clip_name1: models.textEncoderSmall, clip_name2: models.textEncoderLarge, type: 'ace', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    '4': {
      class_type: 'TextEncodeAceStepAudio1.5',
      inputs: {
        clip: ['2', 0], tags: options.tags.trim(), lyrics, seed: options.seed,
        bpm: options.bpm, duration: options.duration, timesignature: options.timeSignature,
        language: options.language, keyscale: options.keyScale, generate_audio_codes: options.generateAudioCodes,
        cfg_scale: 2, temperature: 0.85, top_p: 1, top_k: 0, min_p: 0,
      },
    },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model, shift: 3 } },
    '7': { class_type: 'EmptyAceStep1.5LatentAudio', inputs: { seconds: options.duration, batch_size: 1 } },
    '8': {
      class_type: 'KSampler',
      inputs: {
        model: ['6', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0],
        seed: options.seed, steps: 50, cfg: options.model === 'sft' ? 7 : 6,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1,
      },
    },
    '9': { class_type: 'VAEDecodeAudio', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'SaveAudioAdvanced', inputs: { audio: ['9', 0], filename_prefix: options.filenamePrefix, format: 'flac' } },
  }
}
