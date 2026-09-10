# Automated Movie Pipeline Plan

## Objective

Add a guided, local-first Movie workspace that turns an approved story into a complete editable film using MiniMax H3 T2V, I2V, first/last-frame video, Ref2V, local Ollama planning, dialogue audio, optional lip sync, ComfyUI rendering, and the existing Clip Editor.

The system must save every decision and artifact, support pause and resume, estimate its work before rendering, and never spend substantial GPU time without an approved plan. It must not automatically join generated clips. Joining and full-film export remain explicit actions in the Clip Editor.

## Product principles

- Treat this as a guided production manager, not a single opaque “make movie” command.
- Separate the target film runtime from the available compute-time budget.
- Generate and approve a low-cost animatic before final video production.
- Keep all source clips, attempts, references, dialogue, and exports non-destructive.
- Require explicit approval at configurable checkpoints.
- Cap automatic retries and ask the user when the pipeline is uncertain.
- Keep planning local through Ollama and rendering local through ComfyUI.
- Preserve user-selected model locations and workflow settings.

## Guided production flow

1. Story setup
2. Production bible
3. Screenplay and dialogue
4. Shot plan and mode routing
5. Storyboards
6. Low-cost animatic
7. Draft renders in small batches
8. Shot review and selective retries
9. Final renders, dialogue, sound, and upscale
10. Explicit timeline assembly and export

Every stage has `Back`, `Save`, `Pause`, and `Approve and continue` controls. The user can review every shot or choose scene-level/batch-level review gates.

## 1. Story setup

Collect:

- Premise, outline, or imported screenplay.
- Film runtime target.
- Compute budget or stop time.
- Genre, tone, audience rating, visual style, and pacing.
- Aspect ratio, draft resolution, final resolution, and frame rate.
- Dialogue level and number of recurring characters.
- Review frequency: every shot, every scene, or every N shots.
- Quality profile: Preview, Balanced, or Maximum.
- Whether the pipeline may continue unattended after approved gates.

Before production, benchmark one representative draft shot on the current hardware. Use that result to show an estimate range for render time and disk usage. Recalculate the estimate as real jobs complete.

## 2. Production bible

Create a versioned source of truth for the project:

- Character names, appearance, age, body shape, hair, face, and distinguishing details.
- Front, three-quarter, full-body, neutral-expression, and costume references.
- Approved voice reference and delivery notes for each speaking character.
- Locations, time of day, lighting, palette, props, and set details.
- Camera rules, lens style, composition, motion, and prohibited visual changes.
- Continuity facts such as wardrobe, injuries, carried objects, screen direction, and emotional state.

Approved references become locked versions. Changing one warns the user which planned or rendered shots depend on it.

## 3. Structured screenplay

Use Ollama structured JSON output and validate it in the application. The LLM proposes creative material, while application code enforces durations, supported modes, reference counts, and model constraints.

Suggested entities:

```ts
type MovieProject = {
  id: string
  title: string
  targetRuntimeSeconds: number
  computeBudgetMinutes?: number
  status: 'planning' | 'animatic' | 'production' | 'paused' | 'complete'
  bible: ProductionBible
  scenes: MovieScene[]
  settings: MovieRenderProfile
}

type MovieScene = {
  id: string
  title: string
  summary: string
  locationId: string
  continuityState: Record<string, string>
  shots: MovieShot[]
}

type MovieShot = {
  id: string
  order: number
  durationSeconds: number
  prompt: string
  characters: string[]
  dialogue: DialogueCue[]
  generationMode: 'text' | 'image' | 'frames' | 'reference' | 'video'
  dependencies: string[]
  referenceIds: string[]
  stage: 'planned' | 'storyboard' | 'draft' | 'review' | 'approved' | 'final' | 'locked'
  attempts: RenderAttempt[]
}
```

## 4. Generation-mode router

Choose the least expensive mode that can satisfy the shot:

| Requirement | Preferred route |
| --- | --- |
| Establishing shot without a recurring subject | T2V |
| Exact starting composition | I2V |
| Recurring character, costume, location, or voice | Ref2V |
| Direct continuation from an existing clip | Grab end frame, then I2V |
| Required start and final composition | First + Last |
| Existing motion or camera structure must be retained | V2V or controlled LTX |
| Exact spoken words | Approved audio followed by audio-driven video or lip sync |
| Non-critical ambience and incidental speech | Native H3 synchronized audio/video |

An extracted continuation frame only configures the next generation. The completed render remains a separate asset. The user adds both videos to the Clip Editor and explicitly exports the joined timeline.

## 5. Dialogue and audio

For exact dialogue:

1. Write and approve the line.
2. Generate or import the voice audio.
3. Let the user listen and approve it.
4. Measure its exact duration.
5. Fit the shot length and acting beats around the approved audio.
6. Use the audio as an H3/LTX reference or apply an optional dedicated lip-sync pass.
7. Mix dialogue, ambience, effects, and music as separate tracks.

Prefer one visible speaker for detailed lip-sync shots. Use reaction shots, over-the-shoulder framing, or wider framing for conversations involving several visible faces. Voice cloning must require user confirmation that they have the necessary rights and consent.

## 6. Storyboards and animatic

Generate one inexpensive approved image per shot before video. Assemble these images with temporary dialogue, subtitles, simple camera moves, and transitions into an FFmpeg animatic.

The animatic review shows:

- Full story and pacing.
- Predicted and actual runtime.
- Estimated GPU time and disk usage.
- Missing character/location references.
- Dialogue that does not fit its shot.
- Continuity conflicts.
- Risky or unusually expensive shots.

Final video rendering remains locked until the animatic or selected scenes are approved.

## 7. Progressive rendering

Move each shot through:

```text
planned -> storyboard -> draft -> review -> approved -> final -> locked
                               |          |
                               v          v
                             failed     retry requested
```

- Storyboard: still image only.
- Draft: reduced resolution, turbo steps, no upscale.
- Candidate: one normal-quality attempt.
- Approved: selected candidate.
- Final: full quality, optional upscale and audio finishing.
- Locked: protected from automated replacement.

Default retry policy: one initial attempt and at most one automatic correction. Further retries require user review. Render small batches until references and settings prove stable.

## 8. Consistency system

- Compile every shot prompt from the locked production bible.
- Route recurring subjects through approved reference packs.
- Use previous-shot boundary frames where visual continuity is required.
- Keep model, VAE, LoRA, sampler, scheduler, and quality profile stable within a scene.
- Track wardrobe, props, lighting, time, screen direction, and emotional state in a continuity ledger.
- Store keyframes from approved shots as scene memory.
- Compare storyboard and output frames using general visual embeddings.
- Make optional face-identity scoring license-aware and disabled by default.
- Flag low-confidence results for humans instead of blindly retrying.

Using a repeated seed alone is not considered an identity-control mechanism.

## 9. Quality checks

Automated checks can detect or score:

- Missing/corrupt/black output frames.
- Incorrect duration, resolution, FPS, or audio stream.
- Excessive repeated frames or unexpectedly low motion.
- Character, costume, and location similarity to approved references.
- First/last-frame continuity.
- Audio clipping and silence.
- Dialogue length and synchronization.
- Prompt/reference/workflow mismatches.

Scores are warnings and routing signals, not final creative judgments.

## 10. Pause, resume, and recovery

Persist the pipeline as durable tasks:

```text
planned -> ready -> queued -> rendering -> reviewing -> approved -> final
                    |          |
                    v          v
                 cancelled    failed
```

Provide:

- `Pause after current shot` to preserve the active render.
- `Stop now` to interrupt the active ComfyUI job.
- Resume from the next incomplete dependency.
- Startup reconciliation against ComfyUI queue and history.
- A readable error and retry action for every failed task.
- No deletion of completed assets when a task is retried.

## 11. Movie workspace interface

Add a `Movie` navigation destination with:

- Left: scenes and ordered shots.
- Center: storyboard, preview, or animatic player.
- Right inspector: prompt, references, continuity, dialogue, render route, attempts, and approval state.
- Top status bar: project stage, runtime, estimated remaining compute, disk estimate, and pause control.
- Bottom production queue: current task and the next few dependent tasks.

Avoid large modal-driven shot workflows. Use the inspector for normal shot edits. Character and location creation use focused, viewport-safe modals so the main production bible stays scannable; destructive confirmations, voice authorization, and final export settings may also use dialogs.

## Implementation phases

## Feature-pass progress

### Feature Pass 1 — Planning foundation (implemented)

- Persistent local movie projects with schema-safe defaults.
- Story, target runtime, compute budget, aspect ratio, quality, and review-gate setup.
- Editable production bible for global visual rules, characters, wardrobe, voices, and locations.
- Local Ollama structured-output scene and shot planning.
- Manual scene and shot creation when Ollama is unavailable.
- Planned-versus-target runtime feedback.
- Persistent pause/resume project state.
- One-shot handoff into the existing Create workspace.
- No automatic ComfyUI submission, retry, or video joining.

### Feature Pass 2 — Movie assets and assisted authoring (implemented)

- Focused create/edit modals for movie characters and recurring locations.
- Compact production-bible cards after each asset is saved.
- Persistent character and location reference-image lists that keep the original local file paths.
- Local Ollama assistance for story treatments, global continuity rules, characters, locations, and individual MiniMax shot prompts.
- Character assignment per shot for explicit recurring-cast continuity.
- Ref2V handoff loads the assigned character and scene-location references into Create without starting a render.
- Progressive story layout with collapsible production limits.
- Compact shot rows with details expanded only when requested.
- Collapsible scene cards showing the scene summary, location, shot count, runtime, generation-route mix, and assigned cast before opening.
- Responsive modal bodies and always-reachable modal actions in resized desktop windows.
- Browser-preview mocks for all new structured assistant flows.

Next test gate: exercise reference-image selection in the packaged Electron build with real local images, confirm Ref2V handoff loads them, and then begin storyboard/animatic timing work. References are not copied into project storage yet, so moving or deleting an original file will intentionally make that reference unavailable.

### Feature Pass 3 — Scene continuity foundation (implemented)

- Scene cards can be opened independently and summarize story beat, location, duration, shot count, route mix, assigned cast, and continuation readiness.
- Every scene after the opening scene defaults to an explicit connection with the preceding scene; users can switch it to a hard cut.
- Connected scenes wait for the preceding scene’s final shot instead of silently falling back to an unrelated first frame.
- Completed movie-linked renders are written back to their source shot without joining clips or queuing follow-up work.
- Opening the first shot of a ready connected scene extracts the preceding scene’s final rendered frame automatically and routes the shot through I2V.
- Continuation handoff adds explicit identity, wardrobe, prop, lighting, color, lens, camera-axis, screen-direction, pose, and motion-momentum preservation guidance.
- Hard-cut scenes remain freely routable through T2V, I2V, first/last-frame, or Ref2V.

Next test gate: complete two real linked scene renders in packaged Electron, verify the extracted handoff frame against the prior video’s final decoded frame, and add storyboard thumbnails plus animatic timing without automatic generation.

### Feature Pass 4 — Project copilot and movie review (implemented)

- A persistent right-side movie copilot uses the selected local Ollama model and receives the current story, production rules, recurring cast, locations, scenes, shots, and recent project conversation.
- Copilot conversations are stored per movie project and restored with that project.
- Structured copilot responses can safely revise project, scene, and shot fields while preserving unrequested content and rejecting unknown character or location IDs.
- Every completed render opened from a movie shot is collected into a project-specific movie preview in scene and shot order.
- The movie preview plays clips sequentially without joining, modifying, or duplicating the source files.
- The Clip Editor frame extractor now accepts an FFmpeg executable or FFmpeg folder, supports quoted Windows paths, verifies that a real image was produced, and displays extraction progress in the modal.
- Extracted frames are shown through the app media protocol and can be routed to I2V, first/last-frame, or Ref2V without automatically joining clips.

Next test gate: render several movie-linked clips out of order and confirm the preview restores story order, then exercise start/end frame extraction from local, ComfyUI-served, and trimmed clips in the packaged app.

### Feature Pass 5 — Whole-project conversational builder (implemented)

- The Ollama copilot is a full-height companion beside the entire Movie Maker workspace rather than a panel tied to one planning stage.
- The complete editable project is supplied as context: setup, story, global visual rules, character continuity, locations, scenes, shots, dialogue, render routes, status, and recent conversation.
- Structured chat operations can create or revise characters, locations, scenes, and shots; explicitly requested deletes are also supported.
- Temporary IDs from a single Ollama response are safely translated into persistent IDs, allowing a new shot to reference a new scene or character created in the same response.
- Existing reference images, shot output links, render timestamps, and stages survive chat edits to their parent entities.
- Unknown character, location, scene, and shot references are rejected instead of corrupting the project graph.
- Chat replies support safe presentation markup for headings, paragraphs, bullets, bold text, and inline code without injecting HTML.
- Responses include smart review actions that open the affected Story, Bible, Shots, or Movie Preview area.
- Starter actions let a filmmaker develop the treatment, create recurring cast and sets, or create connected scenes and MiniMax-ready shots directly from the sidebar.
- The conversation and every applied-change summary remain stored with the selected movie project.

Next test gate: use several different installed Ollama model families against the expanded schema, measure response reliability on large projects, and add an undoable review step for destructive or broad multi-scene revisions.

### Feature Pass 6 — Storyboard and conversational revision safety (in progress)

- Implemented a pending-change review inside Movie copilot. AI proposals now show field-level additions, edits, and removals before any project data is committed.
- Implemented a capped per-project undo history for reviewed AI changes. The latest ten pre-change movie snapshots are stored locally, with a session-only fallback when browser storage cannot accommodate a large snapshot.
- Implemented stale-proposal protection: if the filmmaker manually edits the movie while a proposal is open, Apply refreshes the comparison against the current project instead of overwriting newer work.
- Implemented explicit destructive-change confirmation for character, location, scene, and shot removals, including rendered-output warnings and a highlighted threshold when more than three shots are removed.
- Summarize older conversation and completed scenes into compact project memory when the local model context window becomes crowded.
- Generate Z-Image storyboard candidates per shot and show approved thumbnails on scene cards.
- Add an animatic player using approved storyboards, dialogue placeholders, shot durations, and temporary audio.
- Surface continuity warnings in chat and scene cards when wardrobe, location anchors, screen direction, duration, or generation route drift from the production bible.
- Let chat select a specific character, location, scene, or shot as its focused editing scope while retaining awareness of the full project.

Next test gate: exercise the review schema with several installed Ollama model families on large movie projects, verify retained undo snapshots after an app restart, and confirm stale proposals rebase cleanly after simultaneous manual story, bible, and shot edits.

### Feature Pass 7 — LAN mobile companion (implemented foundation)

- Start a private companion web server with the desktop app and expose it only on the local network.
- Show a scannable QR link in the desktop title bar; its private token persists across restarts and changes only when the user explicitly rotates the access link.
- Provide a focused phone workspace for T2V and I2V without exposing the full desktop editor.
- Reuse the desktop model-folder settings, MiniMax model selection rules, workflow builder, output resolutions, orientation controls, and automatic image-crop editor.
- Upload only the prepared I2V crop to the desktop ComfyUI input folder, queue the real MiniMax workflow, poll completion, and preview or download the resulting video.
- Proxy generated video with byte-range support so mobile playback and seeking work without exposing ComfyUI directly to the network.
- Add a web manifest, mobile icons, standalone presentation, safe-area layout, and an offline shell service worker.
- Preserve the access token on the phone after a home-screen launch while keeping it out of cached request URLs.
- Treat the initial HTTP LAN page as a same-network browser companion. Full browser-verified PWA installation and service-worker caching require a trusted HTTPS origin (localhost is the development exception).

Next test gate: install the rebuilt desktop app, allow its private-network firewall prompt, scan from a real phone on the same Wi-Fi, submit one T2V and one cropped I2V, seek and download both outputs, and verify the layout in phone portrait, phone landscape, and tablet widths.

### Feature Pass 8 — Trusted mobile install and production controls (next)

- Add an opt-in LAN companion setting, port selection, connection list, and a prominent stop-sharing control.
- Provide a guided trusted-HTTPS setup for full PWA installation without asking users to bypass certificate warnings.
- Mirror phone-started jobs into the desktop queue and library with source-device labels.
- Add mobile queue visibility, generation recovery after page reload, and completed-output history.
- Validate phone uploads by decoded media type and dimensions in addition to file size.
- Add automated LAN API tests covering authorization, invalid workflows, upload limits, ComfyUI errors, range requests, and stale tokens.

### Feature Pass 9 — Dedicated first-frame and expanded mobile creation (implemented)

- Move Z-Image Turbo out of the MiniMax composer into its own First Frame workspace with persistent prompt, canvas, seed, and model-component settings.
- Provide a large still-image preview, cancellation, local Ollama enhancement, and an explicit **Use in MiniMax I2V** handoff that also matches the video canvas.
- Keep the original Z-Image output in ComfyUI while passing a prepared image copy to the later MiniMax workflow.
- Add mobile Ollama prompt tools for enhancement, shot timing, synchronized audio, and free-form revision instructions.
- Add mobile LTX 2.5 latent 2× and RTX/CUDA frame 2× post-render options using the upscalers detected from the desktop ComfyUI instance.
- Relay ComfyUI sampler progress and binary preview frames to the mobile page without exposing ComfyUI on the LAN.
- Add mobile generation cancellation and retain the persistent, manually rotated mobile access token.

Next test gate: run Z-Image through the dedicated workspace and hand its output to I2V; then test phone T2V and I2V with each upscale mode, progress preview, Ollama editing, cancellation, and final download.

### Feature Pass 10 — DaVinci-style timeline interaction (next)

- Keep the media bin at left, program viewer above, timeline below, and add a collapsible clip inspector at right so the editor reads as one workspace rather than separate cards.
- Add a time ruler, draggable playhead, current/total timecode, timeline zoom, fit-to-timeline, horizontal wheel navigation, and a clearly visible active clip.
- Replace move-left/right as the primary interaction with direct clip dragging, magnetic snapping, insertion indicators, and keyboard-accessible reorder controls.
- Add draggable in/out trim handles with live viewer feedback, ripple-safe trimming, split-at-playhead, ripple delete, and undo/redo history.
- Add video and audio track headers with lock, mute, solo, visibility, and target controls before supporting layered clips.
- Add J/K/L playback, Space play/pause, arrow-frame stepping, I/O marks, S split, Delete/ripple-delete, and tooltips that expose shortcuts.
- Keep explicit export as the only join operation. Frame extraction and continuation rendering continue to create separate source clips.
- Adapt at smaller window sizes by collapsing the inspector and media bin into toggled panels while keeping transport and timeline controls reachable.

Research basis: Blackmagic’s Edit page uses a media pool, viewers, and timeline as a coordinated workspace; Resolve 20 also emphasizes trim modes, ripple controls, and safe trimming. See the official Editor’s Guide and Resolve documentation: https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Editors-Guide.pdf and https://www.blackmagicdesign.com/support

### Feature Pass 11 — Consistency-first movie automation controller (next)

- Create a versioned identity pack for each character: approved hero portrait, profile, full body, wardrobe variants, color anchors, voice anchor, and protected textual traits.
- Pin every shot to explicit character/reference versions so later bible changes cannot silently alter already approved scenes.
- Generate and approve inexpensive Z-Image keyframes before expensive video. Use those anchors for I2V or Ref2V rather than relying on T2V to rediscover a recurring character.
- Route connected shots through last-frame I2V continuation; route hard cuts containing recurring cast through Ref2V identity packs; reserve pure T2V for establishing shots or intentionally new subjects.
- Maintain separate inter-shot memory (approved keyframes and identity references) and intra-shot memory (continuation frames and motion direction), reflecting current multi-shot consistency research.
- Add automated identity, wardrobe, location, palette, screen-direction, prompt-alignment, duration, and technical-output checks after every render.
- Compare face/subject embeddings against approved references and flag drift for review. Never auto-retry beyond a small user-configured budget.
- Ask for approval after storyboard/keyframe batches and after failed quality checks so automation saves time instead of repeatedly producing unusable video.
- Store every attempt, seed, prompt, references, model route, score, rejection reason, and chosen result in the project ledger.
- Add pause/resume checkpoints around planning, keyframes, video batches, dialogue, continuity repair, edit assembly, and final export.

### Feature Pass 12 — Independent LTX‑2.5 provider workspace (implemented)

- Add LTX‑2.5 as a dedicated navigation workspace rather than mixing its controls with MiniMax H3.
- Persist its T2V/I2V mode, prompt, first frame and crop, resolution, duration, seed, quality preset, and live-preview preference under a separate workspace key.
- Use the official ComfyUI two-stage distilled graph for Quality: fixed 8-step first-stage sigmas, half-resolution generation, latent spatial 2× upscaling, and fixed 3-step refinement.
- Offer a Turbo preset using the official fixed 8-step distilled schedule as a single full-resolution stage.
- Keep LTX output selection, current job, cancellation, progress, preview frame, and final playback isolated from the MiniMax composer while sharing the reliable ComfyUI queue transport.
- Detect and prefer the official INT8 ConvRot distilled transformer, projected Gemma 4 encoder, LTX video/audio VAEs, and latent spatial upscaler already installed by the user.
- Add local Ollama prompt refinement tailored to LTX T2V or I2V without altering MiniMax prompt state.

Next test gate: run one 5-second LTX T2V and one cropped I2V in both Quality and Turbo, compare the fixed seed, confirm native audio, cancel a queued render, and verify intermediate/final previews remain scoped to the LTX workspace.

### Feature Pass 13 — Mobile LTX and reference preparation (implemented)

- Expose MiniMax H3 and native LTX‑2.5 as clearly separated providers in the LAN mobile Create workspace, with independent persisted prompts and settings.
- Reuse the official desktop LTX Quality and Turbo workflow builders on mobile, including T2V, cropped I2V, synchronized audio, live preview, and cancellation.
- Relay real ComfyUI sampler steps and workflow stages immediately on desktop and mobile, and check completed output once per second.
- Open every newly selected Ref2V video in a focused clipper with source preview, playhead controls, precise in/out points, and a 2–15 second validation window.
- Re-encode the chosen section to a separate H.264/AAC reference MP4 in the configured output folder; retain source metadata so an existing reference can be revised from its original video.
- Keep reference clipping independent from the Clip Editor: it never joins media, alters the original, or starts a render.

Next test gate: trim the beginning, middle, and end of long MP4/MOV sources; re-edit an existing reference; render Ref2V with the resulting clip; and verify native LTX T2V/I2V progress and output on a real phone.

### Feature Pass 14 — H3 quality guardrails and diagnostics (implemented)

- Promote three clear production routes in Create and Settings: Native Quality at 1344 × 768 and 20 steps, official Turbo 8 on the native canvas, and an 864 × 480 Turbo 8 Preview.
- Label every H3 resolution as Draft, Preview, Balanced, or Native Quality so lower-resolution generation is not mistaken for an equivalent final-quality path.
- Force all guided presets back to `res_multistep` + `simple`, native sigma shifts, LoRA 1.0 when applicable, and post-render upscale off.
- Restrict full-quality tuning to 16–30 steps and move 4-step FL2V, custom sampler/scheduler, custom sigma shifts, and custom LoRA strength into a clearly warned Experimental disclosure.
- Compare detected FL2VA, Qwen encoder, video VAE, audio VAE, and Turbo 8 files against the validated official filenames while continuing to support explicitly labeled non-standard fallbacks.
- Add one-click fixed-seed H3 A/B diagnostics: Native 20-step and official Turbo 8, both 1344 × 768, five seconds, no upscale, saved with diagnostic filenames.
- Warn that RTX/CUDA frame upscaling is best for already-clean output and may amplify noise or introduce temporal shimmer.

Next test gate: run the diagnostic pair on the target GPU, compare native files before any upscale, then repeat a known problematic prompt using Native Quality and Preview to isolate resolution and Turbo artifacts.

### Feature Pass 15 — Verified upscale isolation (implemented)

- Keep RTX/CUDA frame upscaling explicitly experimental and require confirmation before every desktop or mobile render because independent per-frame enhancement can magnify source noise and temporal shimmer.
- Verify the MiniMax LTX 2× branch against ComfyUI's current LTX latent-upsample contract: encode completed H3 frames with the LTX‑2.5 video VAE, apply `LTXVLatentUpsampler`, decode, remove temporal padding, and remux untouched H3 audio.
- Require both exact LTX‑2.5 model selections and the full ComfyUI encode/upscale/decode node chain before enabling the option.
- Validate the native LTX workspace's full two-stage node set separately, preserving provider isolation from MiniMax.
- Add graph regression assertions for the selected VAE/upscaler, all latent links, 8n+1 temporal padding, output trim, 24 fps, original audio link, and `_LTX25_2x` saved output.
- Track ComfyUI DynamicCombo schema changes in LTX I2V and serialize the image-resize branch using its required dotted `resize_type.longer_size` API input.
- Stream local Clip Editor and reference-clipper media through explicit byte-range responses, allowing Chromium to buffer and seek large MP4/MOV files without repeatedly reading the entire source; throttle playhead rendering independently from native video playback.

Next test gate: render one Native Quality MiniMax clip with upscale Off, then run LTX 2× on the same seed and inspect both saved files. Run RTX only as a third comparison so any new noise or flicker is attributable to that branch.

### Feature Pass 16 — Character Studio foundation (implemented)

- Add a global, persistent Character Studio library independent of individual movie projects.
- Create a full-body master reference through a targeted Z-Image workspace handoff; generated images are saved to the configured output folder for durable reuse.
- Prepare a neutral MiniMax I2V turntable from the master reference, automatically link its completed output to the character project, and allow replacement with any existing video.
- Extract five evenly distributed frames from an approved turntable into a reusable multi-angle set, or deliberately keep only the single master image.
- Surface library characters in Movie Creator’s Production Bible, where approved references can be imported as normal editable movie cast cards and used by existing shot/reference routing.

Next test gate: make one Z-Image master, generate a six-second turntable, verify its automatic link after completion, split five frames, import the set into a movie, assign it to a shot, and confirm Ref2V sees all selected references.

### Feature Pass 17 — Reference workspace continuity and asset assembly (implemented)

- Expand Source Media into a viewport-safe 1120px workspace with calmer section spacing, larger standalone-file previews, and large identity/location thumbnails.
- Import the selected character's approved identity, assigned Hair Studio design, Wardrobe Studio outfit, and accessories through one current library allocation instead of preserving an identity-only snapshot.
- Show the exact connected hair and wardrobe on each character row, and explicitly flag linked assets that still need an approved image.
- Generate one automatic per-character assembly instruction that pairs numbered identity, hair, clothing, and accessory pictures before the detailed preservation rules.
- Expose the synchronized automatic reference direction inside Source Media so picture numbering and missing assignments can be audited before rendering.
- Add a Character Studio action that renders an assigned hairstyle into a fresh character master for the most reliable downstream identity reference.
- Add completed-Reference-video continuation controls: extract the exact final frame or a user-selected timestamp, load it as the next I2V first frame, and leave the already-rendered clip untouched.
- Store the completed local video path for deterministic continuation-frame extraction.
- Supply current MiniMax H3 Preview Override inputs (`vae_name` and `jpeg_quality`) and cover them with workflow regression assertions.
- Select the newest linked Location Studio automation job, return submission failures to its guided builder, and report automatic frame-extraction failures instead of silently hiding them.

Next test gate: select a character with approved hair and wardrobe and confirm every numbered picture and assembly line appears; render a short Reference clip with animated preview; continue once from the last frame and once from a middle timestamp; then verify character turntable and location walkthrough auto-import five stills.

### Feature Pass 18 — Mobile and LAN workspace access (implemented)

- Simplify the phone companion to three quick destinations—Video, Image, and Cast—with a separate touch-sized workspace drawer.
- Put Reference Workspace directly in the mobile menu and keep identity, hair, wardrobe, standalone images, motion references, audio, clothing intent, and fidelity controls reachable at phone widths.
- Add a complete-Studio entry for Movie, Hair, Wardrobe, Locations, Queue, Library, Editor, and Settings.
- Replace the complete Studio's narrow horizontal mobile icon strip with an accessible overlay drawer so every workspace remains reachable without sideways scrolling.
- Synchronize mobile cast entries with the same numbered desktop reference allocation and automatic prompt instructions, including approved hair and wardrobe instead of sending an empty wardrobe field.
- Convert local reference files to phone-safe data URLs before LAN synchronization so the phone can preview and upload connected assets through the authenticated LAN API.
- Preserve token authorization, invalid-token rejection, ComfyUI bootstrap, media proxying, queue cancellation, and local Ollama routing.

Next test gate: open the QR link on a real phone, import one character with approved hair and wardrobe into Reference mode, submit/cancel a short render, preview and download the result, then open the complete Studio drawer at portrait and landscape sizes.

### Feature Pass 19 — Reference intake and engine visibility (implemented)

- Expand the H3 engine-stack audit so FL2VA, Ref2VA, FL2V Turbo 8, Ref2V Turbo 8, and optional Ref2V Turbo 4 are individually visible instead of hiding the reference route behind the Create workspace.
- Analyze newly chosen existing images with the configured local Ollama or LM Studio vision model in Character, Hair, Wardrobe, Accessory, and Location studios.
- Fill only blank or untouched starter fields with visible, role-specific descriptions while preserving the user's authored names and notes; keep the selected image when analysis is unavailable or fails.
- Keep every existing resolution preset and add a Custom choice with width/height inputs, 32-pixel alignment checks, provider canvas limits, accessible invalid states, and responsive phone-width layout.
- Add two optional user-LoRA slots directly in Output and quality. Exclude the automatic MiniMax Turbo adapters from these selections, chain selected adapters after Turbo in the ComfyUI graph, preserve per-slot strength, and prevent duplicate selection.

Next test gate: use one vision-capable Ollama model and one text-only model to import each reference type, confirm authored fields are retained, then render H3 and LTX clips at several valid custom sizes and confirm invalid dimensions never reach ComfyUI.

Research basis: current work finds a real identity-versus-motion tradeoff, while multi-shot systems improve consistency through shared references/features, approved anchor frames, and separate shot/temporal memory. Relevant sources: https://arxiv.org/abs/2412.07750, https://arxiv.org/abs/2512.11274, and https://openaccess.thecvf.com/content/CVPR2025/html/Kara_ShotAdapter_Text-to-Multi-Shot_Video_Generation_with_Diffusion_Models_CVPR_2025_paper.html

### Phase 1 — Planning foundation

- Movie project persistence and schema migrations.
- Story wizard and compute/runtime settings.
- Ollama JSON-schema screenplay generation and validation.
- Production bible and versioned references.
- Scene/shot dependency model.

### Phase 2 — Storyboard and animatic

- Z-Image storyboard batches.
- Dialogue placeholders and timing.
- Shot-duration editor.
- FFmpeg animatic construction.
- Approval gates and continuity warnings.

### Phase 3 — Production controller

- Automatic generation-mode routing.
- Reuse existing MiniMax workflow builders and queue.
- Small-batch rendering, pause/resume, retries, and recovery.
- Send completed shots to the Clip Editor as separate assets.

### Phase 4 — Dialogue and quality control

- Voice library and approved master-audio workflow.
- H3/LTX audio-driven routing.
- Optional lip-sync integration.
- Visual consistency and technical output checks.
- Final audio mix, subtitles, and export validation.

## Research references

### Implemented workflow foundation

- MiniMax H3 T2V/I2V uses the official ComfyUI `MiniMaxH3ImageToVideo` sampling and joint video/audio decode graph.
- Ref2V uses the official `MiniMaxH3ReferenceToVideo` graph and published 4-step turbo path.
- Official `res_multistep` + `simple` sampling is the safe default; non-template combinations require an explicit experimental opt-in.
- Official INT8 ConvRot diffusion, NVFP4-AWQ encoder, and matching video/audio VAE filenames are preferred when multiple local safetensors match.
- Preview and upscale nodes remain downstream branches so they cannot change base MiniMax sampling.
- Main Settings now stores official quality, official 8-step Turbo, and experimental Euler/Beta Turbo defaults, including LoRA strength, reference fidelity, live preview, and optional core `MiniMaxH3SigmaShift` values.

- ComfyUI server routes and interruption: https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI progress and preview messages: https://docs.comfy.org/development/comfyui-server/comms_messages
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- Official LTX-2 workflows: https://github.com/Comfy-Org/docs/blob/main/tutorials/video/ltx/ltx-2.mdx
- MiniMax H3 guide-frame node: https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/MiniMaxH3AddGuide/en.md
- Official ComfyUI workflow templates: https://github.com/Comfy-Org/workflow_templates
- Multi-shot character consistency research: https://arxiv.org/abs/2412.07750
- Cache-guided multi-shot consistency research: https://arxiv.org/abs/2512.11274
- LatentSync: https://github.com/bytedance/LatentSync
- DINOv2 model card: https://github.com/facebookresearch/dinov2/blob/main/MODEL_CARD.md

## Completion criteria

- A user can pause and resume without losing approved work.
- The app shows a meaningful time/storage estimate before final rendering.
- No expensive batch begins before its configured approval gate.
- Every final shot traces back to its prompt, references, settings, and attempts.
- Character and scene references remain consistent and versioned.
- Failed shots do not block unrelated ready work or destroy earlier outputs.
- Generated clips are never joined automatically.
- Joining happens only when the user explicitly exports a Clip Editor timeline.
