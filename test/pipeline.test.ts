import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfig, withFaceLimit } from "../src/config.js";
import { estimateTripoCredits, imageCostUsd } from "../src/costs.js";
import { TripoClient, primaryModelUrl } from "../src/tripo.js";
import { conceptPrompt, turnaroundPrompt } from "../src/prompts.js";
import { solidPng } from "../src/images.js";

const template = fs.readFileSync(path.join(__dirname, "..", "templates", "asset.config.yaml"), "utf8");

describe("config", () => {
  it("parses the template", () => {
    const c = parseConfig(template);
    expect(c.image.model).toBe("gpt-image-2");
    expect(c.model.format).toBe("FBX");
    expect(c.turnaround.views).toEqual(["front", "left", "back", "right"]);
  });

  it("fills defaults for a minimal config", () => {
    const c = parseConfig("game: Test\n");
    expect(c.paths.assets).toBe("art/assets");
    expect(c.image.drafts).toBe(3);
  });

  it("applies a per-run face limit override within Tripo's range", () => {
    const m = parseConfig(template).model;
    expect(withFaceLimit(m, undefined)).toBe(m);
    expect(withFaceLimit(m, "5000").faceLimit).toBe(5000);
    expect(m.faceLimit).toBe(2000);
    expect(() => withFaceLimit(m, "abc")).toThrow(/whole number/);
    expect(() => withFaceLimit(m, "300")).toThrow(/500–20,000/);
    expect(() => withFaceLimit({ ...m, quad: true }, "15000")).toThrow(/500–10,000/);
    expect(withFaceLimit({ ...m, smartLowPoly: false }, "50000").faceLimit).toBe(50000);
  });

  it("rejects turnarounds without a front view", () => {
    expect(() => parseConfig("turnaround:\n  views: [left, back]\n")).toThrow(/front/);
  });
});

describe("costs", () => {
  it("prices image usage from tokens", () => {
    const cost = imageCostUsd(
      { input_tokens: 1100, output_tokens: 1000, input_tokens_details: { image_tokens: 1000, text_tokens: 100 } },
      { textIn: 5, imageIn: 8, imageOut: 30 },
    );
    expect(cost).toBeCloseTo((100 * 5 + 1000 * 8 + 1000 * 30) / 1e6);
  });

  it("estimates Tripo credits from the H-series table", () => {
    const base = parseConfig(template).model;
    expect(base.faceLimit).toBe(2000);
    expect(estimateTripoCredits(base).credits).toBe(40);
    expect(estimateTripoCredits({ ...base, smartLowPoly: false }).credits).toBe(30);
    expect(estimateTripoCredits({ ...base, smartLowPoly: false, textureQuality: "detailed", quad: true }).credits).toBe(45);
    expect(estimateTripoCredits({ ...base, smartLowPoly: false, texture: false, geometryQuality: "detailed" }).credits).toBe(40);
  });
});

describe("prompts", () => {
  const c = parseConfig(template);
  it("mentions references only when present", () => {
    expect(conceptPrompt(c, "a gate", [], true)).toMatch(/style references/);
    expect(conceptPrompt(c, "a gate", [], false)).not.toMatch(/style references/);
  });
  it("anchors side views to the front", () => {
    expect(turnaroundPrompt(c, "a gate", "left", true)).toMatch(/approved front view/);
    expect(turnaroundPrompt(c, "a gate", "front", true)).not.toMatch(/approved front view/);
  });
});

describe("tripo client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends a v3 multiview request with view-keyed inputs", async () => {
    process.env.TRIPO_API_KEY = "tsk_test";
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ code: 0, data: { task_id: "t1" } }));
    });
    const client = new TripoClient();
    const m = { ...parseConfig(template).model, faceLimit: 8000 };
    const id = await client.multiviewToModel({ front: "tok-f", back: "tok-b" }, m);
    expect(id).toBe("t1");
    expect(calls[0].url).toBe("https://openapi.tripo3d.ai/v3/generation/multiview-to-model");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tsk_test");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.inputs).toEqual([{ front: "tok-f" }, { back: "tok-b" }]);
    expect(body).toMatchObject({ model: "v3.1-20260211", texture: true, texture_quality: "standard", face_limit: 8000, smart_low_poly: true });
  });

  it("surfaces API errors", async () => {
    process.env.TRIPO_API_KEY = "tsk_test";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: 2010, message: "Insufficient credits" }), { status: 403 }));
    await expect(new TripoClient().balance()).rejects.toThrow(/Insufficient credits/);
  });

  it("finds the model URL in task output", () => {
    expect(primaryModelUrl({ task_id: "x", status: "success", output: { pbr_model: "https://a/b.glb" } })).toBe("https://a/b.glb");
    expect(primaryModelUrl({ task_id: "x", status: "success", output: {} })).toBeUndefined();
  });
});

describe("mock png", () => {
  it("writes a valid PNG signature", () => {
    const png = solidPng(4, 4, 1);
    const file = path.join(os.tmpdir(), "mock.png");
    fs.writeFileSync(file, png);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});
