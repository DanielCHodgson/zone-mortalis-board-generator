/**
 * Layout-shape profile, for judging a board against the reference photographs.
 *
 * The metrics in validate.ts score a candidate; this describes a whole population, in
 * the terms the reference boards are actually built from. It exists because the old
 * model passed every metric it had while producing boards that looked nothing like the
 * references — 63 doorways apiece, every compartment sealed, not one open face — and
 * none of those numbers could see it.
 *
 * Run: node --experimental-strip-types tests/profile.ts [preset] [sets] [catalogue]
 */

import { TERRAIN, BOARD_SIZES, type BoardPreset, type CatalogueId } from "../app/terrain.ts";
import { generate } from "../app/generate.ts";
import { cellRegions, edgeKey, transparent } from "../app/lattice.ts";
import { measure } from "../app/validate.ts";

const preset = (process.argv[2] ?? "48x48") as BoardPreset;
const sets = Number(process.argv[3] ?? 4);
const catalogue = (process.argv[4] ?? "boarding") as CatalogueId;
const { width, height } = BOARD_SIZES[preset];

const inventory = Object.fromEntries(
  TERRAIN.filter((def) => def.catalogue === catalogue && def.kind !== "scatter")
    .map((def) => [def.id, def.limit * sets]),
);

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
let uid = 0;
const totals = {
  boards:0, wall:0, hatch:0, regions:0, sizes:[] as number[],
  openFaceShare:[] as number[], alcoveShare:[] as number[], doorwayShare:[] as number[],
  density:[] as number[], plazaShare:[] as number[], cells:0, longestRun:[] as number[],
};

for (const seed of SEEDS) {
  const report = generate({
    boardWidth:width, boardHeight:height, catalogue, defs:TERRAIN, inventory,
    heights:{}, zones:[], anchor:"auto", seed, nextUid:() => `u${uid++}`,
  });
  if (!report.plan || !report.lattice) { console.log(`seed ${seed}: FAILED — ${report.note}`); continue; }
  const { lattice, state } = report.plan;
  totals.boards++;
  totals.cells = lattice.cols * lattice.rows;

  for (const edge of report.plan.panelEdges) {
    const value = state.get(edgeKey(edge));
    if (value === "hatch") totals.hatch++; else if (value === "wall") totals.wall++;
  }

  // Openness comes from `measure`, deliberately, rather than being recounted here.
  // Counting it independently is how this script twice told me compartments were open on
  // three sides when they were textbook alcoves: it was counting open EDGES, and a
  // three-cell-wide mouth is three edges and one side. One implementation, in validate.ts,
  // where the scorer reads it too.
  const metrics = measure(report.plan);
  totals.openFaceShare.push(metrics.openFaceShare);
  totals.alcoveShare.push(metrics.alcoveShare);
  totals.doorwayShare.push(metrics.doorwayShare);
  totals.density.push(metrics.density);
  report.plan.regions.forEach((region) => {
    totals.regions++;
    totals.sizes.push(region.cells.length);
  });

  const seen = cellRegions(lattice, state, transparent);
  totals.plazaShare.push(Math.max(...seen.sizes) / (lattice.cols * lattice.rows));
  totals.longestRun.push(report.metrics?.longestSolidRun ?? 0);
}

const pct = (value:number) => `${(100 * value).toFixed(0)}%`;
const mean = (values:number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const sizes = [...totals.sizes].sort((a, b) => a - b);
const histogram = new Map<number, number>();
sizes.forEach((size) => histogram.set(size, (histogram.get(size) ?? 0) + 1));

console.log(`\n${preset} x${sets} ${catalogue} — ${totals.boards} boards, ${totals.cells} cells each\n`);
console.log(`DOORWAYS      ${(totals.hatch / Math.max(1, totals.boards)).toFixed(1)} per board   (${pct(mean(totals.doorwayShare))} of panels)`);
console.log(`OPENNESS      open faces ${pct(mean(totals.openFaceShare))}   alcoves ${pct(mean(totals.alcoveShare))}`);
console.log(`DENSITY       ${mean(totals.density).toFixed(2)} of interior edges panelled`);
console.log(`SIZES         median ${sizes[Math.floor(sizes.length / 2)]} cells   single-cell ${pct((histogram.get(1) ?? 0) / Math.max(1, totals.regions))}`);
console.log(`              ${[...histogram].sort((a, b) => a[0] - b[0]).map(([size, count]) => `${size}:${count}`).join("  ")}`);
console.log(`OPEN AREA     largest see-across region ${pct(mean(totals.plazaShare))} of the floor`);
console.log(`LONGEST WALL  ${mean(totals.longestRun).toFixed(1)} cells\n`);
