/**
 * The floorplan: a connected labyrinth of corridors.
 *
 * A Zone Mortalis board is a maze you fight through, not a set of rooms. The
 * lattice cells are the walkable squares; a panel stands on the edge between two
 * cells that do not connect. Because the maze is built as a spanning tree with
 * loops opened back up, every square is reachable by construction and there are
 * several routes between any two — junctions, dead ends and blind corners fall
 * out of that rather than being placed.
 *
 * Two things follow that took a long time to see:
 *
 * 1. The board edge is the outer wall, so the complex fills the table and every
 *    panel is spent on interior structure. Building a free-standing block instead
 *    spends most of the kit on a hull and leaves isolated rectangles adrift.
 *
 * 2. Panel count is an OUTPUT, not a target. A 6 x 6 board has 60 internal edges
 *    and a connected maze must leave 35 of them open, so it carries about 25
 *    wall-cells and no more. Pushing past that is exactly what produced sealed
 *    boxes: there is nowhere left to put a wall except around something.
 */

export type PlanEdge = { axis:"h" | "v"; col:number; row:number };

export type Plan = {
  cols:number; rows:number;
  /** Solid panels: they stop movement and sight alike. */
  walls:PlanEdge[];
  /**
   * Hatchways standing where the maze leaves a passage open.
   *
   * These are the reason a kit ships more hatchways than walls. A hatchway on an
   * open edge takes nothing away from the maze — models still pass — but it
   * breaks the firing lane through it, so a board can be made much tighter
   * without sealing a single square off. It is also where the surplus terrain
   * goes on a small table, which otherwise has nowhere to put it but around
   * something.
   */
  hatches:PlanEdge[];
  /** Squares merged into wider halls, so the board is not all one-cell corridor. */
  chambers:number;
};

/** Everything carrying a panel: what gets built, and what blocks sight. */
export const panelsOf = (plan:Plan) => [...plan.walls, ...plan.hatches];

export const edgeKey = (edge:PlanEdge) => `${edge.axis}:${edge.col}:${edge.row}`;

/** Cells either side of an edge, or -1 where that side is off the board. */
const between = (edge:PlanEdge, cols:number, rows:number) => {
  const inside = (col:number, row:number) => col >= 0 && row >= 0 && col < cols && row < rows ? row * cols + col : -1;
  return edge.axis === "h"
    ? [inside(edge.col, edge.row - 1), inside(edge.col, edge.row)]
    : [inside(edge.col - 1, edge.row), inside(edge.col, edge.row)];
};

const internalEdges = (cols:number, rows:number) => {
  const edges:PlanEdge[] = [];
  for (let row = 1; row < rows; row++) for (let col = 0; col < cols; col++) edges.push({ axis:"h", col, row });
  for (let col = 1; col < cols; col++) for (let row = 0; row < rows; row++) edges.push({ axis:"v", col, row });
  return edges;
};

const shuffled = <T,>(values:T[], random:() => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

/**
 * Carve the labyrinth.
 *
 * A couple of squares are first merged into wider halls — the open ground that
 * breaks up a board of nothing but one-square corridors. Every remaining edge is
 * then offered to a union-find in random order: an edge joining two parts of the
 * board that were not yet connected becomes a passage, everything else is a
 * candidate wall. That is a uniform spanning tree, so the board is always fully
 * connected and never needs a doorway cut into it afterwards.
 *
 * Loops are then opened back up until the walls fit the terrain budget, which is
 * also what keeps the maze from being one tedious thread — a board wants
 * alternative routes, not a single path with dead ends hanging off it.
 */
export const buildMaze = (cols:number, rows:number, budgetCells:number, hatchShare:number, random:() => number):Plan => {
  const count = cols * rows;
  const parent = new Int32Array(count).map((_, index) => index);
  const find = (cell:number):number => { while (parent[cell] !== cell) { parent[cell] = parent[parent[cell]]; cell = parent[cell]; } return cell; };
  const union = (first:number, second:number) => { const a = find(first), b = find(second); if (a === b) return false; parent[a] = b; return true; };

  const open = new Set<string>();
  let chambers = 0;
  const wanted = cols >= 5 && rows >= 5 ? 1 + Math.floor(random() * 2) : 0;
  for (let attempt = 0; attempt < 30 && chambers < wanted; attempt++) {
    const width = 2 + Math.floor(random() * 2);
    const height = 2 + Math.floor(random() * 2);
    if (width >= cols - 1 || height >= rows - 1) continue;
    const col = Math.floor(random() * (cols - width));
    const row = Math.floor(random() * (rows - height));
    const cells:number[] = [];
    for (let y = row; y < row + height; y++) for (let x = col; x < col + width; x++) cells.push(y * cols + x);
    // Never overlap a hall already carved, or the two merge into a shapeless void.
    if (cells.some((cell) => find(cell) !== cell)) continue;
    for (let y = row; y < row + height; y++) for (let x = col; x < col + width; x++) {
      if (x > col) { open.add(edgeKey({ axis:"v", col:x, row:y })); union(y * cols + x - 1, y * cols + x); }
      if (y > row) { open.add(edgeKey({ axis:"h", col:x, row:y })); union((y - 1) * cols + x, y * cols + x); }
    }
    chambers++;
  }

  const candidates:PlanEdge[] = [];
  shuffled(internalEdges(cols, rows), random).forEach((edge) => {
    if (open.has(edgeKey(edge))) return;
    const [first, second] = between(edge, cols, rows);
    if (first < 0 || second < 0) return;
    if (union(first, second)) open.add(edgeKey(edge));
    else candidates.push(edge);
  });

  const walls = shuffled(candidates, random).slice(0, Math.max(0, Math.min(candidates.length, budgetCells)));

  // Whatever the walls did not spend goes on hatchways across open passages,
  // which tightens the sight lines without closing a single route.
  const solid = new Set(walls.map(edgeKey));
  const passages = [...open].map((key) => {
    const [axis, col, row] = key.split(":");
    return { axis:axis as "h" | "v", col:Number(col), row:Number(row) };
  }).filter((edge) => !solid.has(edgeKey(edge)));
  const spare = Math.max(0, budgetCells - walls.length);
  const hatches = shuffled(passages, random).slice(0, Math.min(spare, Math.round(passages.length * hatchShare)));

  return { cols, rows, walls, hatches, chambers };
};

/**
 * Set hatchways into the wall lines.
 *
 * A hatchway blocks line of sight but lets models through, so it has to sit
 * inline in a run with structure continuing past both ends — anywhere else it is
 * a frame standing in open space that models simply walk around.
 */
export const chooseDoorways = (plan:Plan, share:number, random:() => number) => {
  const present = new Set(panelsOf(plan).map(edgeKey));
  const inline = (edge:PlanEdge) => {
    const step = edge.axis === "h" ? { col:1, row:0 } : { col:0, row:1 };
    return present.has(edgeKey({ axis:edge.axis, col:edge.col - step.col, row:edge.row - step.row }))
      && present.has(edgeKey({ axis:edge.axis, col:edge.col + step.col, row:edge.row + step.row }));
  };
  // A hatchway across an open passage is already a hatchway; the rest are drawn
  // from solid walls that sit inline in a run.
  const doorways = new Set(plan.hatches.map(edgeKey));
  shuffled(plan.walls.filter(inline), random)
    .slice(0, Math.round(plan.walls.length * share))
    .forEach((edge) => doorways.add(edgeKey(edge)));
  return doorways;
};

/** Maximal straight sequences of panelled edges — one physical wall run each. */
export const edgeRuns = (edges:PlanEdge[]) => {
  const present = new Set(edges.map(edgeKey));
  const used = new Set<string>();
  const runs:PlanEdge[][] = [];
  edges.forEach((edge) => {
    if (used.has(edgeKey(edge))) return;
    const step = edge.axis === "h" ? { col:1, row:0 } : { col:0, row:1 };
    let start = edge;
    for (;;) {
      const previous:PlanEdge = { axis:edge.axis, col:start.col - step.col, row:start.row - step.row };
      if (!present.has(edgeKey(previous))) break;
      start = previous;
    }
    const run:PlanEdge[] = [];
    for (let current = start; present.has(edgeKey(current)); current = { axis:edge.axis, col:current.col + step.col, row:current.row + step.row }) {
      run.push(current);
      used.add(edgeKey(current));
    }
    runs.push(run);
  });
  return runs;
};

/**
 * Mean firing lane, in squares.
 *
 * A labyrinth is only doing its job if you cannot see across the table. This
 * counts, for every square, how far a model could shoot along both axes before a
 * panel stops it. Lower is a tighter board; it is the number to keep down when
 * tuning, and the one that tells a corridor network apart from a few boxes
 * standing in an open field.
 */
export const meanSightLine = (plan:Plan) => {
  const blocked = new Set(panelsOf(plan).map(edgeKey));
  const stops = (axis:"h" | "v", col:number, row:number) => blocked.has(edgeKey({ axis, col, row }));
  let total = 0;
  for (let row = 0; row < plan.rows; row++) for (let col = 0; col < plan.cols; col++) {
    let seen = 0;
    for (let step = col + 1; step < plan.cols && !stops("v", step, row); step++) seen++;
    for (let step = col; step > 0 && !stops("v", step, row); step--) seen++;
    for (let step = row + 1; step < plan.rows && !stops("h", col, step); step++) seen++;
    for (let step = row; step > 0 && !stops("h", col, step); step--) seen++;
    total += seen;
  }
  return plan.cols * plan.rows ? total / (plan.cols * plan.rows) : 0;
};
