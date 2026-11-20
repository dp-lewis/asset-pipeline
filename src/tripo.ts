import fs from "node:fs";
import path from "node:path";
import type { Config, View } from "./config.js";

/**
 * Minimal client for Tripo's v3 REST API.
 * Reference: developers.tripo3d.com and VAST-AI-Research/tripo-go-sdk.
 */

export interface TripoTask {
  task_id: string;
  type?: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled" | "unknown" | "banned" | "expired";
  progress?: number;
  output?: Record<string, unknown>;
  credits_consumed?: number;
  error_code?: number;
  error_message?: string;
}

export interface ModelProvider {
  upload(file: string): Promise<string>;
  multiviewToModel(views: Partial<Record<View, string>>, m: Config["model"]): Promise<string>;
  convert(taskId: string, m: Config["model"]): Promise<string>;
  getTask(taskId: string): Promise<TripoTask>;
  download(url: string): Promise<Buffer>;
  balance(): Promise<{ balance: number; frozen?: number }>;
}

const TERMINAL = new Set(["success", "failed", "cancelled", "banned", "expired"]);

export class TripoClient implements ModelProvider {
  private base: string;
  private key: string;

  constructor() {
    const key = process.env.TRIPO_API_KEY;
    if (!key) throw new Error("TRIPO_API_KEY is not set. Add it to .env (see .env.example).");
    this.key = key;
    this.base = (process.env.TRIPO_BASE_URL ?? "https://openapi.tripo3d.ai/v3").replace(/\/$/, "");
  }

  private async request<T>(method: string, route: string, body?: unknown): Promise<T> {
    const init: RequestInit = { method, headers: { Authorization: `Bearer ${this.key}` } };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + route, init);
    const text = await res.text();
    let env: { code?: number; data?: T; message?: string; suggestion?: string };
    try {
      env = JSON.parse(text);
    } catch {
      throw new Error(`Tripo ${method} ${route} → HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.ok || env.code !== 0) {
      const hint = env.suggestion ? ` (${env.suggestion})` : "";
      throw new Error(`Tripo ${method} ${route} failed: ${env.message ?? `HTTP ${res.status}`}${hint}`);
    }
    return env.data as T;
  }

  async upload(file: string): Promise<string> {
    const form = new FormData();
    const type = path.extname(file).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    form.append("file", new Blob([fs.readFileSync(file)], { type }), path.basename(file));
    const data = await this.request<{ file_token: string }>("POST", "/files", form);
    return data.file_token;
  }

  async multiviewToModel(views: Partial<Record<View, string>>, m: Config["model"]): Promise<string> {
    const inputs = Object.entries(views).map(([view, token]) => ({ [view]: token }));
    const body: Record<string, unknown> = {
      inputs,
      texture: m.texture,
      pbr: m.pbr,
      auto_size: m.autoSize,
    };
    if (m.version) body.model = m.version;
    if (m.texture) body.texture_quality = m.textureQuality;
    if (m.geometryQuality) body.geometry_quality = m.geometryQuality;
    if (m.faceLimit) body.face_limit = m.faceLimit;
    if (m.quad) body.quad = true;
    if (m.smartLowPoly) body.smart_low_poly = true;
    const data = await this.request<{ task_id: string }>("POST", "/generation/multiview-to-model", body);
    return data.task_id;
  }

  async convert(taskId: string, m: Config["model"]): Promise<string> {
    const c = m.convert ?? {};
    const body: Record<string, unknown> = { input: taskId, format: m.format };
    if (m.quad) body.quad = true;
    if (m.faceLimit) body.face_limit = m.faceLimit;
    if (c.pivotToCenterBottom) body.pivot_to_center_bottom = true;
    if (c.fbxPreset) body.fbx_preset = c.fbxPreset;
    if (c.scaleFactor) body.scale_factor = c.scaleFactor;
    const data = await this.request<{ task_id: string }>("POST", "/models/convert", body);
    return data.task_id;
  }

  getTask(taskId: string): Promise<TripoTask> {
    return this.request<TripoTask>("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  async download(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  balance() {
    return this.request<{ balance: number; frozen?: number }>("GET", "/account/balance");
  }
}

/** Main model URL from a task's output, checking the usual fields in priority order. */
export function primaryModelUrl(task: TripoTask): string | undefined {
  const o = (task.output ?? {}) as Record<string, unknown>;
  for (const key of ["model_url", "model", "pbr_model", "base_model"]) {
    if (typeof o[key] === "string" && o[key]) return o[key] as string;
  }
  const urls = o.model_urls;
  if (Array.isArray(urls) && typeof urls[0] === "string") return urls[0];
  return undefined;
}

export async function waitForTask(
  client: ModelProvider,
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number; onProgress?: (t: TripoTask) => void } = {},
): Promise<TripoTask> {
  const interval = opts.intervalMs ?? 5000;
  const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60 * 1000);
  for (;;) {
    const task = await client.getTask(taskId);
    opts.onProgress?.(task);
    if (TERMINAL.has(task.status)) {
      if (task.status !== "success") {
        throw new Error(`Tripo task ${taskId} ${task.status}${task.error_message ? `: ${task.error_message}` : ""}`);
      }
      return task;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for Tripo task ${taskId} (status: ${task.status})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Fake provider for testing the flow without API calls. */
export class MockTripo implements ModelProvider {
  private n = 0;
  private tasks = new Map<string, { kind: string; format: string; polls: number }>();
  async upload(file: string) {
    return `mock-token-${path.basename(file)}`;
  }
  async multiviewToModel() {
    const id = `mock-task-${++this.n}`;
    this.tasks.set(id, { kind: "model", format: "glb", polls: 0 });
    return id;
  }
  async convert(_taskId: string, m: Config["model"]) {
    const id = `mock-task-${++this.n}`;
    this.tasks.set(id, { kind: "convert", format: m.format.toLowerCase(), polls: 0 });
    return id;
  }
  async getTask(taskId: string): Promise<TripoTask> {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`unknown mock task ${taskId}`);
    t.polls++;
    if (t.polls < 2) return { task_id: taskId, status: "running", progress: 50 };
    return {
      task_id: taskId,
      status: "success",
      progress: 100,
      credits_consumed: t.kind === "model" ? 35 : 5,
      output: { model: `https://mock.tripo/${taskId}.${t.format}` },
    };
  }
  async download(url: string) {
    return Buffer.from(`mock model from ${url}\n`);
  }
  async balance() {
    return { balance: 2000, frozen: 0 };
  }
}
