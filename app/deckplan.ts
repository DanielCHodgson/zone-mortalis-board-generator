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
 * 1. A corridor's two flanks are single long unbroken runs by construction.
 * 2. Every compartment boundary that meets a corridor flank is a T-junction, and
 *    every split line that meets another is a cross. Junctions are not placed;
 *    they are what a partition is made of.
 * 3. Room size variety comes from where the split lines land, so it needs no
 *    catalogue of shapes.
 */

import {
  cellKey, edgeKey, edgesOfCell, internalEdges, makeLattice,
  type EdgeState, type LatticeCell, type LatticeEdge, type Lattice,
} from "./lattice.ts";

export type Rect = { col:number; row:number; cols:number; rows:number };

export type RegionKind = "corridor" | "room";

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
  corridorCount:number;
};

export type DeckPlanInput = {
  lattice:Lattice;
  /** How many edges may carry a panel. Splits are undone until the plan fits. */
  wallEdgeBudget:number;
  /** How many hatchway panels are in stock. Doorways beyond this become open
   *  archways, which cost nothing and are a legitimate way into a compartment. */
  hatchSupply:number;
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

const shuffled = <T,>(values:T[], random:() => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

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

/** Remove the corridor bands from a set of rectangles, leaving the blocks
 *  between them to be subdivided into compartments. */
const carve = (rects:Rect[], corridor:Corridor):Rect[] =>
  rects.flatMap((rect) => {
    if (corridor.axis === "h") {
      if (corridor.at < rect.row || corridor.at >= rect.row + rect.rows) return [rect];
      return [
        { col:rect.col, row:rect.row, cols:rect.cols, rows:corridor.at - rect.row },
        { col:rect.col, row:corridor.at + 1, cols:rect.cols, rows:rect.row + rect.rows - corridor.at - 1 },
      ].filter(rectArea);
    }
    if (corridor.at < rect.col || corridor.at >= rect.col + rect.cols) return [rect];
    return [
      { col:rect.col, row:rect.row, cols:corridor.at - rect.col, rows:rect.rows },
      { col:corridor.at + 1, row:rect.row, cols:rect.col + rect.cols - corridor.at - 1, rows:rect.rows },
    ].filter(rectArea);
  });

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
const chooseBulkheads = (lattice:Lattice, corridors:Corridor[], random:() => number) => {
  const bulkheads = new Set<string>();
  corridors.forEach((corridor) => {
    const extent = corridor.axis === "h" ? lattice.cols : lattice.rows;
    // Roughly one break every three or four squares, and never at the very ends
    // where it would seal a single cell off the end of the street.
    const wanted = Math.max(1, Math.round(extent / 3.5) - 1);
    for (let attempt = 0, made = 0; attempt < 12 && made < wanted; attempt++) {
      const at = 2 + Math.floor(random() * Math.max(1, extent - 3));
      const edge:LatticeEdge = corridor.axis === "h"
        ? { axis:"v", col:at, row:corridor.at }
        : { axis:"h", col:corridor.at, row:at };
      const key = edgeKey(edge);
      if (bulkheads.has(key)) continue;
      bulkheads.add(key);
      made++;
    }
  });
  return bulkheads;
};

const assignRegions = (lattice:Lattice, corridorCells:Set<string>, rooms:Rect[], bulkheads:Set<string>) => {
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

  rooms.forEach((rect) => {
    const id = regions.length;
    const cells:LatticeCell[] = [];
    for (let row = rect.row; row < rect.row + rect.rows; row++) for (let col = rect.col; col < rect.col + rect.cols; col++) {
      cells.push({ col, row });
      cellRegion[index({ col, row })] = id;
    }
    regions.push({ id, kind:"room", cells, bounds:rect });
  });

  return { cellRegion, regions, index };
};

/** Every internal edge whose two cells belong to different regions. That is the
 *  partition boundary, and it is the whole wall set — nothing else needs a wall
 *  and nothing here can be left out. */
const boundaryEdges = (lattice:Lattice, cellRegion:Int32Array) => {
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  return internalEdges(lattice).filter((edge) => {
    const [first, second] = edge.axis === "h"
      ? [{ col:edge.col, row:edge.row - 1 }, { col:edge.col, row:edge.row }]
      : [{ col:edge.col - 1, row:edge.row }, { col:edge.col, row:edge.row }];
    return cellRegion[index(first)] !== cellRegion[index(second)];
  });
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
  hatchSupply:number, loopShare:number, random:() => number,
) => {
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  const shared = new Map<string, { a:number; b:number; edges:LatticeEdge[] }>();
  boundary.forEach((edge) => {
    const [first, second] = edge.axis === "h"
      ? [{ col:edge.col, row:edge.row - 1 }, { col:edge.col, row:edge.row }]
      : [{ col:edge.col - 1, row:edge.row }, { col:edge.col, row:edge.row }];
    const a = cellRegion[index(first)], b = cellRegion[index(second)];
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const entry = shared.get(key);
    if (entry) entry.edges.push(edge);
    else shared.set(key, { a:Math.min(a, b), b:Math.max(a, b), edges:[edge] });
  });

  const parent = Int32Array.from({ length:regionCount }, (_, id) => id);
  const find = (id:number):number => { while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; };
  const union = (first:number, second:number) => { const a = find(first), b = find(second); if (a === b) return false; parent[a] = b; return true; };

  const adjacencies = shuffled([...shared.values()], random);
  const chosen:{ edges:LatticeEdge[] }[] = [];
  const spare:{ edges:LatticeEdge[] }[] = [];
  adjacencies.forEach((adjacency) => {
    if (union(adjacency.a, adjacency.b)) chosen.push(adjacency);
    else spare.push(adjacency);
  });
  // Loops, so the board has alternative routes rather than one thread.
  chosen.push(...spare.slice(0, Math.round(chosen.length * loopShare)));

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

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export const buildDeckPlan = (input:DeckPlanInput):DeckPlan => {
  const { lattice, wallEdgeBudget, hatchSupply, random } = input;
  const roomMax = input.roomMax ?? 3;
  const splitChance = input.splitChance ?? .55;
  const loopShare = input.loopShare ?? .3;

  const corridors = chooseCorridors(lattice, random);
  const corridorCells = new Set<string>();
  corridors.forEach((corridor) => {
    if (corridor.axis === "h") for (let col = 0; col < lattice.cols; col++) corridorCells.add(cellKey({ col, row:corridor.at }));
    else for (let row = 0; row < lattice.rows; row++) corridorCells.add(cellKey({ col:corridor.at, row }));
  });

  let blocks:Rect[] = [{ col:0, row:0, cols:lattice.cols, rows:lattice.rows }];
  corridors.forEach((corridor) => { blocks = carve(blocks, corridor); });

  const bulkheads = chooseBulkheads(lattice, corridors, random);
  const trees = blocks.map((rect) => subdivide(rect, 0, roomMax, splitChance, random));

  let assigned = assignRegions(lattice, corridorCells, trees.flatMap(leavesOf), bulkheads);
  let boundary = boundaryEdges(lattice, assigned.cellRegion);
  const reassign = () => {
    assigned = assignRegions(lattice, corridorCells, trees.flatMap(leavesOf), bulkheads);
    boundary = boundaryEdges(lattice, assigned.cellRegion);
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
    hatchSupply, loopShare, random,
  );

  const state = new Map<string, EdgeState>();
  boundary.forEach((edge) => state.set(edgeKey(edge), doorways.get(edgeKey(edge)) ?? "wall"));

  const panelEdges = boundary.filter((edge) => state.get(edgeKey(edge)) !== "open");

  return {
    lattice, state, regions:assigned.regions, cellRegion:assigned.cellRegion,
    panelEdges, corridorCount:corridors.length,
  };
};

/** An ASCII edge map, for judging plans without a browser. Cheap to read and the
 *  fastest way to tell a deck plan from a scatter of fragments. */
export const renderPlan = (plan:DeckPlan) => {
  const { lattice, state } = plan;
  const at = (edge:LatticeEdge) => state.get(edgeKey(edge)) ?? "open";
  const lines:string[] = [];
  for (let row = 0; row <= lattice.rows; row++) {
    let top = "";
    for (let col = 0; col < lattice.cols; col++) {
      const border = row === 0 || row === lattice.rows;
      const value = at({ axis:"h", col, row });
      top += "+" + (border ? "===" : value === "wall" ? "---" : value === "hatch" ? "-o-" : "   ");
    }
    lines.push(top + "+");
    if (row === lattice.rows) break;
    let middle = "";
    for (let col = 0; col <= lattice.cols; col++) {
      const border = col === 0 || col === lattice.cols;
      const value = at({ axis:"v", col, row });
      middle += (border ? "#" : value === "wall" ? "|" : value === "hatch" ? "o" : " ");
      if (col < lattice.cols) middle += plan.regions[plan.cellRegion[row * lattice.cols + col]]?.kind === "corridor" ? " . " : "   ";
    }
    lines.push(middle);
  }
  return lines.join("\n");
};

/** A lattice sized to a board, for callers that only have inches. */
export const latticeForBoard = (
  cols:number, rows:number, pitchX:number, pitchY:number, boardWidth:number, boardHeight:number,
) => makeLattice(
  cols, rows, pitchX, pitchY,
  (boardWidth - cols * pitchX) / 2, (boardHeight - rows * pitchY) / 2,
);

export { leavesOf as compartmentsOf };
export const edgesAroundCell = edgesOfCell;
