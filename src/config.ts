import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import dotenv from "dotenv";

export const CONFIG_FILE = "asset.config.yaml";
export const VIEWS = ["front", "left", "back", "right"] as const;
export type View = (typeof VIEWS)[number];

export interface Config {
  game: string;
  style: string;
  paths: { concept: string; assets: string; output: string };
  image: {
    model: string;
    quality: "low" | "medium" | "high";
    size: string;
    drafts: number;
    maxReferences: number;
    inputFidelity?: "high" | "low";
    pricesPerMillion: { textIn: number; imageIn: number; imageOut: number };
  };
  turnaround: { views: View[] };
  model: {
    version?: string;
    texture: boolean;
    pbr: boolean;
    textureQuality: "fast" | "standard" | "detailed" | "extreme";
    geometryQuality: "standard" | "detailed";
    faceLimit?: number;
    quad: boolean;
    smartLowPoly: boolean;
    autoSize: boolean;
    format: "FBX" | "GLB" | "GLTF" | "OBJ" | "USDZ" | "STL";
    convert?: {
      pivotToCenterBottom?: boolean;
      fbxPreset?: string;
      scaleFactor?: number;
    };
  };
}

/** Root folder of this package (where templates/ and skills/ live). */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULTS: Config = {
  game: "Untitled",
  style: "",
  paths: { concept: "art/concept", assets: "art/assets", output: "art/models" },
  image: {
    model: "gpt-image-2",
    quality: "medium",
    size: "1024x1024",
    drafts: 3,
    maxReferences: 4,
    pricesPerMillion: { textIn: 5, imageIn: 8, imageOut: 30 },
  },
  turnaround: { views: [...VIEWS] },
  model: {
    version: "v3.1-20260211",
    texture: true,
    pbr: true,
    textureQuality: "standard",
    geometryQuality: "standard",
    faceLimit: 2000,
    quad: false,
    smartLowPoly: true,
    autoSize: true,
    format: "FBX",
    convert: { pivotToCenterBottom: true },
  },
};

/** Load API keys from .env files. Earlier files win; real env vars win over all. */
export function loadEnv(cwd = process.cwd()): void {
  const candidates = [
    path.join(cwd, ".env"),
    path.join(os.homedir(), ".config", "asset-pipeline", ".env"),
    path.join(PACKAGE_ROOT, ".env"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
  }
}

export function findConfigFile(start = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base)) return override as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

export interface Project {
  root: string;
  configFile: string;
  config: Config;
  conceptDir: string;
  assetsDir: string;
  outputDir: string;
}

export function parseConfig(text: string): Config {
  const raw = YAML.parse(text) ?? {};
  const config = deepMerge(DEFAULTS, raw);
  validateConfig(config);
  return config;
}

export function validateConfig(config: Config): void {
  const views = config.turnaround.views;
  for (const v of views) {
    if (!VIEWS.includes(v)) throw new Error(`turnaround.views: unknown view "${v}" (use ${VIEWS.join(", ")})`);
  }
  if (!views.includes("front") || views.length < 2) {
    throw new Error("turnaround.views must include front and at least one other view (Tripo needs 2+ views)");
  }
  if (config.image.drafts < 1 || config.image.drafts > 10) throw new Error("image.drafts must be 1–10");
}

export function loadProject(start = process.cwd()): Project {
  const configFile = findConfigFile(start);
  if (!configFile) {
    throw new Error(`No ${CONFIG_FILE} found here or in any parent folder. Run \`asset init\` in your game repo first.`);
  }
  const root = path.dirname(configFile);
  const config = parseConfig(fs.readFileSync(configFile, "utf8"));
  return {
    root,
    configFile,
    config,
    conceptDir: path.resolve(root, config.paths.concept),
    assetsDir: path.resolve(root, config.paths.assets),
    outputDir: path.resolve(root, config.paths.output),
  };
}

export const isMock = () => process.env.ASSET_PIPELINE_MOCK === "1";
