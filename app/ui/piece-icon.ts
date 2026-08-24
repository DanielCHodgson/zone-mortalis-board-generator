import type { TerrainDef } from "../terrain.ts";

/** Shared class contract for catalogue, palette, legend, and board symbols. */
export const pieceIconClass = (def:TerrainDef) => [
  "piece-icon",
  `piece-${def.id}`,
  def.kind,
  def.width > 5 ? "long" : "short",
  def.visual ? `visual-${def.visual}` : "",
].filter(Boolean).join(" ");
