import type { Config } from "./config.js";

export interface ImageUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

/** USD cost of an OpenAI image call from its token usage. */
export function imageCostUsd(usage: ImageUsage | undefined, prices: Config["image"]["pricesPerMillion"]): number {
  if (!usage) return 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? Math.max(0, usage.input_tokens - imageIn);
  return (textIn * prices.textIn + imageIn * prices.imageIn + usage.output_tokens * prices.imageOut) / 1_000_000;
}

/**
 * Rough per-image output cost, for estimates before a call is made.
 * Based on OpenAI's published gpt-image-2 figures at 1024x1024.
 */
const OUTPUT_ESTIMATE_USD: Record<string, number> = { low: 0.006, medium: 0.053, high: 0.211 };
export function estimateImageUsd(config: Config, images: number, referenceImages: number): number {
  const out = OUTPUT_ESTIMATE_USD[config.image.quality] ?? 0.053;
  const refs = referenceImages * 0.01; // input images are cheap relative to output
  return images * out + refs;
}

/**
 * Estimate of Tripo credits for a multiview generation, from Tripo's published
 * H-series table (developers.tripo3d.com). 1 credit = US$0.01.
 * The actual figure is read back from the task and logged.
 */
export function estimateTripoCredits(m: Config["model"]): { credits: number; breakdown: string[] } {
  const base = !m.texture ? 20 : { fast: 30, standard: 30, detailed: 40, extreme: 50 }[m.textureQuality];
  const breakdown = [`base (${m.texture ? `${m.textureQuality} texture` : "no texture"}): ${base}`];
  let credits = base;
  const add = (cond: boolean, n: number, label: string) => {
    if (cond) {
      credits += n;
      breakdown.push(`${label}: +${n}`);
    }
  };
  add(m.geometryQuality === "detailed", 20, "detailed geometry");
  add(m.quad, 5, "quad mesh");
  add(m.smartLowPoly, 10, "smart low-poly");
  if (m.version && /^P/i.test(m.version)) {
    breakdown.push("note: P-series models are priced higher than this H-series estimate");
  }
  return { credits, breakdown };
}

export const usd = (n: number) => `US$${n.toFixed(2)}`;
