const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
function load(path) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, require, URLSearchParams })
  return exports
}
const { frameCount, buildMiniMaxWorkflow, extractOutputUrl, OFFICIAL_H3_SAMPLER, OFFICIAL_H3_SCHEDULER } = load('src/lib/workflow.ts')
const { buildZImage } = load('src/lib/zimage.ts')
const { buildLtx25Workflow, ltx25FrameCount, LTX25_FIRST_STAGE_SIGMAS, LTX25_REFINER_SIGMAS } = load('src/lib/ltx25Workflow.ts')
const { inferSelections, inferLtx25Selections } = load('src/lib/modelSelection.ts')
const { cropRect, fitWholeCharacter } = load('src/lib/imageCrop.ts')
const { promptPresets, searchPromptPresets } = load('src/lib/promptPresets.ts')
assert.equal(fitWholeCharacter({ path: 'character.png', name: 'Character', kind: 'image' }).crop.fit, 'contain')
assert.equal(fitWholeCharacter({ path: 'character.png', name: 'Character', kind: 'image', crop: { x: .5, y: .5, zoom: 1, fit: 'crop' } }).crop.fit, 'crop')
assert.ok(promptPresets.length >= 190)
assert.ok(searchPromptPresets('dolly zoom').some((item) => item.id === 'camera.vertigo'))
for (let seconds = 2; seconds <= 15; seconds += 0.5) {
  const frames = frameCount(seconds)
  assert.equal((frames - 5) % 17, 0)
  assert.ok(frames >= Math.round(seconds * 24))
  assert.ok(frames < Math.round(seconds * 24) + 17)
}
for (const [width, height] of [[608, 352], [352, 608], [768, 768]]) {
  for (const x of [0, 0.5, 1]) for (const y of [0, 0.5, 1]) for (const zoom of [1, 2, 4]) {
    const r = cropRect(1000, 500, width, height, { x, y, zoom, fit: 'crop' })
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000.0001 && r.y + r.h <= 500.0001)
    assert.ok(Math.abs(r.w / r.h - width / height) < 0.0001)
  }
}
const models = { fl2va: 'fl2va', ref2va: 'ref2va', textEncoder: 'clip', videoVae: 'video', audioVae: 'audio', fl2vLora: 'fl-lora', ref2vLora: 'ref-lora' }
for (const mode of ['text', 'image', 'frames', 'reference']) for (const duration of [2, 3, 5, 15]) {
  const g = buildMiniMaxWorkflow({ mode, width: 352, height: 608, prompt: 'neutral test', duration, seed: 123, steps: 20, turbo: '8', sampler: 'res_multistep', scheduler: 'simple', filenamePrefix: 'test', refImageSize: 'match', upscale: { type: 'ltx', model: 'ltx-upscale', vae: 'ltx-vae' } }, models, { first: { name: 'first.png' }, last: { name: 'last.png' }, images: [{ name: 'ref.png' }], videos: [], audios: [] })
  assert.equal(g['13'].inputs.sampler_name, OFFICIAL_H3_SAMPLER)
  assert.equal(g['14'].inputs.scheduler, OFFICIAL_H3_SCHEDULER)
  assert.equal(g['14'].inputs.steps, 8)
  assert.equal(g['2'].inputs.type, 'minimax')
  assert.equal(g['18'].inputs.fps, 24)
  assert.equal(g['18'].inputs.bit_depth, 8)
  assert.equal(g['10'].inputs.width, 352)
  assert.equal(g['68'].inputs.length, frameCount(duration))
  const padded = frameCount(duration) + (g['61']?.inputs.amount ?? 0)
  assert.equal((padded - 1) % 8, 0)
  assert.equal(g['63'].class_type, 'VAELoader')
  assert.equal(g['63'].inputs.vae_name, 'ltx-vae')
  assert.equal(g['64'].class_type, 'VAEEncodeTiled')
  assert.equal(g['64'].inputs.pixels[0], g['62'] ? '62' : '16')
  assert.equal(g['65'].class_type, 'LatentUpscaleModelLoader')
  assert.equal(g['65'].inputs.model_name, 'ltx-upscale')
  assert.equal(g['66'].class_type, 'LTXVLatentUpsampler')
  assert.equal(g['66'].inputs.samples[0], '64')
  assert.equal(g['66'].inputs.upscale_model[0], '65')
  assert.equal(g['66'].inputs.vae[0], '63')
  assert.equal(g['67'].class_type, 'VAEDecodeTiled')
  assert.equal(g['67'].inputs.samples[0], '66')
  assert.equal(g['68'].inputs.image[0], '67')
  assert.equal(g['69'].inputs.audio[0], '17')
  assert.equal(g['69'].inputs.fps, 24)
  assert.ok(g['70'].inputs.filename_prefix.endsWith('_LTX25_2x'))
  assert.ok(g['19'] && g['70'])
  assert.equal(g['71'].class_type, 'ImageFromBatch')
  assert.equal(g['72'].class_type, 'PreviewImage')
  for (const node of Object.values(g)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(g[value[0]], `Missing linked node ${value[0]}`)
}
const fullQuality = buildMiniMaxWorkflow({ mode: 'text', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 20, turbo: 'off', sampler: 'heun', scheduler: 'karras', filenamePrefix: 'test', refImageSize: 'match' }, models, { images: [], videos: [], audios: [] })
assert.equal(fullQuality['13'].inputs.sampler_name, OFFICIAL_H3_SAMPLER)
assert.equal(fullQuality['14'].inputs.scheduler, OFFICIAL_H3_SCHEDULER)
assert.equal(fullQuality['14'].inputs.steps, 20)

const previewGraph = buildMiniMaxWorkflow({ mode: 'reference', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 20, turbo: 'off', sampler: 'res_multistep', scheduler: 'simple', filenamePrefix: 'test', refImageSize: 'match', previewOverride: { frames: 50, fps: 12, nodeType: 'MiniMaxH3PreviewOverride', vaeName: 'taeh3_decoder.safetensors', jpegQuality: 85 } }, models, { images: [{ name: 'ref.png' }], videos: [], audios: [] })
assert.equal(previewGraph['7'].class_type, 'MiniMaxH3PreviewOverride')
assert.equal(previewGraph['7'].inputs.vae_name, 'taeh3_decoder.safetensors')
assert.equal(previewGraph['7'].inputs.jpeg_quality, 85)
assert.equal(previewGraph['12'].inputs.model[0], '7')

const compatibilityTurbo = buildMiniMaxWorkflow({ mode: 'text', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 20, turbo: '8', experimentalSampling: true, loraStrength: 0.9, sampler: 'euler', scheduler: 'beta', sigmaShift: { video: 12, audio: 4 }, filenamePrefix: 'test', refImageSize: 'match' }, models, { images: [], videos: [], audios: [] })
assert.equal(compatibilityTurbo['5'].inputs.strength_model, 0.9)
assert.equal(compatibilityTurbo['6'].class_type, 'MiniMaxH3SigmaShift')
assert.equal(compatibilityTurbo['6'].inputs.shift_video, 12)
assert.equal(compatibilityTurbo['6'].inputs.shift_audio, 4)
assert.equal(compatibilityTurbo['12'].inputs.model[0], '6')
assert.equal(compatibilityTurbo['14'].inputs.model[0], '6')
assert.equal(compatibilityTurbo['13'].inputs.sampler_name, 'euler')
assert.equal(compatibilityTurbo['14'].inputs.scheduler, 'beta')
assert.equal(compatibilityTurbo['14'].inputs.steps, 8)

const turboStable = buildMiniMaxWorkflow({ mode: 'text', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 20, turbo: '8', sampler: 'euler', scheduler: 'simple', filenamePrefix: 'test', refImageSize: 'match' }, models, { images: [], videos: [], audios: [] })
assert.equal(turboStable['13'].inputs.sampler_name, 'euler')
assert.equal(turboStable['14'].inputs.scheduler, 'simple')
const turboMotion = buildMiniMaxWorkflow({ mode: 'text', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 20, turbo: '8', sampler: 'res_multistep', scheduler: 'beta', filenamePrefix: 'test', refImageSize: 'match' }, models, { images: [], videos: [], audios: [] })
assert.equal(turboMotion['13'].inputs.sampler_name, 'res_multistep')
assert.equal(turboMotion['14'].inputs.scheduler, 'beta')

const officialModels = inferSelections([
  { kind: 'diffusion_models', name: 'minimax_h3_fl2va_other.safetensors' },
  { kind: 'diffusion_models', name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' },
  { kind: 'diffusion_models', name: 'minimax_h3_fl2va_unsupported.gguf' },
  { kind: 'diffusion_models', name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors' },
  { kind: 'text_encoders', name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors' },
  { kind: 'text_encoders', name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors' },
  { kind: 'vae', name: 'minimax_h3_video_vae_fp16.safetensors' },
  { kind: 'vae', name: 'minimax_h3_audio_vae_fp32.safetensors' },
  { kind: 'loras', name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors' },
  { kind: 'loras', name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors' },
  { kind: 'loras', name: 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors' },
], '8')
assert.equal(officialModels.fl2va, 'minimax_h3_fl2va_pruned_int8_convrot.safetensors')
assert.equal(officialModels.textEncoder, 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors')
assert.equal(inferSelections([
  { kind: 'text_encoders', name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors' },
  { kind: 'text_encoders', name: 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors' },
], 'off', 'quality').textEncoder, 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors')
assert.equal(inferSelections([{ kind: 'text_encoders', name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors' }], 'off', 'quality').textEncoder, '')
assert.equal(officialModels.ref2vLora, 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors')
const refFour = inferSelections([{ kind: 'loras', name: 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors' }], '4')
assert.equal(refFour.ref2vLora, 'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors')
const refEightGraph = buildMiniMaxWorkflow({ mode: 'reference', width: 1344, height: 768, prompt: 'test', duration: 5, seed: 1, steps: 30, turbo: '8', sampler: 'res_multistep', scheduler: 'simple', filenamePrefix: 'test', refImageSize: 'match' }, officialModels, { images: [{ name: 'ref.png' }], videos: [], audios: [] })
assert.equal(refEightGraph['1'].inputs.unet_name, 'minimax_h3_ref2va_pruned_int8_convrot.safetensors')
assert.equal(refEightGraph['5'].inputs.lora_name, 'minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors')
assert.equal(refEightGraph['5'].inputs.strength_model, 1)
assert.equal(refEightGraph['6'].class_type, 'MiniMaxH3SigmaShift')
assert.equal(refEightGraph['6'].inputs.shift_video, 6)
assert.equal(refEightGraph['6'].inputs.shift_audio, 3)
assert.equal(refEightGraph['10'].class_type, 'MiniMaxH3ReferenceToVideo')
assert.equal(refEightGraph['14'].inputs.steps, 8)

const ltxModels = { diffusion: 'ltx-distilled.safetensors', textEncoder: 'gemma4.safetensors', videoVae: 'video-vae.safetensors', audioVae: 'audio-vae.safetensors', latentUpscaler: 'latent-x2.safetensors' }
for (const mode of ['text', 'image']) for (const preset of ['quality', 'turbo']) {
  const graph = buildLtx25Workflow({ mode, preset, prompt: 'test', width: 1280, height: 736, duration: 5, seed: 42, filenamePrefix: 'ltx-test' }, ltxModels, mode === 'image' ? { name: 'first.png' } : undefined)
  assert.equal(graph['2'].inputs.type, 'ltxv')
  assert.equal(graph['8'].inputs.length, ltx25FrameCount(5))
  assert.equal(graph['12'].inputs.video_cfg, 1)
  assert.equal(graph['13'].inputs.sampler_name, 'euler_ancestral')
  assert.equal(graph['14'].inputs.sigmas, LTX25_FIRST_STAGE_SIGMAS)
  assert.equal(graph['42'].inputs.fps, 24)
  assert.equal(graph['45'].class_type, 'PreviewImage')
  assert.equal(Boolean(graph['21']), mode === 'image')
  if (mode === 'image') {
    assert.equal(graph['21'].class_type, 'ResizeImageMaskNode')
    assert.equal(graph['21'].inputs.resize_type, 'scale longer dimension')
    assert.equal(graph['21'].inputs['resize_type.longer_size'], 1536)
    assert.equal(graph['21'].inputs.scale_method, 'lanczos')
    assert.equal('resolution' in graph['21'].inputs, false)
  }
  assert.equal(Boolean(graph['31']), preset === 'quality')
  if (preset === 'quality') {
    assert.equal(graph['8'].inputs.width, 640)
    assert.equal(graph['37'].inputs.sigmas, LTX25_REFINER_SIGMAS)
  } else assert.equal(graph['8'].inputs.width, 1280)
  for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(graph[value[0]], `Missing LTX linked node ${value[0]}`)
}
const selectedLtx = inferLtx25Selections([
  { kind: 'diffusion_models', name: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors' },
  { kind: 'text_encoders', name: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors' },
  { kind: 'vae', name: 'ltx-2.5-video-vae-bf16.safetensors' },
  { kind: 'vae', name: 'ltx-2.5-audio-vae-bf16.safetensors' },
], ['ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'])
assert.ok(Object.values(selectedLtx).every(Boolean))

const zimage = buildZImage('test', 1024, 1024, 7, 'z.safetensors', 'qwen.safetensors', 'ae.safetensors')
assert.equal(zimage['2'].inputs.type, 'lumina2')
assert.equal(zimage['7'].class_type, 'ModelSamplingAuraFlow')
assert.equal(zimage['7'].inputs.shift, 3)
assert.equal(zimage['8'].inputs.steps, 8)
assert.equal(zimage['8'].inputs.cfg, 1)
assert.equal(zimage['8'].inputs.sampler_name, 'res_multistep')
assert.equal(zimage['8'].inputs.scheduler, 'simple')
const rtx = buildMiniMaxWorkflow({ mode: 'text', width: 608, height: 352, prompt: 'test', duration: 2, seed: 1, steps: 20, turbo: '4', sampler: 'res_multistep', scheduler: 'simple', filenamePrefix: 'test', refImageSize: 'match', upscale: { type: 'rtx', model: 'RealESRGAN_x2.pth' } }, models, { images: [], videos: [], audios: [] })
{
  assert.equal(rtx['80'].class_type, 'UpscaleModelLoader')
  assert.equal(rtx['82'].inputs.width, 1216)
  assert.equal(rtx['82'].inputs.height, 704)
  assert.equal(rtx['83'].inputs.audio[0], '17')
  assert.ok(rtx['19'] && rtx['84'])
}
const url = extractOutputUrl({ job: { outputs: { 19: { images: [{ filename: 'original.mp4' }] }, 70: { images: [{ filename: 'upscaled.mp4' }] } } } }, 'job', 'http://localhost:8188')
assert.ok(decodeURIComponent(url).includes('upscaled.mp4'))
console.log('PASS: official H3, LTX-2.5 and Z-Image workflows, model preference, duration/crop, previews, post-processing, and output selection')
