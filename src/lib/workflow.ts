import type { GenerationOptions, ModelSelection, UploadedFile } from '../types'

type Link = [string, number]
type ComfyNode = { class_type: string; inputs: Record<string, string | number | boolean | Link> }
export type ComfyPrompt = Record<string, ComfyNode>

// The official ComfyUI MiniMax H3 templates use this pair for both the
// full-quality and distilled graphs. Turbo LoRAs are trained for it, so do not
// let a stale/custom UI choice silently change a turbo render.
export const OFFICIAL_H3_SAMPLER = 'res_multistep'
export const OFFICIAL_H3_SCHEDULER = 'simple'

export function frameCount(seconds: number) {
  const base = Math.max(5, Math.round(seconds * 24))
  return base + ((5 - (base % 17) + 17) % 17)
}

export function uploadedName(file: UploadedFile) {
  return file.subfolder ? `${file.subfolder.replace(/\\/g, '/')}/${file.name}` : file.name
}

function addLoader(prompt: ComfyPrompt, id: string, kind: 'image' | 'video' | 'audio', name: string): Link {
  if (kind === 'image') {
    prompt[id] = { class_type: 'LoadImage', inputs: { image: name } }
    return [id, 0]
  }
  if (kind === 'audio') {
    prompt[id] = { class_type: 'LoadAudio', inputs: { audio: name } }
    return [id, 0]
  }
  prompt[id] = { class_type: 'LoadVideo', inputs: { file: name } }
  prompt[`${id}1`] = { class_type: 'GetVideoComponents', inputs: { video: [id, 0] } }
  return [`${id}1`, 0]
}

export function buildMiniMaxWorkflow(
  options: GenerationOptions,
  models: ModelSelection,
  uploads: {
    first?: UploadedFile
    last?: UploadedFile
    images: UploadedFile[]
    videos: UploadedFile[]
    audios: UploadedFile[]
  },
): ComfyPrompt {
  const prompt: ComfyPrompt = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: options.mode === 'reference' ? models.ref2va : models.fl2va, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.textEncoder, type: 'minimax', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.videoVae } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: models.audioVae } },
  }

  let modelLink: Link = ['1', 0]
  const loraName = options.mode === 'reference' ? models.ref2vLora : models.fl2vLora
  if (options.turbo !== 'off' && loraName) {
    prompt['5'] = { class_type: 'LoraLoaderModelOnly', inputs: { model: modelLink, lora_name: loraName, strength_model: options.loraStrength ?? 1 } }
    modelLink = ['5', 0]
  }
  // User-selected adapters are intentionally loaded after the official Turbo
  // adapter. This keeps Turbo automatic and allows up to two additional
  // ComfyUI LoRAs without treating the Turbo file as a manual slot.
  options.userLoras?.filter((lora) => lora.name.trim()).slice(0, 2).forEach((lora, index) => {
    const id = `${90 + index}`
    prompt[id] = { class_type: 'LoraLoaderModelOnly', inputs: { model: modelLink, lora_name: lora.name, strength_model: lora.strength } }
    modelLink = [id, 0]
  })
  // Ref2VA Turbo 8-step v1.0 was trained at 768p with 6 / 3 shifts. This is
  // part of that adapter's recipe, not a user tuning preference, so it wins
  // over a stale custom-shift setting whenever this exact LoRA is selected.
  const ref2vaTurbo8TrainingShifts = options.mode === 'reference' && options.turbo === '8'
    && /^minimax_h3_ref2v_turbo_8step_v1\.0_768p_comfyui_bf16\.safetensors$/i.test(models.ref2vLora)
  const sigmaShift = ref2vaTurbo8TrainingShifts ? { video: 6, audio: 3 } : options.sigmaShift
  if (sigmaShift) {
    prompt['6'] = {
      class_type: 'MiniMaxH3SigmaShift',
      inputs: { model: modelLink, shift_video: sigmaShift.video, shift_audio: sigmaShift.audio },
    }
    modelLink = ['6', 0]
  }
  if (options.previewOverride) {
    prompt['7'] = {
      class_type: options.previewOverride.nodeType ?? 'MiniMaxH3PreviewOverride',
      inputs: {
        model: modelLink,
        max_resolution: 512,
        preview_frames: options.previewOverride.frames,
        preview_fps: options.previewOverride.fps,
        // This is the tiny per-step RGB decoder from models/vae_approx, not the
        // full MiniMax video VAE used by the final decode branch.
        vae_name: options.previewOverride.vaeName ?? models.previewVae,
        jpeg_quality: options.previewOverride.jpegQuality ?? 85,
        suppress_default_preview: true,
      },
    }
    modelLink = ['7', 0]
  }

  const conditioningInputs: Record<string, string | number | boolean | Link> = {
    clip: ['2', 0],
    vae: ['3', 0],
    prompt: options.prompt,
    width: options.width,
    height: options.height,
    length: frameCount(options.duration),
  }

  if (options.mode === 'reference') {
    conditioningInputs.audio_vae = ['4', 0]
    conditioningInputs.ref_image_size = options.refImageSize
    uploads.images.forEach((file, index) => {
      const link = addLoader(prompt, `30${index}`, 'image', uploadedName(file))
      conditioningInputs[`ref_images.ref_image_${index}`] = link
    })
    uploads.videos.forEach((file, index) => {
      const loaderId = `40${index}`
      const link = addLoader(prompt, loaderId, 'video', uploadedName(file))
      conditioningInputs[`ref_videos.ref_video_${index}`] = link
      conditioningInputs[`ref_video_audios.ref_video_audio_${index}`] = [`${loaderId}1`, 1]
    })
    uploads.audios.forEach((file, index) => {
      const link = addLoader(prompt, `50${index}`, 'audio', uploadedName(file))
      conditioningInputs[`ref_audios.ref_audio_${index}`] = link
    })
    prompt['10'] = { class_type: 'MiniMaxH3ReferenceToVideo', inputs: conditioningInputs }
  } else {
    if (uploads.first) conditioningInputs.first_frame = addLoader(prompt, '20', 'image', uploadedName(uploads.first))
    if (uploads.last) conditioningInputs.last_frame = addLoader(prompt, '21', 'image', uploadedName(uploads.last))
    prompt['10'] = { class_type: 'MiniMaxH3ImageToVideo', inputs: conditioningInputs }
  }

  prompt['11'] = { class_type: 'RandomNoise', inputs: { noise_seed: options.seed } }
  prompt['12'] = { class_type: 'BasicGuider', inputs: { model: modelLink, conditioning: ['10', 0] } }
  // Turbo 8 profiles are intentional, tested recipes—not an accidental custom
  // override. Full-quality and Turbo 4 retain the upstream safe pair unless a
  // user explicitly opts into experimental sampling.
  const useRequestedSampling = options.experimentalSampling || options.turbo === '8'
  const sampler = useRequestedSampling ? options.sampler : OFFICIAL_H3_SAMPLER
  const scheduler = useRequestedSampling ? options.scheduler : OFFICIAL_H3_SCHEDULER
  prompt['13'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: sampler } }
  // The 8-step adapter remains useful at 8–10 steps for a little extra
  // coherence. Turbo 4 is a separate trained recipe and stays fixed at four.
  const requestedTurbo8Steps = Math.round(Number(options.steps))
  const scheduledSteps = options.turbo === 'off' ? options.steps : options.turbo === '8' ? requestedTurbo8Steps >= 4 && requestedTurbo8Steps <= 12 ? requestedTurbo8Steps : 8 : 4
  prompt['14'] = {
    class_type: 'BasicScheduler',
    inputs: { model: modelLink, scheduler, steps: scheduledSteps, denoise: 1 },
  }
  prompt['15'] = {
    class_type: 'SamplerCustomAdvanced',
    inputs: { noise: ['11', 0], guider: ['12', 0], sampler: ['13', 0], sigmas: ['14', 0], latent_image: ['10', 1] },
  }
  prompt['16'] = { class_type: 'VAEDecode', inputs: { samples: ['15', 0], vae: ['3', 0] } }
  prompt['17'] = { class_type: 'VAEDecodeAudio', inputs: { samples: ['15', 0], vae: ['4', 0] } }
  prompt['18'] = {
    class_type: 'CreateVideo',
    inputs: { images: ['16', 0], audio: ['17', 0], fps: 24, bit_depth: 8, color_space: 'sRGB' },
  }
  prompt['19'] = {
    class_type: 'SaveVideo',
    inputs: { video: ['18', 0], filename_prefix: options.filenamePrefix, format: 'auto', codec: 'auto' },
  }
  // Always publish one standard ComfyUI preview frame. This works even when the
  // server was launched without latent preview decoding enabled.
  prompt['71'] = { class_type: 'ImageFromBatch', inputs: { image: ['16', 0], batch_index: 0, length: 1 } }
  prompt['72'] = { class_type: 'PreviewImage', inputs: { images: ['71', 0] } }
  if (options.upscale?.type === 'ltx') {
    // MiniMax post-processing intentionally remains non-generative: encode the
    // completed H3 frame sequence into the LTX video latent domain, apply the
    // learned spatial x2 node, decode, then remux the untouched H3 audio.
    // Padding to 8n+1 satisfies the LTX video VAE temporal layout and is removed
    // after decoding so clip duration cannot drift.
    let images: Link = ['16', 0]
    const frames = frameCount(options.duration)
    const pad = (8 - ((frames - 1) % 8)) % 8
    if (pad) {
      prompt['60'] = { class_type: 'ImageFromBatch', inputs: { image: images, batch_index: frames - 1, length: 1 } }
      prompt['61'] = { class_type: 'RepeatImageBatch', inputs: { image: ['60', 0], amount: pad } }
      prompt['62'] = { class_type: 'ImageBatch', inputs: { image1: images, image2: ['61', 0] } }
      images = ['62', 0]
    }
    prompt['63'] = { class_type: 'VAELoader', inputs: { vae_name: options.upscale.vae } }
    prompt['64'] = { class_type: 'VAEEncodeTiled', inputs: { pixels: images, vae: ['63', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } }
    prompt['65'] = { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: options.upscale.model } }
    prompt['66'] = { class_type: 'LTXVLatentUpsampler', inputs: { samples: ['64', 0], upscale_model: ['65', 0], vae: ['63', 0] } }
    prompt['67'] = { class_type: 'VAEDecodeTiled', inputs: { samples: ['66', 0], vae: ['63', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } }
    prompt['68'] = { class_type: 'ImageFromBatch', inputs: { image: ['67', 0], batch_index: 0, length: frames } }
    prompt['69'] = { class_type: 'CreateVideo', inputs: { images: ['68', 0], audio: ['17', 0], fps: 24, bit_depth: 8, color_space: 'sRGB' } }
    prompt['70'] = { class_type: 'SaveVideo', inputs: { video: ['69', 0], filename_prefix: `${options.filenamePrefix}_LTX25_2x`, format: 'auto', codec: 'auto' } }
  } else if (options.upscale?.type === 'rtx') {
    // Frame-based AI upscaling runs through ComfyUI's CUDA/PyTorch device. It is
    // independent of LTX and is normalized to an exact 2x output even when the
    // selected ESRGAN model's native scale is larger.
    prompt['80'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: options.upscale.model } }
    prompt['81'] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['80', 0], image: ['16', 0] } }
    prompt['82'] = { class_type: 'ImageScale', inputs: { image: ['81', 0], upscale_method: 'lanczos', width: options.width * 2, height: options.height * 2, crop: 'disabled' } }
    prompt['83'] = { class_type: 'CreateVideo', inputs: { images: ['82', 0], audio: ['17', 0], fps: 24, bit_depth: 8, color_space: 'sRGB' } }
    prompt['84'] = { class_type: 'SaveVideo', inputs: { video: ['83', 0], filename_prefix: `${options.filenamePrefix}_RTX_AI_2x`, format: 'auto', codec: 'auto' } }
  }
  return prompt
}

export function buildMiniMaxReferenceStillWorkflow(options: GenerationOptions, models: ModelSelection, uploads: { images: UploadedFile[]; videos: UploadedFile[]; audios: UploadedFile[] }): ComfyPrompt {
  // Ref2VA requires a video-shaped latent, so keep its minimum valid frame
  // batch in memory, select one decoded frame, and save only that image.
  const prompt = buildMiniMaxWorkflow(options, models, uploads)
  delete prompt['17']; delete prompt['18']; delete prompt['19']; delete prompt['72']
  prompt['73'] = { class_type: 'SaveImage', inputs: { images: ['71', 0], filename_prefix: options.filenamePrefix } }
  return prompt
}

export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string }

export function extractOutputFile(history: Record<string, unknown>, promptId: string, mediaType: 'video' | 'audio' | 'image' = 'video'): ComfyOutputFile | undefined {
  const entry = history[promptId] as { outputs?: Record<string, Record<string, unknown>> } | undefined
  if (!entry?.outputs) return undefined
  const candidates: ComfyOutputFile[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (typeof object.filename === 'string') {
      candidates.push({
        filename: object.filename,
        subfolder: typeof object.subfolder === 'string' ? object.subfolder : undefined,
        type: typeof object.type === 'string' ? object.type : undefined,
      })
    }
    Object.values(object).forEach(visit)
  }
  if (mediaType === 'image' && entry.outputs['73']) visit(entry.outputs['73'])
  else if (entry.outputs['84']) visit(entry.outputs['84'])
  else if (entry.outputs['70']) visit(entry.outputs['70'])
  else visit(entry.outputs)
  const expected = mediaType === 'audio' ? /\.(flac|wav|mp3|ogg|m4a|aac|opus)$/i : mediaType === 'image' ? /\.(png|jpe?g|webp)$/i : /\.(mp4|webm|mov|mkv|gif)$/i
  return candidates.find((candidate) => expected.test(candidate.filename)) ?? candidates[0]
}

export function extractOutputUrl(history: Record<string, unknown>, promptId: string, comfyUrl: string, mediaType: 'video' | 'audio' | 'image' = 'video') {
  const file = extractOutputFile(history, promptId, mediaType)
  if (file) {
    const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' })
    const upstream = `${comfyUrl.replace(/\/+$/, '')}/view?${query.toString()}`
    return `minimax-media://comfy?url=${encodeURIComponent(upstream)}`
  }
  return undefined
}
