/**
 * The deck plan: which edges carry a wall, and where the doorways are.
 *
 * This is the part every previous attempt got wrong, and it got it wrong by
 * generating the WALLS. A maze over a grid of cells has to leave a spanning
 * tree's worth of edges open or the board falls apart, which caps the wall count
 * at (cols-1)(rows-1) and makes a dense board impossible — and then every attempt
 * to push past the cap has nowhere to put a wall except around something, which
 * is where the "squares of doom" came from.
 *
 * So this generates the PARTITION instead, and cuts doorways through it
 * afterwards. A Gallowdark board is not a labyrinth; it is a ship deck. Through
 * corridors, compartments either side of them, hatchways between. The walls are
 * simply the boundaries of the partition, and connectivity is restored by the
 * doorway pass rather than by leaving edges open — so wall count is bounded by
 * the terrain in the box and by nothing else.
 *
 * That works because of what is actually in the box: 20 of the 32 panels in a
 * Boarding Actions set carry a hatchway. A hatchway blocks sight but passes
 * models, so the deck can be walled almost solid and still be walkable
 * throughout. Hatchways are the kit's primary building material, not a garnish —
 * the previous `DOOR_SHARE = .13` was fighting the box by a factor of five.
 *
 * Three consequences of the partition model that are worth stating, because they
 * are what makes the output look like a board:
 *
 * 1. A corridor's flanks are long unbroken runs by construction, broken where the
 *    corridor takes a dog-leg. Note that this is NOT what stops a wall running the
 *    length of the table — the longest wall on a board comes from the compartment
 *    split lines, and `breakLongBulkheads` is what handles those. Dog-legs are here
 *    for the shape of the passage, not for the run length.
 * 2. Every compartment boundary that meets a corridor flank is a T-junction, and
 *    every split line that meets another is a cross. Junctions are not placed;
 *    they are what a partition is made of.
 * 3. Room size variety comes from where the split lines land, so it needs no
 *    catalogue of shapes.
 */

import {
  allEdges, cellInside, cellKey, edgeKey, edgeRuns, internalEdges, isBorderEdge,
  type EdgeState, type LatticeCell, type LatticeEdge, type Lattice,
} from "./lattice.ts";
import { shuffle as shuffled } from "./random.ts";

export type Rect = { col:number; row:number; cols:number; rows:number };

export type RegionKind = "corridor" | "room" | "reserved";

export type Region = { id:number; kind:RegionKind; cells:LatticeCell[]; bounds:Rect };

export type DeckPlan = {
  lattice:Lattice;
  /** Edge states. Absent means `open`. */
  state:Map<string, EdgeState>;
  regions:Region[];
  /** Region id per cell, indexed row * cols + col. */
  cellRegion:Int32Array;
  /** Edges carrying a panel of any kind, in no particular order. */
  panelEdges:LatticeEdge[];
  /**
   * Perimeter edges that face open deck, as edge keys, and so are the complex's own
   * outside wall rather than the table edge.
   *
   * Carried on the plan because `build` cannot tell the two apart from the lattice
   * alone: both are `isBorderEdge`, and the difference is where the board ends.
   */
  exterior:Set<string>;
  corridorCount:number;
};

export type DeckPlanInput = {
  lattice:Lattice;
  /** How many edges may carry a panel. Splits are undone until the plan fits. */
  wallEdgeBudget:number;
  /** How many hatchway panels are in stock. Doorways beyond this become open
   *  archways, which cost nothing and are a legitimate way into a compartment. */
  hatchSupply:number;
  /**
   * Lattice perimeter edges that face open deck rather than the table edge, and
   * must therefore be built as the complex's own outside wall.
   *
   * This is what makes a complex smaller than the board read as a BUILDING rather
   * than as a patch of walls that stops. When the lattice fills the table, its
   * perimeter is the board edge and costs nothing; when it is inset, those same
   * edges are open air, and leaving them bare is why sparse boards came out as
   * runs with stubs dangling off them into nothing.
   */
  exterior?:Set<string>;
  /**
   * Cells the user has reserved — a hangar, a command room, a generator hall.
   *
   * Reserved cells become a single undivided compartment with walls around it and
   * a doorway in, which is what the tool is for. No panel is ever placed inside
   * one; scatter goes there instead.
   */
  reserved?:Rect[];
  /** Largest compartment, in cells, before a split becomes compulsory. */
  roomMax?:number;
  /** Chance of splitting a compartment that is already small enough to keep. */
  splitChance?:number;
  /** Extra doorways beyond the spanning tree, as a share of it. A board wants
   *  alternative routes, not one thread with dead ends hanging off it. */
  loopShare?:number;
  random:() => number;
};

// ---------------------------------------------------------------------------
// Rectangles and the split tree
// ---------------------------------------------------------------------------

type SplitNode = {
  rect:Rect;
  depth:number;
  /** null once this is a leaf, either because it was never split or because the
   *  budget pass undid its split. */
  split:{ axis:"v" | "h"; at:number; a:SplitNode; b:SplitNode } | null;
};

const rectArea = (rect:Rect) => rect.cols * rect.rows;

/**
 * Recursively subdivide a rectangle with straight bulkheads.
 *
 * The longer axis is split, which is what keeps compartments roughly square
 * rather than degenerating into long thin slots. A split lands anywhere that
 * leaves at least one cell either side, biased toward the middle by averaging two
 * rolls — an unbiased pick produces a lot of one-cell slivers, and while a
 * one-cell closet is a real feature of these boards, a board made mostly of them
 * is not.
 */
const chooseSplit = (rect:Rect, random:() => number) => {
  const axisCandidates:("v" | "h")[] = [];
  if (rect.cols >= 2) axisCandidates.push("v");
  if (rect.rows >= 2) axisCandidates.push("h");
  if (!axisCandidates.length) return null;
  // Split the longer side. Where both are splittable and equal, either will do.
  const axis = axisCandidates.length === 1 ? axisCandidates[0]
    : rect.cols > rect.rows ? "v"
      : rect.rows > rect.cols ? "h"
        : axisCandidates[Math.floor(random() * 2)];

  const extent = axis === "v" ? rect.cols : rect.rows;
  const offset = 1 + Math.floor((random() + random()) / 2 * (extent - 1));
  const at = (axis === "v" ? rect.col : rect.row) + Math.min(extent - 1, Math.max(1, offset));

  const first:Rect = axis === "v"
    ? { col:rect.col, row:rect.row, cols:at - rect.col, rows:rect.rows }
    : { col:rect.col, row:rect.row, cols:rect.cols, rows:at - rect.row };
  const second:Rect = axis === "v"
    ? { col:at, row:rect.row, cols:rect.col + rect.cols - at, rows:rect.rows }
    : { col:rect.col, row:at, cols:rect.cols, rows:rect.row + rect.rows - at };
  return { axis, at, first, second };
};

const subdivide = (rect:Rect, depth:number, roomMax:number, splitChance:number, random:() => number):SplitNode => {
  const node:SplitNode = { rect, depth, split:null };
  const mustSplit = rect.cols > roomMax || rect.rows > roomMax;
  if (!mustSplit && random() > splitChance) return node;
  const choice = chooseSplit(rect, random);
  if (!choice) return node;
  node.split = {
    axis:choice.axis, at:choice.at,
    a:subdivide(choice.first, depth + 1, roomMax, splitChance, random),
    b:subdivide(choice.second, depth + 1, roomMax, splitChance, random),
  };
  return node;
};

const leavesOf = (node:SplitNode):Rect[] =>
  node.split ? [...leavesOf(node.split.a), ...leavesOf(node.split.b)] : [node.rect];

const leafNodes = (node:SplitNode, into:SplitNode[] = []):SplitNode[] => {
  if (node.split) { leafNodes(node.split.a, into); leafNodes(node.split.b, into); }
  else into.push(node);
  return into;
};

/** Split one compartment without recursing, for the pass that grows a plan up to
 *  the terrain budget. */
const splitOnce = (node:SplitNode, random:() => number) => {
  const choice = chooseSplit(node.rect, random);
  if (!choice) return false;
  node.split = {
    axis:choice.axis, at:choice.at,
    a:{ rect:choice.first, depth:node.depth + 1, split:null },
    b:{ rect:choice.second, depth:node.depth + 1, split:null },
  };
  return true;
};

/**
 * The splits whose two children are both leaves.
 *
 * These are the only ones that can be undone without orphaning anything deeper,
 * so the budget pass works strictly bottom-up: it merges the smallest, most
 * deeply nested pair of compartments first, which is the least of the plan's
 * structure to give away.
 */
const undoableSplits = (node:SplitNode, into:SplitNode[] = []):SplitNode[] => {
  if (!node.split) return into;
  if (!node.split.a.split && !node.split.b.split) into.push(node);
  else { undoableSplits(node.split.a, into); undoableSplits(node.split.b, into); }
  return into;
};

// ---------------------------------------------------------------------------
// Corridors
// ---------------------------------------------------------------------------

type Corridor = { axis:"h" | "v"; at:number };

/**
 * A corridor as the rectangles it occupies.
 *
 * A long corridor takes a dog-leg: it runs part of the way in one lane, steps
 * sideways by a square, and carries on. Each leg is still a rectangle, so the block
 * subdivision either side needs no special handling — it subtracts rectangles exactly
 * as it does for a reserved hall.
 *
 * This is here for the SHAPE of the passage: a street that jogs around whatever is in
 * the way reads like a deck, where one ruled straight across the board reads like a
 * diagram. It was originally added on the theory that it would stop a wall running
 * the length of the table, and measured against 240 boards it did nothing of the kind
 * — the longest wall comes from the compartment split lines, not the corridor flanks,
 * and `breakLongBulkheads` is what deals with those. Kept for the shape, with the
 * claim corrected.
 */
const corridorLegs = (lattice:Lattice, corridor:Corridor, random:() => number):Rect[] => {
  const extent = corridor.axis === "h" ? lattice.cols : lattice.rows;
  const lanes = corridor.axis === "h" ? lattice.rows : lattice.cols;
  const asRect = (at:number, from:number, to:number):Rect => corridor.axis === "h"
    ? { col:from, row:at, cols:to - from, rows:1 }
    : { col:at, row:from, cols:1, rows:to - from };

  // Only worth jogging if the run would otherwise be long enough to look wrong, and
  // only if there is a neighbouring lane to jog into.
  const legs:Rect[] = [];
  let lane = corridor.at;
  let from = 0;
  // One step roughly every five or six squares.
  const steps = Math.max(0, Math.floor((extent - 3) / 5));
  for (let step = 0; step < steps; step++) {
    const remaining = extent - from;
    if (remaining < 6) break;
    const at = from + 3 + Math.floor(random() * Math.max(1, remaining - 5));
    const direction = random() < .5 ? -1 : 1;
    const next = lane + direction;
    // Keep the corridor off the very edge lanes, or the jog seals a one-cell strip
    // between the passage and the hull.
    if (next < 1 || next > lanes - 2) continue;
    legs.push(asRect(lane, from, at));
    lane = next;
    from = at;
  }
  legs.push(asRect(lane, from, extent));
  return legs.filter(rectArea);
};

/**
 * Carve the through corridors.
 *
 * These are the streets, and they are what stop the board reading as an
 * undifferentiated warren of rooms. Each one runs the full extent of the lattice,
 * so its flanks are the long unbroken wall runs, and it is kept off the hull —
 * a corridor pressed against the board edge only walls one side and wastes the
 * best structural line on the board.
 */
const chooseCorridors = (lattice:Lattice, random:() => number):Corridor[] => {
  const room = (extent:number) => extent >= 3;
  const pick = (extent:number) => 1 + Math.floor(random() * (extent - 2));
  const options:Corridor[] = [];
  if (room(lattice.rows)) options.push({ axis:"h", at:pick(lattice.rows) });
  if (room(lattice.cols)) options.push({ axis:"v", at:pick(lattice.cols) });
  if (!options.length) return [];

  // One corridor on a small deck, two on anything with space for them. A crossing
  // pair gives four quadrants and a cross junction at the middle; a parallel pair
  // gives a long central block between two streets. Both read as a real deck, so
  // the choice is left to the seed.
  const wantTwo = lattice.cols >= 5 && lattice.rows >= 5 && random() < .75;
  if (!wantTwo) return [options[Math.floor(random() * options.length)]];

  if (options.length === 2 && random() < .6) return options;

  // A parallel pair, kept at least two cells apart so there is a compartment
  // between them rather than a shared wall.
  const axis = options[Math.floor(random() * options.length)].axis;
  const extent = axis === "h" ? lattice.rows : lattice.cols;
  if (extent < 6) return [{ axis, at:pick(extent) }];
  const first = 1 + Math.floor(random() * (extent - 4));
  const second = first + 3 + Math.floor(random() * Math.max(1, extent - first - 4));
  if (second > extent - 2) return [{ axis, at:first }];
  return [{ axis, at:first }, { axis, at:second }];
};

/**
 * Cut a rectangular hole out of a rectangle, leaving up to four pieces.
 *
 * Used for reserved zones. They are rectangles in board space, so they are
 * rectangles in lattice space too, which means the recursive subdivision can carry
 * on working on rectangles either side of them rather than needing to handle
 * arbitrary cell sets.
 */
const subtractRect = (rect:Rect, hole:Rect):Rect[] => {
  const left = Math.max(rect.col, hole.col);
  const right = Math.min(rect.col + rect.cols, hole.col + hole.cols);
  const top = Math.max(rect.row, hole.row);
  const bottom = Math.min(rect.row + rect.rows, hole.row + hole.rows);
  if (left >= right || top >= bottom) return [rect];
  return [
    { col:rect.col, row:rect.row, cols:rect.cols, rows:top - rect.row },
    { col:rect.col, row:bottom, cols:rect.cols, rows:rect.row + rect.rows - bottom },
    { col:rect.col, row:top, cols:left - rect.col, rows:bottom - top },
    { col:right, row:top, cols:rect.col + rect.cols - right, rows:bottom - top },
  ].filter(rectArea);
};

// ---------------------------------------------------------------------------
// Regions and walls
// ---------------------------------------------------------------------------

/**
 * Bulkheads across a corridor.
 *
 * A corridor running the full length of the deck is also a firing lane running
 * the full length of the deck, and an unbroken one is the single worst thing that
 * can appear on a Zone Mortalis board. Real boards close them with a hatchway
 * every few squares, so the street is still a street but you cannot shoot down
 * all of it.
 *
 * These are returned as edges the region flood may not cross, which is all it
 * takes: the corridor comes out as two or three separate regions, the boundary
 * between them is therefore a wall, and the doorway pass puts a hatchway in it
 * because the spanning tree has to reconnect them.
 */
const chooseBulkheads = (legs:Rect[], random:() => number) => {
  const bulkheads = new Set<string>();
  legs.forEach((leg) => {
    const horizontal = leg.cols > leg.rows;
    const extent = horizontal ? leg.cols : leg.rows;
    const from = horizontal ? leg.col : leg.row;
    // Roughly one break every three or four squares of leg, and never at a leg's own
    // ends — a bulkhead there would seal the corner where it turns into the next leg.
    const wanted = Math.max(extent >= 4 ? 1 : 0, Math.round(extent / 3.5) - 1);
    for (let attempt = 0, made = 0; attempt < 12 && made < wanted; attempt++) {
      const step = 1 + Math.floor(random() * Math.max(1, extent - 1));
      if (step <= 0 || step >= extent) continue;
      const edge:LatticeEdge = horizontal
        ? { axis:"v", col:from + step, row:leg.row }
        : { axis:"h", col:leg.col, row:from + step };
      const key = edgeKey(edge);
      if (bulkheads.has(key)) continue;
      bulkheads.add(key);
      made++;
    }
  });
  return bulkheads;
};

const assignRegions = (
  lattice:Lattice, corridorCells:Set<string>, rooms:Rect[], bulkheads:Set<string>, reserved:Rect[] = [],
) => {
  const cellRegion = new Int32Array(lattice.cols * lattice.rows).fill(-1);
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  const regions:Region[] = [];

  // Corridors first, flooded rather than listed, so a crossing pair counts as one
  // region and the cross junction at their middle is genuinely open.
  const seen = new Set<string>();
  corridorCells.forEach((key) => {
    if (seen.has(key)) return;
    const [col, row] = key.split(":").map(Number);
    const cells:LatticeCell[] = [];
    const queue:LatticeCell[] = [{ col, row }];
    seen.add(key);
    const id = regions.length;
    while (queue.length) {
      const cell = queue.pop()!;
      cells.push(cell);
      cellRegion[index(cell)] = id;
      ([
        { cell:{ col:cell.col - 1, row:cell.row }, via:{ axis:"v", col:cell.col, row:cell.row } },
        { cell:{ col:cell.col + 1, row:cell.row }, via:{ axis:"v", col:cell.col + 1, row:cell.row } },
        { cell:{ col:cell.col, row:cell.row - 1 }, via:{ axis:"h", col:cell.col, row:cell.row } },
        { cell:{ col:cell.col, row:cell.row + 1 }, via:{ axis:"h", col:cell.col, row:cell.row + 1 } },
      ] as { cell:LatticeCell; via:LatticeEdge }[])
        .forEach(({ cell:next, via }) => {
          const nextKey = cellKey(next);
          if (!corridorCells.has(nextKey) || seen.has(nextKey)) return;
          // A bulkhead is where the street is closed off, so the flood stops and
          // the far side becomes its own region.
          if (bulkheads.has(edgeKey(via))) return;
          seen.add(nextKey);
          queue.push(next);
        });
    }
    const cols = cells.map((cell) => cell.col), rws = cells.map((cell) => cell.row);
    regions.push({
      id, kind:"corridor", cells,
      bounds:{ col:Math.min(...cols), row:Math.min(...rws), cols:Math.max(...cols) - Math.min(...cols) + 1, rows:Math.max(...rws) - Math.min(...rws) + 1 },
    });
  });

  // Reserved halls next, so they claim their cells before the subdivided
  // compartments do and stay undivided whatever the recursion produced.
  const asRegion = (rect:Rect, kind:RegionKind) => {
    const id = regions.length;
    const cells:LatticeCell[] = [];
    for (let row = rect.row; row < rect.row + rect.rows; row++) for (let col = rect.col; col < rect.col + rect.cols; col++) {
      if (!cellInside(lattice, { col, row }) || cellRegion[index({ col, row })] !== -1) continue;
      cells.push({ col, row });
      cellRegion[index({ col, row })] = id;
    }
    if (!cells.length) return;
    regions.push({ id, kind, cells, bounds:rect });
  };

  reserved.forEach((rect) => asRegion(rect, "reserved"));
  rooms.forEach((rect) => asRegion(rect, "room"));

  return { cellRegion, regions, index };
};

/** The pseudo-region on the far side of an exterior wall. Open deck: not a
 *  compartment, but something the building needs a door onto. */
const OUTSIDE = -2;

/**
 * Every edge that needs a panel: the partition boundaries, plus the outside wall.
 *
 * An internal edge earns a panel when the two cells it separates belong to
 * different regions — that is the partition, and it is the whole interior wall set.
 * A perimeter edge listed in `exterior` earns one because it faces open deck and is
 * the building's own outside wall.
 */
const boundaryEdges = (lattice:Lattice, cellRegion:Int32Array, exterior:Set<string>) => {
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  const interior = internalEdges(lattice).filter((edge) => {
    const [first, second] = edge.axis === "h"
      ? [{ col:edge.col, row:edge.row - 1 }, { col:edge.col, row:edge.row }]
      : [{ col:edge.col - 1, row:edge.row }, { col:edge.col, row:edge.row }];
    return cellRegion[index(first)] !== cellRegion[index(second)];
  });
  const hull = allEdges(lattice).filter((edge) => isBorderEdge(lattice, edge) && exterior.has(edgeKey(edge)));
  return [...interior, ...hull];
};

// ---------------------------------------------------------------------------
// Doorways
// ---------------------------------------------------------------------------

/**
 * Cut one doorway per chosen adjacency.
 *
 * A spanning tree over the REGION graph guarantees every compartment is reachable
 * using one doorway per compartment, then extra links are added so there is more
 * than one way around. The doorway is a hatchway where stock allows and an open
 * archway otherwise: connectivity is never traded away for a shortage of panels,
 * which is the mistake the old `openSealedPockets` was there to clean up after.
 */
const cutDoorways = (
  boundary:LatticeEdge[], lattice:Lattice, cellRegion:Int32Array, regionCount:number,
  hatchSupply:number, loopShare:number, entrances:number, random:() => number,
) => {
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  const regionOf = (cell:LatticeCell) =>
    cell.col < 0 || cell.row < 0 || cell.col >= lattice.cols || cell.row >= lattice.rows
      ? OUTSIDE : cellRegion[index(cell)];
  const shared = new Map<string, { a:number; b:number; edges:LatticeEdge[] }>();
  boundary.forEach((edge) => {
    const [first, second] = edge.axis === "h"
      ? [{ col:edge.col, row:edge.row - 1 }, { col:edge.col, row:edge.row }]
      : [{ col:edge.col - 1, row:edge.row }, { col:edge.col, row:edge.row }];
    const a = regionOf(first), b = regionOf(second);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const entry = shared.get(key);
    if (entry) entry.edges.push(edge);
    else shared.set(key, { a:Math.min(a, b), b:Math.max(a, b), edges:[edge] });
  });

  const parent = Int32Array.from({ length:regionCount }, (_, id) => id);
  const find = (id:number):number => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  const union = (first:number, second:number) => { const a = find(first), b = find(second); if (a === b) return false; parent[a] = b; return true; };

  // Exterior adjacencies are handled separately from the spanning tree. The tree's
  // job is to make every compartment reachable from every other, which is a purely
  // interior question; the outside is not a compartment and must not be allowed to
  // stand in as the route between two rooms, or the only way from one end of the
  // complex to the other would be to walk around it.
  const all = shuffled([...shared.values()], random);
  const outward = all.filter((adjacency) => adjacency.a === OUTSIDE);
  const inward = all.filter((adjacency) => adjacency.a !== OUTSIDE);

  const chosen:{ edges:LatticeEdge[] }[] = [];
  const spare:{ edges:LatticeEdge[] }[] = [];
  inward.forEach((adjacency) => {
    if (union(adjacency.a, adjacency.b)) chosen.push(adjacency);
    else spare.push(adjacency);
  });
  // Loops, so the board has alternative routes rather than one thread.
  chosen.push(...spare.slice(0, Math.round(chosen.length * loopShare)));
  // Then the ways in. A sealed building is not playable, and one door on a big
  // complex funnels every game through the same corridor, so entrances scale with
  // how much outside wall there is.
  chosen.push(...outward.slice(0, Math.max(1, entrances)));

  const doorways = new Map<string, EdgeState>();
  // Hatchways where the kit has them, open archways for the rest. Shuffled so the
  // archways are not all clustered on whichever regions happened to be visited
  // first.
  shuffled(chosen, random).forEach((adjacency, order) => {
    const edge = adjacency.edges[Math.floor(random() * adjacency.edges.length)];
    doorways.set(edgeKey(edge), order < hatchSupply ? "hatch" : "open");
  });
  return doorways;
};

/**
 * Put doors in the long bulkheads.
 *
 * Recursive subdivision splits a block with a bulkhead spanning the whole block, and
 * the first block is nearly the whole lattice — so a four-foot complex reliably grew
 * a stretch of unbroken solid wall 7 or 8 panels long, which is 26 to 30 inches of
 * blank wall on a 48 inch table. Nothing on a real Gallowdark board looks like that;
 * a bulkhead that long has hatchways along it.
 *
 * Worth being precise about what this does and does not fix, because an earlier
 * attempt at it missed: dog-legging the corridors breaks the CORRIDOR FLANK runs, but
 * the longest wall on the board comes from the split lines instead, so it moved the
 * aggregate not at all. This pass addresses the split lines directly, which is where
 * the problem actually was.
 *
 * Doors are placed on the longest runs first and spaced along them, so the panels go
 * where they buy the most. Where the hatchway supply runs out the wall simply stays
 * long — that is honest, and better than punching an open hole and opening a firing
 * lane through it.
 */
const MAX_SOLID_RUN = 4;

const breakLongBulkheads = (
  boundary:LatticeEdge[], state:Map<string, EdgeState>, hatchSupply:number, random:() => number,
) => {
  const used = [...state.values()].filter((value) => value === "hatch").length;
  let spare = Math.max(0, hatchSupply - used);
  if (!spare) return;

  const solid = () => boundary.filter((edge) => state.get(edgeKey(edge)) === "wall");
  // Longest first, so a limited supply of hatchways goes to the worst offenders.
  const runs = edgeRuns(solid())
    .filter((run) => run.length > MAX_SOLID_RUN)
    .sort((first, second) => second.length - first.length);

  for (const run of runs) {
    if (!spare) break;
    // Enough doors to bring every resulting segment inside the limit, spaced evenly
    // along the run rather than clustered at one end.
    const wanted = Math.min(spare, Math.floor(run.length / (MAX_SOLID_RUN + 1)) || 1);
    const stride = run.length / (wanted + 1);
    for (let index = 0; index < wanted && spare; index++) {
      const jitter = Math.floor(random() * 2);
      const at = Math.min(run.length - 1, Math.max(0, Math.round(stride * (index + 1)) - 1 + jitter));
      const edge = run[at];
      if (state.get(edgeKey(edge)) !== "wall") continue;
      state.set(edgeKey(edge), "hatch");
      spare--;
    }
  }
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export const buildDeckPlan = (input:DeckPlanInput):DeckPlan => {
  const { lattice, wallEdgeBudget, hatchSupply, random } = input;
  const roomMax = input.roomMax ?? 3;
  const splitChance = input.splitChance ?? .55;
  const loopShare = input.loopShare ?? .3;

  const exterior = input.exterior ?? new Set<string>();
  const reserved = (input.reserved ?? []).filter(rectArea);

  const corridors = chooseCorridors(lattice, random);
  const legs = corridors.flatMap((corridor) => corridorLegs(lattice, corridor, random));
  const reservedCells = new Set<string>();
  reserved.forEach((rect) => {
    for (let row = rect.row; row < rect.row + rect.rows; row++) for (let col = rect.col; col < rect.col + rect.cols; col++) {
      reservedCells.add(cellKey({ col, row }));
    }
  });

  const corridorCells = new Set<string>();
  legs.forEach((leg) => {
    for (let row = leg.row; row < leg.row + leg.rows; row++) for (let col = leg.col; col < leg.col + leg.cols; col++) {
      corridorCells.add(cellKey({ col, row }));
    }
  });
  // A reserved hall takes precedence over a street running through it. The corridor
  // simply arrives at the hall and stops, which is what a corridor meeting a hangar
  // does anyway.
  reservedCells.forEach((key) => corridorCells.delete(key));

  let blocks:Rect[] = [{ col:0, row:0, cols:lattice.cols, rows:lattice.rows }];
  legs.forEach((leg) => { blocks = blocks.flatMap((block) => subtractRect(block, leg)); });
  reserved.forEach((rect) => { blocks = blocks.flatMap((block) => subtractRect(block, rect)); });

  const bulkheads = chooseBulkheads(legs, random);
  const trees = blocks.map((rect) => subdivide(rect, 0, roomMax, splitChance, random));

  // Roughly one way in per four squares of outside wall, so a small blockhouse has
  // a door and a large complex has several approaches.
  const entrances = Math.max(1, Math.round(exterior.size / 4));

  let assigned = assignRegions(lattice, corridorCells, trees.flatMap(leavesOf), bulkheads, reserved);
  let boundary = boundaryEdges(lattice, assigned.cellRegion, exterior);
  const reassign = () => {
    assigned = assignRegions(lattice, corridorCells, trees.flatMap(leavesOf), bulkheads, reserved);
    boundary = boundaryEdges(lattice, assigned.cellRegion, exterior);
  };

  // Spend the budget. The recursion stops early by design — a compartment small
  // enough to keep usually is kept — so a plan routinely lands well under what
  // the box could build, and an under-spent kit is exactly the "few pieces on
  // open floor" complaint. Splitting the largest compartment repeatedly puts the
  // surplus somewhere useful: it subdivides the big open blocks first, which is
  // also where a real board would put its next bulkhead.
  for (let guard = 0; boundary.length < wallEdgeBudget && guard < 400; guard++) {
    const candidates = trees.flatMap((tree) => leafNodes(tree))
      .filter((leaf) => leaf.rect.cols >= 2 || leaf.rect.rows >= 2);
    if (!candidates.length) break;
    candidates.sort((first, second) => rectArea(second.rect) - rectArea(first.rect));
    if (!splitOnce(candidates[0], random)) break;
    reassign();
  }

  // Then come back inside it, by merging compartments smallest and deepest first.
  // Piece count is a converged result rather than an accident of how the
  // recursion happened to land, and a board short of terrain comes out as fewer,
  // larger rooms instead of a plan with holes in it.
  for (let guard = 0; boundary.length > wallEdgeBudget && guard < 400; guard++) {
    const candidates = trees.flatMap((tree) => undoableSplits(tree));
    if (!candidates.length) break;
    candidates.sort((first, second) => second.depth - first.depth || rectArea(first.rect) - rectArea(second.rect));
    candidates[0].split = null;
    reassign();
  }

  const doorways = cutDoorways(
    boundary, lattice, assigned.cellRegion, assigned.regions.length,
    hatchSupply, loopShare, entrances, random,
  );

  const state = new Map<string, EdgeState>();
  boundary.forEach((edge) => state.set(edgeKey(edge), doorways.get(edgeKey(edge)) ?? "wall"));

  breakLongBulkheads(boundary, state, hatchSupply, random);

  const panelEdges = boundary.filter((edge) => state.get(edgeKey(edge)) !== "open");

  return {
    lattice, state, regions:assigned.regions, cellRegion:assigned.cellRegion,
    panelEdges, exterior, corridorCount:corridors.length,
  };
};

/** An ASCII edge map, for judging plans without a browser. Cheap to read and the
 *  fastest way to tell a deck plan from a scatter of fragments. */
export const renderPlan = (plan:DeckPlan) => {
  const { lattice, state } = plan;
  // Distinguishes a perimeter edge the complex BUILT (its own outside wall, shown
  // solid) from one that is simply the table edge (shown as free border). Without
  // that distinction the map looks identical whether the hull exists or not, which
  // is exactly the bug it was needed to find.
  const at = (edge:LatticeEdge) => state.get(edgeKey(edge)) ?? "open";
  const lines:string[] = [];
  for (let row = 0; row <= lattice.rows; row++) {
    let top = "";
    for (let col = 0; col < lattice.cols; col++) {
      const edge:LatticeEdge = { axis:"h", col, row };
      const border = row === 0 || row === lattice.rows;
      const value = at(edge);
      const built = border && state.has(edgeKey(edge));
      top += "+" + (built ? (value === "hatch" ? "*o*" : value === "open" ? "   " : "###")
        : border ? "==="
          : value === "wall" ? "---" : value === "hatch" ? "-o-" : "   ");
    }
    lines.push(top + "+");
    if (row === lattice.rows) break;
    let middle = "";
    for (let col = 0; col <= lattice.cols; col++) {
      const edge:LatticeEdge = { axis:"v", col, row };
      const border = col === 0 || col === lattice.cols;
      const value = at(edge);
      const built = border && state.has(edgeKey(edge));
      middle += built ? (value === "hatch" ? "*" : value === "open" ? " " : "#")
        : border ? ":"
          : value === "wall" ? "|" : value === "hatch" ? "o" : " ";
      if (col < lattice.cols) {
        const kind = plan.regions[plan.cellRegion[row * lattice.cols + col]]?.kind;
        middle += kind === "corridor" ? " . " : kind === "reserved" ? " Z " : "   ";
      }
    }
    lines.push(middle);
  }
  return lines.join("\n");
};

