# MiniMax Studio

A local-first Windows desktop interface for MiniMax H3 generation through ComfyUI. Models are indexed and used from their existing locations; the application does not download, copy, or reorganize model files.

## Current capabilities

- Text-to-video, image-to-video, and first/last-frame generation through the FL2VA model
- A separate LTX‑2.5 T2V/I2V workspace with native synchronized audio, live ComfyUI previews, an official two-stage quality preset, and a distilled single-stage Turbo preset
- A dedicated ACE‑Step 1.5 music workspace through ComfyUI, with XL SFT and XL Base checkpoint selection, lyric/instrumental modes, tempo/key/language controls, FLAC output, progress, cancellation, and in-app playback
- A global Character Studio: Z-Image master references, MiniMax I2V turntable handoff, five-angle frame extraction, single-image or reference-set selection, and one-click Movie Creator imports
- Mixed image, video, and audio references through the Ref2VA model
- A complete H3 stack report that separately verifies FL2VA, Ref2VA, and the detected FL2V/Ref2V Turbo LoRAs
- Automatic local vision-model descriptions for existing character, hair, wardrobe, accessory, and location reference images; authored fields are preserved
- Non-destructive Ref2V video clipping: preview a longer source, set precise in/out points, and create or revise a focused 2–15 second reference MP4 without changing the original
- Native synchronized video and stereo-audio decoding
- Official ComfyUI H3 graph topology and sampling defaults, with detected FL2V and Ref2V 4/8-step turbo LoRAs, including MiniMax H3 Turbo Ref2VA 8-Step v1.0 at 768p
- Two optional additional ComfyUI LoRA slots, each with an independent strength; official Turbo LoRAs remain automatic and do not consume a slot
- Optional H3 text encoding: fast NVFP4-AWQ remains the default; select the slower, higher-quality `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` encoder when it is installed
- Local Ollama prompt enhancement, timed shot planning, and synchronized-audio rewriting
- In-app playback through a range-aware local media proxy, using either ComfyUI history or the configured output directory
- Z-Image Turbo first-frame generation using locally installed ComfyUI models
- Landscape, portrait, and square output presets plus validated custom 32-pixel-aligned dimensions, automatic image fitting, and an interactive crop preview
- Official `res_multistep` + `simple` sampling by default, an explicit full-quality experimental override, and WebSocket render progress/previews
- Persistent generation defaults with Native Quality, official Turbo 8, Preview, and separately disclosed experimental sampling controls
- Guided H3 Native Quality, Turbo 8, and Preview presets with resolution quality labels, validated official-stack reporting, and custom sampling isolated under an Experimental disclosure
- A fixed-seed H3 quality diagnostic that queues matching Native and Turbo 8 renders for direct A/B comparison
- Optional verified LTX 2.5 latent 2× post-processing for every MiniMax video mode; LTX-VAE encodes the completed frames, the learned latent upsampler doubles spatial size, and the app trims padding and retains untouched MiniMax audio
- A one-click, per-user NSIS Windows installer with desktop and Start menu shortcuts
- A same-network mobile companion for native MiniMax H3 or LTX‑2.5 T2V/I2V creation, separate provider state, automatic crop controls, video preview, and download
- A dedicated Z-Image Turbo first-frame workspace with persistent controls, local Ollama enhancement, cancellation, and direct I2V handoff
- Mobile and desktop live ComfyUI sampler steps, stage-aware progress, faster completion updates, Ollama prompt revision, cancellation, verified MiniMax post-render LTX 2.5 latent upscaling, and explicitly experimental RTX/CUDA frame upscaling

## Mobile companion

Launch MiniMax Studio, select **Mobile** in the top bar, and scan the QR code from a phone connected to the same trusted Wi-Fi or LAN. The private access token persists across desktop restarts, so saved phone links keep working. Use **Rotate access link** in the QR dialog whenever you want to invalidate every previously scanned link. Windows Firewall may ask whether the app can accept private-network connections the first time.

The phone uses the model folders, ComfyUI address, and output settings configured on the desktop. The first pass is served over local HTTP for simple LAN access. Browsers require a trusted HTTPS origin for verified PWA installation and service-worker caching, so the HTTP version should be used in the browser or saved as a home-screen shortcut until the guided HTTPS pass is complete.

## Local services

- ComfyUI defaults to `http://127.0.0.1:8188`.
- Ollama defaults to `http://127.0.0.1:11434`. The app lists installed local text models and deliberately excludes embedding and cloud-backed entries. Prompt text never needs to leave the workstation.

Both addresses, every model directory, and the ComfyUI output directory can be changed from Settings.

## Workflow compatibility

MiniMax generation is built from ComfyUI's official T2V/I2V/Ref2V core graph: native H3 conditioning, `RandomNoise`, `BasicGuider`, `res_multistep`, `simple`, joint video/audio latent decoding, and `CreateVideo`/`SaveVideo`. The app prefers the official pruned INT8 ConvRot diffusion safetensors, NVFP4-AWQ text encoder, FP16 video VAE, and FP32 audio VAE when multiple matching files exist. Live preview and LTX/RTX upscaling are separate output branches and do not alter the base H3 sampling path.

Turbo sampling uses the official sampler/scheduler pair unless the user explicitly enables custom sampling. Ref2VA Turbo 8-step v1.0 at 768p automatically applies its required 6 / 3 training shifts. Custom combinations remain clearly marked experimental because they are not equivalent to the published template and can produce unusual motion or composition.

The Settings workspace can save and apply resolution, duration, quality mode, full-quality steps, LoRA strength, reference-image fidelity, live preview, sampler/scheduler, and sigma-shift defaults. Native H3 behavior leaves shifts on the model baseline (video 12, audio 3). Enabling custom shifts inserts ComfyUI's core `MiniMaxH3SigmaShift` node; the Euler/Beta preset is intentionally labeled experimental because it targets converted Turbo LoRA compatibility rather than the published template.

The **LTX 2.5** navigation entry is a separate provider workspace and never reads or changes MiniMax prompts, inputs, Turbo LoRAs, samplers, sigma shifts, or post-render upscale choices. Its Quality preset follows ComfyUI's official two-stage distilled workflow: an 8-step half-resolution pass, LTX latent spatial 2× upscaling, and a 3-step refinement pass. Its Turbo preset uses the official fixed 8-step distilled schedule as a single full-resolution stage. Both use Euler ancestral, CFG 1, 24 fps, the LTX Gemma encoder, separate LTX video/audio VAEs, and native synchronized audio.

## Build and package

```powershell
pnpm install
pnpm build
pnpm package:win
```

For a packaged Windows build with an automatically incremented rolling build number, run `build.bat`. The patch component of the app version is the build number, and the installer is written to `release\MiniMax-Studio-Setup-<version>.exe`.
- Independent model locations for diffusion models, text encoders, VAEs, LoRAs, preview VAEs, and vision encoders
- ComfyUI connection health, GPU/VRAM display, job status, cancellation, history, and output playback
- Responsive layouts for compact and large desktop windows

## Screenshots

The screenshots below are captured from the current desktop workflow. The complete capture sequence is kept in [`Readmescreenshots`](Readmescreenshots) for maintainers who need the full interaction history.

### Reference prompt builder

The reference mode keeps the generated reference instructions visible above the editable prompt, numbers each image, and preserves the existing video output preview.

![Reference prompt builder with numbered references and generated prompt](Readmescreenshots/step-0001.png)

### ACE-Step 1.5 music generation

Music is a first-class sidebar workspace. It exposes the two requested XL checkpoints, lyric or instrumental generation, and the audio-specific controls without changing the video workspaces.

![ACE-Step 1.5 Music workspace](Readmescreenshots/step-0005.png)

### Reusable production libraries

Character, wardrobe, and location studios keep reusable references and continuity details in separate libraries that can be brought into movie planning.

![Character Studio reference production](Readmescreenshots/step-0010.png)

![Wardrobe Studio](Readmescreenshots/step-0015.png)

![Location Studio](Readmescreenshots/step-0020.png)

![Movie Planner production bible](Readmescreenshots/step-0026.png)

## ACE-Step 1.5 setup

The Music workspace submits the native ComfyUI ACE-Step 1.5 graph; it does not call a separate hosted music service. Install the following files into the configured ComfyUI model folders, then use **Settings → Test connection** and rescan models:

| ComfyUI folder | Required file |
| --- | --- |
| `models/diffusion_models` | `acestep_v1.5_xl_sft_bf16.safetensors` |
| `models/diffusion_models` | `acestep_v1.5_xl_base_bf16.safetensors` |
| `models/vae` | `ace_1.5_vae.safetensors` |
| `models/text_encoders` | `qwen_0.6b_ace15.safetensors` |
| `models/text_encoders` | `qwen_4b_ace15.safetensors` |

The app detects either XL checkpoint independently, so an installation with only Base or only SFT remains usable. A current ComfyUI build must expose `TextEncodeAceStepAudio1.5`, `EmptyAceStep1.5LatentAudio`, `ModelSamplingAuraFlow`, `VAEDecodeAudio`, and `SaveAudioAdvanced` in its object info. The generated graph follows Comfy-Org's published ACE-Step 1.5 templates: 50 Euler/simple diffusion steps, AuraFlow shift 3, and the published per-checkpoint CFG defaults (SFT 7, Base 6).

Reference downloads and node documentation are maintained by [Comfy-Org's ACE-Step 1.5 workflow templates](https://github.com/Comfy-Org/workflow_templates/tree/main/templates) and [the TextEncodeAceStepAudio1.5 embedded docs](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/TextEncodeAceStepAudio1.5/en.md).

Generated tracks are written by ComfyUI's audio saver to the configured output directory as FLAC and appear in the Music workspace and Queue with an audio player. Video Library cards intentionally remain video-only, so adding music does not change frame-bookmark or video editing behavior.

## Requirements

- Node.js 20+
- pnpm 10+
- A current local ComfyUI instance with MiniMax H3 core nodes (and current LTX‑2.5 or ACE-Step 1.5 core nodes when using those workspaces)
- The MiniMax H3 model components already present on disk

The default model root is `%USERPROFILE%\Documents\ComfyUI\models`, but every category can be changed in **Settings → Model locations**.

## Development

```powershell
pnpm install
pnpm build
pnpm dev
```

The launcher removes `ELECTRON_RUN_AS_NODE` from Electron's child environment, so `pnpm start` and `pnpm dev` work even when an automation or parent shell sets it.

Start ComfyUI separately, then use **Settings → Test connection**. The default server is `http://127.0.0.1:8188`.

## How generation works

The renderer sends media paths through a context-isolated Electron bridge. Electron uploads selected inputs to the configured local ComfyUI server and submits a native API-format graph using these core nodes:

- `MiniMaxH3ImageToVideo` or `MiniMaxH3ReferenceToVideo`
- `UNETLoader`, `CLIPLoader`, and separate video/audio `VAELoader` nodes
- `SamplerCustomAdvanced` with `res_multistep`
- `VAEDecode`, `VAEDecodeAudio`, `CreateVideo`, and `SaveVideo`

Durations are converted to MiniMax H3's required `17k + 5` frame grid at 24 fps. Reference autogrow inputs use ComfyUI's required dotted API keys, such as `ref_images.ref_image_0`.
