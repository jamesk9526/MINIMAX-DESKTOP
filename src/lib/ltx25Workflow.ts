import type { Ltx25GenerationOptions, Ltx25ModelSelection, UploadedFile } from '../types'
import type { ComfyPrompt } from './workflow'

type Link = [string, number]

function uploadedName(file: UploadedFile) {
  return file.subfolder ? `${file.subfolder.replace(/\\/g, '/')}/${file.name}` : file.name
}

export const LTX25_FIRST_STAGE_SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'
export const LTX25_REFINER_SIGMAS = '0.85, 0.7250, 0.4219, 0.0'

export function ltx25FrameCount(seconds: number) {
  return Math.max(25, Math.round(seconds * 24) + 1)
}

export function buildLtx25Workflow(
  options: Ltx25GenerationOptions,
  models: Ltx25ModelSelection,
  firstFrame?: UploadedFile,
  msrReferences: UploadedFile[] = [],
): ComfyPrompt {
  const frames = ltx25FrameCount(options.duration)
  const quality = options.preset === 'quality'
  // The official two-stage template divides the selected output dimensions by
  // two directly before constructing the first-stage latent.
  const firstWidth = quality ? options.width / 2 : options.width
  const firstHeight = quality ? options.height / 2 : options.height
  const prompt: ComfyPrompt = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.diffusion, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.textEncoder, type: 'ltxv', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } },
    '5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: options.prompt } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'pc game, console game, video game, cartoon, childish, ugly' } },
    '7': { class_type: 'LTXVConditioning', inputs: { positive: ['5', 0], negative: ['6', 0], frame_rate: 24 } },
    '8': { class_type: 'EmptyLTXVLatentVideo', inputs: { width: firstWidth, height: firstHeight, length: frames, batch_size: 1 } },
    '9': { class_type: 'LTXVEmptyLatentAudio', inputs: { audio_vae: ['4', 0], frames_number: frames, frame_rate: 24, batch_size: 1 } },
    '11': { class_type: 'RandomNoise', inputs: { noise_seed: options.seed } },
    '12': { class_type: 'LTXVDualCFGGuider', inputs: { model: ['1', 0], positive: ['7', 0], negative: ['7', 1], video_cfg: 1, audio_cfg: 1 } },
    '13': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    '14': { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_FIRST_STAGE_SIGMAS } },
  }

  // KJNodes' LTX2SamplingPreviewOverride wraps the model before either stage's
  // guider. The supplied LTX 2.5 DEV workflow connects the video VAE here and
  // leaves the optional latent-upscale-model socket empty; retaining that
  // wiring avoids a current DynamicVRAM ModelPatcher compatibility failure.
  let modelLink: Link = ['1', 0]
  let initialVideo: Link = ['8', 0]
  if (options.msr && msrReferences.length) {
    // Licon MSR's loader must precede both LTX guiders; its guide then replaces
    // the text conditioning and video latent with slot-aware reference tokens.
    prompt['47'] = { class_type: 'ComfyUILTX25MSRICLoRALoader', inputs: { model: modelLink, lora_name: options.msr.loraName, strength_model: 1 } }
    modelLink = ['47', 0]
    const guideInputs: Record<string, string | number | boolean | Link> = { positive: ['5', 0], negative: ['6', 0], vae: ['3', 0], latent: ['8', 0], strength: 1, reference_frames: '33', use_tiled_encode: false, tile_size: 256, tile_overlap: 64, msr_parameters: ['47', 1] }
    const slots = ['pic1', 'pic2', 'pic3', 'pic4', 'background']
    msrReferences.slice(0, 5).forEach((file, index) => {
      const id = String(50 + index)
      prompt[id] = { class_type: 'LoadImage', inputs: { image: uploadedName(file) } }
      guideInputs[slots[index]] = [id, 0]
    })
    prompt['48'] = { class_type: 'ComfyUILTX25MSRMultiReferenceGuide', inputs: guideInputs }
    prompt['7'].inputs = { positive: ['48', 0], negative: ['48', 1], frame_rate: 24 }
    initialVideo = ['48', 2]
  }
  prompt['12'].inputs.model = modelLink
  if (options.previewOverride) {
    prompt['46'] = {
      class_type: options.previewOverride.nodeType,
      inputs: { model: modelLink, preview_rate: options.previewOverride.fps, vae: ['3', 0] },
    }
    modelLink = ['46', 0]
    prompt['12'].inputs.model = modelLink
  }

  let preparedImage: Link | undefined
  if (options.mode === 'image' && firstFrame) {
    prompt['20'] = { class_type: 'LoadImage', inputs: { image: uploadedName(firstFrame) } }
    // ResizeImageMaskNode is a current ComfyUI DynamicCombo node. Its selected
    // branch values must use dotted API keys; a legacy `resolution` input is
    // ignored and fails validation with a missing `resize_type.longer_size`.
    prompt['21'] = { class_type: 'ResizeImageMaskNode', inputs: { input: ['20', 0], resize_type: 'scale longer dimension', 'resize_type.longer_size': 1536, scale_method: 'lanczos' } }
    prompt['22'] = { class_type: 'LTXVPreprocess', inputs: { image: ['21', 0], img_compression: 18 } }
    prompt['23'] = { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: ['22', 0], latent: initialVideo, strength: 0.7, bypass: false } }
    initialVideo = ['23', 0]
    preparedImage = ['22', 0]
  }

  prompt['10'] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: initialVideo, audio_latent: ['9', 0] } }
  prompt['15'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['11', 0], guider: ['12', 0], sampler: ['13', 0], sigmas: ['14', 0], latent_image: ['10', 0] } }
  prompt['16'] = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['15', 0] } }

  let finalVideo: Link = ['16', 0]
  let finalAudio: Link = ['16', 1]
  if (quality) {
    prompt['30'] = { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: models.latentUpscaler } }
    prompt['31'] = { class_type: 'LTXVLatentUpsampler', inputs: { samples: finalVideo, upscale_model: ['30', 0], vae: ['3', 0] } }
    let refinedVideo: Link = ['31', 0]
    if (preparedImage) {
      prompt['32'] = { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['3', 0], image: preparedImage, latent: refinedVideo, strength: 1, bypass: false } }
      refinedVideo = ['32', 0]
    }
    prompt['33'] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: refinedVideo, audio_latent: finalAudio } }
    prompt['34'] = { class_type: 'RandomNoise', inputs: { noise_seed: 42 } }
    prompt['35'] = { class_type: 'LTXVDualCFGGuider', inputs: { model: modelLink, positive: ['7', 0], negative: ['7', 1], video_cfg: 1, audio_cfg: 1 } }
    prompt['36'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } }
    prompt['37'] = { class_type: 'ManualSigmas', inputs: { sigmas: LTX25_REFINER_SIGMAS } }
    prompt['38'] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['34', 0], guider: ['35', 0], sampler: ['36', 0], sigmas: ['37', 0], latent_image: ['33', 0] } }
    prompt['39'] = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['38', 0] } }
    finalVideo = ['39', 0]
    finalAudio = ['39', 1]
  }

  prompt['40'] = { class_type: 'VAEDecodeTiled', inputs: { samples: finalVideo, vae: ['3', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } }
  prompt['41'] = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: finalAudio, audio_vae: ['4', 0] } }
  prompt['42'] = { class_type: 'CreateVideo', inputs: { images: ['40', 0], audio: ['41', 0], fps: 24, bit_depth: 8, color_space: 'sRGB' } }
  prompt['43'] = { class_type: 'SaveVideo', inputs: { video: ['42', 0], filename_prefix: options.filenamePrefix, format: 'auto', codec: 'auto' } }
  prompt['44'] = { class_type: 'ImageFromBatch', inputs: { image: ['40', 0], batch_index: 0, length: 1 } }
  prompt['45'] = { class_type: 'PreviewImage', inputs: { images: ['44', 0] } }
  return prompt
}
