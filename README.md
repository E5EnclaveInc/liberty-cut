# Liberty Cut

**A cinematic studio built entirely on open weights.** Create a cast of original,
fictional characters, lock each one's face across a whole shot list, animate the
shots with matched camera moves, re-light any shot at a different hour — and never
call a partner API to do it.

- **Video:** LTX-Video 13B (Lightricks, open weights) via native ComfyUI nodes
- **Stills:** FLUX.1-dev (Black Forest Labs, open weights)
- **Identity:** PuLID-Flux (open research weights) — the same cast card drives every shot
- **Interface:** a small web studio over the ComfyUI API (no node-graph spelunking)

> **Verification status — read this first.** Every workflow in this repo has been
> executed end-to-end. The example project in `examples/` ("The Night Market") is
> real pipeline output, rendered on a single NVIDIA A10 (24 GB) cloud instance:
> cast cards, PuLID-locked keyframes, LTX shots, the assembled scene, and the
> dawn/noon/dusk relights. The studio app was driven live in a browser to capture
> the demo video. Character identity was tuned in a measured pass (PuLID weight
> 1.10, selected against the shipped keyframes); see `BUILD_LOG.md` for the honest
> line-by-line record, including what failed and what it cost (≈$4 of cloud GPU
> across all runs). The low-VRAM path below is documented practice for these
> models and is **not** a configuration we have benchmarked. Model licenses: the
> code in this repo is MIT; the model weights carry their publishers' licenses
> (FLUX.1-dev is a non-commercial open-weights license; LTX-Video and PuLID
> carry their own terms) — check them before commercial use.

## The two modes

### 1 · Ensemble Continuity (flagship)
1. **Cast cards.** Describe an original character; Liberty Cut renders a portrait
   "cast card" (FLUX txt2img) that becomes that character's identity reference.
2. **Shot list.** Write 3+ shots, assign cast members, pick a camera move per shot
   (locked-off, push-in, pull-back, pan, orbit) and a length (≈2 s / 4 s / 8 s).
3. **Render.** Each shot is keyframed with FLUX + PuLID (identity locked to the
   cast card), animated by LTX image-to-video with your camera direction, and the
   finished shots are assembled into one scene MP4 with ffmpeg.

### 2 · Relight & Hour
Pick any rendered shot and re-light its keyframe at **dawn, noon, or dusk** —
FLUX img2img at moderate denoise with the identity re-locked by PuLID — then
animate the new hour with the shot's original camera move.

## Quickstart (about 10 minutes, once models are downloaded)

### 0. Requirements
- **NVIDIA GPU, 16 GB VRAM recommended** for the shipped defaults
  (1216×704 keyframes; 768×512 × 97-frame LTX shots). Low-VRAM path (12 GB)
  in the next section — it is documented practice for these models, **not**
  a configuration we have benchmarked.
- ComfyUI (recent build; the workflows use native nodes including `CreateVideo` /
  `SaveVideo`), Python 3.10+, ffmpeg on PATH (for scene assembly only).
- ~45 GB free disk for weights.

### 1. Install ComfyUI and the one custom node pack
```bash
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI && pip install -r requirements.txt

cd custom_nodes
git clone https://github.com/iFayens/ComfyUI-PuLID-Flux   # PuLID-Flux nodes
cd .. && pip install -r custom_nodes/ComfyUI-PuLID-Flux/requirements.txt
```
Everything else — LTX, FLUX, sampling, video save — is native ComfyUI.

### 2. Download the weights (all open; some repos are click-through gated)
| File | Goes in | Source |
|---|---|---|
| `flux1-dev.safetensors` | `models/unet/` | Hugging Face `black-forest-labs/FLUX.1-dev` |
| `clip_l.safetensors` | `models/clip/` | Hugging Face `comfyanonymous/flux_text_encoders` |
| `t5xxl_fp8_e4m3fn.safetensors` | `models/clip/` | same repo |
| `ae.safetensors` | `models/vae/` | Hugging Face `black-forest-labs/FLUX.1-dev` (`ae.safetensors`) |
| `pulid_flux_v0.9.1.safetensors` | `models/pulid/` | Hugging Face `guozinan/PuLID` |
| `ltxv-13b-0.9.8-distilled-fp8.safetensors` | `models/checkpoints/` | Hugging Face `Lightricks/LTX-Video` |
| `t5xxl_fp16.safetensors` | `models/clip/` | Hugging Face `comfyanonymous/flux_text_encoders` |

InsightFace's `antelopev2` face-analysis models download automatically the first
time a PuLID workflow runs (the node pack fetches them); EVA-CLIP ships with the pack.

### 3. Start ComfyUI
```bash
python main.py --listen 127.0.0.1 --port 8188
```

### 4. Start the studio
```bash
cd liberty-cut
python3 app/server.py        # http://127.0.0.1:8190
```
Open the URL, wait for the green "ComfyUI connected" pill, create a cast card,
write three shots, render. The studio talks to ComfyUI through its own proxy
(`/comfy/…`), so no CORS flags are needed. Set `COMFY_PORT` / `PORT` env vars
if your ports differ.

### Low-VRAM path (12 GB class cards)
- Launch ComfyUI with `--lowvram`.
- Swap the LTX checkpoint to the same distilled fp8 file (already the default)
  and keep LTX shots at 768×512, 49–97 frames.
- The LTX workflow already decodes with `VAEDecodeTiled` (tile 512, temporal 64).
- Set the PuLID InsightFace loader's `provider` to `CPU` in
  `workflows/keyframe_flux_pulid.json` / `relight_flux_pulid_img2img.json`
  if face analysis competes for VRAM.
- Keyframes at 1216×704 fit comfortably; if you still OOM, drop
  `EmptySD3LatentImage` to 1024×576.

### Running the workflows without the studio
Each file in `workflows/` is a ComfyUI **API-format** prompt — POST it to
`http://127.0.0.1:8188/prompt`, or load it in the ComfyUI UI via
*Settings → Enable Dev Mode → Open (API format)*. Node ids patched by the
studio are documented at the top of `app/app.js`.

## Repo structure
```
app/         the studio: index.html, styles.css, app.js, server.py (stdlib only)
workflows/   API-format ComfyUI workflows (see SPEC.md for graphs)
examples/    the demo project — "The Night Market" (see examples/README.md)
LICENSE      MIT (code) — model weights keep their publishers' licenses
```

## Characters & likenesses
Cast members are **original, fictional people generated by the models** from text
descriptions. Liberty Cut is built for invented casts; do not point it at a real
person's photograph or likeness.

## Built for
The Comfy "Open Source Higgsfield" challenge — an open rebuild of the closed,
subscription cinematic-studio pattern, on open weights only. #OpenSourceHiggsfield
