/**
 * Render generated plans as ASCII, for judging by eye.
 *
 * The metrics rig says how close the numbers are; this says whether the board is
 * any good. Every failed version of this project passed its own numbers, so the
 * numbers are never allowed to be the last word.
 *
 * Legend: `---`/`|` wall, `-o-`/`o` hatchway, `###`/`#` built outside wall,
 * `===`/`:` free table edge, ` . ` corridor cell, ` Z ` reserved hall.
 *
 * Run: node --experimental-strip-types tests/eyeball.ts [preset] [sets] [count]
 */

import { TERRAIN, BOARD_SIZES, type BoardPreset } from "../app/terrain.ts";
import { generate } from "../app/generate.ts";
import { renderPlan } from "../app/deckplan.ts";
import { edgeRuns } from "../app/lattice.ts";

const BOARDING = Object.fromEntries(
  TERRAIN.filter((def) => def.catalogue === "boarding" && def.kind !== "scatter").map((def) => [def.id, def.limit]),
);
const setsOf = (sets:number) => Object.fromEntries(Object.entries(BOARDING).map(([id, count]) => [id, count * sets]));

const preset = (process.argv[2] ?? "card") as BoardPreset;
const sets = Number(process.argv[3] ?? 1);
const count = Number(process.argv[4] ?? 3);
const { width, height } = BOARD_SIZES[preset];

for (let index = 0; index < count; index++) {
  let uid = 0;
  const report = generate({
    boardWidth:width, boardHeight:height, catalogue:"boarding",
    defs:TERRAIN, inventory:setsOf(sets), heights:{}, zones:[], anchor:"auto",
    seed:(index * 2654435761 + 7) >>> 0, nextUid:() => `u${uid++}`,
  });
  const m = report.metrics;
  console.log(`\n=== ${preset} x${sets} · seed ${index} · ${report.pieces.length} pieces · ${report.anchor} ===`);
  if (!m || !report.plan) { console.log("FAILED:", report.note, JSON.stringify(report.rejected)); continue; }
  const runs = edgeRuns(report.plan.panelEdges).map((run) => run.length).sort((a, b) => b - a);
  console.log(`${report.note}`);
  console.log(`density ${m.density.toFixed(2)} · sight ${m.meanSight.toFixed(1)}/${m.longestSight} · runs ${runs.slice(0, 8).join(",")} · rooms ${m.meanRoom.toFixed(1)}±${m.roomSpread.toFixed(1)} · junctions ${m.junctionShare.toFixed(2)}`);
  console.log(renderPlan(report.plan));
}
