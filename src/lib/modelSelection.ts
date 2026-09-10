import type { Ltx25ModelSelection, ModelFile, ModelKind, ModelSelection } from '../types'

function findModel(files: ModelFile[], kind: ModelKind, expressions: RegExp | RegExp[]) {
  const candidates = files.filter((file) => file.kind === kind)
  for (const expression of Array.isArray(expressions) ? expressions : [expressions]) {
    const match = candidates.find((file) => expression.test(file.name))
    if (match) return match.name
  }
  return ''
}

export type H3TextEncoderPreference = 'fast' | 'quality'

export const H3_FAST_TEXT_ENCODER = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
export const H3_QUALITY_TEXT_ENCODER = 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors'

export function inferSelections(files: ModelFile[], turbo: 'off' | '4' | '8', textEncoderPreference: H3TextEncoderPreference = 'fast'): ModelSelection {
  const find = (kind: ModelKind, expressions: RegExp | RegExp[]) => findModel(files, kind, expressions)
  const turboSteps = turbo === 'off' ? '[48]' : turbo
  return {
    fl2va: find('diffusion_models', [/^minimax_h3_fl2va_pruned_int8_convrot\.safetensors$/i, /^minimax_h3_fl2va.*\.safetensors$/i]),
    ref2va: find('diffusion_models', [/^minimax_h3_ref2va_pruned_int8_convrot\.safetensors$/i, /^minimax_h3_ref2va.*\.safetensors$/i]),
    // Keep NVFP4-AWQ as the fast default. The full INT8 ConvRot encoder is an
    // intentional opt-in: falling back would make the quality choice misleading.
    textEncoder: textEncoderPreference === 'quality'
      ? find('text_encoders', /^qwen3vl_32b_minimax_h3_int8_convrot\.safetensors$/i)
      : find('text_encoders', [/^qwen3vl_32b_minimax_h3_nvfp4_awq\.safetensors$/i, /^qwen3vl_32b_minimax_h3.*\.safetensors$/i]),
    videoVae: find('vae', [/^minimax_h3_video_vae_fp16\.safetensors$/i, /^minimax_h3_video_vae.*\.safetensors$/i]),
    audioVae: find('vae', [/^minimax_h3_audio_vae_fp32\.safetensors$/i, /^minimax_h3_audio_vae.*\.safetensors$/i]),
    previewVae: find('vae_approx', /^taeh3_decoder\.safetensors$/i),
    fl2vLora: find('loras', new RegExp(`^minimax_h3_fl2v_turbo_${turboSteps}step.*\\.safetensors$`, 'i')),
    ref2vLora: turbo === '8'
      ? find('loras', [
        /^minimax_h3_ref2v_turbo_8step_v1\.0_768p_comfyui_bf16\.safetensors$/i,
        /^minimax_h3_ref2v_turbo_8step.*comfyui.*\.safetensors$/i,
        /^minimax_h3_ref2v_turbo_8step.*\.safetensors$/i,
      ])
      : find('loras', [
        /^minimax_h3_ref2v_turbo_4step_v0\.1_comfyui_bf16\.safetensors$/i,
        /^minimax_h3_ref2v_turbo_4step.*\.safetensors$/i,
      ]),
  }
}

export function inferLtx25Selections(files: ModelFile[], latentUpscalers: string[]): Ltx25ModelSelection {
  return {
    diffusion: findModel(files, 'diffusion_models', [
      /^ltx-2\.5-22b-distilled-transformer-comfy-int8-convrot\.safetensors$/i,
      /^ltx-2\.5-22b-distilled-transformer-nvfp4\.safetensors$/i,
      /^ltx-2\.5-22b-distilled-transformer.*\.safetensors$/i,
    ]),
    textEncoder: findModel(files, 'text_encoders', [
      /^gemma4-12b-with-proj-ltx-2\.5-comfy-int8-convrot\.safetensors$/i,
      /^gemma4-12b-with-proj-ltx-2\.5.*\.safetensors$/i,
    ]),
    videoVae: findModel(files, 'vae', /^ltx-2\.5-video-vae.*\.safetensors$/i),
    audioVae: findModel(files, 'vae', /^ltx-2\.5-audio-vae.*\.safetensors$/i),
    latentUpscaler: latentUpscalers.find((name) => /^ltx-2\.5-latent-spatial-upscaler-x2.*\.safetensors$/i.test(name)) ?? '',
  }
}
