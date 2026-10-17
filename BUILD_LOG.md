# Liberty Cut — Build Log

Build date: 2026-10-16 · Builder: subagent (local files only — nothing submitted,
pushed, or posted; all external steps belong to the parent agent)
Deadline for the parent: **submission by Oct 30, 2026, 9:00 AM PT** (Typeform).

## Environment findings (this machine, checked firsthand)

| Check | Result |
|---|---|
| `which comfy` / `which comfyui` | **not installed** |
| ComfyUI at common paths (`~/ComfyUI`, `/opt`, workspace, `find ~ -maxdepth 4`) | **none found** |
| pip packages matching comfy/torch | **none** |
| `nvidia-smi` | **absent — no NVIDIA GPU on this box** |
| CPU / RAM | 2 cores / 7.7 GB |
| Disk free | 37 GB (of 150 GB) |
| Python | 3.12.3 |
| Node | v24.20.0 (used for JS syntax check only) |
| ffmpeg | **8.1.2 present** — the `/assemble` path is real code against a real tool |
| jq | 1.7 |

**Consequence, stated plainly:** this box cannot run ComfyUI or any of the four
workflows. No model was downloaded (37 GB free < ~45 GB of weights, and no GPU
to run them on regardless). Every workflow below is **authored and statically
validated, not executed**. First execution must happen on a GPU host.

## What was verified (actually run, results observed)

1. **Workflow JSON validity** — all four files in `repo/workflows/` parse as
   JSON, and a link-integrity script confirmed every `[node_id, slot]` input
   reference resolves to an existing node. Zero dangling links.
   - `cast_card_flux.json` — 10 nodes
   - `keyframe_flux_pulid.json` — 15 nodes
   - `relight_flux_pulid_img2img.json` — 16 nodes
   - `shot_ltx_i2v.json` — 13 nodes
2. **Node-schema grounding** — node class names and inputs were cross-checked
   against published sources during the build (treated as data, not gospel):
   - LTX core structure (`CheckpointLoaderSimple` + `CLIPLoader` type `ltxv`,
     `LTXVImgToVideo`, `LTXVConditioning`, `LTXVScheduler` defaults
     2.05/0.95/true/0.1, `SamplerCustom`, `VAEDecodeTiled`, `CreateVideo`,
     `SaveVideo`) matches the official ComfyUI LTX example structure as
     documented in multiple public workflow repos; frame counts follow 8n+1.
   - PuLID-Flux node family (`PulidFluxModelLoader`, `PulidFluxInsightFaceLoader`
     provider CPU/CUDA/ROCm, `PulidFluxEvaClipLoader`, `ApplyPulidFlux` with
     model/pulid_flux/eva_clip/face_analysis/image/weight/start_at/end_at/fusion)
     matches the node pack's published `INPUT_TYPES` (weights file
     `pulid_flux_v0.9.1.safetensors`, InsightFace `antelopev2`).
   - FLUX block (`UNETLoader`, `DualCLIPLoader` type `flux`, `FluxGuidance` 3.5,
     `KSampler` euler/simple cfg 1.0) is the canonical ComfyUI FLUX.1-dev graph.
3. **App syntax** — `node --check app/app.js` passes; `python3 -m py_compile
   app/server.py` passes.
4. **App server smoke test** — `server.py` booted on port 8199 and served:
   `/` (index), `/app/app.js` (200), `/workflows/shot_ltx_i2v.json` (200);
   `/api/health` correctly reported `{"comfy": "unreachable", "ffmpeg": true}`
   (graceful degradation, exactly the expected state on this box);
   `/assemble` with an empty payload returned a clean 400 JSON error.
   Server stopped after the test.

## What is staged / UNVERIFIED (needs a GPU host)

- **All four workflows end-to-end.** No render of any kind has been produced.
  There are no example outputs yet — `repo/examples/` ships empty on purpose.
- **PuLID pack version drift.** `ApplyPulidFlux.fusion` is present in current
  builds of ComfyUI-PuLID-Flux; an older build may reject the extra input.
  One-line fix documented in SPEC.md §7. Loader class names are the
  `PulidFlux*` family; other forks name them differently.
- **`SaveVideo` / `CreateVideo` parameter details** (codec enum `h264`, format
  `mp4`) follow current core docs; the app is written defensively (outputs are
  classified by extension across all history keys) but the node inputs
  themselves are unexecuted.
- **`CLIPLoader` type `ltxv` + `t5xxl_fp16.safetensors`** pairing for the 13B
  checkpoint follows the published LTX example structure; unexecuted.
- **VRAM figures in README/SPEC** (16 GB recommended, 12 GB low-VRAM path) are
  sizing guidance from the models' published requirements and community
  practice — **not measurements**. No render time is claimed anywhere.
- **Identity-lock quality** (PuLID weight 0.85, relight denoise 0.55) are
  starting values from the PuLID workflow literature, untuned by any local run.

## Design decisions worth noting

- **LTX-Video 13B (0.9.8), not LTX-2.x**, is the graph target: it runs on
  ComfyUI *core* nodes (zero extra packs beyond PuLID), which minimises
  install friction for judges and keeps the Open Weights lane clean. LTX-2 is
  named in SPEC.md as a future swap only.
- **One custom node pack total** (PuLID-Flux). No partner/API nodes anywhere.
- **Assembly lives in the app** (ffmpeg concat with re-encode) instead of a
  video-helper node pack — one less dependency, and it degrades gracefully
  (501 + gallery fallback) when ffmpeg is absent.
- **Cast cards are re-uploaded as ComfyUI inputs** after generation, so the
  pipeline works even when ComfyUI runs on a different host than the browser.
- Seeds are deterministic hashes of (character / shot) descriptors —
  reproducible casts and shots, which the demo recording will want.

## Next steps (parent agent)

1. On a GPU host (≥16 GB VRAM): follow `repo/README.md` quickstart; run the
   four workflows in order — cast card → keyframe → LTX shot → relight —
   and fix any input-name drift the first execution surfaces (log it here).
2. Run the full "Night Market" example; save artefacts into
   `repo/examples/{cast,shots,final}/` per `examples/README.md`.
3. Record the demo per `repo/DEMO.md` (≤2:00, closing line included).
4. Publish the repo publicly, post with **#OpenSourceHiggsfield**, and submit
   the Typeform **before Oct 30, 2026, 9:00 AM PT**.
5. If step 1 reveals the PuLID `fusion` input is rejected, remove that one
   line from the two PuLID workflows and note the pack version here.

---

## Appendix A — Lambda GPU run record (Fri Oct 16 – Sat Oct 17, 2026)

**Verdict: the run protocol's hypothesis is PROVEN.** All four authored
workflows executed end-to-end on real GPU and produced the complete
"The Night Market" example. Outputs are in `repo/examples/` and every file
was verified twice (ffprobe on the instance, ffprobe + `file` after
retrieval).

### Run facts

| | |
|---|---|
| Instance | `gpu_1x_a10` (NVIDIA A10, 24 GB), us-east-1, id `ff731b8ecebb4556ad0fd29700aa0ee2`, name `libertycut-render-01` |
| Live rate at launch | **$1.29/hr** (the pre-run estimate of ~$0.75/hr in RUN_PROTOCOL was stale; live `types` output governed) |
| Launched | 2026-10-16T23:49:40Z |
| Terminated | 2026-10-17T00:53:17Z — elapsed 63m37s; `lambda.py list` verified `(no instances)` afterward |
| Spend estimate | 1.06 hr × $1.29 ≈ **$1.37**, drawn on the account's NVIDIA Inception credit; cap was $20 |
| Access lane | Jupyter-over-HTTPS helpers from the local-lambda-cloud skill (this sandbox has no SSH egress). Terminate was the run's last step; no idle burn |
| Environment | Ubuntu 22.04, driver 580.126.09 / CUDA 13.0; ComfyUI cloned at HEAD; venv on system Python 3.10; torch 2.4.1+cu121. Weights: exactly the SPEC table, incl. the fp8 LTX file (`ltxv-13b-0.9.8-distilled-fp8.safetensors`, 15.59 GB) and the fp8 T5 encoder. FLUX VAE came from the public `ffxvs/vae-flux` mirror — the `black-forest-labs/FLUX.1-schnell` file first tried is token-gated (401) |

### What rendered (all in `repo/examples/`)

- `cast/mara.png`, `cast/theo.png` — 832×1216 PNG cast cards (FLUX bf16,
  ~40 s each on the A10). Mara's card is on-brief: deep brown skin, short
  natural hair, mustard-yellow work jacket.
- `shots/keyframe_1..3.png` — 1216×704 PuLID identity-locked keyframes.
- `shots/shot_1..3.mp4` — LTX-Video 13B fp8 image-to-video, h264 768×512,
  4.04 s each (97 frames @ 24 fps).
- `final/scene.mp4` — ffmpeg concat of the three shots, 12.125 s.
- `final/shot_1_dawn|noon|dusk.png` + `.mp4` — the Relight & Hour pass on
  shot 1 (composition and framing preserved; light/time-of-day changed),
  each still also animated.

### Honest quality note (for the demo step)

Identity lock is **inconsistent**: shot 2's keyframe clearly reads as Mara
(frontal, well-lit); shot 1's keyframe — three-quarter angle, dimmer face
light — does **not** hold her likeness (different face/hair read), and the
relight stills inherit that. The mechanism works; the fidelity is the
SPEC §3.2 "bias, not guarantee" caveat made visible. Levers for a tuning
pass before the demo is cut: raise the `ApplyPulidFlux` weight (workflow
default 0.85 → 1.0–1.1), re-roll shot 1's seed, or restage shot 1 with a
more frontal framing.

### Fixes applied on the instance (all folded back into `run/worker.sh`
and/or noted here so a from-scratch run reproduces the working stack)

1. **FLUX VAE source**: schnell repo is token-gated → switched worker.sh to
   the public `ffxvs/vae-flux` mirror of the same weights.
2. **numpy pin**: numpy 2.x broke the system scipy binary; venv pins
   `numpy==1.26.4`, and the pin is **re-applied after** the PuLID pack's
   requirements (which upgrade numpy again).
3. **Broken system egg-info**: `flatbuffers-1.12.1_git...egg-info` has an
   invalid version string that makes pip die on *any* install on this
   image; worker.sh moves it aside first.
4. **onnxruntime shadowing**: the pack's requirements install the CPU
   `onnxruntime`, which shadows the GPU build — InsightFace then has no
   `CUDAExecutionProvider`. Fix: uninstall both, install `onnxruntime-gpu`
   only, after the pack requirements; `facexlib` and
   `opencv-python==4.10.0.84` pinned in the same step.
5. **antelopev2 path**: InsightFace models belong at
   `<ComfyUI>/models/insightface/models/antelopev2/` (the pack's
   `INSIGHTFACE_DIR`); worker.sh path corrected. (The pack also
   auto-downloads the same set on first use.)
6. **ComfyUI core drift in `pulidflux.py`** (the pre-GPU risk register's
   "node input name drift", one level down): current core passes
   `timestep_zero_index` and `transformer_options` into the Flux forward
   pass, and the pack's hand-rolled `forward_orig` rejected both
   (`TypeError` at the KSampler for every keyframe). Shim: add
   `timestep_zero_index=None` and `**kwargs` to its signature — implemented
   as a patch step in worker.sh's SETUP_PULID and verified to reproduce the
   exact hand patch that unblocked the run. **The repo's workflow JSONs
   needed no changes** — all four matched the installed nodes as authored.
7. **First-keyframe CUDA OOM**: the first-ever PuLID run spiked past the
   A10's 22 GiB usable (FLUX bf16 + EVA-CLIP + InsightFace loading at once
   inside `ApplyPulidFlux`); later keyframes fit once the model cache
   settled. Shot 1 was completed by a top-up pass (`run/topup.py`, same
   prompts/seeds) against the warm server. On a cold single-pass run,
   expect the first keyframe to be the fragile one on 24 GB cards.

### What did not run

Nothing in scope failed permanently. Driver run 1 stopped at SETUP_PULID
(fixes 3–4), run 2 rendered the cast then hit fix 6, the top-up pass closed
shot 1, the assembly, and all three relights with `errors=0`. Full logs
preserved in `run/` (`run.log`, `render.log`, `comfy.log`).

### Remaining before the demo can be cut

Per `repo/DEMO.md`: record the ≤2:00 narrated walkthrough against the app
UI + these example outputs (the identity note above is the one creative
decision — ship as-is with the honest caveat, or spend one short tuning
run on shot 1 first). Then: publish the repo, make the tagged social post,
and file the Typeform — in that order, since the form needs the post link.
Deadline **Oct 30, 2026, 9:00 AM PT**.


---

## Appendix B — Shot-1 tuning pass (Sat Oct 17, 2026)

**Verdict: FIXED.** Shot 1 now holds Mara's likeness end-to-end — keyframe,
LTX shot, assembled scene segment, and all three Relight & Hour stills were
visually verified against `cast/mara.png` and the positive control
`shots/keyframe_2.png`. The Appendix A "ship as-is with the honest caveat"
option is no longer needed for shot 1; the demo can be cut on the tuned
outputs.

### What was tried (keyframe_flux_pulid, shot-1 prompt, Mara cast card)

Original pipeline seed for shot 1: `862008040` (driver's
`seed_from_string("shot:0:Mara:<prompt>")`); re-roll seed: `260391666`.

| Candidate | PuLID weight | Seed | Result |
|---|---|---|---|
| A | 1.05 | 862008040 | **Holds** — Mara's face, hair, skin; frontal at the stall |
| B | 1.10 | 862008040 | **Holds — WINNER.** Same framing as A; face reads closest to keyframe_2, strongest identity margin for the downstream LTX + img2img relights to inherit |
| C | 1.10 | 260391666 (re-roll) | Not rendered — KSampler died twice on a device mismatch ("Expected all tensors to be on the same device… cuda:0 and cpu") when ComfyUI's execution cache reused the PuLID-patched graph with only the seed changed. Not a likeness failure; unneeded once B won |

Candidates preserved in `run/tuning-candidates/`; the shipped
`shots/keyframe_1.png` is byte-identical to candidate B (sha256
`6a429dc4…`). Phase 2 regenerated from the approved candidate file itself
(no sampler re-roll): `shots/shot_1.mp4`, `final/scene.mp4` (shots 2 and 3
byte-unchanged), `final/shot_1_{dawn,noon,dusk}.png` + `.mp4`. The
relights' `ApplyPulidFlux` weight was also set to the winning 1.10 (same
identity lever; denoise 0.55 and the original relight seeds unchanged).
Pre-tuning originals backed up in `run/tuning-backup-2026-10-17/` with
checksums. Run record: `run/TUNING_REPORT.md`,
`run/tuning-2026-10-17/CAP_REGISTRATION.json`.

### Run facts

| | |
|---|---|
| Instance | `gpu_1x_a10` (24 GB), us-east-1, id `b96daea3b6814375aa8666138eb14003`, name `libertycut-tune-01` |
| Launched → terminated | 2026-10-17T15:47:45Z → 16:22:48Z (35m03s); `lambda.py list` verified `(no instances)` afterward |
| Cost | 0.584 h × $1.29/hr (instance-record rate) ≈ **$0.75** (the `types` list showed $1.69/hr at launch; at that rate $0.99). Project cumulative ≈ $2.12–$2.36 of the $20 cap |
| Wall times | setup+weights ≈ 5 min (worker raced ahead — see fix 8); candidates ≈ 1 min each once the stack was fixed; tune2 (keyframe place + LTX + assemble + 3 relights with clips) 16:13→16:19Z, errors=0 |

### Fixes / findings this run (fix-forward, in run order)

8. **Payload race**: worker.sh's WAIT_PAYLOAD keys on
   `~/lc/payload/workflows` alone, and setup finished before the staged
   upload did — tune1's auto-run died at 15:55:25Z on the not-yet-uploaded
   `cast/mara.png`. Recovery: relaunch the phase script manually once the
   payload is complete. Next run: upload `cast/` and `shots/` BEFORE
   `workflows/` (workflows are the start trigger).
9. **Appendix A fix 3 did not take effect under cloud-init**: the
   flatbuffers egg-info was still present when checked interactively, so
   every SETUP_PULID pip step failed with `invalid-installed-package`
   (worker.sh's `sudo -n mv … || true` failed silently in that context)
   and the PuLID pack never imported (`insightface` missing → /prompt
   HTTP 400 on all three candidates). Fix-forward: interactive
   `sudo mv` of the egg-info, re-run the pack requirements + fix-4 re-pin
   + insightface install, then the fix-4 shadow recurred in reverse
   (insightface pulled the CPU `onnxruntime` over the GPU build — no
   CUDAExecutionProvider): uninstall both, install `onnxruntime-gpu`
   only, verify providers, restart ComfyUI. Pack then imported clean.
10. **Lambda disables guest poweroff**: `shutdown -h +N` (armed in
    user_data and re-tried interactively) is refused platform-side —
    broadcast: "Shutdown/poweroff has been disabled. Terminate the
    instance in the Lambda Cloud web interface." The RENDER_LANE
    box-side self-destruct gate cannot be armed on Lambda; the operative
    guard was continuous supervision + terminate-on-completion (as in
    Appendix A). RENDER_LANE should be amended accordingly.
11. **Cap registration scope**: this run's registration was kept in-scope
    at `run/tuning-2026-10-17/CAP_REGISTRATION.json` (frozen
    RUN_PROTOCOL cap + $5 pass abort). The fleet nursery cap-watch store
    was not written (outside this run's file scope; the Oct 16 run never
    registered there either — its watchdog stays silent on unregistered
    pairs).

## Appendix C — Demo video run (Sat Oct 17, 2026)

Produced the competition demo per DEMO.md: `demo/liberty-cut-demo.mp4`,
**105.86 s, 1920×1080**, H.264 + AAC. Full record:
`demo/DEMO_REPORT.md`; run artifacts under `run/demo-2026-10-17/`.

- **Capture: LIVE, not the playback fallback.** The studio app ran on
  the instance (gpu_1x_a10 us-east-1, `c19331c67d194b1b8155721f324f5fff`,
  `libertycut-demo-01`) and was driven by Playwright/Chromium at
  1920×1080 with recordVideo through every DEMO.md beat; all renders in
  the capture (cast, 3 keyframes, 3 LTX clips, scene, dawn relight
  still + clip) were produced by the pipeline during the recorded
  session (22 beats; the payload workflows carry the tuning pass's
  winning PuLID weight 1.10, as disclosed in the report). Edit inserts
  are the shipped `repo/examples/` media, per DEMO.md's design.
- **VO: Ebony's canonical clone** (ElevenLabs "Eden"), DEMO.md lines
  verbatim; a Scribe pass over the finished file's audio returned the
  script word-for-word. Captions burned in verbatim from DEMO.md.
- **Spend:** ≈69 min ≈ **$1.47** this pass; project cumulative
  ≈ **$3.83**. Instance terminated; `lambda.py list` verified
  `(no instances)`.
- **Four defects found and fixed forward** (details in DEMO_REPORT):
  (1) `app/index.html` asset paths 404'd in a real browser — fixed in
  repo (`app/styles.css`, `app/app.js`); (2) ComfyUI 0.41's origin
  check 403s the studio proxy's POSTs — fixed in repo `server.py`
  (Origin/Referer no longer forwarded); (3) the flatbuffers egg-info
  is a **directory** on this image, so worker.sh's `[ -f … ]` move
  never ran — guard changed to `-e` in worker.sh; the Appendix B
  insightface→CPU-onnxruntime shadow recurred (install order), and
  the `--system-site-packages` venv silently used the system
  egg-info torch whose NumPy bridge fails under both NumPy 1.26.4 and
  2.x — instance fixed with `pip install --ignore-installed
  torch==2.7.0 torchvision==0.22.0 torchaudio==2.7.0`; (4) ComfyUI
  0.41's model cache OOMs the cast→keyframe sequence on the A10 —
  the capture ran ComfyUI with `--cache-none` (clean-slate preflight
  passed first).
- **Known capture limitation:** the open-source Chromium cannot decode
  H.264, so the recorded page's gallery video tiles are dark (the
  player itself displays the scene); the edit cuts to the real clips
  full-screen at those beats, as DEMO.md designs.
- Nothing published; repo push, the Chairman's post, and the Typeform
  remain the next step, untouched.
