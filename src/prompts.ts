import type { Config, View } from "./config.js";

const BACKGROUND =
  "Plain, evenly lit, neutral light-grey background. No ground shadow, no props, no text, no watermark, no border.";

export function conceptPrompt(config: Config, description: string, notes: string[], hasReferences: boolean): string {
  const parts = [
    `Concept art of a single game asset for "${config.game}": ${description}.`,
    config.style ? `Art direction: ${config.style.trim()}` : "",
    hasReferences
      ? "The attached images are style references from the game's concept art. Match their realism, materials, colour palette, lighting and level of wear, but do not copy their composition — show only the requested object."
      : "",
    "Show the whole object, uncropped and centred, from a three-quarter view at eye level, with clear readable silhouette and materials, suitable as reference for 3D modelling.",
    BACKGROUND,
    notes.length ? `Feedback to apply: ${notes.join(" ")}` : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function revisePrompt(config: Config, description: string, feedback: string): string {
  return [
    `Revise this concept art of a game asset for "${config.game}" (${description}).`,
    `Change: ${feedback}`,
    "Keep everything else the same — same object, viewpoint, style and materials.",
    BACKGROUND,
  ].join("\n\n");
}

const VIEW_TEXT: Record<View, string> = {
  front: "a straight-on FRONT view (camera facing the object's front)",
  left: "a straight-on LEFT SIDE view (object rotated 90° so we see its left side)",
  back: "a straight-on BACK view (object rotated 180°, we see its rear)",
  right: "a straight-on RIGHT SIDE view (object rotated 90° the other way, we see its right side)",
};

export function turnaroundPrompt(config: Config, description: string, view: View, hasFront: boolean, notes?: string): string {
  return [
    `Turnaround reference for 3D modelling of a game asset (${description}).`,
    `Show EXACTLY the same object as the first attached image — identical shape, proportions, materials, colours, wear and details — but from ${VIEW_TEXT[view]}.`,
    hasFront && view !== "front"
      ? "The second attached image is the approved front view; stay consistent with it."
      : "",
    "Orthographic-style: camera at the object's mid-height, no perspective distortion, whole object centred and fully in frame with a small margin, same scale as the reference.",
    "Flat, even, shadowless lighting so surface colour reads clearly.",
    BACKGROUND,
    config.style ? `Art direction: ${config.style.trim()}` : "",
    notes ? `Additional notes: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
