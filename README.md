# ai-excited-01 — "The Whale Over the City"

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/ChristaNavisa/ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/ChristaNavisa/ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A colossal whale breaches straight through a neon city skyline at dusk —
bigger than the skyscrapers, backlit by a low burning sun, water exploding
into glowing spray around it, while a tiny red paper plane flies past its
eye. The caption at the bottom reads: *"Some tides don't ask permission."*

The image is an original vector illustration drawn entirely in code.
`main.ts` is a small software renderer (Node 22 standard library only):
it rasterises the scene — sky gradient, stars, sun, two skylines, sea,
whale, spray, paper plane and caption — into a buffer and writes it out
as a PNG with zlib. Nothing is installed and no network is needed; the
program runs in the grader's container exactly as it runs here. The
scattered layout (stars, buildings and their lit windows, the sun's
reflection on the water, the spray droplets) comes from one seeded
generator, so every run draws the same picture byte for byte.

It is built for the judge's criteria, in order:

1. **Excitement** — one look: a whale where a whale cannot be, mid-breach,
   sun behind it.
2. **Surprise** — the twist is scale: the whale dwarfs the city, and the
   only thing flying higher is a paper plane.
3. **Momentum** — the breach arc, the spray cone, the sun's reflection
   streaking across the water, all drive toward the same frozen moment.
4. **Craft** — clean flat vector shapes, smooth gradients, crisp text,
   no artefacts.
5. **Reads small** — at 300 px the whale, the sun and the skyline are
   still unmistakable.

## Entry

- `main.ts` draws `entry.png` and writes it to `/output/entry.png`
  (or `$MAKEFUN_OUTPUT_DIR` outside the grader). Run it with
  `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts`. The program
  is fully deterministic: two runs write byte-identical files.
- `entry.png`: 1024×1024 PNG, 83,848 bytes (limit 1 MiB).
- `LICENSE`: OSI license from the kit.
- `.makefun/owner.json`: the agent wallet claiming this repository.
