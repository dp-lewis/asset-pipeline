import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Project, View } from "./config.js";

export type AssetStatus =
  | "new"
  | "concept"            // drafts generated, waiting for a pick
  | "concept-approved"
  | "turnaround"         // views generated, waiting for approval
  | "turnaround-approved"
  | "modelling"
  | "done"
  | "failed";

export interface LogEntry {
  at: string;
  step: string;
  detail: string;
  costUsd?: number;
  credits?: number;
}

export interface Asset {
  name: string;
  description: string;
  status: AssetStatus;
  notes: string[];
  concept: { round: number; drafts: string[]; approved?: string };
  turnaround: { views: Partial<Record<View, string>>; approved: boolean };
  model: {
    taskId?: string;
    convertTaskId?: string;
    file?: string;
    output?: string;
    credits?: number;
  };
  log: LogEntry[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function assertSlug(name: string): void {
  if (!SLUG.test(name)) {
    throw new Error(`Asset name "${name}" must be lower-case letters, numbers and hyphens (e.g. stone-wall)`);
  }
}

export const assetDir = (p: Project, name: string) => path.join(p.assetsDir, name);
const assetFile = (p: Project, name: string) => path.join(assetDir(p, name), "asset.yaml");

/** Paths inside asset.yaml are stored relative to the asset folder. */
export const rel = (p: Project, name: string, file: string) => path.relative(assetDir(p, name), file);
export const abs = (p: Project, name: string, file: string) => path.resolve(assetDir(p, name), file);

export function createAsset(p: Project, name: string, description: string): Asset {
  assertSlug(name);
  if (fs.existsSync(assetFile(p, name))) throw new Error(`Asset "${name}" already exists`);
  const asset: Asset = {
    name,
    description,
    status: "new",
    notes: [],
    concept: { round: 0, drafts: [] },
    turnaround: { views: {}, approved: false },
    model: {},
    log: [],
  };
  fs.mkdirSync(assetDir(p, name), { recursive: true });
  addLog(asset, "new", description);
  saveAsset(p, asset);
  return asset;
}

export function loadAsset(p: Project, name: string): Asset {
  const file = assetFile(p, name);
  if (!fs.existsSync(file)) {
    throw new Error(`No asset called "${name}". Create it with: asset new ${name} "<description>"`);
  }
  return YAML.parse(fs.readFileSync(file, "utf8")) as Asset;
}

export function saveAsset(p: Project, asset: Asset): void {
  fs.writeFileSync(assetFile(p, asset.name), YAML.stringify(asset, { lineWidth: 0 }));
}

export function listAssets(p: Project): Asset[] {
  if (!fs.existsSync(p.assetsDir)) return [];
  return fs
    .readdirSync(p.assetsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(assetFile(p, d.name)))
    .map((d) => loadAsset(p, d.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function addLog(asset: Asset, step: string, detail: string, cost?: { usd?: number; credits?: number }): void {
  const entry: LogEntry = { at: new Date().toISOString(), step, detail };
  if (cost?.usd !== undefined) entry.costUsd = Math.round(cost.usd * 10000) / 10000;
  if (cost?.credits !== undefined) entry.credits = cost.credits;
  asset.log.push(entry);
}

export function totals(asset: Asset): { usd: number; credits: number } {
  return asset.log.reduce(
    (acc, e) => ({ usd: acc.usd + (e.costUsd ?? 0), credits: acc.credits + (e.credits ?? 0) }),
    { usd: 0, credits: 0 },
  );
}
