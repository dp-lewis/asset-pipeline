---
name: game-asset
description: Turn a game asset idea into a 3D model using the `asset` CLI (OpenAI concept art → turnaround views → Tripo 3D). Use when the user asks to make, design or model a game asset, prop, character or creature for a game repo that has an asset.config.yaml, or mentions concept art, turnarounds or Tripo.
---

# Game asset pipeline

You drive the `asset` CLI to take one asset from idea to model, stopping for the user's approval at each creative step. The user makes the creative decisions; you handle prompting, waiting, reviewing images, filing and cost tracking.

## Before you start

1. Check you're in a game repo: look for `asset.config.yaml` here or in a parent folder. If there isn't one, offer to run `asset init --game "<name>"` and help edit the style text. Don't continue without it.
2. Read `asset.config.yaml` so you know the game's style, polygon budget and export format.
3. Run `asset refs`. If there are no style references, tell the user. Results are much more consistent when their approved concept art or video frames are in the concept folder. Offer to continue anyway.
4. Run `asset status` to see existing assets, so you don't duplicate one and can match naming.

If `asset` isn't found, the user hasn't run `npm link` in the asset-pipeline repo. Tell them.

## The flow

### 1. Create the asset
Pick a short kebab-case name and a concrete description. Include size, materials, condition and anything that matters for the silhouette.
```
asset new stone-wall "mossy dry-stone wall section, about 2m long, waist height"
```
Ask a quick question only if something essential is missing, such as scale or how weathered it is.

### 2. Concept drafts — CHECKPOINT
```
asset concept stone-wall
```
**Look at every draft with the Read tool before showing the user.** Then show the user the images and give a short critique of each, focused on what matters for 3D:
- Is the whole object visible and uncropped, on a plain background?
- Is it a single object, with no extra props?
- Is the silhouette readable, without ambiguous overlapping parts?
- Is it consistent with the style references?
- Will it model cleanly? Thin wires, transparency, fur, foliage and very fine detail are hard for Tripo.

Then **stop and ask** which draft to approve, or what to change. Don't approve on the user's behalf.

- To revise a draft: `asset concept stone-wall --revise r1-2 --feedback "less moss, flatter top"`
- For a fresh round with lasting direction: `asset concept stone-wall --note "drier, more lichen than moss"`
- To approve: `asset approve stone-wall r2-1`

### 3. Turnaround — CHECKPOINT
```
asset turnaround stone-wall
```
Read all four views and check them against the approved concept and each other:
- Is it the same object in every view: proportions, colour, materials, details?
- Is each view actually the stated angle? Watch for left and right being swapped or the same image.
- Is it centred, uncropped, on a plain background, without strong shadows?

Show the user the views with your assessment. Redo any weak view before asking for approval:
```
asset turnaround stone-wall --view left --note "the wall end should show stacked stones, not a cut face"
```
Then **stop and ask** the user to approve. On a yes: `asset approve stone-wall`.

### 4. Model — COST CHECKPOINT
```
asset estimate stone-wall
```
Tell the user the estimated credits and dollar cost, plus anything notable about the settings (format, face limit, quad, smart mesh). Smart mesh (`smartLowPoly`) is on by default for cleaner topology. If a task fails on a very complex asset, suggest turning it off. **Wait for an explicit go-ahead.** Then:
```
asset model stone-wall --yes
```
This takes a few minutes. When it finishes, report where the model went and what it cost.

If the Blender MCP tools are available, offer a quick check: import the file, report triangle count, dimensions and orientation, and render a thumbnail.

If it fails part-way (network, download), run `asset model <name> --yes` again. It resumes the existing Tripo task rather than paying twice. If the error says the Tripo task itself failed, tell the user, then with their OK run `asset model <name> --yes --restart` to start a fresh task.

## Batches
When the user lists several assets, create them all and generate concepts for each. Present them together for approval in one pass, then do turnarounds together. Get a single cost approval covering all the modelling (show the total) before running `asset model` for each.

## Ground rules
- Never pass `--yes` to `asset model` without the user's explicit approval in this conversation for this asset (or batch).
- Never pass `--force` unless the user asks. `--restart` needs the same approval as `--yes`.
- Never edit files under the concept folder. Those are the user's art.
- Keep the user's creative feedback in their words when passing `--feedback` or `--note`.
- Vegetation (trees, bushes, grass) is a poor fit for Tripo. Suggest a Blender-based approach instead of spending credits.
- `asset status` shows spend per asset if the user asks what things have cost.

## Command reference
| Command | Does |
|---|---|
| `asset init [--game name]` | Set up a game repo: config, concept/assets/output folders |
| `asset new <name> <description>` | Create an asset |
| `asset concept <name> [-n 3] [--note ..] [--revise r1-2 --feedback ..]` | Concept drafts |
| `asset approve <name> <draft>` | Approve a concept draft |
| `asset turnaround <name> [--view left back] [--note ..]` | Generate or redo views |
| `asset approve <name>` | Approve the turnaround |
| `asset estimate <name>` | Tripo credit estimate |
| `asset model <name> --yes [--restart]` | Generate, convert, download and copy to output |
| `asset status [name] [--json]` | Stages, file paths, spend |
| `asset balance` | Tripo credit balance |
| `asset refs` | Style references in use |

Set `ASSET_PIPELINE_MOCK=1` to rehearse the whole flow with fake providers at no cost.
