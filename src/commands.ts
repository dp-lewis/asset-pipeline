import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_FILE,
  PACKAGE_ROOT,
  VIEWS,
  isMock,
  loadProject,
  withFaceLimit,
  type Project,
  type View,
} from "./config.js";
import {
  abs,
  addLog,
  assetDir,
  createAsset,
  listAssets,
  loadAsset,
  rel,
  saveAsset,
  totals,
  type Asset,
} from "./assets.js";
import { IMAGE_EXTS, MockImages, OpenAIImages, type ImageProvider } from "./images.js";
import { MockTripo, TripoClient, primaryModelUrl, waitForTask, type ModelProvider } from "./tripo.js";
import { conceptPrompt, revisePrompt, turnaroundPrompt } from "./prompts.js";
import { estimateImageUsd, estimateTripoCredits, usd } from "./costs.js";

const say = (msg = "") => console.log(msg);
const images = (p: Project): ImageProvider => (isMock() ? new MockImages() : new OpenAIImages(p.config));
const tripo = (): ModelProvider => (isMock() ? new MockTripo() : new TripoClient());

/** Style reference images from the concept folder, newest names last, capped. */
export function references(p: Project): string[] {
  if (!fs.existsSync(p.conceptDir)) return [];
  return fs
    .readdirSync(p.conceptDir)
    .filter((f) => IMAGE_EXTS.includes(path.extname(f).toLowerCase()))
    .sort()
    .slice(0, p.config.image.maxReferences)
    .map((f) => path.join(p.conceptDir, f));
}

// ---------------------------------------------------------------- init

export function init(opts: { game?: string; force?: boolean }): void {
  const target = path.join(process.cwd(), CONFIG_FILE);
  if (fs.existsSync(target) && !opts.force) {
    throw new Error(`${CONFIG_FILE} already exists here (use --force to overwrite)`);
  }
  let template = fs.readFileSync(path.join(PACKAGE_ROOT, "templates", CONFIG_FILE), "utf8");
  if (opts.game) template = template.replace(/^game: .*$/m, `game: ${JSON.stringify(opts.game)}`);
  fs.writeFileSync(target, template);

  const p = loadProject();
  for (const dir of [p.conceptDir, p.assetsDir, p.outputDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(p.conceptDir, "README.md"),
    "Drop your approved concept art and video frames here (PNG/JPG/WebP).\n" +
      `The first ${p.config.image.maxReferences} files (alphabetically) are sent as style references.\n`,
  );

  const gitignore = path.join(p.root, ".gitignore");
  const line = `${path.relative(p.root, p.assetsDir).split(path.sep).join("/")}/*/drafts/`;
  const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!existing.includes(line)) {
    fs.appendFileSync(gitignore, `${existing && !existing.endsWith("\n") ? "\n" : ""}# asset-pipeline drafts\n${line}\n`);
  }

  say(`Created ${CONFIG_FILE}, ${rel0(p, p.conceptDir)}/, ${rel0(p, p.assetsDir)}/ and ${rel0(p, p.outputDir)}/`);
  say(`Added "${line}" to .gitignore (rejected drafts stay out of git).`);
  say("");
  say("Next:");
  say(`  1. Edit ${CONFIG_FILE}: game name, style, polygon budget, export format.`);
  say(`  2. Put your best concept art / video frames in ${rel0(p, p.conceptDir)}/`);
  say("  3. Consider Git LFS for models:  git lfs track \"*.fbx\" \"*.glb\"");
}

const rel0 = (p: Project, dir: string) => path.relative(p.root, dir) || ".";

// ---------------------------------------------------------------- new

export function newAsset(name: string, description: string): void {
  const p = loadProject();
  const asset = createAsset(p, name, description);
  say(`Created asset "${asset.name}" in ${rel0(p, assetDir(p, name))}/`);
  say(`Next: asset concept ${name}`);
}

// ---------------------------------------------------------------- concept

export async function concept(
  name: string,
  opts: { drafts?: number; note?: string; revise?: string; feedback?: string },
): Promise<void> {
  const p = loadProject();
  const asset = loadAsset(p, name);
  const provider = images(p);
  const dir = path.join(assetDir(p, name), "drafts");
  fs.mkdirSync(dir, { recursive: true });

  if (opts.note) asset.notes.push(opts.note);
  const refs = references(p);
  let prompt: string;
  let inputs: string[];
  let n = opts.drafts ?? p.config.image.drafts;

  if (opts.revise) {
    if (!opts.feedback) throw new Error("--revise needs --feedback \"what to change\"");
    const base = resolveDraft(p, asset, opts.revise);
    prompt = revisePrompt(p.config, asset.description, opts.feedback);
    inputs = [base, ...refs].slice(0, p.config.image.maxReferences + 1);
    n = opts.drafts ?? 1;
    asset.notes.push(opts.feedback);
  } else {
    prompt = conceptPrompt(p.config, asset.description, asset.notes, refs.length > 0);
    inputs = refs;
  }

  asset.concept.round += 1;
  const round = asset.concept.round;
  say(`Generating ${n} concept draft${n > 1 ? "s" : ""} (round ${round}, ~${usd(estimateImageUsd(p.config, n, inputs.length))})…`);
  if (refs.length) say(`Style references: ${refs.map((r) => path.basename(r)).join(", ")}`);
  else say(`No style references found in ${rel0(p, p.conceptDir)}/ — generating from the style text only.`);

  const result = await provider.generate({ prompt, inputs, n });
  const files = result.images.map((img, i) => {
    const file = path.join(dir, `r${round}-${i + 1}.png`);
    fs.writeFileSync(file, img);
    return file;
  });
  asset.concept.drafts.push(...files.map((f) => rel(p, name, f)));
  asset.status = "concept";
  addLog(asset, "concept", `round ${round}: ${files.length} draft(s)${opts.revise ? ` revising ${opts.revise}` : ""}`, {
    usd: result.costUsd,
  });
  saveAsset(p, asset);

  say(`Cost: ${usd(result.costUsd)}`);
  say("Drafts:");
  for (const f of files) say(`  ${f}`);
  say("");
  say(`Pick one:   asset approve ${name} r${round}-1`);
  say(`Or revise:  asset concept ${name} --revise r${round}-1 --feedback "less moss"`);
}

function resolveDraft(p: Project, asset: Asset, ref: string): string {
  const candidates = [
    ref,
    path.join(assetDir(p, asset.name), ref),
    path.join(assetDir(p, asset.name), "drafts", ref),
    path.join(assetDir(p, asset.name), "drafts", `${ref}.png`),
  ];
  const hit = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!hit) throw new Error(`Can't find draft "${ref}" for ${asset.name}`);
  return path.resolve(hit);
}

// ---------------------------------------------------------------- approve

export function approve(name: string, draft?: string): void {
  const p = loadProject();
  const asset = loadAsset(p, name);

  if (draft) {
    const src = resolveDraft(p, asset, draft);
    const dest = path.join(assetDir(p, name), "concept.png");
    fs.copyFileSync(src, dest);
    asset.concept.approved = rel(p, name, dest);
    asset.status = "concept-approved";
    asset.turnaround = { views: {}, approved: false };
    addLog(asset, "approve", `concept ${path.basename(src)}`);
    saveAsset(p, asset);
    say(`Approved ${path.basename(src)} → ${dest}`);
    say(`Next: asset turnaround ${name}`);
    return;
  }

  if (asset.status === "turnaround") {
    const missing = p.config.turnaround.views.filter((v) => !asset.turnaround.views[v]);
    if (missing.length) throw new Error(`Missing views: ${missing.join(", ")}. Run asset turnaround ${name} first.`);
    asset.turnaround.approved = true;
    asset.status = "turnaround-approved";
    addLog(asset, "approve", "turnaround");
    saveAsset(p, asset);
    say(`Approved turnaround for ${name}.`);
    say(`Next: asset estimate ${name}   then   asset model ${name} --yes`);
    return;
  }

  throw new Error(
    asset.status === "concept"
      ? `Say which draft to approve, e.g. asset approve ${name} r${asset.concept.round}-1`
      : `Nothing to approve for ${name} (status: ${asset.status})`,
  );
}

// ---------------------------------------------------------------- turnaround

export async function turnaround(name: string, opts: { view?: string[]; note?: string }): Promise<void> {
  const p = loadProject();
  const asset = loadAsset(p, name);
  if (!asset.concept.approved) throw new Error(`Approve a concept first: asset approve ${name} <draft>`);

  const views = (opts.view?.length ? opts.view : p.config.turnaround.views) as View[];
  for (const v of views) if (!VIEWS.includes(v)) throw new Error(`Unknown view "${v}"`);
  // Front first, so the other views can be anchored to it.
  views.sort((a, b) => VIEWS.indexOf(a) - VIEWS.indexOf(b));

  const provider = images(p);
  const dir = path.join(assetDir(p, name), "turnaround");
  fs.mkdirSync(dir, { recursive: true });
  const conceptFile = abs(p, name, asset.concept.approved);

  say(`Generating ${views.join(", ")} view(s) (~${usd(estimateImageUsd(p.config, views.length, 2))})…`);
  let total = 0;
  for (const view of views) {
    const front = asset.turnaround.views.front ? abs(p, name, asset.turnaround.views.front) : undefined;
    const useFront = view !== "front" && front !== undefined && fs.existsSync(front);
    const inputs = useFront ? [conceptFile, front!] : [conceptFile];
    const result = await provider.generate({
      prompt: turnaroundPrompt(p.config, asset.description, view, useFront, opts.note),
      inputs,
      n: 1,
    });
    const file = path.join(dir, `${view}.png`);
    fs.writeFileSync(file, result.images[0]);
    asset.turnaround.views[view] = rel(p, name, file);
    total += result.costUsd;
    say(`  ${view}: ${file}`);
    saveAsset(p, asset); // save after each view so a failure part-way keeps progress
  }
  asset.turnaround.approved = false;
  asset.status = "turnaround";
  addLog(asset, "turnaround", views.join(", "), { usd: total });
  saveAsset(p, asset);

  say(`Cost: ${usd(total)}`);
  say("");
  say(`Approve:     asset approve ${name}`);
  say(`Redo a view: asset turnaround ${name} --view left --note "show the gate latch"`);
}

// ---------------------------------------------------------------- estimate / model

export function estimate(name: string, opts: { faceLimit?: string } = {}): void {
  const p = loadProject();
  const asset = loadAsset(p, name);
  const m = withFaceLimit(p.config.model, opts.faceLimit);
  const { credits, breakdown } = estimateTripoCredits(m);
  const views = Object.keys(asset.turnaround.views);
  const faces = m.faceLimit ? `${m.faceLimit} faces${opts.faceLimit ? " (override)" : ""}` : "Tripo default faces";
  say(`Tripo estimate for ${name} (${views.length} views, ${m.version ?? "default model"}, ${m.format}, ${faces}):`);
  for (const line of breakdown) say(`  ${line}`);
  say(`  format conversion: a few credits (exact figure logged afterwards)`);
  say(`Total: ~${credits}+ credits ≈ ${usd(credits / 100)}`);
}

export async function model(
  name: string,
  opts: { yes?: boolean; force?: boolean; restart?: boolean; faceLimit?: string },
): Promise<void> {
  const p = loadProject();
  const asset = loadAsset(p, name);
  const m = withFaceLimit(p.config.model, opts.faceLimit);

  const views = Object.fromEntries(
    p.config.turnaround.views
      .filter((v) => asset.turnaround.views[v])
      .map((v) => [v, abs(p, name, asset.turnaround.views[v]!)]),
  ) as Partial<Record<View, string>>;

  if (!views.front || Object.keys(views).length < 2) {
    throw new Error(`Need a front view and at least one other. Run: asset turnaround ${name}`);
  }
  if (!asset.turnaround.approved && !opts.force) {
    throw new Error(`Turnaround not approved yet. Run: asset approve ${name}  (or pass --force)`);
  }

  const { credits } = estimateTripoCredits(m);
  if (!opts.yes) {
    estimate(name, opts);
    say("");
    const flag = opts.faceLimit ? ` --face-limit ${m.faceLimit}` : "";
    say(`This spends Tripo credits. Re-run with --yes to go ahead: asset model ${name} --yes${flag}`);
    return;
  }

  const client = tripo();
  const progress = (label: string) => {
    let last = "";
    return (t: { status: string; progress?: number }) => {
      const line = `${label}: ${t.status}${t.progress !== undefined ? ` ${t.progress}%` : ""}`;
      if (line !== last) say(`  ${line}`);
      last = line;
    };
  };

  asset.status = "modelling";
  let taskId = opts.restart ? undefined : asset.model.taskId;
  try {
    if (taskId && !asset.model.file) {
      say(`Resuming Tripo task ${taskId}…`);
      if (opts.faceLimit) say(`  Note: --face-limit only applies to new tasks. Add --restart to regenerate at ${m.faceLimit} faces.`);
    } else {
      say(`Uploading ${Object.keys(views).length} views to Tripo…`);
      const tokens: Partial<Record<View, string>> = {};
      for (const [view, file] of Object.entries(views) as [View, string][]) tokens[view] = await client.upload(file);
      taskId = await client.multiviewToModel(tokens, m);
      asset.model = { taskId };
      const faces = m.faceLimit ? `, ${m.faceLimit} faces` : "";
      addLog(asset, "model", `multiview task ${taskId} (est. ${credits} credits${faces})`);
      saveAsset(p, asset);
      say(`Started task ${taskId}`);
    }

    const task = await waitForTask(client, taskId, { onProgress: progress("model") });
    let spent = task.credits_consumed ?? 0;
    let finalTask = task;

    const needsConvert = m.format !== "GLB" || Object.values(m.convert ?? {}).some(Boolean);
    if (needsConvert) {
      const convertId = await client.convert(taskId, m);
      asset.model.convertTaskId = convertId;
      saveAsset(p, asset);
      say(`Converting to ${m.format} (task ${convertId})…`);
      finalTask = await waitForTask(client, convertId, { onProgress: progress("convert") });
      spent += finalTask.credits_consumed ?? 0;
    }

    const url = primaryModelUrl(finalTask);
    if (!url) throw new Error(`Task finished but returned no model URL: ${JSON.stringify(finalTask.output)}`);
    const data = await client.download(url); // URLs expire ~5 minutes after completion
    const ext = path.extname(new URL(url).pathname).replace(".", "").toLowerCase() || m.format.toLowerCase();

    const modelDir = path.join(assetDir(p, name), "model");
    fs.mkdirSync(modelDir, { recursive: true });
    const file = path.join(modelDir, `${name}.${ext}`);
    fs.writeFileSync(file, data);
    fs.mkdirSync(p.outputDir, { recursive: true });
    const output = path.join(p.outputDir, `${name}.${ext}`);
    fs.copyFileSync(file, output);

    asset.model.file = rel(p, name, file);
    asset.model.output = path.relative(p.root, output);
    asset.model.credits = spent;
    asset.status = "done";
    addLog(asset, "model", `downloaded ${path.basename(file)}`, { credits: spent });
    saveAsset(p, asset);

    say(`Done. ${spent} credits (${usd(spent / 100)}).`);
    say(`Model:  ${file}`);
    say(`Copied: ${output}`);
  } catch (err) {
    asset.status = "failed";
    addLog(asset, "model", `failed: ${(err as Error).message}`);
    saveAsset(p, asset);
    throw err;
  }
}

// ---------------------------------------------------------------- status / balance / refs

export function status(name: string | undefined, opts: { json?: boolean }): void {
  const p = loadProject();
  const assets = name ? [loadAsset(p, name)] : listAssets(p);
  if (opts.json) {
    say(JSON.stringify(name ? assets[0] : assets, null, 2));
    return;
  }
  if (!assets.length) {
    say(`No assets yet. Create one: asset new <name> "<description>"`);
    return;
  }
  let usdTotal = 0;
  let creditTotal = 0;
  for (const a of assets) {
    const t = totals(a);
    usdTotal += t.usd;
    creditTotal += t.credits;
    say(`${a.name.padEnd(24)} ${a.status.padEnd(20)} ${usd(t.usd)} + ${t.credits} credits   ${a.description}`);
    if (name) {
      if (a.concept.approved) say(`  concept:    ${abs(p, a.name, a.concept.approved)}`);
      for (const [v, f] of Object.entries(a.turnaround.views)) say(`  ${v.padEnd(10)}  ${abs(p, a.name, f!)}`);
      if (a.model.output) say(`  model:      ${path.join(p.root, a.model.output)}`);
      if (a.notes.length) say(`  notes:      ${a.notes.join(" | ")}`);
    }
  }
  if (!name) say(`\nTotal: ${usd(usdTotal)} OpenAI + ${creditTotal} Tripo credits (${usd(creditTotal / 100)})`);
}

export async function balance(): Promise<void> {
  const b = await tripo().balance();
  say(`Tripo balance: ${b.balance} credits (${usd(b.balance / 100)})${b.frozen ? `, ${b.frozen} reserved for running tasks` : ""}`);
}

export function refs(): void {
  const p = loadProject();
  const list = references(p);
  if (!list.length) say(`No reference images in ${p.conceptDir}`);
  for (const r of list) say(r);
}
