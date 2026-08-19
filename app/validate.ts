/**
 * Invariants and metrics.
 *
 * Two separate jobs, deliberately kept apart.
 *
 * The **invariants** are pass/fail and describe a board that can be built and
 * played. A candidate failing any of them is thrown away, never repaired. They are
 * cheap, they are absolute, and they are the reason this generator cannot emit the
 * kind of output the previous ones did.
 *
 * The **metrics** are a description, not a target. This is the part every previous
 * attempt got wrong: piece utilisation went from 15/32 to 31/32 while the boards
 * got worse, because a number was chosen and then optimised. So the metrics here
 * are scored by DISTANCE TO A REFERENCE BOARD rather than by maximising or
 * minimising anything. A candidate is good insofar as it resembles a board known
 * to be right, and "more terrain" or "shorter sight lines" cannot run away with the
 * score because overshooting the reference is penalised exactly as much as
 * undershooting it.
 */

import {
  cellRegions, edgeKey, edgeRuns, internalEdgeCount, isBorderEdge, nodeKey, nodesOfEdge,
  passable, sightLines,
  type LatticeEdge,
} from "./lattice.ts";
import type { DeckPlan } from "./deckplan.ts";
import type { BuildDef, BuiltPiece } from "./build.ts";

export type Metrics = {
  /** Share of internal edges carrying a panel. */
  density:number;
  /** Mean and worst-case firing lane, in cells. */
  meanSight:number;
  longestSight:number;
  /** Mean length of a wall run, in cells. */
  meanRun:number;
  /**
   * Longest run of SOLID panels, uninterrupted by a doorway, in cells.
   *
   * Measured on solid panels rather than on the whole wall line, deliberately. A
   * wall line counted through its hatchways runs 9-12 cells on a four-foot complex
   * and is bounded only by the lattice, which made it look like a defect when it is
   * simply what a bulkhead spanning a deck IS — and 20 of the 32 panels in the box
   * carry a hatchway, so a long line is expected to be full of doors.
   *
   * What would genuinely look wrong is a long stretch of unbroken solid wall, so
   * that is what is measured. It also happens to be scale-invariant in a way the
   * full wall line is not: it depends on how doorways are distributed, not on how
   * big the board is.
   */
  longestSolidRun:number;
  /** Nodes where three or four panels meet, as a share of all panelled nodes. */
  junctionShare:number;
  /** Mean compartment size in cells, and the spread across compartments. */
  meanRoom:number;
  roomSpread:number;
  /** Cells with only one way in. */
  deadEndShare:number;
  /** Share of panels that carry a hatchway. */
  hatchShare:number;
};

/**
 * What a good board measures.
 *
 * PROVISIONAL. These are derived from the kit and the published board geometry —
 * a Boarding Actions set holds 48 wall-cells, a 7 x 6 card board has 71 internal
 * edges, so reference density is 48/71 — together with the stated properties of a
 * good board: corridors 3.5-4" clear, no firing lane across the table, long
 * unbroken runs meeting at junctions, hatchways roughly at the kit's own ratio.
 *
 * They are meant to be REPLACED by measuring a transcribed real board. The whole
 * point of scoring by distance is that swapping this object for one computed from
 * a fixture retunes the generator without touching a line of generation code, so
 * this is the one place to change when the fixture lands.
 */
export type ReferenceProfile = Metrics & { weights:Partial<Record<keyof Metrics, number>> };

export const PROVISIONAL_REFERENCE:ReferenceProfile = {
  // Interior density, excluding the outside wall. Deliberately below the 0.62 the
  // kit arithmetic alone suggests, for two reasons: a complex smaller than the board
  // spends part of its panels on its own hull, and a board packed to the arithmetic
  // limit reads as solid rather than as dense. Lowering it also spreads the same
  // terrain over a LARGER footprint, because sizing solves
  // `internalEdges x density + hull <= capacity` — so this one number is the
  // "use a bit more of the table" dial.
  density:.52,
  meanSight:2.3,
  longestSight:4.5,
  meanRun:2.8,
  // A long SOLID stretch is what looks wrong. Hatchways are 62% of the box, so a
  // wall line is expected to be broken up by doors every couple of panels. Four
  // panels is about 15", which is as far as a bulkhead runs on a real board before a
  // hatchway appears in it, and it is the limit `breakLongBulkheads` enforces.
  longestSolidRun:4,
  junctionShare:.4,
  meanRoom:3,
  roomSpread:1.6,
  deadEndShare:.12,
  hatchShare:.46,
  // Sight lines and run structure are what separate a deck from a scatter, so they
  // carry the most weight. Density matters but is largely fixed by the box.
  weights:{
    density:1, meanSight:2.5, longestSight:2, meanRun:2, longestSolidRun:1.25,
    junctionShare:1.5, meanRoom:.75, roomSpread:.5, deadEndShare:1, hatchShare:.5,
  },
};

export const measure = (plan:DeckPlan):Metrics => {
  const { lattice, state } = plan;
  const panels = plan.panelEdges.filter((edge) => !isBorderEdge(lattice, edge));
  const runs = edgeRuns(panels);
  const runLengths = runs.map((run) => run.length);
  // Split the wall lines wherever a doorway interrupts them, so what is measured is
  // unbroken solid wall rather than wall-line length.
  const solidLengths = edgeRuns(panels.filter((edge) => state.get(edgeKey(edge)) === "wall")).map((run) => run.length);
  const sight = sightLines(lattice, state);

  const nodeDegree = new Map<string, number>();
  panels.forEach((edge) => nodesOfEdge(edge).forEach((node) => {
    const key = nodeKey(node);
    nodeDegree.set(key, (nodeDegree.get(key) ?? 0) + 1);
  }));
  const junctions = [...nodeDegree.values()].filter((degree) => degree >= 3).length;

  const roomSizes = plan.regions.map((region) => region.cells.length);
  const meanRoom = roomSizes.length ? roomSizes.reduce((sum, size) => sum + size, 0) / roomSizes.length : 0;
  const roomSpread = roomSizes.length
    ? Math.sqrt(roomSizes.reduce((sum, size) => sum + (size - meanRoom) ** 2, 0) / roomSizes.length)
    : 0;

  let deadEnds = 0;
  for (let row = 0; row < lattice.rows; row++) for (let col = 0; col < lattice.cols; col++) {
    const ways = ([
      { axis:"h", col, row }, { axis:"h", col, row:row + 1 },
      { axis:"v", col, row }, { axis:"v", col:col + 1, row },
    ] as LatticeEdge[]).filter((edge) => passable(lattice, state, edge)).length;
    if (ways === 1) deadEnds++;
  }

  const hatches = panels.filter((edge) => state.get(edgeKey(edge)) === "hatch").length;

  return {
    density:panels.length / Math.max(1, internalEdgeCount(lattice.cols, lattice.rows)),
    meanSight:sight.mean,
    longestSight:sight.longest,
    meanRun:runLengths.length ? runLengths.reduce((sum, length) => sum + length, 0) / runLengths.length : 0,
    longestSolidRun:solidLengths.length ? Math.max(...solidLengths) : 0,
    junctionShare:nodeDegree.size ? junctions / nodeDegree.size : 0,
    meanRoom, roomSpread,
    deadEndShare:deadEnds / Math.max(1, lattice.cols * lattice.rows),
    hatchShare:panels.length ? hatches / panels.length : 0,
  };
};

/**
 * Distance from the reference, normalised per metric so a metric measured in
 * cells does not outvote one measured as a share. Lower is better; zero would be
 * an exact match for the reference board.
 */
export const distanceFromReference = (metrics:Metrics, reference:ReferenceProfile = PROVISIONAL_REFERENCE) => {
  const keys = Object.keys(metrics) as (keyof Metrics)[];
  let total = 0;
  let weightSum = 0;
  keys.forEach((key) => {
    const weight = reference.weights[key] ?? 1;
    const target = reference[key];
    const scale = Math.max(Math.abs(target), .25);
    total += weight * Math.abs(metrics[key] - target) / scale;
    weightSum += weight;
  });
  return weightSum ? total / weightSum : 0;
};

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export type Failure = { rule:string; detail:string };

type Box = { x:number; y:number; width:number; height:number };

const rectOf = (piece:BuiltPiece, defs:Map<string, BuildDef>):Box => {
  const def = defs.get(piece.defId)!;
  return piece.rotation === 90
    ? { x:piece.x, y:piece.y, width:def.depth, height:def.length }
    : { x:piece.x, y:piece.y, width:def.length, height:def.depth };
};

const overlapArea = (first:Box, second:Box) => {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return width > 0 && height > 0 ? width * height : 0;
};

/**
 * Whether two panels genuinely clash.
 *
 * Two panels meeting at right angles at a node necessarily share a small square of
 * plan area the size of their own thickness — that square is the joint, where both
 * clip into the same column, and it is not a collision. Checking raw rectangle
 * intersection flags every single junction on the board, which is a lot of noise
 * for a board whose whole merit is having junctions. So the test is on the AREA
 * shared: anything up to a few joints' worth is the joint, and a real clash — two
 * panels on the same edge, or one lying along another — shares an order of
 * magnitude more.
 */
const panelsClash = (first:Box, second:Box) => {
  const thickness = Math.max(Math.min(first.width, first.height), Math.min(second.width, second.height));
  return overlapArea(first, second) > thickness * thickness * 4;
};

/**
 * Everything that must be true of a board before it is worth looking at.
 *
 * Returns the failures rather than throwing, so a caller can log which rule a
 * candidate died on — that turned out to be the fastest way to tell a generator
 * that is nearly right from one that is structurally wrong.
 */
export const invariants = ({ plan, pieces, defs, inventory, boardWidth, boardHeight, maxSight, zones = [] }:{
  plan:DeckPlan; pieces:BuiltPiece[]; defs:Map<string, BuildDef>;
  inventory:Record<string, number>; boardWidth:number; boardHeight:number; maxSight:number;
  zones?:{ x:number; y:number; width:number; height:number }[];
}):Failure[] => {
  const failures:Failure[] = [];
  const { lattice, state } = plan;

  // 1. Every cell reachable from every other. A board with a compartment nobody
  //    can enter is not a board, and this is the rule the old generator broke and
  //    then tried to repair by deleting walls.
  const regions = cellRegions(lattice, state, passable);
  if (regions.sizes.length > 1) {
    failures.push({ rule:"connected", detail:`${regions.sizes.length} separate walkable regions` });
  }

  // 2. No firing lane across the table.
  const sight = sightLines(lattice, state);
  if (sight.longest > maxSight) {
    failures.push({ rule:"sight", detail:`open lane of ${sight.longest} cells, limit ${maxSight}` });
  }

  // 3. Every doorway the plan promised actually got a hatchway panel. A solid
  //    panel standing in for one would seal a route the connectivity check above
  //    assumed was open.
  const hatchEdges = plan.panelEdges.filter((edge) => state.get(edgeKey(edge)) === "hatch");
  const doorPanels = pieces.filter((piece) => defs.get(piece.defId)?.kind === "door").length;
  if (doorPanels < 1 && hatchEdges.length) {
    failures.push({ rule:"doorways", detail:`${hatchEdges.length} doorways planned, no hatchway panels placed` });
  }

  // 4. Stock. Never more of a piece than the palette owns.
  const used = new Map<string, number>();
  pieces.forEach((piece) => used.set(piece.defId, (used.get(piece.defId) ?? 0) + 1));
  used.forEach((count, id) => {
    const owned = inventory[id] ?? 0;
    if (count > owned) failures.push({ rule:"stock", detail:`${id}: used ${count} of ${owned}` });
  });

  // 5. Nothing overlaps, and nothing hangs off the table. Panels sit on edges and
  //    columns on nodes, so this should hold by construction — it is checked
  //    because a construction-guaranteed property that stops holding is exactly
  //    the kind of bug that took a whole session to find last time.
  //    Columns are allowed to overlap the panels they bracket: that is the joint.
  const structural = pieces.filter((piece) => {
    const kind = defs.get(piece.defId)?.kind;
    return kind === "wall" || kind === "door";
  });
  structural.forEach((piece, index) => {
    const rect = rectOf(piece, defs);
    if (rect.x < -.01 || rect.y < -.01 || rect.x + rect.width > boardWidth + .01 || rect.y + rect.height > boardHeight + .01) {
      failures.push({ rule:"bounds", detail:`${piece.defId} at ${rect.x.toFixed(2)},${rect.y.toFixed(2)} leaves the board` });
    }
    structural.slice(index + 1).forEach((other) => {
      if (panelsClash(rect, rectOf(other, defs))) {
        failures.push({ rule:"overlap", detail:`${piece.defId} overlaps ${other.defId} at ${rect.x.toFixed(2)},${rect.y.toFixed(2)}` });
      }
    });
  });

  // 6. Every panel end is bracketed. A panel with an unsupported end is the one
  //    joint the kit cannot build, and the 125 mm pitch bug was precisely this:
  //    panels ending 0.256" short of the column they were meant to clip into.
  const supports = pieces.filter((piece) => {
    const kind = defs.get(piece.defId)?.kind;
    return kind === "pillar" || kind === "connector" || kind === "end";
  }).map((piece) => rectOf(piece, defs));
  const unsupported = structural.filter((piece) => {
    const rect = rectOf(piece, defs);
    const alongX = rect.width >= rect.height;
    const ends = alongX
      ? [{ x:rect.x, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width, y:rect.y + rect.height / 2 }]
      : [{ x:rect.x + rect.width / 2, y:rect.y }, { x:rect.x + rect.width / 2, y:rect.y + rect.height }];
    return ends.some((end) => {
      // The board border is a wall in its own right, so an end reaching it is
      // terminated as validly as one meeting a column.
      const atHull = end.x <= .6 || end.y <= .6 || end.x >= boardWidth - .6 || end.y >= boardHeight - .6;
      if (atHull) return false;
      return !supports.some((support) => end.x >= support.x - .35 && end.x <= support.x + support.width + .35
        && end.y >= support.y - .35 && end.y <= support.y + support.height + .35);
    });
  });
  if (unsupported.length) {
    failures.push({ rule:"bracketed", detail:`${unsupported.length} panel ends stand on nothing` });
  }

  // 7. Reserved zones stay clear.
  //
  // A rule, not a hope. The generator previously "respected" zones by nudging the
  // whole complex to overlap them less, which silently gave up whenever the complex
  // filled the board — and the test that was supposed to catch it only checked that
  // no OTHER invariant broke, so it passed on layouts with walls straight through
  // the zone. Walls AROUND a zone are wanted; anything inside it is not.
  if (zones.length) {
    const structuralKinds = new Set(["wall", "door", "pillar", "connector", "end"]);
    const intruding = pieces.filter((piece) => {
      if (!structuralKinds.has(defs.get(piece.defId)?.kind ?? "")) return false;
      const rect = rectOf(piece, defs);
      const centre = { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2 };
      return zones.some((zone) => centre.x > zone.x + .25 && centre.x < zone.x + zone.width - .25
        && centre.y > zone.y + .25 && centre.y < zone.y + zone.height - .25);
    });
    if (intruding.length) {
      failures.push({ rule:"zone", detail:`${intruding.length} pieces stand inside a reserved zone (${intruding.map((piece) => piece.defId).join(", ")})` });
    }
  }

  return failures;
};
