/**
 * Generator invariants.
 *
 * Two rules govern this suite, both learned the hard way.
 *
 * **Single shot.** Every assertion runs against ONE call to `generate` per seed.
 * The previous suite generated 24 candidates and kept the best, so it never saw
 * what a single call returned — which is precisely where the failure was hiding.
 * With 11 green tests, the Boarding Actions generator was emitting six panels and
 * no pillars from a 68-piece box, and nothing in the suite could tell.
 *
 * **No lower bounds on quantity.** `structures >= 5` and `supports >= 4` are
 * satisfied by a scatter of fragments. What is asserted here instead is that the
 * board is BUILDABLE and CONNECTED — properties a broken board cannot fake — plus
 * the specific geometry that the kit makes true.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { TERRAIN, BOARDING_INVENTORY, BOARD_SIZES, GALLOWDARK_GRID } from "../app/terrain.ts";
import { generate, readKit, type KitDef } from "../app/generate.ts";
import { invariants, measure } from "../app/validate.ts";
import {
  columnBite, edgeKey, edgeRuns, fullyConnected, internalEdgeCount, nodesOfEdge,
  pitchIsBuildable, sightLines,
} from "../app/lattice.ts";

const MM = 25.4;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

let counter = 0;
const nextUid = () => `test-${++counter}`;

const defs = TERRAIN as KitDef[];
const heights = Object.fromEntries(TERRAIN.map((def) => [def.id, def.height]));

const scaled = (sets:number) =>
  Object.fromEntries(Object.entries(BOARDING_INVENTORY).map(([id, count]) => [id, count * sets]));

const run = (options:{
  width?:number; height?:number; sets?:number; seed?:number;
  catalogue?:"boarding" | "ttcombat"; inventory?:Record<string, number>;
  anchor?:"auto" | "corner" | "edge" | "centre";
} = {}) => {
  const width = options.width ?? BOARD_SIZES.card.width;
  const height = options.height ?? BOARD_SIZES.card.height;
  const report = generate({
    boardWidth:width, boardHeight:height,
    catalogue:options.catalogue ?? "boarding",
    defs,
    inventory:options.inventory ?? scaled(options.sets ?? 1),
    heights, zones:[],
    anchor:options.anchor,
    seed:options.seed ?? 1,
    nextUid,
  });
  return { report, width, height };
};

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

test("the catalogue matches the verified contents of the Boarding Actions set", () => {
  // 68 pieces: 32 panels, 32 pillars, 4 wall ends. Guards against the data drifting
  // back to the fabricated `limit: 4` on everything, and against the opposite
  // error — the previous handoff was confident these numbers were wrong when they
  // were right, and rewrote the generator's hatchway policy around that belief.
  const boarding = TERRAIN.filter((def) => def.catalogue === "boarding");
  const total = boarding.reduce((sum, def) => sum + def.limit, 0);
  assert.equal(total, 68, "the set holds 68 pieces");

  const panels = boarding.filter((def) => def.kind === "wall" || def.kind === "door");
  assert.equal(panels.reduce((sum, def) => sum + def.limit, 0), 32, "32 of them are panels");
  assert.equal(
    boarding.filter((def) => def.kind === "door").reduce((sum, def) => sum + def.limit, 0), 20,
    "20 panels carry a hatchway — hatchways are the kit's primary building material",
  );
  assert.equal(boarding.find((def) => def.kind === "pillar")?.limit, 32);
  assert.equal(boarding.find((def) => def.kind === "end")?.limit, 4);
});

test("the Gallowdark grid is the panel length, and the card board divides by it", () => {
  // 704 x 607 mm is exactly 7 x 97 + 25 by 6 x 97 + 25. If this stops holding, the
  // pitch has been changed to something the kit cannot build.
  assert.ok(Math.abs(GALLOWDARK_GRID - 97 / MM) < 1e-9, "the pitch is 97 mm");
  assert.equal(Math.round(704 - 7 * 97), 25, "seven squares across a card board, 25 mm of border");
  assert.equal(Math.round(607 - 6 * 97), 25, "six squares down a card board, 25 mm of border");
});

test("a panel reaches the pillars it clips into, on every kit in the catalogue", () => {
  (["boarding", "ttcombat"] as const).forEach((catalogue) => {
    const inventory = catalogue === "boarding"
      ? scaled(1)
      : Object.fromEntries(TERRAIN.filter((def) => def.catalogue === "ttcombat").map((def) => [def.id, def.limit]));
    const kit = readKit(defs, inventory, catalogue);
    assert.ok(kit, `${catalogue} should read`);
    const shortest = Math.min(...kit.buildDefs.filter((def) => def.cells === 1).map((def) => def.length));
    assert.ok(
      pitchIsBuildable(shortest, kit.pitch, kit.support),
      `${catalogue}: a ${shortest.toFixed(2)}" panel on a ${kit.pitch.toFixed(2)}" pitch with `
      + `${kit.support.toFixed(2)}" columns leaves ${columnBite(shortest, kit.pitch, kit.support).toFixed(3)}" of joint`,
    );
  });
});

test("the 125 mm pitch that broke the last generator is refused outright", () => {
  // The specific regression: at that pitch a short panel ends 0.256" short of its
  // pillar, so the layout cannot be assembled. It has to be rejected rather than
  // built and then patched, because patching it is what produced six-piece boards.
  const broken = defs.map((def) => def.catalogue === "boarding" && def.span
    ? { ...def, span:def.span * (125 / 97) }
    : def);
  const report = generate({
    boardWidth:BOARD_SIZES.card.width, boardHeight:BOARD_SIZES.card.height,
    catalogue:"boarding", defs:broken, inventory:scaled(1), heights, zones:[],
    seed:1, nextUid,
  });
  assert.equal(report.pieces.length, 0, "nothing should be built on an unbuildable grid");
  assert.match(report.note, /unbuildable grid/);
});

// ---------------------------------------------------------------------------
// Single-shot invariants
// ---------------------------------------------------------------------------

test("one call, on every board and set count, breaks no invariant", () => {
  const boards = Object.entries(BOARD_SIZES);
  boards.forEach(([name, size]) => [1, 2, 4].forEach((sets) => SEEDS.slice(0, 4).forEach((seed) => {
    const { report } = run({ width:size.width, height:size.height, sets, seed });
    assert.ok(report.plan, `${name} x${sets} seed ${seed}: nothing built — ${report.note}`);
    const defMap = new Map(readKit(defs, scaled(sets), "boarding")!.buildDefs.map((def) => [def.id, def]));
    const failures = invariants({
      plan:report.plan, pieces:report.pieces, defs:defMap, inventory:scaled(sets),
      boardWidth:size.width, boardHeight:size.height, maxSight:8,
    });
    assert.deepEqual(
      failures.map((failure) => `${failure.rule}: ${failure.detail}`), [],
      `${name} x${sets} seed ${seed}`,
    );
  })));
});

test("every square is reachable from every other", () => {
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    assert.ok(report.plan, `seed ${seed}: nothing built`);
    assert.ok(
      fullyConnected(report.plan.lattice, report.plan.state),
      `seed ${seed}: the board has walled-off squares`,
    );
  });
});

test("no firing lane runs the length of the board", () => {
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    const sight = sightLines(report.plan!.lattice, report.plan!.state);
    const span = Math.max(report.plan!.lattice.cols, report.plan!.lattice.rows);
    assert.ok(
      sight.longest < span,
      `seed ${seed}: an open lane of ${sight.longest} squares across a board ${span} squares wide`,
    );
  });
});

test("every wall run is tiled end to end, with no hole in the middle", () => {
  // The old tiler skipped a cell when stock ran short and carried on down the run,
  // which puts a gap in the middle of a bulkhead. A run must be complete or the
  // plan must be revised.
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    const plan = report.plan!;
    edgeRuns(plan.panelEdges).forEach((edgeRun) => {
      const covered = edgeRun.filter((edge) => plan.state.get(edgeKey(edge)) !== "open");
      assert.equal(
        covered.length, edgeRun.length,
        `seed ${seed}: a run of ${edgeRun.length} carries only ${covered.length} panels`,
      );
    });
  });
});

test("every panel end stands on a pillar, or on the board edge", () => {
  // Checked across the whole layout. The old suite filtered to walls it had already
  // matched to a pair of pillars, so a panel with nothing at its ends was excluded
  // from the very test that existed to catch it.
  SEEDS.forEach((seed) => {
    const { report, width, height } = run({ seed });
    const kit = readKit(defs, scaled(1), "boarding")!;
    const defMap = new Map(kit.buildDefs.map((def) => [def.id, def]));
    const failures = invariants({
      plan:report.plan!, pieces:report.pieces, defs:defMap, inventory:scaled(1),
      boardWidth:width, boardHeight:height, maxSight:99,
    }).filter((failure) => failure.rule === "bracketed");
    assert.deepEqual(failures.map((failure) => failure.detail), [], `seed ${seed}`);
  });
});

test("a pillar sits at every node where panels meet, and nowhere else", () => {
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    const plan = report.plan!;
    const kit = readKit(defs, scaled(1), "boarding")!;
    const nodeKinds = new Set(["pillar", "connector", "end"]);
    const supports = report.pieces.filter((piece) =>
      nodeKinds.has(kit.buildDefs.find((def) => def.id === piece.defId)?.kind ?? ""));
    // Every support is at a node a panel actually reaches. A support standing on its
    // own is what the old orphan sweep existed to delete.
    const panelNodes = new Set(plan.panelEdges.flatMap((edge) =>
      nodesOfEdge(edge).map((node) => {
        const x = plan.lattice.originX + node.col * plan.lattice.pitchX;
        const y = plan.lattice.originY + node.row * plan.lattice.pitchY;
        return `${x.toFixed(2)}:${y.toFixed(2)}`;
      })));
    supports.forEach((support) => {
      const def = kit.buildDefs.find((candidate) => candidate.id === support.defId)!;
      const centreX = support.x + (support.rotation === 90 ? def.depth : def.length) / 2;
      const centreY = support.y + (support.rotation === 90 ? def.length : def.depth) / 2;
      assert.ok(
        panelNodes.has(`${centreX.toFixed(2)}:${centreY.toFixed(2)}`),
        `seed ${seed}: a ${support.defId} stands at ${centreX.toFixed(2)},${centreY.toFixed(2)} with no panel reaching it`,
      );
    });
  });
});

test("no more of a piece is used than the palette owns", () => {
  [1, 2].forEach((sets) => SEEDS.forEach((seed) => {
    const inventory = scaled(sets);
    const { report } = run({ sets, seed });
    const used = new Map<string, number>();
    report.pieces.forEach((piece) => used.set(piece.defId, (used.get(piece.defId) ?? 0) + 1));
    used.forEach((count, id) => assert.ok(
      count <= (inventory[id] ?? 0),
      `x${sets} seed ${seed}: used ${count} ${id} of ${inventory[id] ?? 0}`,
    ));
  }));
});

test("hatchways are used as the kit ships them, not as filler or as a rarity", () => {
  // The kit is 20 hatchway panels to 12 solid, so a board that is nearly all doors
  // and a board with one door in eight panels are both wrong. This brackets it from
  // both sides, which neither of the two previous regressions would have survived.
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    const metrics = measure(report.plan!);
    assert.ok(
      metrics.hatchShare > .2 && metrics.hatchShare < .8,
      `seed ${seed}: ${(metrics.hatchShare * 100).toFixed(0)}% of panels carry a hatchway`,
    );
  });
});

// ---------------------------------------------------------------------------
// Sets and footprint
// ---------------------------------------------------------------------------

test("one set fills one card board, and the app says so", () => {
  const { report } = run({ sets:1 });
  assert.ok(report.greed >= .9, `one set should fill a card board, greed was ${report.greed.toFixed(2)}`);
  assert.equal(report.plan!.lattice.cols, 7);
  assert.equal(report.plan!.lattice.rows, 6);
});

test("more sets grow the footprint rather than thickening the walls", () => {
  // The point of the set multiplier. A bigger palette on a big board must spread,
  // because cramming it into the same footprint gives a compartment per square.
  const footprint = (sets:number) => {
    const { report } = run({ width:48, height:48, sets, seed:3 });
    assert.ok(report.plan, `x${sets}: nothing built — ${report.note}`);
    return { cells:report.plan.lattice.cols * report.plan.lattice.rows, density:measure(report.plan).density };
  };
  const one = footprint(1);
  const four = footprint(4);
  assert.ok(four.cells > one.cells, `four sets covered ${four.cells} squares against one set's ${one.cells}`);
  assert.ok(
    four.density < one.density * 1.4,
    `density went from ${one.density.toFixed(2)} to ${four.density.toFixed(2)} — the surplus should go into footprint`,
  );
});

test("a palette too small for the board is told to fill part of it, not all of it thinly", () => {
  const { report } = run({ width:48, height:48, sets:1, seed:2 });
  assert.ok(report.greed < 1, "one set cannot fill a 4' x 4' board");
  assert.ok(report.setsToFill > 1, "it should say how many sets would");
  assert.match(report.note, /fills about \d+% of the board/);
  // And it must still be dense within its own footprint — that is the whole point of
  // building small rather than spreading thin.
  assert.ok(
    measure(report.plan!).density > .35,
    `the complex itself measured ${measure(report.plan!).density.toFixed(2)} density`,
  );
});

test("anchoring puts a small complex where it was asked to go", () => {
  const board = 48;
  const place = (anchor:"corner" | "centre") => {
    const { report } = run({ width:board, height:board, sets:1, seed:5, anchor });
    const lattice = report.plan!.lattice;
    return {
      anchor:report.anchor,
      left:lattice.originX,
      right:board - (lattice.originX + lattice.cols * lattice.pitchX),
      top:lattice.originY,
      bottom:board - (lattice.originY + lattice.rows * lattice.pitchY),
    };
  };
  const corner = place("corner");
  assert.equal(corner.anchor, "corner");
  assert.ok(
    Math.min(corner.left, corner.right) < 1 && Math.min(corner.top, corner.bottom) < 1,
    `a corner anchor should be flush on both axes, got margins ${JSON.stringify(corner)}`,
  );

  const centre = place("centre");
  assert.ok(
    Math.abs(centre.left - centre.right) < .01 && Math.abs(centre.top - centre.bottom) < .01,
    `a centred island should be even on both axes, got ${JSON.stringify(centre)}`,
  );
});

test("a reserved zone is left clear without cutting holes in the walls", () => {
  // The old generator deleted pieces that landed in a zone, which left bulkheads
  // with gaps. The complex is moved instead, so the zone stays clear and the walls
  // stay whole.
  const width = 48, height = 48;
  const zone = { x:2, y:2, width:14, height:14 };
  const report = generate({
    boardWidth:width, boardHeight:height, catalogue:"boarding", defs,
    inventory:scaled(1), heights, zones:[zone], seed:4, nextUid,
  });
  assert.ok(report.plan, `nothing built — ${report.note}`);
  const kit = readKit(defs, scaled(1), "boarding")!;
  const failures = invariants({
    plan:report.plan, pieces:report.pieces, defs:new Map(kit.buildDefs.map((def) => [def.id, def])),
    inventory:scaled(1), boardWidth:width, boardHeight:height, maxSight:8,
  });
  assert.deepEqual(failures.map((failure) => failure.rule), [], "zones must not cost invariants");
});

// ---------------------------------------------------------------------------
// Iron Labyrinth
// ---------------------------------------------------------------------------

test("Iron Labyrinth builds on its own joint model", () => {
  // The other kit meets its columns differently: the wall sits BETWEEN two
  // connector blocks rather than slotting into one that straddles the corner, so
  // the square is wall plus connector. The generator must derive that rather than
  // assume Gallowdark's.
  const ultima = TERRAIN_ULTIMA;
  const kit = readKit(defs, ultima, "ttcombat")!;
  assert.ok(
    Math.abs(kit.pitch - (64 + 50) / MM) < .02,
    `Iron Labyrinth should run a 114 mm pitch, got ${(kit.pitch * MM).toFixed(0)} mm`,
  );
  const report = generate({
    boardWidth:BOARD_SIZES["24x24"].width, boardHeight:BOARD_SIZES["24x24"].height,
    catalogue:"ttcombat", defs, inventory:ultima, heights, zones:[], seed:1, nextUid,
  });
  assert.ok(report.plan, `nothing built — ${report.note}`);
  assert.ok(fullyConnected(report.plan.lattice, report.plan.state), "the Iron board must be walkable throughout");
});

const TERRAIN_ULTIMA:Record<string, number> = {
  "tt-connector":24, "tt-wall-end":21, "tt-solid-wall":8, "tt-grid-wall":2,
  "tt-solid-pipe-wall":2, "tt-vertical-pipe-wall":2, "tt-reinforced-pipe-wall":2, "tt-fan-wall":2,
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the same seed builds the same board", () => {
  const shape = (report:{ pieces:{ defId:string; x:number; y:number }[] }) =>
    report.pieces.map((piece) => `${piece.defId}@${piece.x.toFixed(3)},${piece.y.toFixed(3)}`).sort().join("|");
  assert.equal(shape(run({ seed:11 }).report), shape(run({ seed:11 }).report));
  assert.notEqual(shape(run({ seed:11 }).report), shape(run({ seed:12 }).report));
});

test("internal edge counts are what the density budget assumes", () => {
  // One set is 48 wall-cells and a 7 x 6 card board has 71 internal edges, which is
  // where reference density comes from. If this arithmetic drifts, every sizing
  // decision in the generator drifts with it.
  assert.equal(internalEdgeCount(7, 6), 71);
  const kit = readKit(defs, scaled(1), "boarding")!;
  assert.equal(kit.capacity, 48, "16 short panels and 16 long ones cover 48 squares of wall");
  assert.equal(kit.doorways, 20);
  assert.equal(kit.columns, 32);
});
