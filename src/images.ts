import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import OpenAI, { toFile } from "openai";
import type { Config } from "./config.js";
import { imageCostUsd, type ImageUsage } from "./costs.js";

export interface ImageRequest {
  prompt: string;
  /** Input images (concept/front view first, then style references). */
  inputs: string[];
  n: number;
}

export interface ImageResult {
  images: Buffer[];
  costUsd: number;
}

export interface ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult>;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
export const IMAGE_EXTS = Object.keys(MIME);

export class OpenAIImages implements ImageProvider {
  private client: OpenAI;
  constructor(private config: Config) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set. Add it to .env (see .env.example).");
    }
    this.client = new OpenAI();
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const { model, quality, size, inputFidelity, pricesPerMillion } = this.config.image;
    const common = { model, prompt: req.prompt, n: req.n, quality, size: size as "1024x1024" };
    let res;
    if (req.inputs.length) {
      const image = await Promise.all(
        req.inputs.map((file) =>
          toFile(fs.createReadStream(file), path.basename(file), {
            type: MIME[path.extname(file).toLowerCase()] ?? "image/png",
          }),
        ),
      );
      res = await this.client.images.edit({
        ...common,
        image,
        ...(inputFidelity ? { input_fidelity: inputFidelity } : {}),
      });
    } else {
      res = await this.client.images.generate(common);
    }
    const images = (res.data ?? []).map((d) => {
      if (!d.b64_json) throw new Error("OpenAI returned an image without b64_json data");
      return Buffer.from(d.b64_json, "base64");
    });
    return { images, costUsd: imageCostUsd(res.usage as ImageUsage | undefined, pricesPerMillion) };
  }
}

/** Fake provider for testing the flow without API calls. Writes solid-colour PNGs. */
export class MockImages implements ImageProvider {
  private counter = 0;
  async generate(req: ImageRequest): Promise<ImageResult> {
    const images = Array.from({ length: req.n }, () => solidPng(64, 64, this.counter++));
    return { images, costUsd: 0 };
  }
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function solidPng(w: number, h: number, seed: number): Buffer {
  const rgb = [(seed * 67) % 256, (seed * 131 + 80) % 256, (seed * 29 + 160) % 256];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
