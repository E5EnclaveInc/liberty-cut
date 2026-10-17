# Liberty Cut — Build Spec

**What it is.** An open-source cinematic studio on the Comfy Developer Platform:
a thin web UI over the ComfyUI API that turns text descriptions into a cast of
original fictional characters and renders multi-shot scenes in which each
character's identity holds across shots — with matched camera moves and a
re-lighting pass — using **open-weights models only, no partner nodes or APIs**.

**Competition mapping (Comfy "Open Source Higgsfield").**
- Working creative app on the Comfy Developer Platform → the studio drives the
  ComfyUI API (`/prompt`, `/history`, `/view`, `/upload/image`) for every render.
- Public repo with code, workflows, license, local run instructions → this repo
  (MIT code license; workflows in API format; 10-minute quickstart in README).
- Demo video ≤ 2:00 → shot-by-shot script in `DEMO.md`.
- Prize-lane fit: **Open Weights Only** (LTX + FLUX + PuLID weights are all
  downloadable; no hosted/partner endpoints anywhere in the graph) and the
  **$2,000 LTX bonus** (LTX is the core — and only — video model).
- Lawful / SFW / no unlicensed likenesses → cast members are text-generated
  fictional people; the UI and README both bar real-person references.

---

## 1. Architecture

```
Browser (app/index.html + app.js)
   │  same-origin fetch
   ▼
app/server.py  (Python stdlib only)
   ├─ serves the static UI + workflows
   ├─ /comfy/*  → proxies ComfyUI API at 127.0.0.1:8188 (no CORS flags needed)
   ├─ /api/health → ComfyUI /system_stats + ffmpeg presence
   └─ /assemble   → downloads shot MP4s via /view, ffmpeg-concats to app/output/scene.mp4
   ▼
ComfyUI (local) — workflows/*.json (API format)
   ├─ FLUX.1-dev + PuLID-Flux  → cast cards, keyframes, relights
   └─ LTX-Video 13B            → every shot's motion
```

The studio **orchestrates**; it does not re-implement generation. Ensemble
Continuity is an app-level loop over two workflows (keyframe → animate) per shot;
assembly is an app-level ffmpeg step. Identity data flows as files: a finished
cast card is downloaded from ComfyUI output and re-uploaded to the input folder
(`/upload/image`) so PuLID's `LoadImage` can consume it — standard Comfy API
behaviour, no shared-filesystem assumptions.

## 2. Models (exact names, sources, licenses)

| Role | File | Source (Hugging Face) | Folder | License note |
|---|---|---|---|---|
| Image diffusion | `flux1-dev.safetensors` | `black-forest-labs/FLUX.1-dev` (gated) | `models/unet/` | FLUX.1-dev Non-Commercial License — open weights, not OSI |
| Text encoders (FLUX) | `clip_l.safetensors`, `t5xxl_fp8_e4m3fn.safetensors` | `comfyanonymous/flux_text_encoders` | `models/clip/` | per-repo terms |
| Image VAE | `ae.safetensors` | `black-forest-labs/FLUX.1-dev` | `models/vae/` | as FLUX.1-dev |
| Identity | `pulid_flux_v0.9.1.safetensors` | `guozinan/PuLID` | `models/pulid/` | research weights, per-repo terms |
| Face analysis | InsightFace `antelopev2` | auto-downloaded by the node pack at first run | node-managed | per InsightFace terms |
| Identity vision encoder | EVA02-CLIP-L-14-336 | bundled with ComfyUI-PuLID-Flux | node-managed | per-repo terms |
| Video diffusion | `ltxv-13b-0.9.8-distilled-fp8.safetensors` | `Lightricks/LTX-Video` | `models/checkpoints/` | LTX-Video license (open weights) |
| Text encoder (LTX) | `t5xxl_fp16.safetensors` | `comfyanonymous/flux_text_encoders` | `models/clip/` | per-repo terms |

**Custom node packs: exactly one** — `ComfyUI-PuLID-Flux`
(github.com/iFayens/ComfyUI-PuLID-Flux; hardened forks exist). Everything else is
ComfyUI core. No partner/API nodes (no `ComfyUI` partner endpoints, no external
generation services) appear in any workflow — that is what keeps the build inside
the Open Weights lane.

**Quality variant (documented, not default):** swap the LTX checkpoint for the
full `ltxv-13b-0.9.8-dev.safetensors`, set `LTXVScheduler.steps` to 30 and
`SamplerCustom.cfg` to 3.5. Slower, heavier, finer motion.

## 3. Workflow graphs

All files are ComfyUI **API-format** prompts (node-id → `{class_type, inputs}`).
Link inputs are `[node_id, output_index]`. The app patches inputs by node id;
the patch map is also documented at the top of `app/app.js`.

### 3.1 `workflows/cast_card_flux.json` — create an identity
| Node | Class | Key inputs |
|---|---|---|
| 1 | `UNETLoader` | `flux1-dev.safetensors` |
| 2 | `DualCLIPLoader` | clip_l + t5xxl_fp8, type `flux` |
| 3 | `VAELoader` | `ae.safetensors` |
| 4 | `CLIPTextEncode` | portrait prompt (app-patched) |
| 5 | `FluxGuidance` | guidance 3.5 |
| 6 | `CLIPTextEncode` | negative (empty — FLUX convention) |
| 7 | `EmptySD3LatentImage` | 832×1216 portrait |
| 8 | `KSampler` | euler / simple, 20 steps, cfg 1.0, seed = hash(name+description) |
| 9 | `VAEDecode` | |
| 10 | `SaveImage` | `libertycut/cast_<name>` |

Deterministic seed per (name, description) so a cast card is reproducible.

### 3.2 `workflows/keyframe_flux_pulid.json` — one shot, identity locked
Loaders 1–3 as above, plus:
| Node | Class | Key inputs |
|---|---|---|
| 4 | `PulidFluxModelLoader` | `pulid_flux_v0.9.1.safetensors` |
| 5 | `PulidFluxInsightFaceLoader` | provider `CUDA` (`CPU` on low-VRAM) |
| 6 | `PulidFluxEvaClipLoader` | — |
| 7 | `LoadImage` | cast card (app-uploaded input name) |
| 8 | `ApplyPulidFlux` | model ← 1, image ← 7, weight **0.85**, start 0.0, end 1.0, fusion `mean` |
| 9 | `CLIPTextEncode` | shot scene prompt (app-patched) |
| 10 | `FluxGuidance` | 3.5 |
| 12 | `EmptySD3LatentImage` | 1216×704 (shot frame) |
| 13 | `KSampler` | model ← **8 (PuLID-patched)**, 20 steps, seed per shot |
| 15 | `SaveImage` | `libertycut/keyframe_<n>` |

Identity strategy, stated plainly: PuLID injects the cast card's face embedding
into FLUX's sampling; it is the strongest open ID-injection for FLUX, but it is a
bias, not a guarantee — extreme angles and heavy occlusion still drift. The demo
script is written around shots where the face is visible.

### 3.3 `workflows/shot_ltx_i2v.json` — animate a keyframe
| Node | Class | Key inputs |
|---|---|---|
| 1 | `CheckpointLoaderSimple` | `ltxv-13b-0.9.8-distilled-fp8.safetensors` → MODEL, VAE |
| 2 | `CLIPLoader` | `t5xxl_fp16.safetensors`, type `ltxv` |
| 3 / 4 | `CLIPTextEncode` | motion prompt (app-patched) / negative |
| 5 | `LoadImage` | keyframe (app-uploaded) |
| 6 | `LTXVImgToVideo` | 768×512, length 8n+1 (49/97/193), strength 1.0 |
| 7 | `LTXVConditioning` | frame_rate 24 |
| 8 | `LTXVScheduler` | steps 8 (distilled), max_shift 2.05, base_shift 0.95, stretch, terminal 0.1 |
| 9 | `KSamplerSelect` | `euler` |
| 10 | `SamplerCustom` | cfg 1.0 (distilled), noise_seed per shot |
| 11 | `VAEDecodeTiled` | tile 512, overlap 64, temporal 64/8 |
| 12 | `CreateVideo` | 24 fps |
| 13 | `SaveVideo` | mp4 / h264, `libertycut/shot_<n>` |

**Camera moves** are prompt-level: the app appends one fixed camera phrase per
preset ("the camera slowly pushes in toward the subject", pan/orbit/pull-back/
locked-off). "Matched" means the same preset phrase is applied verbatim wherever
that move is chosen — LTX follows natural-language camera direction; there is no
separate camera-control model in the graph, and the spec does not pretend
otherwise.

### 3.4 `workflows/relight_flux_pulid_img2img.json` — Relight & Hour
Same loader/PuLID block as 3.2, plus `LoadImage` (16) for the source keyframe →
`VAEEncode` (17) → `KSampler` latent input, **denoise 0.55** (structure and
composition survive; light and palette are re-drawn). Prompt = original scene
text + an hour block (dawn: cool blue-grey, mist, long shadows; noon: hard direct
sun; dusk: golden-hour amber). The relit still is then animated by workflow 3.3
with the original shot's camera preset.

## 4. UI spec (`app/`)

Single page, four sections, no build step, no framework:
1. **Cast** — name + description → cast card grid; click selects the active member;
   cards persist as ComfyUI input uploads for the session.
2. **Ensemble Continuity** — dynamic shot rows (cast select, scene textarea,
   camera preset, length 49/97/193 frames); *Render scene* runs the per-shot loop
   with a live log, then assembles via `/assemble` and embeds the scene player.
   Starter content = the "Night Market" example (3 shots).
3. **Relight & Hour** — shot picker + dawn/noon/dusk toggle → relit still + video.
4. **Gallery** — every artefact produced this session (cards, keyframes, shots,
   relights), newest first, served from ComfyUI `/view`.

Header shows a live ComfyUI connection pill (`/api/health` → `/system_stats`,
device name; flags missing ffmpeg). All state is in-memory; a page reload starts
a fresh session (outputs remain in ComfyUI's output folder).

## 5. Run requirements

**Standard (shipped defaults):** NVIDIA GPU ≥ 16 GB VRAM; ComfyUI current;
Python 3.10+; ffmpeg for assembly; ~45 GB disk for weights. FLUX at 1216×704 and
LTX fp8 at 768×512×97 are sized for this class of card.

**Low-VRAM (12 GB class):** `--lowvram` launch flag; LTX stays on the distilled
fp8 checkpoint at 49–97 frames; tiled VAE decode is already the graph default;
PuLID face analysis on CPU; keyframes may drop to 1024×576. *Status: documented
community practice for these models — not benchmarked by the authors (see
BUILD_LOG.md).*

**This build machine:** no GPU, no ComfyUI — authoring + static validation only.
First execution is a parent-agent step on a GPU host (see BUILD_LOG next steps).

## 6. Repo structure

```
SPEC.md                  this file (project root, outside the repo)
BUILD_LOG.md             verification ledger (project root)
repo/
  LICENSE                MIT (code)
  README.md              pitch + 10-minute quickstart + honest status
  DEMO.md                ≤2:00 demo script
  app/                   index.html · styles.css · app.js · server.py
  workflows/             cast_card_flux.json · keyframe_flux_pulid.json
                         relight_flux_pulid_img2img.json · shot_ltx_i2v.json
  examples/              README.md (Night Market) · cast/ shots/ final/ (empty)
```

## 7. Risks & open verifications (honest list)

1. **Nothing has been executed.** No GPU/ComfyUI on the build box; first run may
   surface input-name drift (see 2–4). Mitigation: graphs follow the node pack's
   published `INPUT_TYPES` and ComfyUI core's LTX example structure.
2. **PuLID node-pack version variance.** `ApplyPulidFlux`'s `fusion` input exists
   in current builds of the pack; on an older build that rejects it, delete the
   `fusion` line from the two PuLID workflows. Loader class names also differ
   across forks (`PulidFlux*` family is the current one).
3. **SaveVideo history key.** The app classifies outputs by file extension across
   all history output arrays, so `images` vs `videos` key naming differences
   across ComfyUI builds do not break it.
4. **LTX-2 vs LTX-Video naming.** The graph deliberately targets the LTX-Video
   13B (0.9.8) core-node surface — the most widely installed open LTX stack.
   LTX-2 (Gemma-encoded, GGUF) is a documented future swap, not claimed here.
5. **Identity drift** on extreme angles/occlusion (see 3.2) — a model limit,
   disclosed rather than hidden.

## 8. Demo plan (summary; full script in `repo/DEMO.md`)
Cold-open on the finished scene → cast card creation → shot list render →
keyframe/animate cuts → assembled scene + face-match beat → dawn relight →
model/repo montage → closing line "built on open weights." Target 1:50.
