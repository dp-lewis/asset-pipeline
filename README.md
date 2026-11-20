# asset-pipeline

Concept art → turnarounds → 3D models, from the command line.

The `asset` CLI uses OpenAI image generation for asset concepts and front/left/back/right turnarounds, styled from your game's own concept art. It then sends the turnaround to Tripo's multiview-to-model API, converts the result to FBX or GLB, and drops it in your game repo. A Claude Code skill (`game-asset`) sits on top: you describe the asset, Claude runs the steps and reviews the images, and stops for your approval at each stage.

```
your concept art (ChatGPT / OpenArt)  ──►  art/concept/   (style references, manual)
                                               │
asset new  ──►  asset concept  ──►  approve  ──►  asset turnaround  ──►  approve  ──►  asset model
                 (3 drafts)       (you pick)      (4 views)          (you check)    (Tripo → FBX)
```

## Setup (once)

```bash
git clone https://github.com/dp-lewis/asset-pipeline.git
cd asset-pipeline
npm install          # also builds
npm link             # puts `asset` on your PATH
cp .env.example .env # then add your keys
./scripts/install-skill.sh   # links the Claude Code skill into ~/.claude/skills
```

Keys:
- **OpenAI**: platform.openai.com → API keys. API usage is billed separately from ChatGPT Plus. Your organisation may need verifying before GPT Image models work.
- **Tripo**: platform.tripo3d.ai → API Keys. New API accounts get 2,000 free credits; after that, credits are US$0.01 each.

The `.env` file is read from the current folder, then `~/.config/asset-pipeline/.env`, then this repo.

## Set up a game

In the game repo, for example `sheepgame-unreal`:

```bash
asset init --game "Away to Me"
```

This creates:

```
asset.config.yaml   style text, image quality, polygon budget, export format
art/concept/        put your approved concept art and video frames here
art/assets/         one folder per asset (asset.yaml, drafts, concept, turnaround, model)
art/models/         finished models, ready to import
```

and adds `art/assets/*/drafts/` to `.gitignore`. Consider Git LFS for models: `git lfs track "*.fbx" "*.glb"`.

Edit `asset.config.yaml`. The `style` text and the images in `art/concept/` are what keep assets consistent.

## Day to day

**With Claude** (recommended): open Claude Code in the game repo and ask.

> Make a mossy dry-stone wall section for the sheep game, about 2m long.

Claude creates the asset, generates drafts and critiques them, and waits for your pick. It then makes the turnaround, checks the views match, tells you the Tripo cost and waits for your go-ahead before modelling.

**By hand:**

```bash
asset new stone-wall "mossy dry-stone wall section, about 2m long, waist height"
asset concept stone-wall                                  # 3 drafts in art/assets/stone-wall/drafts/
asset concept stone-wall --revise r1-2 --feedback "less moss, flatter top"
asset approve stone-wall r2-1
asset turnaround stone-wall                               # front, left, back, right
asset turnaround stone-wall --view left --note "show the end stones"
asset approve stone-wall
asset estimate stone-wall
asset model stone-wall --yes                              # → art/models/stone-wall.fbx
asset status
```

Every step is logged in the asset's `asset.yaml`: your feedback notes, Tripo task IDs, OpenAI cost and Tripo credits. `asset status` totals spend across assets.

## Costs (November 2026)

| Step | Typical cost |
|---|---|
| Concept draft, medium quality 1024² | ~US$0.05 each |
| Turnaround (4 views) | ~US$0.20–0.25 |
| Tripo multiview, standard texture | 30 credits (US$0.30) + a few for conversion |
| **Typical asset** | **~US$0.75** |

Use `quality: high` and `textureQuality: detailed` for hero assets, at roughly double the cost.

## Rehearse for free

```bash
ASSET_PIPELINE_MOCK=1 asset concept stone-wall
npm run smoke        # whole flow in a scratch folder with fake providers
npm test
```

## Notes

- Tripo model download URLs expire about 5 minutes after a task finishes, so the CLI downloads straight away. If something fails part-way, `asset model <name> --yes` resumes the same task, and `--restart` starts a fresh one.
- `quad: true` forces FBX output on Tripo's side.
- Vegetation is a weak spot for Tripo. Use Blender for trees and bushes.
- Tripo API reference: developers.tripo3d.com (v3, `https://openapi.tripo3d.ai/v3`).
