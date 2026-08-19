/**
 * Soak rig: run the generator hundreds of times and describe what it actually
 * produces, rather than asserting one seed looks fine.
 *
 * This exists because every previous version of this project was judged on a
 * handful of boards and a green test suite, and shipped garbage anyway. A
 * generator is a distribution, not a function — the interesting failures are the
 * tail, and the tail is invisible until you look at a few hundred of them.
 *
 * Run: node --experimental-strip-types tests/soak.ts [runs]
 */

import { TERRAIN, BOARD_SIZES, type BoardPreset } from "../app/terrain.ts";
import { generate, type Anchor } from "../app/generate.ts";
import { PROVISIONAL_REFERENCE, type Metrics } from "../app/validate.ts";

const BOARDING = Object.fromEntries(
  TERRAIN.filter((def) => def.catalogue === "boarding" && def.kind !== "scatter").map((def) => [def.id, def.limit]),
);

const setsOf = (sets:number) => Object.fromEntries(Object.entries(BOARDING).map(([id, count]) => [id, count * sets]));

type Row = {
  preset:string; sets:number; anchor:Anchor;
  ok:boolean; pieces:number; panels:number; leftover:number;
  metrics:Metrics | null; note:string; rejected:Record<string, number>;
};

const run = (preset:BoardPreset, sets:number, anchor:Anchor, seed:number):Row => {
  const { width, height } = BOARD_SIZES[preset];
  let uid = 0;
  const report = generate({
    boardWidth:width, boardHeight:height, catalogue:"boarding",
    defs:TERRAIN, inventory:setsOf(sets), heights:{}, zones:[], anchor,
    seed, nextUid:() => `u${uid++}`,
  });
  return {
    preset, sets, anchor,
    ok:!!report.metrics,
    pieces:report.pieces.length,
    panels:report.plan?.panelEdges.length ?? 0,
    leftover:report.leftover,
    metrics:report.metrics,
    note:report.note,
    rejected:report.rejected,
  };
};

const stats = (values:number[]) => {
  if (!values.length) return { n:0, mean:0, sd:0, min:0, max:0, p10:0, p90:0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const at = (q:number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n:values.length, mean, sd, min:sorted[0], max:sorted[sorted.length - 1], p10:at(.1), p90:at(.9) };
};

const fmt = (value:number, places = 2) => value.toFixed(places).padStart(7);

// ---------------------------------------------------------------------------

const RUNS = Number(process.argv[2] ?? 100);
const PRESETS:BoardPreset[] = ["card", "cardx2", "30x22", "24x24", "48x24", "48x48"];
const SETS = [1, 2, 4];

const rows:Row[] = [];
let seed = 1;
for (const preset of PRESETS) {
  for (const sets of SETS) {
    for (let i = 0; i < RUNS; i++) rows.push(run(preset, sets, "auto", (seed += 7919) >>> 0));
  }
}

console.log(`\n=== SOAK: ${rows.length} generations (${RUNS} per preset x sets) ===\n`);

// 1. Hard failures first. A generator that returns nothing is the only truly
//    unacceptable outcome, so it is counted before anything is described.
const failures = rows.filter((row) => !row.ok);
console.log(`FAILURES: ${failures.length}/${rows.length} (${(failures.length / rows.length * 100).toFixed(1)}%)`);
if (failures.length) {
  const byCase = new Map<string, number>();
  failures.forEach((row) => {
    const key = `${row.preset} x${row.sets}`;
    byCase.set(key, (byCase.get(key) ?? 0) + 1);
  });
  [...byCase].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => console.log(`  ${key}: ${count}`));
  const reasons = new Map<string, number>();
  failures.forEach((row) => Object.entries(row.rejected).forEach(([rule, count]) => reasons.set(rule, (reasons.get(rule) ?? 0) + count)));
  console.log("  rejection reasons:", [...reasons].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} x${c}`).join(", ") || "none");
}

// 2. Empty or near-empty boards that still reported success. A board with three
//    panels on it is a failure the invariants do not catch, because everything it
//    does contain is legal.
const anaemic = rows.filter((row) => row.ok && row.panels < 8);
console.log(`\nANAEMIC (ok but < 8 panels): ${anaemic.length}/${rows.length}`);
if (anaemic.length) {
  const byCase = new Map<string, number[]>();
  anaemic.forEach((row) => {
    const key = `${row.preset} x${row.sets}`;
    byCase.set(key, [...(byCase.get(key) ?? []), row.panels]);
  });
  [...byCase].forEach(([key, panels]) => console.log(`  ${key}: ${panels.length} runs, panels ${Math.min(...panels)}-${Math.max(...panels)}`));
}

// 3. Per-case description. The reference is what a real board measures, so the
//    question for each cell of the matrix is whether it lands near it.
console.log("\n=== PER CASE ===");
console.log("case              runs  fail  panels(mean)   density        sight mean     sight max      run mean     rooms");
for (const preset of PRESETS) {
  for (const sets of SETS) {
    const group = rows.filter((row) => row.preset === preset && row.sets === sets);
    const good = group.filter((row) => row.ok);
    const metric = (pick:(m:Metrics) => number) => stats(good.map((row) => pick(row.metrics!)));
    const panels = stats(good.map((row) => row.panels));
    const density = metric((m) => m.density);
    const sight = metric((m) => m.meanSight);
    const worst = metric((m) => m.longestSight);
    const runLen = metric((m) => m.meanRun);
    const rooms = metric((m) => m.meanRoom);
    console.log(
      `${`${preset} x${sets}`.padEnd(18)}${String(group.length).padStart(4)}${String(group.length - good.length).padStart(6)}`
      + `${fmt(panels.mean, 1)}       ${fmt(density.mean)}        ${fmt(sight.mean)}        ${fmt(worst.mean, 1)}`
      + `        ${fmt(runLen.mean)}     ${fmt(rooms.mean, 1)}`,
    );
  }
}

// 4. Distance from the reference board, which is the single number the generator
//    is actually optimising, so its distribution is the headline result.
console.log("\n=== VS REFERENCE BOARD ===");
const keys:(keyof Metrics)[] = ["density", "meanSight", "longestSight", "meanRun", "longestSolidRun", "junctionShare", "meanRoom", "roomSpread", "deadEndShare", "hatchShare"];
console.log("metric            target     mean       sd      p10      p90     |  within 25%");
keys.forEach((key) => {
  const good = rows.filter((row) => row.ok);
  const values = good.map((row) => row.metrics![key]);
  const s = stats(values);
  const target = PROVISIONAL_REFERENCE[key];
  const scale = Math.max(Math.abs(target), .25);
  const within = values.filter((v) => Math.abs(v - target) / scale <= .25).length;
  const flag = within / values.length < .6 ? "  <-- OFF" : "";
  console.log(
    `${key.padEnd(16)}${fmt(target)}  ${fmt(s.mean)}  ${fmt(s.sd)}  ${fmt(s.p10)}  ${fmt(s.p90)}`
    + `     ${`${(within / values.length * 100).toFixed(0)}%`.padStart(5)}${flag}`,
  );
});

// 5. Remix stability. The bug this rig was built to catch: repeatedly regenerating
//    from the board's own contents shrank the stock every pass, so four clicks took
//    a full board down to nothing. A remix must be lossless.
console.log("\n=== REMIX STABILITY (25 chained remixes, palette-backed stock) ===");
for (const preset of ["card", "48x48"] as BoardPreset[]) {
  const { width, height } = BOARD_SIZES[preset];
  const palette = setsOf(preset === "48x48" ? 4 : 1);
  let uid = 0;
  let placed:Record<string, number> = {};
  const counts:number[] = [];
  for (let step = 0; step < 25; step++) {
    // Exactly what page.tsx now does: stock is the palette or the board, whichever
    // holds more of each piece.
    const inventory = Object.fromEntries(Object.keys(palette).map((id) => [id, Math.max(palette[id] ?? 0, placed[id] ?? 0)]));
    const report = generate({
      boardWidth:width, boardHeight:height, catalogue:"boarding",
      defs:TERRAIN, inventory, heights:{}, zones:[], anchor:"auto",
      seed:(step * 2654435761 + 11) >>> 0, nextUid:() => `u${uid++}`,
    });
    placed = report.pieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]:(acc[piece.defId] ?? 0) + 1 }), {});
    counts.push(report.pieces.length);
  }
  const decayed = counts[counts.length - 1] < counts[0] * .8;
  console.log(`${preset}: ${counts.join(" -> ")}`);
  console.log(`  ${decayed ? "DECAY DETECTED" : "stable"} (first ${counts[0]}, last ${counts[counts.length - 1]}, min ${Math.min(...counts)})`);
}

// 6. The lossy version, kept as a control so the fix is demonstrably a fix rather
//    than a coincidence of seeds.
console.log("\n=== REMIX STABILITY, OLD BOARD-DERIVED STOCK (control, expected to decay) ===");
{
  const { width, height } = BOARD_SIZES.card;
  let uid = 0;
  let inventory = setsOf(1);
  const counts:number[] = [];
  for (let step = 0; step < 6; step++) {
    const report = generate({
      boardWidth:width, boardHeight:height, catalogue:"boarding",
      defs:TERRAIN, inventory, heights:{}, zones:[], anchor:"auto",
      seed:(step * 2654435761 + 11) >>> 0, nextUid:() => `u${uid++}`,
    });
    counts.push(report.pieces.length);
    inventory = report.pieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]:(acc[piece.defId] ?? 0) + 1 }), {});
  }
  console.log(`card: ${counts.join(" -> ")}`);
}
