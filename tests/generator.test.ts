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

import {
  TERRAIN, TERRAIN_KITS, BOARDING_INVENTORY, BOARD_SIZES, DEATHRAY_GRID, EBERLEG_GRID,
  GALLOWDARK_GRID, MORTALIS_GRID, MM_PER_IN as MM,
  type CatalogueId,
} from "../app/terrain.ts";
import { cellsThatFit, generate, readKit, type KitDef } from "../app/generate.ts";
import { invariants, measure, PROVISIONAL_REFERENCE } from "../app/validate.ts";
import {
  columnBite, edgeKey, edgeRuns, fullyConnected, internalEdgeCount, isBorderEdge, nodesOfEdge,
  pitchIsBuildable, sightLines, spanWorld,
} from "../app/lattice.ts";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

let counter = 0;
const nextUid = () => `test-${++counter}`;

const defs = TERRAIN as KitDef[];
const heights = Object.fromEntries(TERRAIN.map((def) => [def.id, def.height]));

const scaled = (sets:number) =>
  Object.fromEntries(Object.entries(BOARDING_INVENTORY).map(([id, count]) => [id, count * sets]));

const run = (options:{
  width?:number; height?:number; sets?:number; seed?:number;
  catalogue?:CatalogueId; inventory?:Record<string, number>;
  anchor?:"auto" | "corner" | "edge" | "centre" | "fill";
  zones?:Array<{ x:number; y:number; width:number; height:number }>;
} = {}) => {
  const width = options.width ?? BOARD_SIZES.card.width;
  const height = options.height ?? BOARD_SIZES.card.height;
  const report = generate({
    boardWidth:width, boardHeight:height,
    catalogue:options.catalogue ?? "boarding",
    defs,
    inventory:options.inventory ?? scaled(options.sets ?? 1),
    heights, zones:options.zones ?? [],
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

test("Eberleg castings close on one measured 152.4 mm node grid", () => {
  const byId = new Map(TERRAIN.map((def) => [def.id, def]));
  const mm = (id:string, side:"width" | "depth") => byId.get(id)![side] * MM;
  assert.ok(Math.abs(EBERLEG_GRID * MM - 152.4) < 1e-9);
  assert.ok(Math.abs(mm("eb-column", "width") - 51.91) < 1e-9);
  assert.ok(Math.abs(mm("eb-stub", "width") - 102.16) < 1e-9);
  assert.ok(Math.abs(mm("eb-wall", "width") - 152.4) < 1e-9);
  assert.ok(Math.abs(mm("eb-corner", "width") - 102.16) < 1e-9);
  assert.ok(Math.abs(mm("eb-t-intersection", "width") - 152.4) < 1e-9);

  // Centre-to-end reach of every armed casting is half a pitch. This is the
  // physical reason adjacent castings meet directly without an inserted column
  // or single-wall shim.
  const hubHalf = mm("eb-column", "width") / 2;
  const armReach = mm("eb-stub", "width") - hubHalf;
  assert.ok(Math.abs(armReach - EBERLEG_GRID * MM / 2) < .01);
});

test("Zone Mortalis and Deadbolt use measured six-inch-class bays, not two-inch nodes", () => {
  assert.ok(Math.abs(MORTALIS_GRID * MM - 147) < 1e-9);
  assert.ok(Math.abs(DEATHRAY_GRID * MM - 152.4) < 1e-9);
  const mortalis = readKit(defs, TERRAIN_KITS.find((kit) => kit.id === "zm-columns-and-walls")!.inventory, "mortalis")!;
  const deadboltInventory = Object.fromEntries(TERRAIN_KITS
    .filter((kit) => kit.catalogue === "deathray")
    .flatMap((kit) => Object.entries(kit.inventory))
    .map(([id, count]) => [id, count]));
  const deadbolt = readKit(defs, deadboltInventory, "deathray")!;
  assert.equal(mortalis.cells.get("zm-wall"), .5);
  assert.equal(mortalis.cells.get("zm-wide-wall"), 1);
  assert.equal(deadbolt.cells.get("drd-single-wall"), .5);
  assert.equal(deadbolt.cells.get("drd-double-wall"), 1);
});

test("Zone Mortalis spends solid walls before doors across a 50-board batch", () => {
  const inventory = Object.fromEntries(TERRAIN
    .filter((def) => def.catalogue === "mortalis" && def.kind !== "scatter")
    .map((def) => [def.id, def.limit * 4]));
  for (let seed = 0; seed < 50; seed++) {
    const { report } = run({ width:48, height:48, catalogue:"mortalis", inventory, seed });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);
    const doors = report.pieces.filter((piece) => piece.defId === "zm-door" || piece.defId === "zm-wide-door");
    assert.ok(doors.every((piece) => piece.servesDoorway === true),
      `seed ${seed}: a dedicated Zone Mortalis door was used as a wall`);
    const shortWalls = report.pieces.filter((piece) => piece.defId === "zm-wall").length;
    assert.ok(shortWalls >= 14,
      `seed ${seed}: only ${shortWalls} of 16 short solid walls were used`);
  }
});

test("Zone Mortalis and Deadbolt build around a large reserved hangar in one shot", () => {
  for (const catalogue of ["mortalis", "deathray"] as const) {
    const inventory = Object.fromEntries(TERRAIN_KITS
      .filter((kit) => kit.catalogue === catalogue)
      .flatMap((kit) => Object.entries(kit.inventory))
      .map(([id, count]) => [id, count]));
    SEEDS.forEach((seed) => {
      const { report } = run({
        width:48, height:48, catalogue, inventory, anchor:"fill", seed,
        zones:[{ x:0, y:0, width:24, height:24 }],
      });
      assert.ok(report.plan, `${catalogue} seed ${seed}: nothing built — ${report.note}`);
      assert.ok(report.pieces.length >= (catalogue === "deathray" ? 20 : 6),
        `${catalogue} seed ${seed}: collapsed to ${report.pieces.length} pieces`);
    });
  }
});

test("Eberleg never uses more singles than its four-way nodes require", () => {
  const kit = TERRAIN_KITS.find((candidate) => candidate.id === "eberleg-all")!;
  SEEDS.forEach((seed) => {
    const { report } = run({
      width:48, height:48, catalogue:"eberleg", inventory:kit.inventory,
      anchor:"fill", seed,
    });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);

    const degree = new Map<string, number>();
    const builtEdges = report.plan!.panelEdges.filter((edge) =>
      !isBorderEdge(report.lattice!, edge) || report.plan!.exterior.has(edgeKey(edge)));
    builtEdges.forEach((edge) => nodesOfEdge(edge).forEach((node) => {
      const key = `${node.col}:${node.row}`;
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }));
    const fourWayNodes = [...degree.values()].filter((value) => value === 4).length;
    const singles = report.pieces.filter((piece) => piece.defId === "eb-single-wall").length;
    assert.ok(
      singles <= fourWayNodes,
      `seed ${seed}: a loose single was used where a direct node casting should make the connection`,
    );

    // Bare columns are legitimate beside a full-width door, whose frame replaces
    // both solid arms. They must not reappear as column + single-wall run ends.
    const columns = report.pieces.filter((piece) => piece.defId === "eb-column").length;
    const wideDoors = report.pieces.filter((piece) => piece.defId === "eb-wide-door").length;
    assert.ok(columns <= wideDoors * 2, `seed ${seed}: ${columns} bare columns are not accounted for by ${wideDoors} doors`);
  });
});

test("a doorway cannot be walked around at the end of its own panel", () => {
  const kit = TERRAIN_KITS.find((candidate) => candidate.id === "eberleg-all")!;
  SEEDS.forEach((seed) => {
    const { report } = run({ width:48, height:48, catalogue:"eberleg", inventory:kit.inventory, anchor:"fill", seed });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);
    const { lattice, state } = report.plan!;
    const inside = (edge:{ axis:"h" | "v"; col:number; row:number }) => edge.axis === "h"
      ? edge.col >= 0 && edge.col < lattice.cols && edge.row >= 0 && edge.row <= lattice.rows
      : edge.col >= 0 && edge.col <= lattice.cols && edge.row >= 0 && edge.row < lattice.rows;
    const open = (edge:{ axis:"h" | "v"; col:number; row:number }) =>
      inside(edge) && (state.get(edgeKey(edge)) ?? "open") === "open";
    report.plan!.panelEdges.filter((edge) => state.get(edgeKey(edge)) === "hatch").forEach((edge) => {
      const routes = edge.axis === "h"
        ? [
            [{ axis:"v" as const, col:edge.col, row:edge.row - 1 }, { axis:"h" as const, col:edge.col - 1, row:edge.row }, { axis:"v" as const, col:edge.col, row:edge.row }],
            [{ axis:"v" as const, col:edge.col + 1, row:edge.row - 1 }, { axis:"h" as const, col:edge.col + 1, row:edge.row }, { axis:"v" as const, col:edge.col + 1, row:edge.row }],
          ]
        : [
            [{ axis:"h" as const, col:edge.col - 1, row:edge.row }, { axis:"v" as const, col:edge.col, row:edge.row - 1 }, { axis:"h" as const, col:edge.col, row:edge.row }],
            [{ axis:"h" as const, col:edge.col - 1, row:edge.row + 1 }, { axis:"v" as const, col:edge.col, row:edge.row + 1 }, { axis:"h" as const, col:edge.col, row:edge.row + 1 }],
          ];
      assert.equal(routes.some((route) => route.every(open)), false, `seed ${seed}: ${edgeKey(edge)} has an immediate walk-around`);
    });
  });
});

test("Boarding Actions doorways cannot be walked around at the end of their panel", () => {
  SEEDS.forEach((seed) => {
    const { report } = run({ width:48, height:48, sets:4, anchor:"fill", seed });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);
    const { lattice, state } = report.plan!;
    const inside = (edge:{ axis:"h" | "v"; col:number; row:number }) => edge.axis === "h"
      ? edge.col >= 0 && edge.col < lattice.cols && edge.row >= 0 && edge.row <= lattice.rows
      : edge.col >= 0 && edge.col <= lattice.cols && edge.row >= 0 && edge.row < lattice.rows;
    const open = (edge:{ axis:"h" | "v"; col:number; row:number }) =>
      inside(edge) && (state.get(edgeKey(edge)) ?? "open") === "open";
    report.plan!.panelEdges.filter((edge) => state.get(edgeKey(edge)) === "hatch").forEach((edge) => {
      const routes = edge.axis === "h"
        ? [
            [{ axis:"v" as const, col:edge.col, row:edge.row - 1 }, { axis:"h" as const, col:edge.col - 1, row:edge.row }, { axis:"v" as const, col:edge.col, row:edge.row }],
            [{ axis:"v" as const, col:edge.col + 1, row:edge.row - 1 }, { axis:"h" as const, col:edge.col + 1, row:edge.row }, { axis:"v" as const, col:edge.col + 1, row:edge.row }],
          ]
        : [
            [{ axis:"h" as const, col:edge.col - 1, row:edge.row }, { axis:"v" as const, col:edge.col, row:edge.row - 1 }, { axis:"h" as const, col:edge.col, row:edge.row }],
            [{ axis:"h" as const, col:edge.col - 1, row:edge.row + 1 }, { axis:"v" as const, col:edge.col, row:edge.row + 1 }, { axis:"h" as const, col:edge.col, row:edge.row + 1 }],
          ];
      assert.equal(routes.some((route) => route.every(open)), false, `seed ${seed}: ${edgeKey(edge)} has an immediate walk-around`);
    });
  });
});

test("long Boarding Actions panels never cross, and hatchways never occupy a junction", () => {
  SEEDS.forEach((seed) => {
    const { report } = run({ width:48, height:48, sets:4, anchor:"fill", seed });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);
    const { lattice, state } = report.plan!;
    const carries = (axis:"h" | "v", col:number, row:number) => {
      const value = state.get(`${axis}:${col}:${row}`);
      return value === "wall" || value === "hatch";
    };
    const long = new Set(TERRAIN.filter((def) => def.catalogue === "boarding" && def.span === GALLOWDARK_GRID * 2).map((def) => def.id));
    const midpoints = new Map<string, Set<"h" | "v">>();
    report.pieces.filter((piece) => long.has(piece.defId)).forEach((piece) => {
      const def = TERRAIN.find((candidate) => candidate.id === piece.defId)!;
      const centreX = piece.x + (piece.rotation === 90 ? def.depth : def.width) / 2;
      const centreY = piece.y + (piece.rotation === 90 ? def.width : def.depth) / 2;
      const col = Math.round((centreX - lattice.originX) / lattice.pitchX);
      const row = Math.round((centreY - lattice.originY) / lattice.pitchY);
      const incident = Number(carries("h", col - 1, row)) + Number(carries("h", col, row))
        + Number(carries("v", col, row - 1)) + Number(carries("v", col, row));
      if (def.kind === "door") assert.equal(incident, 2, `${piece.defId} occupies a ${incident}-way junction at ${col}:${row}`);
      const key = `${col}:${row}`;
      const axes = midpoints.get(key) ?? new Set<"h" | "v">();
      axes.add(piece.rotation === 90 ? "v" : "h");
      midpoints.set(key, axes);
    });
    [...midpoints].forEach(([key, axes]) => assert.equal(axes.size, 1, `long panels cross without a connector at ${key}`));
  });
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

test("doorways are tactical and rare, not a way to spend hatchway panels as walls", () => {
  // This test replaces one that asserted the OPPOSITE, and the story is worth keeping
  // because the number looked well-founded. The old test bracketed `hatchShare` between
  // 0.2 and 0.8 on the reasoning that the box holds 20 hatchway panels to 12 solid, so a
  // board with few doors must be wrong. But "62% of the panels you own have a door
  // moulded into them" is a fact about the BOX; it says nothing about how many EDGES
  // should be a way through. A hatchway panel standing in a wall run with its door shut
  // is a wall.
  //
  // Conflating the two produced 63 doorways on a four-set board, 43% of every panel
  // placed, and — measured across eight boards — 100% of compartments sealed with not one
  // open face anywhere. Doors were doing the job walls should do.
  SEEDS.forEach((seed) => {
    const { report } = run({ seed });
    const metrics = measure(report.plan!);
    assert.ok(
      metrics.doorwayShare < .2,
      `seed ${seed}: ${(metrics.doorwayShare * 100).toFixed(0)}% of panels are a doorway — doors are being used as walls`,
    );
  });
});

test("compartments open by a face, rather than being sealed behind a door", () => {
  // The positive half of the rule above, and the one that actually describes the
  // reference boards: a bay is three walls and an open side. That open side is what
  // makes a nook you can put a squad in, and it is why you can see and shoot into a bay
  // without a door being involved.
  //
  // Asserted as a floor on open faces and a ceiling on sealed compartments, because the
  // failure mode is one-directional — the partition model's natural state is to wall
  // every boundary, and it will drift back there given any excuse.
  SEEDS.forEach((seed) => {
    const { report } = run({ seed, sets:2 });
    const metrics = measure(report.plan!);
    assert.ok(
      metrics.openFaceShare > .25,
      `seed ${seed}: only ${(metrics.openFaceShare * 100).toFixed(0)}% of compartment faces are open`,
    );
    assert.ok(
      metrics.alcoveShare > .2,
      `seed ${seed}: only ${(metrics.alcoveShare * 100).toFixed(0)}% of compartments are an alcove`,
    );
  });
});

test("spur walls stand inside compartments, so surplus terrain becomes cover", () => {
  // The partition can only spend a panel by making it a compartment boundary, and that
  // has a floor: past `roomMin` there is nowhere left to put one. A four-set board hit
  // the floor with 103 of its 192 wall-cells still in the box.
  //
  // Spurs are the way out, and they are what the reference boards do with a big
  // collection — free-standing runs jutting into open floor, making crevices rather than
  // another sealed box. Asserted as: a generous kit on a fixed board spends materially
  // more of itself than the partition alone could.
  const oneSet = run({ width:48, height:48, sets:1, seed:3 }).report;
  const fourSets = run({ width:48, height:48, sets:4, seed:3 }).report;
  assert.ok(oneSet.plan && fourSets.plan, "both boards should build");
  const panels = (report:typeof oneSet) => report.plan!.panelEdges.length;
  assert.ok(
    panels(fourSets) > panels(oneSet) * 1.5,
    `four sets placed ${panels(fourSets)} wall-cells against one set's ${panels(oneSet)} — surplus is staying in the box`,
  );
  // And they must never seal anything: a spur that cuts a cell off is rejected, not
  // repaired, like every other invariant here.
  assert.ok(
    fullyConnected(fourSets.lattice!, fourSets.plan!.state),
    "spurs broke connectivity",
  );
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

test("a reserved zone is left genuinely clear, on every board size", () => {
  // This test used to be worthless. It asserted only that no OTHER invariant broke,
  // and `invariants` did not check zones at all, so it passed happily on layouts with
  // walls straight through the zone. Now it measures the thing directly, across every
  // board size, because the failure was size-dependent: a complex that filled the
  // board had no slack to move into and simply built over the zone.
  Object.entries(BOARD_SIZES).forEach(([name, size]) => [1, 2].forEach((sets) => SEEDS.slice(0, 3).forEach((seed) => {
    const zone = { x:size.width * .3, y:size.height * .3, width:9, height:8 };
    const report = generate({
      boardWidth:size.width, boardHeight:size.height, catalogue:"boarding", defs,
      inventory:scaled(sets), heights, zones:[zone], seed, nextUid,
    });
    assert.ok(report.plan, `${name} x${sets} seed ${seed}: nothing built — ${report.note}`);

    const kit = readKit(defs, scaled(sets), "boarding")!;
    const defMap = new Map(kit.buildDefs.map((def) => [def.id, def]));
    const structural = report.pieces.filter((piece) => defMap.has(piece.defId));
    const intruding = structural.filter((piece) => {
      const def = defMap.get(piece.defId)!;
      const width = piece.rotation === 90 ? def.depth : def.length;
      const height = piece.rotation === 90 ? def.length : def.depth;
      const centre = { x:piece.x + width / 2, y:piece.y + height / 2 };
      return centre.x > zone.x + .25 && centre.x < zone.x + zone.width - .25
        && centre.y > zone.y + .25 && centre.y < zone.y + zone.height - .25;
    });
    assert.deepEqual(
      intruding.map((piece) => piece.defId), [],
      `${name} x${sets} seed ${seed}: terrain generated inside the reserved zone`,
    );

    const failures = invariants({
      plan:report.plan, pieces:report.pieces, defs:defMap,
      inventory:scaled(sets), boardWidth:size.width, boardHeight:size.height, maxSight:9, zones:[zone],
    });
    assert.deepEqual(failures.map((failure) => failure.rule), [], `${name} x${sets} seed ${seed}`);
  })));
});

test("a complex smaller than the board builds its own outside wall", () => {
  // Without this, a sparse board is a patch of corridors that simply stops, with wall
  // stubs dangling into open deck. The hull is what makes it read as a building.
  const board = 48;
  const report = generate({
    boardWidth:board, boardHeight:board, catalogue:"boarding", defs,
    inventory:scaled(1), heights, zones:[], seed:6, nextUid, anchor:"corner",
  });
  assert.ok(report.plan, `nothing built — ${report.note}`);
  const { lattice, state } = report.plan;

  const perimeter:{ edge:string; atBoard:boolean }[] = [];
  const tolerance = 1.5;
  for (let col = 0; col < lattice.cols; col++) [0, lattice.rows].forEach((row) => {
    const y = lattice.originY + row * lattice.pitchY;
    perimeter.push({ edge:edgeKey({ axis:"h", col, row }), atBoard:y <= tolerance || y >= board - tolerance });
  });
  for (let row = 0; row < lattice.rows; row++) [0, lattice.cols].forEach((col) => {
    const x = lattice.originX + col * lattice.pitchX;
    perimeter.push({ edge:edgeKey({ axis:"v", col, row }), atBoard:x <= tolerance || x >= board - tolerance });
  });

  const facingDeck = perimeter.filter((entry) => !entry.atBoard);
  assert.ok(facingDeck.length, "a corner-anchored complex on a 4' board must face open deck on two sides");
  const bare = facingDeck.filter((entry) => !state.has(entry.edge));
  assert.deepEqual(bare.map((entry) => entry.edge), [], "every side facing open deck must be walled");

  // And it needs a way in, or it is a sealed box.
  const entrances = facingDeck.filter((entry) => state.get(entry.edge) !== "wall");
  assert.ok(entrances.length >= 1, "the building must have at least one entrance");

  // The sides that ARE the table edge stay free — the board is the hull there, and
  // walling it would spend panels on something the table already provides.
  const wastedOnBoardEdge = perimeter.filter((entry) => entry.atBoard && state.has(entry.edge));
  assert.deepEqual(wastedOnBoardEdge.map((entry) => entry.edge), [], "the table edge is a wall for free");
});

test("scatter respects corridor clearance and never fouls the structure", () => {
  // A Gallowdark corridor is 69 mm of clear opening, so a large piece standing in one
  // cannot be moved past. Small scatter goes anywhere; medium wants a room; the
  // line-of-sight blockers want a hall or open deck.
  const scatterStock = Object.fromEntries(
    TERRAIN.filter((def) => def.kind === "scatter").map((def) => [def.id, 4]),
  );
  const inventory = { ...scaled(1), ...scatterStock };
  const board = 48;
  const zone = { x:8, y:8, width:14, height:12 };
  const report = generate({
    boardWidth:board, boardHeight:board, catalogue:"boarding", defs,
    inventory, heights, zones:[zone], seed:9, nextUid,
  });
  assert.ok(report.plan, `nothing built — ${report.note}`);
  const { lattice } = report.plan;

  const byId = new Map(TERRAIN.map((def) => [def.id, def]));
  const boxOf = (piece:{ defId:string; x:number; y:number; rotation:number }) => {
    const def = byId.get(piece.defId)!;
    const width = piece.rotation === 90 ? def.depth : def.width;
    const height = piece.rotation === 90 ? def.width : def.depth;
    return { x:piece.x, y:piece.y, width, height, def };
  };
  const scatter = report.pieces.filter((piece) => byId.get(piece.defId)?.kind === "scatter");
  assert.ok(scatter.length, "scatter should be placed when the palette holds some");

  // Scatter must never sit on anything. Structure-against-structure is deliberately
  // NOT checked here: a pillar overlaps the panels it brackets and a wall-end cap
  // overlaps the panel it caps, because that overlap IS the joint. `invariants`
  // covers those with a rule that understands the difference.
  const boxes = report.pieces.map(boxOf);
  boxes.filter((box) => box.def.kind === "scatter").forEach((piece) => {
    boxes.forEach((other) => {
      if (other === piece) return;
      const clash = piece.x < other.x + other.width - .02 && piece.x + piece.width > other.x + .02
        && piece.y < other.y + other.height - .02 && piece.y + piece.height > other.y + .02;
      assert.ok(!clash, `scatter ${piece.def.id} overlaps ${other.def.id}`);
    });
  });

  // No large piece stands in a corridor.
  const regionKindAt = (x:number, y:number) => {
    const col = Math.floor((x - lattice.originX) / lattice.pitchX);
    const row = Math.floor((y - lattice.originY) / lattice.pitchY);
    if (col < 0 || row < 0 || col >= lattice.cols || row >= lattice.rows) return "deck";
    return report.plan!.regions[report.plan!.cellRegion[row * lattice.cols + col]]?.kind ?? "deck";
  };
  scatter.forEach((piece) => {
    const box = boxOf(piece);
    const where = regionKindAt(box.x + box.width / 2, box.y + box.height / 2);
    if (box.def.scatter === "small") return;
    assert.notEqual(
      where, "corridor",
      `${piece.defId} (${box.def.scatter}) is standing in a corridor`,
    );
  });
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

test("Iron Labyrinth uses both door kits without excessive fixed-grid overflow", () => {
  const inventory = {
    ...Object.fromEntries(Object.entries(TERRAIN_ULTIMA).map(([id, count]) => [id, count * 4])),
    "tt-vertical-door":8,
    "tt-sliding-door":8,
  };
  const kit = readKit(defs, inventory, "ttcombat")!;
  assert.equal(Math.round(kit.pitch * MM), 114);
  assert.equal(kit.cells.get("tt-vertical-door"), 1, "the vertical door occupies one Iron module");
  assert.equal(kit.cells.get("tt-sliding-door"), 2, "the sliding door occupies two Iron modules");
  assert.equal(kit.excluded.includes("tt-vertical-door"), false);
  assert.equal(kit.excluded.includes("tt-sliding-door"), false);

  const { report } = run({ width:48, height:48, catalogue:"ttcombat", inventory, anchor:"fill", seed:1 });
  assert.ok(report.plan, `nothing built — ${report.note}`);
  const doors = report.pieces.filter((piece) => piece.defId === "tt-vertical-door" || piece.defId === "tt-sliding-door");
  assert.ok(doors.some((piece) => piece.defId === "tt-vertical-door"), "a vertical door should be used");
  assert.ok(doors.some((piece) => piece.defId === "tt-sliding-door"), "a sliding door should be used");
  assert.ok(doors.every((piece) => piece.servesDoorway === true), "dedicated Iron doors must never substitute for plain walls");
  assert.ok(doors.length <= 5, `${doors.length} doors is too many for tactical entry points`);
  assert.ok(report.metrics!.doorwayShare < .1, `${(report.metrics!.doorwayShare * 100).toFixed(0)}% of edges became doors`);
  const physicalWidth = report.lattice!.cols * report.lattice!.pitchX + kit.support;
  const physicalHeight = report.lattice!.rows * report.lattice!.pitchY + kit.support;
  assert.ok(Math.abs(physicalWidth - 48) < kit.pitch / 2, `the physical width missed by ${Math.abs(physicalWidth - 48).toFixed(2)}"`);
  assert.ok(Math.abs(physicalHeight - 48) < kit.pitch / 2, `the physical height missed by ${Math.abs(physicalHeight - 48).toFixed(2)}"`);
  assert.equal(report.lattice!.cols, 10, "11 cells plus the outer connectors overflow a 4-foot board excessively");
  assert.equal(report.lattice!.rows, 10, "11 cells plus the outer connectors overflow a 4-foot board excessively");
});

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

// ---------------------------------------------------------------------------
// Regressions found by soaking the generator (tests/soak.ts).
//
// Each of these was invisible to a single-seed suite and obvious across a few
// hundred runs, which is the whole argument for the soak rig existing.
// ---------------------------------------------------------------------------

test("a remix is lossless, so repeated regeneration cannot drain the board", () => {
  // THE bug this block exists for. `Generate layout` used to take its inventory
  // from the pieces on the board. The generator deliberately leaves surplus in the
  // box, so every remix placed fewer pieces than it was offered, and feeding that
  // thinned board back in as the next remix's stock shrank the stock each click:
  // four presses took a full card board down to a handful of panels and a fifth
  // emptied it. Stock now comes from the palette, so a remix is stationary.
  const palette = scaled(1);
  let placed:Record<string, number> = {};
  const counts:number[] = [];
  for (let step = 0; step < 12; step++) {
    // Exactly the rule page.tsx applies: the palette, or the board, whichever holds
    // more of each piece.
    const inventory = Object.fromEntries(
      Object.keys(palette).map((id) => [id, Math.max(palette[id] ?? 0, placed[id] ?? 0)]),
    );
    const { report } = run({ inventory, seed:step * 7919 + 3 });
    placed = report.pieces.reduce<Record<string, number>>(
      (acc, piece) => ({ ...acc, [piece.defId]:(acc[piece.defId] ?? 0) + 1 }), {},
    );
    counts.push(report.pieces.length);
  }
  const first = counts[0];
  assert.ok(
    Math.min(...counts) >= first * .75,
    `remix decayed: ${counts.join(" -> ")}`,
  );
});

test("the outside wall is paid for on top of the interior, not out of it", () => {
  // The deck plan budgets every panel it places, hull included, so handing it an
  // interior-only allowance made the outside wall compete with the rooms. An inset
  // complex spent 24 of a 35-panel budget on its own perimeter and had 11 left for
  // the interior, which is why 30 x 22 came out identical at one, two and four sets.
  const density = (sets:number) => {
    const { report } = run({ width:30, height:22, sets, seed:11 });
    assert.ok(report.metrics, "30 x 22 should build");
    return report.metrics!.density;
  };
  const one = density(1);
  const two = density(2);
  // Two assertions, and the second one used to be `two > one + .02` — extra sets must buy
  // interior density. That has stopped being true on this board, for a reason worth
  // recording rather than papering over: a 30 x 22 board is a 7 x 5 lattice, which has 58
  // interior edges and 12 hull edges, so it cannot hold much over 40 wall-cells before it
  // is a wall on nearly every edge. One set nearly fills it. The surplus from a second
  // set has nowhere to go, and the generator reports it as staying in the box, which is
  // the designed behaviour rather than a defect. Set scaling on a board with room to grow
  // is covered by "more sets grow the footprint" above.
  //
  // So this now tests its actual subject directly: the HULL is paid on top of the
  // interior, not out of it. The bug was an inset complex spending 24 of a 35-panel
  // budget on its own perimeter and having 11 left for everything else.
  //
  // The floor is 0.40 rather than 0.45 because the measure changed meaning when mouths
  // arrived: `density` counts panelled interior edges, and a mouth is an interior edge the
  // plan deliberately leaves bare, so the same kit on the same board reads lower without
  // building any less.
  assert.ok(one >= .40, `one set on 30 x 22 reached only ${one.toFixed(2)} interior density`);
  assert.ok(two >= .40, `two sets on 30 x 22 reached only ${two.toFixed(2)} interior density`);
  const { report } = run({ width:30, height:22, sets:1, seed:11 });
  const hull = report.plan!.panelEdges.filter((edge) => isBorderEdge(report.lattice!, edge)).length;
  assert.ok(
    hull < report.plan!.panelEdges.length * .45,
    `the hull took ${hull} of ${report.plan!.panelEdges.length} wall-cells — it is eating the interior`,
  );
});

test("a complex that all but fills the board borrows the table edge as its hull", () => {
  // A 12 x 12 lattice leaves 1.1" outside it on a four-foot table once centred. That
  // strip is narrower than a 32 mm base, so nothing can stand there and it needs no
  // wall — but it was being measured as open deck, and the complex built a redundant
  // 48-panel outside wall against a wall it already had.
  const { report } = run({ width:48, height:48, sets:4, seed:7 });
  assert.ok(report.plan, "4' x 4' with four sets should build");
  const built = report.plan!.panelEdges.filter((edge) => report.plan!.lattice.cols === 0
    || edge.axis === "h"
      ? edge.row === 0 || edge.row === report.plan!.lattice.rows
      : edge.col === 0 || edge.col === report.plan!.lattice.cols).length;
  assert.equal(built, 0, `${built} perimeter panels built against the table edge`);
});

test("long bulkheads get doors, so no stretch of blank wall spans the table", () => {
  // Measured on SOLID panels. A wall line counted THROUGH its hatchways is long by
  // design — 20 of the 32 panels in the box carry a doorway, and a bulkhead spanning a
  // deck is what a ship has — so the thing worth bounding is unbroken blank wall.
  //
  // Subdivision splits a block with a bulkhead spanning the whole block, and the first
  // block is nearly the whole lattice, so a four-foot complex reliably grew a 7-8 panel
  // stretch: 26-30" of blank wall on a 48" table. Asserted as an average across seeds
  // as well as a hard cap, because the average is what actually moved (6.3 to 4.3 on
  // 48x48 x2) and a cap alone passes even with the fix reverted.
  ([[BOARD_SIZES.card.width, BOARD_SIZES.card.height, 1], [48, 48, 2], [48, 48, 4]] as const)
    .forEach(([width, height, sets]) => {
      const longest = SEEDS.map((seed) => {
        const { report } = run({ width, height, sets, seed });
        assert.ok(report.plan, `${width}x${height} x${sets} seed ${seed} should build`);
        const solid = report.plan!.panelEdges.filter((edge) => report.plan!.state.get(edgeKey(edge)) === "wall");
        return Math.max(0, ...edgeRuns(solid).map((line) => line.length));
      });
      const mean = longest.reduce((sum, value) => sum + value, 0) / longest.length;
      // Seven, against the five this asserted while `MAX_SOLID_RUN` was 4. Four cells is
      // about 15" at the Gallowdark pitch, which is shorter than any run on the reference
      // boards — their bulkheads reach six or seven squares before something interrupts
      // them, and long runs are half of what makes a deck read as a deck rather than as
      // scatter. The hard cap below is what rules out a wall spanning the table.
      assert.ok(
        mean <= 7,
        `${width}x${height} x${sets}: mean longest blank wall ${mean.toFixed(1)} panels (${longest.join(",")})`,
      );
      // The hard cap is looser than the average on purpose. Where the kit's hatchway
      // panels are exhausted a long wall has to stand, and that is a limit of the box
      // rather than a defect — 48x48 with two sets spends nearly all 40 of its
      // hatchways on doorways before this pass gets a look in.
      assert.ok(
        Math.max(...longest) <= 9,
        `${width}x${height} x${sets}: ${Math.max(...longest)} panels of unbroken blank wall`,
      );
    });
});

test("every board on every preset lands near the reference density", () => {
  // The headline result of the soak, pinned. Interior density across the whole matrix
  // used to run from 0.37 to 0.60 depending on how much of the budget the hull ate; it
  // now tracks the reference on every combination.
  //
  // The band is derived from the reference rather than written out, because a hard-coded
  // 0.42-0.68 outlived the 0.52 it was drawn around and then failed for the wrong reason.
  //
  // It is wider below than above, and the reason is the kit rather than the plan: a
  // Boarding Actions set holds 32 columns against 48 wall-cells of panel, so a small kit
  // on a big board runs out of things to stand its panels on well before it runs out of
  // panels. One set on two card boards is column-bound at about 39 wall-cells, and no
  // amount of planning changes that — it is what the box contains.
  const presets = Object.values(BOARD_SIZES);
  presets.forEach((size) => {
    [1, 2].forEach((sets) => {
      SEEDS.slice(0, 4).forEach((seed) => {
        const { report } = run({ width:size.width, height:size.height, sets, seed });
        assert.ok(report.metrics, `${size.label} x${sets} seed ${seed} produced nothing`);
        const { density } = report.metrics!;
        const floor = PROVISIONAL_REFERENCE.density * .7;
        const ceiling = PROVISIONAL_REFERENCE.density * 1.4;
        assert.ok(
          density >= floor && density <= ceiling,
          `${size.label} x${sets} seed ${seed}: density ${density.toFixed(2)} outside ${floor.toFixed(2)}-${ceiling.toFixed(2)}`,
        );
      });
    });
  });
});

test("generating with a zone drawn works for every shape a person might drag out", () => {
  // "Generate not working when you draw zones" — 10.7% of zone configurations returned
  // an empty board, from three separate causes:
  //
  //   * a reserved hall is one big open region, so sight crosses all of it and the
  //     firing-lane invariant threw the board away. A hangar is MEANT to be open, so
  //     the cap now carries an allowance for the hall's own extent.
  //   * the hall's boundary walls are not compartments, so the budget backoff could
  //     not merge them away and stalled at "out of stock" forever.
  //   * a zone bigger than the footprint left every cell reserved, so the partition
  //     had nothing to divide and the plan carried no panels at all. The complex is
  //     now capped to the largest zone-free rectangle and built BESIDE such a zone.
  //
  // Refusing is a legitimate outcome for a zone that genuinely leaves no room, but it
  // has to say so — an empty board and no explanation is the bug.
  const shapes = (width:number, height:number):{ label:string; zones:{ x:number;y:number;width:number;height:number }[] }[] => [
    { label:"tiny", zones:[{ x:width * .4, y:height * .4, width:2, height:2 }] },
    { label:"sliver", zones:[{ x:width * .5, y:height * .5, width:.6, height:.6 }] },
    { label:"medium", zones:[{ x:width * .3, y:height * .3, width:8, height:7 }] },
    { label:"thin across", zones:[{ x:width * .2, y:height * .45, width:width * .55, height:1.5 }] },
    { label:"thin down", zones:[{ x:width * .45, y:height * .2, width:1.5, height:height * .55 }] },
    { label:"corner", zones:[{ x:0, y:0, width:8, height:7 }] },
    { label:"far corner", zones:[{ x:width - 8, y:height - 7, width:8, height:7 }] },
    { label:"half the board", zones:[{ x:width * .2, y:height * .2, width:width * .5, height:height * .5 }] },
    { label:"two rooms", zones:[{ x:width * .1, y:height * .1, width:6, height:6 }, { x:width * .6, y:height * .6, width:6, height:6 }] },
  ];

  Object.entries(BOARD_SIZES).forEach(([name, size]) => [1, 2].forEach((sets) => {
    shapes(size.width, size.height).forEach(({ label, zones }) => {
      SEEDS.slice(0, 3).forEach((seed) => {
        const report = generate({
          boardWidth:size.width, boardHeight:size.height, catalogue:"boarding", defs,
          inventory:scaled(sets), heights, zones, seed, nextUid,
        });
        const where = `${name} x${sets} ${label} seed ${seed}`;
        if (!report.plan) {
          // Only a self-explaining refusal is acceptable, and only for a zone that
          // really does leave nowhere to build.
          assert.match(report.note, /leave no room/, `${where}: empty board with no reason — ${report.note}`);
          return;
        }

        const kit = readKit(defs, scaled(sets), "boarding")!;
        const defMap = new Map(kit.buildDefs.map((def) => [def.id, def]));
        const intruding = report.pieces.filter((piece) => {
          const def = defMap.get(piece.defId);
          if (!def) return false;
          const width = piece.rotation === 90 ? def.depth : def.length;
          const height = piece.rotation === 90 ? def.length : def.depth;
          const centre = { x:piece.x + width / 2, y:piece.y + height / 2 };
          return zones.some((zone) => centre.x > zone.x + .25 && centre.x < zone.x + zone.width - .25
            && centre.y > zone.y + .25 && centre.y < zone.y + zone.height - .25);
        });
        assert.deepEqual(intruding.map((piece) => piece.defId), [], `${where}: terrain generated inside the zone`);
      });
    });
  }));
});

test("a complex that does not fill the board builds its own outside wall", () => {
  // `build` filtered out EVERY perimeter edge, so the hull was planned, budgeted and
  // drawn in the ASCII map, then silently never placed. A centred 5 x 6 complex on a
  // four-foot table plans 22 of its 44 wall-cells as exterior, so two fifths of the
  // plan went missing and what came out was an unenclosed patch of interior walls with
  // stubs hanging off it — while the interior was starved by the hull's worth of budget
  // it had been charged for and did not spend.
  //
  // Asserted on the pieces rather than on the plan, because the plan was always right.
  SEEDS.forEach((seed) => {
    const { report } = run({ width:48, height:48, sets:1, seed, anchor:"centre" });
    const lattice = report.lattice!;
    assert.ok(report.plan, `seed ${seed}: nothing built`);

    const hull = report.plan!.exterior;
    assert.ok(hull.size > 0, `seed ${seed}: a centred complex on a 4' board should have an exterior`);

    // A panel covers its span; a two-cell panel sits centred across the node between
    // its edges. So an exterior edge is served if any panel's rectangle covers the
    // midpoint of that edge.
    const covered = (key:string) => {
      const [axis, col, row] = key.split(":");
      const edge = { axis:axis as "h" | "v", col:Number(col), row:Number(row) };
      const mid = spanWorld(lattice, edge).centre;
      return report.pieces.some((piece) => {
        const def = TERRAIN.find((candidate) => candidate.id === piece.defId)!;
        if (def.kind !== "wall" && def.kind !== "door") return false;
        const width = piece.rotation === 90 ? def.depth : def.width;
        const height = piece.rotation === 90 ? def.width : def.depth;
        return mid.x >= piece.x - .05 && mid.x <= piece.x + width + .05
          && mid.y >= piece.y - .05 && mid.y <= piece.y + height + .05;
      });
    };
    const bare = [...hull].filter((key) => !covered(key));
    assert.deepEqual(bare, [], `seed ${seed}: ${bare.length} of ${hull.size} exterior edges got no panel`);
  });
});

test("a wall end caps a free end and never joins two panels", () => {
  // A wall end is COSMETIC — it covers the exposed end of a panel that stops in open
  // floor. It brackets nothing, so it can never be the joint between two panels.
  //
  // The build pass used to allow one wherever a single panel END arrived at a node, which
  // is a different test: a run terminating against the flank of a long panel has one end
  // arriving there while the long panel covers that node with two more panel edges.
  // Measured over 18 boards, 51 of 168 caps — 30% — were sitting in exactly that
  // position, holding a wall onto the side of another wall.
  //
  // Asserted on the placed pieces against the plan, because the geometry looked fine from
  // either side alone: invariant 6 saw a panel end with support under it, and the node
  // pass saw one panel end arriving.
  [1, 2, 4].forEach((sets) => {
    SEEDS.slice(0, 4).forEach((seed) => {
      const { report } = run({ width:48, height:48, sets, seed });
      assert.ok(report.plan, `x${sets} seed ${seed}: nothing built`);
      const lattice = report.lattice!;
      const state = report.plan!.state;
      const carriesPanel = (edge:{ axis:"h" | "v"; col:number; row:number }) => {
        const value = state.get(edgeKey(edge));
        return value === "wall" || value === "hatch";
      };
      const caps = report.pieces.filter((piece) => TERRAIN.find((def) => def.id === piece.defId)!.kind === "end");
      const misused = caps.filter((piece) => {
        const def = TERRAIN.find((candidate) => candidate.id === piece.defId)!;
        const width = piece.rotation === 90 ? def.depth : def.width;
        const height = piece.rotation === 90 ? def.width : def.depth;
        const col = Math.round((piece.x + width / 2 - lattice.originX) / lattice.pitchX);
        const row = Math.round((piece.y + height / 2 - lattice.originY) / lattice.pitchY);
        const touching = ([
          { axis:"h", col:col - 1, row }, { axis:"h", col, row },
          { axis:"v", col, row:row - 1 }, { axis:"v", col, row },
        ] as { axis:"h" | "v"; col:number; row:number }[]).filter(carriesPanel).length;
        return touching !== 1;
      });
      assert.equal(
        misused.length, 0,
        `x${sets} seed ${seed}: ${misused.length} of ${caps.length} wall ends are joining panels rather than capping a free end`,
      );
    });
  });
});

test("every panel the generator will place seats in its span without overlapping a support", () => {
  // The bug this pins was severe and invisible. `readKit` took the pitch as
  // `min(spanOf)` — the shortest panel dictated the grid for every other — and
  // `pitchIsBuildable` was then applied ONCE, to that same shortest panel. Nothing checked
  // the rest.
  //
  // On a mixed TTCombat palette that put the whole board on a 96 mm pitch, because a Death
  // Quadrant single wall is 46 mm and butts between 50 mm connectors. The 64 mm Iron
  // Labyrinth walls were then placed into the resulting 46 mm opening, overlapping their
  // connectors by 9 mm at each end — six of the thirteen panel types, running straight
  // through the connectors they were supposed to sit between.
  //
  // Checked here for every kit in the catalogue, on the piece geometry rather than on a
  // generated board, so a data error in a newly added range fails immediately.
  TERRAIN_KITS.forEach((kit) => {
    const reading = readKit(defs, kit.inventory, kit.catalogue);
    if (!reading) return; // door sets, floors, stairs: no walls or no columns of their own
    assert.deepEqual(
      reading.unbuildable, [],
      `${kit.name}: panels whose geometry fits no pitch at all`,
    );
    reading.buildDefs
      .filter((def) => def.kind === "wall" || def.kind === "door")
      .forEach((def) => {
        const span = def.cells * reading.pitch;
        if (def.halfEdge) {
          // A hub kit's filler covers HALF an edge by construction — see
          // EBERLEG_GRID in terrain.ts — so "does it fill its span" is the wrong
          // question. What has to be true is that it reaches from one hub's face
          // to the middle of the gap, where the arm reaching back from the hub
          // opposite meets it. Short of that and the wall has a hole in it;
          // longer than half the gap plus a hub, and it has run clean through
          // the casting at the far end.
          const gap = reading.pitch - reading.support;
          assert.ok(
            def.length >= gap / 2 - .04 && def.length <= gap / 2 + reading.support / 2 + 1e-6,
            `${kit.name}/${def.id}: ${(def.length * MM).toFixed(0)}mm filler does not cover half of a ${(gap * MM).toFixed(0)}mm gap`,
          );
          return;
        }
        if (def.straddles) {
          // Slots into a column standing on the node: may be shorter than its span by up
          // to one column, and that difference is the slot.
          assert.ok(
            pitchIsBuildable(def.length, span, reading.support, def.jointSlack),
            `${kit.name}/${def.id}: ${(def.length * MM).toFixed(0)}mm panel does not slot into a ${(span * MM).toFixed(0)}mm span`,
          );
        } else {
          // Butts between two connectors: must match the clear opening, or it overlaps them.
          const opening = span - reading.support;
          assert.ok(
            def.length <= opening + .04,
            `${kit.name}/${def.id}: ${(def.length * MM).toFixed(0)}mm panel in a ${(opening * MM).toFixed(0)}mm opening — it overlaps its connectors by ${((def.length - opening) * MM / 2).toFixed(0)}mm each end`,
          );
        }
      });
  });
});

test("a palette holding two incompatible modules builds the larger one, consistently", () => {
  // The reported symptom was "it seems random how much it consumes": three generations from
  // the same 382-piece TTCombat palette produced 108, 21 and 55 pieces.
  //
  // The cause was the pitch flipping between 96 mm and 114 mm depending on whether one
  // 46 mm piece happened to be in the palette, which changed the whole board with it — and
  // with the full palette nothing built at all. TTCombat genuinely ships two modules that
  // cannot share a lattice: 46 mm Death Quadrant walls and 64 mm Iron Labyrinth walls, both
  // butting between 50 mm connectors.
  //
  // The pitch is now the one that makes the most of the palette usable, and the other
  // module stays in the box and is named in the report. Asserted as consistency across
  // seeds, because "random" was the complaint.
  const palette = Object.fromEntries(
    TERRAIN.filter((def) => def.catalogue === "ttcombat").map((def) => [def.id, def.limit * 6]),
  );
  const counts = SEEDS.map((seed) => {
    const { report } = run({ width:48, height:48, catalogue:"ttcombat", inventory:palette, seed });
    assert.ok(report.plan, `seed ${seed}: nothing built — ${report.note}`);
    return { pieces:report.pieces.length, cells:report.lattice!.cols * report.lattice!.rows };
  });
  const sizes = new Set(counts.map((entry) => entry.cells));
  assert.equal(sizes.size, 1, `footprint varied across seeds: ${[...sizes].join(", ")} cells`);
  const low = Math.min(...counts.map((entry) => entry.pieces));
  const high = Math.max(...counts.map((entry) => entry.pieces));
  assert.ok(
    high - low <= high * .25,
    `piece count varied from ${low} to ${high} across seeds — the palette is being consumed erratically`,
  );

  // And it has to pick the module that uses the MOST of the palette, not merely a coherent
  // one. Taking the smallest pitch is coherent too — it just leaves 138 wall-cells of Iron
  // Labyrinth wall in the box to build 36 cells of Death Quadrant instead. Enumerated here
  // rather than hard-coded, so editing the catalogue cannot silently invalidate it.
  const reading = readKit(defs, palette, "ttcombat")!;
  const panels = defs.filter((def) => def.catalogue === "ttcombat"
    && (def.kind === "wall" || def.kind === "door") && (palette[def.id] ?? 0) > 0);
  const capacityAt = (pitch:number) => panels.reduce((sum, def) => {
    const cells = cellsThatFit(def, pitch, reading.support);
    return sum + (cells === null ? 0 : palette[def.id] * cells);
  }, 0);
  const alternatives = [...new Set(panels.map((def) => def.span ?? reading.support + def.width))];
  const best = Math.max(...alternatives.map(capacityAt));
  assert.equal(
    reading.capacity, best,
    `chose a ${(reading.pitch * MM).toFixed(0)}mm pitch worth ${reading.capacity} wall-cells when ${best} were available`,
  );
  // And the report has to say which pieces were set aside, or an under-spent palette looks
  // arbitrary to whoever is holding the box.
  const { report } = run({ width:48, height:48, catalogue:"ttcombat", inventory:palette, seed:1 });
  assert.match(report.note, /different module/);
});
