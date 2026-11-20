#!/usr/bin/env node
import { Command } from "commander";
import { loadEnv } from "./config.js";
import * as cmd from "./commands.js";

loadEnv();

const program = new Command();
program
  .name("asset")
  .description("Concept art → turnarounds → 3D models, via OpenAI images and Tripo 3D")
  .version("0.1.0");

program
  .command("init")
  .description("Set up asset-pipeline in the current game repo")
  .option("--game <name>", "game name")
  .option("--force", "overwrite an existing config")
  .action((o) => cmd.init(o));

program
  .command("new <name> <description...>")
  .description("Create an asset, e.g. asset new stone-wall \"mossy dry-stone wall section, 2m\"")
  .action((name: string, description: string[]) => cmd.newAsset(name, description.join(" ")));

program
  .command("concept <name>")
  .description("Generate concept drafts for an asset, styled by your concept/ folder")
  .option("-n, --drafts <n>", "number of drafts", (v) => parseInt(v, 10))
  .option("--note <text>", "extra direction to keep for this asset")
  .option("--revise <draft>", "revise an existing draft (e.g. r1-2) instead of starting fresh")
  .option("--feedback <text>", "what to change when revising")
  .action((name, o) => cmd.concept(name, o));

program
  .command("approve <name> [draft]")
  .description("Approve a concept draft (asset approve wall r1-2) or the turnaround (asset approve wall)")
  .action((name, draft) => cmd.approve(name, draft));

program
  .command("turnaround <name>")
  .description("Generate front/left/back/right views from the approved concept")
  .option("--view <views...>", "only (re)generate these views")
  .option("--note <text>", "extra direction for these views")
  .action((name, o) => cmd.turnaround(name, o));

program
  .command("estimate <name>")
  .description("Estimate the Tripo credits for modelling an asset")
  .option("--face-limit <n>", "override the config's faceLimit for this run")
  .action((name, o) => cmd.estimate(name, o));

program
  .command("model <name>")
  .description("Send the turnaround to Tripo, convert, download and copy to the output folder")
  .option("--yes", "confirm spending Tripo credits")
  .option("--force", "skip the turnaround-approved check")
  .option("--restart", "start a new Tripo task instead of resuming an unfinished one")
  .option("--face-limit <n>", "override the config's faceLimit for this run")
  .action((name, o) => cmd.model(name, o));

program
  .command("status [name]")
  .description("List assets, their stage and spend (or details for one asset)")
  .option("--json", "machine-readable output")
  .action((name, o) => cmd.status(name, o));

program.command("balance").description("Show your Tripo credit balance").action(() => cmd.balance());
program.command("refs").description("List the style reference images that will be used").action(() => cmd.refs());

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
