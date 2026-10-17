# Example project — "The Night Market"

The demo project the studio loads as its starter shot list. A three-shot scene
built to show the one thing closed tools charge for: **the same invented person,
recognisably herself, across every shot** — then the same scene re-lit at dawn.

## The cast (both original and fictional, generated from these descriptions)

- **Mara** — "a woman in her early thirties with deep brown skin and short natural
  hair, calm confident expression, wearing a mustard-yellow work jacket"
- **Theo** — "a man in his fifties with silver-streaked locs and a neat grey beard,
  warm grin, wearing a dark teal apron over a black shirt"

## The shot list (as pre-filled in the studio)

| # | Cast | Camera | Scene |
|---|------|--------|-------|
| 1 | Mara | Slow push-in | A night-market food stall strung with warm bulbs, steam rising from a grill; she turns and smiles at a friend off camera. Teal and amber palette. |
| 2 | Mara | Pan right | She walks between stalls carrying a paper tray of food; vendors and lanterns pass behind her. |
| 3 | Mara | Slow orbit | Close on her laughing at a shared table, string-light bokeh behind her, friends' hands passing dishes across the frame. |

Then: **Relight & Hour** on Shot 1 → dawn. Same woman, same stall, first light.

## Where outputs land

This folder ships empty on purpose — no pre-rendered media is bundled, and no
output in this project is claimed before it exists. After your first run on a
GPU machine, save the artefacts here:

```
cast/    mara.png, theo.png            (cast cards)
shots/   shot_1.mp4 … shot_3.mp4       (rendered shots)
final/   scene.mp4                     (assembled scene from /assemble)
         shot_1_dawn.mp4               (the relight pass, animated)
```

The demo video script that walks through exactly this project is in `../DEMO.md`.
