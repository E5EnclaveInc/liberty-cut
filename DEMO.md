# DEMO.md — "Liberty Cut" demo video script (target 1:50, hard cap 2:00)

Format: screen capture of the studio UI + the rendered clips, voiceover or
burned-in captions (captions written below so it works silent). Record at
1920×1080 after a full successful run of the "Night Market" example project
(see `examples/README.md`). Every shot below shows real output of the pipeline —
no mock renders.

| Time | On screen | Caption / VO |
|---|---|---|
| 0:00–0:08 | Cold open: the finished 3-shot scene plays (Mara at the stall → walking the market → laughing at the table). Freeze on her face in shot 3. | "Three shots. One woman. She doesn't exist — and she never changes her face." |
| 0:08–0:20 | Studio UI. Type Mara's description, click **Generate cast card**. Her portrait appears; click it to select. | "Liberty Cut is a cinematic studio that runs entirely on open weights. You start with a cast card — an original character, generated once." |
| 0:20–0:35 | The shot list: three rows, Mara assigned, camera moves visible (push-in / pan right / orbit). Click **Render scene**; log lines scroll. | "Write a shot list. Pick a camera move for each shot. The studio keyframes every shot with her identity locked in…" |
| 0:35–0:55 | Keyframes appear one by one, then the LTX animations. Cut between keyframe → moving shot for shots 1 and 2. | "…then animates them with LTX — open-weights video — following the camera direction you chose." |
| 0:55–1:10 | The assembled scene plays in the result player, all three shots back to back. Split-second side-by-side: her face from shot 1 vs shot 3. | "Same face, same jacket, three setups — assembled into one scene automatically." |
| 1:10–1:30 | Relight & Hour panel: select Shot 1, click **Dawn**. The night stall fades into the dawn version; the dawn clip animates. | "And when the scene needs a different hour — dawn, noon, dusk — it re-lights the shot with her identity re-locked. Not a filter. A re-render." |
| 1:30–1:45 | Quick montage: the workflow JSON in an editor, the model list (LTX / FLUX / PuLID), the GitHub repo page. | "No partner APIs. No subscription render farm. FLUX for stills, PuLID for identity, LTX for motion — every weight downloadable, every workflow in the repo." |
| 1:45–1:55 | Final scene replay (dawn shot into night shots), title card: **Liberty Cut**. | Closing line, on screen and spoken: **"Liberty Cut — built on open weights."** |

## Production notes
- Record the UI at 1× speed; trim waits in the edit, keep the render log visible
  at least once so the pipeline reads as real.
- If a render misbehaves on recording day, re-roll that shot's seed from the UI
  flow (edit the description slightly) rather than substituting any outside media.
- Post copy for the social share: lead with the cold-open scene, tag
  **#OpenSourceHiggsfield**, link the repo.
