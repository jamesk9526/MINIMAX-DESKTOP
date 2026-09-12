import type { AppSettings, DesktopApi, ModelFile } from './types'

const modelRoot = 'C:\\Users\\James\\Documents\\ComfyUI\\models'
const settings: AppSettings = {
  llmProvider: 'ollama',
  comfyUrl: 'http://127.0.0.1:8188',
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3:latest',
  lmStudioUrl: 'http://127.0.0.1:1234',
  lmStudioModel: '',
  modelRoot,
  paths: {
    diffusion_models: `${modelRoot}\\diffusion_models`,
    text_encoders: `${modelRoot}\\text_encoders`,
    vae: `${modelRoot}\\vae`,
    loras: `${modelRoot}\\loras`,
    vae_approx: `${modelRoot}\\vae_approx`,
    clip_vision: `${modelRoot}\\clip_vision`,
  },
  outputDirectory: 'C:\\Users\\James\\Documents\\ComfyUI\\output',
  ffmpegPath: 'C:\\FFMPEG\\bin\\ffmpeg.exe',
  uiScale: 100,
  attentionBackend: 'automatic',
  h3ParallelAttentionEnabled: false,
  experimentalLtxMsrEnabled: false,
  blurNsfwLivePreviews: false,
  queueDelaySeconds: 0,
  characterDetailReferencesEnabled: false,
  renderSettingsPresets: [],
  generationDefaults: {
    resolution: '1344x768', duration: 5, turbo: 'off', steps: 30,
    sampler: 'res_multistep', scheduler: 'simple', experimentalSampling: false,
    refImageSize: 'match', livePreview: true, sigmaShiftMode: 'model', shiftVideo: 12, shiftAudio: 3, loraStrength: 1, upscaleMode: 'off', textEncoderPreference: 'fast', turbo8Profile: 'balanced',
  },
}

const examples: Array<[ModelFile['kind'], string, number]> = [
  ['diffusion_models', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', 20_970_379_616],
  ['diffusion_models', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', 20_970_379_616],
  ['text_encoders', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 15_687_142_551],
  ['text_encoders', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 27_100_000_000],
  ['vae', 'minimax_h3_video_vae_fp16.safetensors', 5_207_808_496],
  ['vae', 'minimax_h3_audio_vae_fp32.safetensors', 605_254_808],
  ['vae_approx', 'taeh3_decoder.safetensors', 39_458_084],
  ['loras', 'minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors', 1_956_192_992],
  ['loras', 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', 1_956_193_000],
  ['loras', 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors', 1_956_193_000],
  ['loras', 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors', 1_956_193_000],
  ['diffusion_models', 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors', 22_000_000_000],
  ['text_encoders', 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors', 12_000_000_000],
  ['vae', 'ltx-2.5-video-vae-bf16.safetensors', 2_000_000_000],
  ['vae', 'ltx-2.5-audio-vae-bf16.safetensors', 800_000_000],
  ['diffusion_models', 'z_image_turbo_bf16.safetensors', 12_000_000_000],
  ['diffusion_models', 'z_image_bf16.safetensors', 12_000_000_000],
  ['text_encoders', 'qwen_3_4b.safetensors', 8_000_000_000],
  ['vae', 'ae.safetensors', 350_000_000],
  ['diffusion_models', 'acestep_v1.5_xl_sft_bf16.safetensors', 8_000_000_000],
  ['diffusion_models', 'acestep_v1.5_xl_base_bf16.safetensors', 8_000_000_000],
  ['text_encoders', 'qwen_0.6b_ace15.safetensors', 1_200_000_000],
  ['text_encoders', 'qwen_4b_ace15.safetensors', 8_000_000_000],
  ['vae', 'ace_1.5_vae.safetensors', 500_000_000],
]

const ltxNodes = ['LTXVConditioning', 'LTXVEmptyLatentAudio', 'EmptyLTXVLatentVideo', 'LTXVDualCFGGuider', 'LTXVSeparateAVLatent', 'LTXVConcatAVLatent', 'LTXVLatentUpsampler', 'LTXVAudioVAEDecode', 'ManualSigmas', 'VAEEncodeTiled', 'VAEDecodeTiled', 'CLIPTextEncode', 'KSamplerSelect', 'SamplerCustomAdvanced', 'ImageFromBatch', 'RepeatImageBatch', 'ImageBatch']
const aceNodes = ['DualCLIPLoader', 'TextEncodeAceStepAudio1.5', 'EmptyAceStep1.5LatentAudio', 'ConditioningZeroOut', 'ModelSamplingAuraFlow', 'KSampler', 'VAEDecodeAudio', 'SaveAudioAdvanced']

export function installBrowserMock() {
  if (window.minimax) return
  let current = structuredClone(settings)
  const api: DesktopApi = {
    getObjectInfo: async () => Object.fromEntries([
      ...ltxNodes.map((name) => [name, { input: { required: {} } }]),
      ['LTX2SamplingPreviewOverride', { input: { required: {} } }],
      ...aceNodes.map((name) => [name, { input: { required: {} } }]),
      ['LatentUpscaleModelLoader', { input: { required: { model_name: ['COMBO', { options: ['ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'] }] } } }],
      ['UNETLoader', { input: { required: { unet_name: ['COMBO', { options: ['z_image_turbo_bf16.safetensors', 'z_image_bf16.safetensors', 'acestep_v1.5_xl_sft_bf16.safetensors', 'acestep_v1.5_xl_base_bf16.safetensors'] }] } } }],
      ['CLIPLoader', { input: { required: { clip_name: ['COMBO', { options: ['qwen_3_4b.safetensors'] }] } } }],
      ['VAELoader', { input: { required: { vae_name: ['COMBO', { options: ['ltx-2.5-video-vae-bf16.safetensors', 'ae.safetensors', 'ace_1.5_vae.safetensors'] }] } } }],
      ['UpscaleModelLoader', { input: { required: { model_name: ['COMBO', { options: ['4x-UltraSharp.pth'] }] } } }],
    ]),
    uploadImageData: async () => { throw new Error('Open the desktop app to upload images.') },
    getOutputImage: async () => { throw new Error('Open the desktop app to retrieve images.') },
    saveComfyOutputImage: async () => { throw new Error('Open the desktop app to save generated images.') },
    saveStillImage: async () => { throw new Error('Open the desktop app to save generated stills.') },
    getSettings: async () => current,
    getLegacyMigrationStatus: async () => ({ available: false, migrated: false, needsBrowserStorageRepair: false }),
    migrateLegacyData: async () => ({ available: false, migrated: false, needsBrowserStorageRepair: false }),
    getGpuTelemetry: async () => ({ available: true, name: 'Preview GPU', usagePercent: 38, vramPercent: 62, vramUsedMb: 14880, vramTotalMb: 24000 }),
    saveSettings: async (next) => (current = next),
    exportWorkflowJson: async (suggestedName) => `C:\\Users\\James\\Documents\\${suggestedName}`,
    setUiScale: async (scale) => Math.round(Math.max(.75, Math.min(1.5, scale)) * 100),
    chooseDirectory: async () => null,
    chooseMedia: async () => null,
    scanModels: async () => examples.map(([kind, name, bytes]) => ({ kind, name, bytes, path: `${current.paths[kind]}\\${name}` })),
    getComfyStatus: async () => ({ connected: false, latencyMs: 2, error: 'Preview mode' }),
    submitPrompt: async () => { throw new Error('Desktop bridge is unavailable in browser preview.') },
    getQueue: async () => ({}),
    getHistory: async () => ({}),
    cancelPrompt: async () => ({ cancelled: true, state: 'running' }),
    uploadInput: async () => { throw new Error('Desktop bridge is unavailable in browser preview.') },
    fileDataUrl: async () => '',
    mediaUrl: async (path) => path,
    extractVideoFrame: async () => { throw new Error('Open the desktop app to extract video frames.') },
    extractVideoFrames: async () => { throw new Error('Open the desktop app to extract video frames.') },
    trimVideo: async () => { throw new Error('Open the desktop app to trim reference videos.') },
    joinVideos: async () => { throw new Error('Open the desktop app to join videos.') },
    getRifeStatus: async () => ({ installed: false }),
    installRife: async () => ({ installed: false, error: 'Open the desktop app to install RIFE.' }),
    interpolateVideo: async () => { throw new Error('Open the desktop app to interpolate video with RIFE.') },
    showOutput: async () => undefined,
    findLatestOutput: async () => null,
    resolveOutput: async () => null,
    listOllamaModels: async (_url, provider = 'ollama') => provider === 'lmstudio'
      ? [{ name: 'local-vision-model', size: 0, family: 'lmstudio', parameterSize: '', local: true }]
      : [
        { name: 'qwen3:latest', size: 5_225_388_164, family: 'qwen3', parameterSize: '8.2B', local: true },
        { name: 'llama3.1:8b', size: 4_920_753_328, family: 'llama', parameterSize: '8.0B', local: true },
      ],
    generateWithOllama: async () => 'A cinematic wide shot with deliberate subject motion, controlled camera movement, natural lighting, and synchronized environmental audio.',
    generateWithOllamaVision: async () => 'A MiniMax-ready prompt grounded in the visible identity, composition, lighting, and continuity details of the supplied reference images.',
    generateStructuredWithOllama: async (_url, _model, prompt, schema) => {
      const properties = schema.properties as Record<string, unknown> | undefined
      if (properties?.operation) {
        const request = prompt.match(/REQUEST:\n([\s\S]*?)(?:\n\n(?:RECENT CONVERSATION|Return exactly)|$)/)?.[1] ?? prompt
        const asksQuestion = /\?\s*$/.test(request) || /^(?:what|why|how|can you explain|should we|review|analyze)\b/i.test(request)
        const asksForImage = /\b(?:still image|image prompt|z-image|text-to-image)\b/i.test(request)
        const directEdit = /\b(?:write|create|make|generate|draft|rewrite|enhance|revise|improve|build|add|change|replace|remove|have|show|set|turn|keep)\b/i.test(request)
        const imagePrompt = /For a direct request to create or edit an active still image/i.test(prompt) && asksForImage && directEdit && !asksQuestion
        const videoPrompt = !imagePrompt && /For a direct request to create or edit this active video/i.test(prompt) && directEdit && !asksQuestion
        const intent = imagePrompt ? 'image' : videoPrompt ? 'video' : 'text'
        const operation = intent === 'image' ? 'replace' : intent === 'video' ? /\b(?:rewrite|replace|change|remove|revise|improve|enhance|polish|refine)\b|\bmake\b.*\bbetter\b/i.test(request) ? 'replace' : 'append' : 'none'
        const duration = prompt.match(/full (\d+(?:\.\d+)?) second/)?.[1] ?? '5.0'
        const reply = imagePrompt
          ? `A still image prompt following the request: ${request}`
          : videoPrompt && operation === 'replace'
            ? `0.0–2.0s: Establish the requested starting state with a steady camera.\n2.0–${duration}s: Complete the requested action with natural movement and settle on the final pose.`
            : videoPrompt
              ? `Addendum: ${request}`
              : 'I can help with the current workspace. Tell me the change you want and I will follow it.'
        return { reply, operation, intent }
      }
      if (properties?.direction) {
        const draft = prompt.match(/DRAFT:\n([\s\S]*?)(?:\n\nReturn the required structured fields|$)/)?.[1]?.trim()
        return {
          summary: 'A clear, continuous shot that preserves the authored scene and its constraints.',
          direction: draft ? `Clarify the authored scene in concrete, observable terms while preserving every requested detail. ${draft}` : 'A single, continuous cinematic shot with physically coherent subject movement and synchronized natural sound.',
        }
      }
      if (properties?.reply) {
        const filmmakerRequest = prompt.match(/FILMMAKER: ([\s\S]*)$/)?.[1] ?? prompt
        const buildAssets = /Create the recurring characters/i.test(filmmakerRequest)
        const buildStory = /Build a complete story treatment/i.test(filmmakerRequest)
        const buildShots = /Turn the story into connected scenes/i.test(filmmakerRequest)
        const removeFirstCharacter = /(?:remove|delete) (?:the )?(?:first )?character/i.test(filmmakerRequest)
        const contextMatch = prompt.match(/PROJECT CONTEXT: (.+)\n\nFILMMAKER:/)
        const currentContext = contextMatch ? JSON.parse(contextMatch[1]) as { project: Record<string, unknown>; characters?: Array<{ id: string; name?: string }> } : { project: {} }
        const currentProject = currentContext.project
        const removedCharacter = removeFirstCharacter ? currentContext.characters?.[0] : undefined
        return {
          reply: removedCharacter ? `## Character removal prepared\nReview the removal of **${removedCharacter.name ?? 'the selected character'}** before applying it.` : buildAssets ? '## Production bible created\n- Added **Mara Vale** as the continuity anchor.\n- Added `North Relay Station` as the recurring set.\n\nReview the new cards before adding reference images.' : buildStory ? '## Story treatment created\nA courier crosses a flooded city before sunrise, carrying the final radio capable of reconnecting the evacuation fleet.' : buildShots ? '## Shot plan created\n- Added an opening scene and a production-ready MiniMax establishing shot.\n- Later connected scenes can inherit its final frame.' : '## Continuity approach\n- Carry the prior scene’s **last frame** into the connected shot.\n- Preserve wardrobe, screen direction, lighting, and motion momentum.',
          changes: removedCharacter ? [`Removed character ${removedCharacter.name ?? removedCharacter.id}.`] : buildAssets ? ['Created character Mara Vale.', 'Created location North Relay Station.'] : buildStory ? ['Created a complete story treatment.'] : buildShots ? ['Created the opening scene.', 'Created its establishing shot.'] : [], focusAreas: buildAssets || removedCharacter ? ['bible'] : buildStory ? ['setup'] : ['shots'],
          projectPatch: {
            title: currentProject.title ?? 'Untitled movie', targetRuntime: currentProject.targetRuntime ?? 60,
            computeBudgetMinutes: currentProject.computeBudgetMinutes ?? 120, aspectRatio: currentProject.aspectRatio ?? '16:9',
            genre: currentProject.genre ?? '', visualStyle: currentProject.visualStyle ?? '', quality: currentProject.quality ?? 'balanced',
            reviewGate: currentProject.reviewGate ?? 'scene', story: buildStory ? 'A courier crosses a flooded city before sunrise, carrying the final radio capable of reconnecting the evacuation fleet. Pursued across collapsing rooftops, she reaches the harbor tower and transmits just as dawn breaks.' : currentProject.story ?? '', visualRules: currentProject.visualRules ?? '',
          },
          characterUpserts: buildAssets ? [{ id: 'new-mara', name: 'Mara Vale', description: 'A weathered pilot in her late thirties with cropped black hair and a narrow scar above her left eyebrow.', wardrobe: 'Faded charcoal flight jacket, rust-red scarf, utility belt, brass compass.', voiceNotes: 'Low warm alto with a measured pace.' }] : [], characterDeletes: removedCharacter ? [removedCharacter.id] : [],
          locationUpserts: buildAssets ? [{ id: 'new-relay', name: 'North Relay Station', description: 'An isolated concrete relay station with oxidized antenna ribs, amber work lights, and a cracked blue orientation stripe.' }] : [], locationDeletes: [],
          sceneUpserts: buildShots ? [{ id: 'new-opening', title: 'Flooded crossing', summary: 'The courier enters the drowned city and commits to the dangerous route.', locationId: '', transition: 'cut' }] : [], sceneDeletes: [],
          shotUpserts: buildShots ? [{ id: 'new-establishing', sceneId: 'new-opening', title: 'City at first light', prompt: 'Wide cinematic view of a lone courier crossing a flooded avenue before sunrise, skiffs drifting between dark towers, slow crane movement forward, cold blue ambient light with distant amber windows, wind and water synchronized.', dialogue: '', duration: 6, mode: currentContext.characters?.[0] ? 'reference' : 'text', characterIds: currentContext.characters?.[0] ? [currentContext.characters[0].id] : [] }] : [], shotDeletes: [],
        }
      }
      if (properties?.wardrobe) return { name: 'Mara Vale', description: 'A weathered pilot in her late thirties with cropped black hair, a narrow scar above her left eyebrow, and a steady watchful posture.', wardrobe: 'Faded charcoal flight jacket, rust-red scarf, utility belt, brass compass.', voiceNotes: 'Low warm alto, measured pace, dry delivery that tightens under pressure.' }
      if (properties?.description && !properties?.scenes) return { name: 'North Relay Station', description: 'An isolated concrete relay station on a wind-cut plateau, with a circular control room, oxidized antenna ribs, amber work lights, and a cracked blue orientation stripe running through every corridor.' }
      return { scenes: [{ title: 'Opening', summary: 'The story begins.', location: 'Primary location', shots: [{ title: 'Establishing shot', duration: 5, prompt: 'A cinematic establishing shot introduces the location with controlled camera movement and natural synchronized ambience.', dialogue: '', mode: 'text', characters: [] }] }] }
    },
    getLanStatus: async () => ({ running: true, url: `${location.origin}/?mobile=1&token=browser-preview`, desktopUrl: `${location.origin}/?desktop=1&token=browser-preview`, port: Number(location.port) }),
    syncMobileCharacters: async (characters) => ({ synced: characters.length }),
    rotateLanToken: async () => ({ running: true, url: `${location.origin}/?mobile=1&token=browser-preview`, desktopUrl: `${location.origin}/?desktop=1&token=browser-preview`, port: Number(location.port) }),
    setWindowAlwaysOnTop: async (enabled) => enabled,
  }
  window.minimax = api
}
