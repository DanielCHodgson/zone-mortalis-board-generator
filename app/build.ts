/**
 * Turning a deck plan into pieces from the box.
 *
 * This module is the authority on whether a plan can actually be built, and it
 * answers by trying and failing rather than by estimating. Nothing here repairs
 * anything: a run that cannot be tiled fails the run, a plan that runs out of
 * columns fails the plan, and the caller generates another. The old generator's
 * three repair sweeps — reopen sealed pockets, prune stranded hatchways, drop
 * orphaned supports — existed because it shipped layouts it could not build, and
 * between them they ate two thirds of every board. Reject-and-retry costs a few
 * milliseconds and cannot do that.
 *
 * Two facts about the kit shape everything below.
 *
 * **A hatchway panel is a superset of a wall panel.** It blocks line of sight
 * exactly as a wall does, and additionally lets models through. So a hatchway
 * panel may always stand in for a solid one — the board simply gains a route —
 * but a solid panel may never stand in for a hatchway, because that seals a
 * doorway the plan is relying on. That asymmetry is the whole substitution rule,
 * and it is what makes the kit's odd composition usable: a Boarding Actions set
 * holds 20 solid wall-cells against 28 hatchway wall-cells, so without
 * substitution most of the box would be unspendable.
 *
 * **Columns are the binding constraint, not panels.** 48 wall-cells of panel imply
 * up to 96 panel ends, and there are only 32 loose columns plus the 16 panels that
 * carry their own. So the tiler is built to economise columns, and that pressure
 * points somewhere useful: a long panel spanning two cells skips the column a pair
 * of shorts would need between them, and a node where three or four runs meet
 * serves them all from one column. Preferring long panels and sharing nodes is
 * what produces long unbroken runs meeting at T and cross junctions — the top item
 * on the list of what a good board looks like, arrived at through a physical
 * budget rather than a scoring weight.
 */

import {
  edgeKey, edgeRuns, isBorderEdge, nodeKey, nodesOfEdge, nodeWorld, spanWorld,
  type EdgeState, type LatticeEdge, type LatticeNode, type Lattice,
} from "./lattice.ts";
import type { DeckPlan } from "./deckplan.ts";
import { randomFactory, shuffle } from "./random.ts";

export type PanelKind = "wall" | "door";
export type NodeKind = "pillar" | "connector" | "end";

export type BuildDef = {
  id:string;
  kind:PanelKind | NodeKind;
  /** Along the run, in inches. */
  length:number;
  /** Across the run, in inches. */
  depth:number;
  /** Lattice edges the piece covers. 1 for a short panel, 2 for a long one. */
  cells:number;
  /**
   * Columns moulded into the piece, at 0, 1 or 2 of its ends.
   *
   * The "+ pillars" variants are 16 of the 32 panels in a Boarding Actions set.
   * Their stated width is exactly one grid square — 97 mm against the bare panel's
   * 80 mm — which says the moulded columns are *inside* the span: half a column at
   * each end, with the neighbouring piece supplying the other half. That is your
   * "connectors sit on the corner with equal overlap", moulded in.
   *
   * Because each end carries only half a column, a node is never fully served by
   * these pieces alone, so a column occupant is still placed at every panel end.
   * This flag is therefore a PREFERENCE — reach for these panels first, since on
   * the table they bring their own hardware — and not a change to the geometry or
   * to the column budget. Confirming whether the moulded column is at one end or
   * both is one look at a real panel, and only the preference ordering below
   * depends on the answer.
   */
  ownColumns:0 | 1 | 2;
  height:number;
  /**
   * Which joint this piece makes: true if it slots INTO a column standing on the node,
   * false if it butts BETWEEN two connectors.
   *
   * Carried here so `invariants` can check the right condition. The two allow different
   * geometry — a straddling panel may be up to a column's width shorter than its span,
   * because that difference is the slot; a butting panel must match the clear opening
   * exactly or it overlaps the connectors it is supposed to sit between.
   */
  straddles:boolean;
  /** HUB KITS ONLY: which arrangement of moulded wall arms this node casting
   *  carries — see `CANONICAL_ARMS`. Undefined everywhere else, where a column is
   *  direction-agnostic and stands at any node. */
  shape?:HubShape;
  /** HUB KITS ONLY: a filler panel covering half an edge, from one hub's face to
   *  the midpoint of the gap. */
  halfEdge?:boolean;
};

export type BuiltPiece = {
  uid:string;
  defId:string; x:number; y:number; rotation:0 | 90; height:number;
  runId?:string; sequenceIndex?:number;
  /**
   * Whether this panel's hatchway is a DOORWAY the plan routes through, as opposed to a
   * hatchway panel standing in a wall run with its door shut.
   *
   * The two are physically the same piece and the distinction is invisible in the plan's
   * edge state alone, because a hatchway panel is a strict superset of a wall panel and
   * substitutes for one freely — which it must, since 62% of the panels in the box carry
   * a hatchway and the board would otherwise be unbuildable.
   *
   * It matters for DRAWING. Colouring by `kind === "door"` painted every substituted
   * hatchway as an opening, so a board reading 8% doorways looked like 58% doors. That
   * is what made "doors are used far too frequently" true of the picture even where it
   * was becoming untrue of the layout.
   */
  servesDoorway?:boolean;
  /** HUB KITS ONLY: degrees clockwise from the casting's canonical orientation,
   *  which is what says where its arms point. Absent on every other piece. */
  facing?:0 | 90 | 180 | 270;
};

export type BuildResult =
  | { ok:true; pieces:BuiltPiece[] }
  | { ok:false; reason:string };

export type BuildInput = {
  plan:DeckPlan;
  defs:BuildDef[];
  /** Copies of each definition available, by id. Consumed as it builds. */
  stock:Map<string, number>;
  heights:Record<string, number>;
  nextUid:() => string;
  seed:number;
};

/** A panel as placed: which edges it covers, and which nodes it terminates on. */
type Placement = {
  def:BuildDef; edge:LatticeEdge; cells:number; ends:[LatticeNode, LatticeNode];
  /** True when the plan marked one of the covered edges as a doorway. */
  servesDoorway:boolean;
};

/**
 * Pick a panel for `cells` edges starting here.
 *
 * Ordered by what it costs the rest of the board rather than by what fits. A piece
 * carrying its own columns is preferred because it removes demand from the loose
 * column budget, and a solid panel is preferred over a hatchway for a plain wall
 * so the hatchways stay available for the doorways that genuinely need one.
 */
const chooseDef = (
  defs:BuildDef[], stock:Map<string, number>, cells:number, needsDoorway:boolean, random:() => number,
) => {
  const available = defs.filter((def) => def.cells === cells && (stock.get(def.id) ?? 0) > 0
    && (needsDoorway ? def.kind === "door" : true));
  if (!available.length) return null;
  // Matching the plan comes first, carrying columns second. Ranked the other way
  // round, a hatchway panel that happens to have moulded columns outranks a plain
  // solid wall, and since 20 of the kit's 32 panels are hatchways the solid walls
  // never get picked at all — a board built almost entirely of doors, with the
  // solid walls still on the sprue.
  const rank = (def:BuildDef) =>
    (needsDoorway || def.kind === "wall" ? 0 : 4)
    + (def.ownColumns ? 0 : 1);
  const best = Math.min(...available.map(rank));
  const tied = available.filter((def) => rank(def) === best);
  return tied[Math.floor(random() * tied.length)];
};

/**
 * How many panel-carrying edges meet at a node.
 *
 * This is what decides whether a node is a genuinely FREE end. Exactly one means a run
 * stops here in open floor and nothing else touches it, which is the only place a
 * wall-end cap belongs. Two or more means panels meet, and a joint between panels needs
 * a column whatever the geometry looks like.
 */
const panelsAtNode = (node:LatticeNode, state:Map<string, EdgeState>) => {
  const carriesPanel = (candidate:LatticeEdge) => {
    const value = state.get(edgeKey(candidate));
    return value === "wall" || value === "hatch";
  };
  return ([
    { axis:"h", col:node.col - 1, row:node.row },
    { axis:"h", col:node.col, row:node.row },
    { axis:"v", col:node.col, row:node.row - 1 },
    { axis:"v", col:node.col, row:node.row },
  ] as LatticeEdge[]).filter(carriesPanel).length;
};

// ---------------------------------------------------------------------------
// Hub kits
//
// A hub kit has no edge panels: every piece stands on a NODE and carries its
// own arms of wall, each reaching exactly half a pitch, so an edge is walled
// when the hubs at both its ends reach an arm along it. See EBERLEG_GRID in
// terrain.ts for the measurements this is read from.
// ---------------------------------------------------------------------------

export type Dir = "n" | "e" | "s" | "w";
export type HubShape = "column" | "stub" | "straight" | "corner" | "t" | "cross";

/** Turning the board 90 degrees clockwise sends each side to the next one. */
const CLOCKWISE:Record<Dir, Dir> = { n:"e", e:"s", s:"w", w:"n" };

/**
 * Each casting's arms as the STL actually has them, before any rotation.
 *
 * Read straight off the meshes — the corner's two arms are west and south, the
 * T's three are west, east and south, and so on. `facing` elsewhere is the
 * number of degrees clockwise from these.
 */
const CANONICAL_ARMS:Record<HubShape, Dir[]> = {
  column:[],
  stub:["e"],
  straight:["w", "e"],
  corner:["w", "s"],
  t:["w", "e", "s"],
  cross:["n", "e", "s", "w"],
};

const turn = (arms:Dir[], quarters:number):Dir[] => {
  let turned = arms;
  for (let step = 0; step < quarters; step++) turned = turned.map((dir) => CLOCKWISE[dir]);
  return turned;
};

/** Which way you travel along an edge to get from one of its nodes to the other. */
const dirFromNode = (edge:LatticeEdge, from:LatticeNode):Dir =>
  edge.axis === "h" ? (from.col === edge.col ? "e" : "w") : (from.row === edge.row ? "s" : "n");

/**
 * Tile one wall run.
 *
 * Long panels first, because they cost one column fewer per two cells and because
 * a long unbroken panel is what a real bulkhead is made of. An edge the plan marks
 * as a doorway must receive a hatchway panel; there is no fallback, since walling
 * it up would cut the route the plan guaranteed.
 *
 * Returns null if the run cannot be completed. It never returns a partial run:
 * a bulkhead with a hole in the middle of it is the single most obviously wrong
 * thing a generator of these boards can emit, and the previous one did it by
 * design.
 */
const tileRun = (
  run:LatticeEdge[], state:Map<string, EdgeState>, defs:BuildDef[], stock:Map<string, number>,
  random:() => number,
):Placement[] | null => {
  const placements:Placement[] = [];
  const wants = (edge:LatticeEdge) => state.get(edgeKey(edge)) === "hatch";
  let index = 0;
  while (index < run.length) {
    const edge = run[index];
    const next = run[index + 1];
    let placed:Placement | null = null;

    if (next) {
      // A long panel carries a single hatchway, so it can serve at most one
      // doorway. Two doorways side by side need two panels.
      const doorways = (wants(edge) ? 1 : 0) + (wants(next) ? 1 : 0);
      if (doorways <= 1) {
        const def = chooseDef(defs, stock, 2, doorways === 1, random);
        if (def) {
          stock.set(def.id, stock.get(def.id)! - 1);
          const [from] = nodesOfEdge(edge);
          const to = edge.axis === "h" ? { col:from.col + 2, row:from.row } : { col:from.col, row:from.row + 2 };
          placed = { def, edge, cells:2, ends:[from, to], servesDoorway:doorways === 1 };
        }
      }
    }
    if (!placed) {
      const def = chooseDef(defs, stock, 1, wants(edge), random);
      if (!def) return null;
      stock.set(def.id, stock.get(def.id)! - 1);
      placed = { def, edge, cells:1, ends:nodesOfEdge(edge), servesDoorway:wants(edge) };
    }
    placements.push(placed);
    index += placed.cells;
  }
  return placements;
};

const placePanel = (
  lattice:Lattice, placement:Placement, heights:Record<string, number>,
  runId:string, sequenceIndex:number,
):Omit<BuiltPiece, "uid"> => {
  const { def, edge, cells, servesDoorway } = placement;
  const span = spanWorld(lattice, edge, cells);
  const horizontal = span.horizontal;
  // Every panel is centred in its span, which is the whole of the placement rule.
  // A bare panel is shorter than its span and reaches into the column at each end;
  // a "+ pillars" panel is exactly one span long because the moulded half-column at
  // each end takes up the difference. Both come out right from being centred.
  const along = def.length;
  return {
    defId:def.id,
    x:span.centre.x - (horizontal ? along : def.depth) / 2,
    y:span.centre.y - (horizontal ? def.depth : along) / 2,
    rotation:horizontal ? 0 : 90,
    height:heights[def.id] ?? def.height,
    runId, sequenceIndex,
    servesDoorway,
  };
};

/**
 * Build a board from a hub kit.
 *
 * Nothing sits on an edge here. Each node takes ONE casting, chosen by which of
 * its four directions the plan wants walled, and that casting brings the walls
 * with it: half an edge in each armed direction, meeting the arm reaching back
 * from the hub opposite. So the whole board is node pieces, and the fillers
 * exist only for the two cases a hub cannot serve.
 *
 *   - A doorway, which is never an arm because an arm is solid wall. The hubs
 *     either side leave the gap open and a bulkhead stands in it.
 *   - A direction whose casting ran out, or a node where four runs meet and the
 *     kit has no cross casting.
 *
 * The one rule that keeps this honest is that a casting is only ever placed
 * where EVERY arm it carries has a wall to be: `arms` must be a subset of what
 * the plan wants at that node. A corner turned the wrong way would otherwise put
 * a moulded stub of wall out into open floor, which is the hub-kit version of a
 * panel hanging in mid-air.
 */
const buildHub = ({ plan, defs, stock, heights, nextUid, seed }:BuildInput):BuildResult => {
  const { lattice, state } = plan;
  const random = randomFactory(seed);
  const working = new Map(stock);
  const pieces:BuiltPiece[] = [];

  const hubDefs = shuffle(defs.filter((def) => def.shape !== undefined), random);
  const halfDoors = defs.filter((def) => def.halfEdge && def.kind === "door");
  const halfWalls = defs.filter((def) => def.halfEdge && def.kind === "wall");
  const wideDoors = defs.filter((def) => !def.halfEdge && def.shape === undefined && def.kind === "door");
  if (!hubDefs.length) return { ok:false, reason:"hub kit has no node castings" };

  const column = hubDefs.find((def) => def.shape === "column");
  const hubHalf = (column ? column.depth : Math.min(...hubDefs.map((def) => def.depth))) / 2;
  const reachOf = (dir:Dir) => dir === "w" || dir === "e" ? lattice.pitchX / 2 : lattice.pitchY / 2;

  const has = (def:BuildDef) => (working.get(def.id) ?? 0) > 0;
  const take = (def:BuildDef) => { working.set(def.id, (working.get(def.id) ?? 0) - 1); return def; };
  const spare = (list:BuildDef[]) => list.find(has);

  const panelEdges = plan.panelEdges.filter((edge) =>
    !isBorderEdge(lattice, edge) || plan.exterior.has(edgeKey(edge)));
  if (!panelEdges.length) return { ok:false, reason:"plan carries no panels" };

  // Eberleg bulkheads are large freestanding frames, so a door with a three-edge
  // detour around either end looks especially absurd: the model just walks round
  // the frame. Close those locally bypassable hatches into ordinary wall before
  // choosing castings. The detour proves this cannot disconnect the board.
  const insideEdge = (edge:LatticeEdge) => edge.axis === "h"
    ? edge.col >= 0 && edge.col < lattice.cols && edge.row >= 0 && edge.row <= lattice.rows
    : edge.col >= 0 && edge.col <= lattice.cols && edge.row >= 0 && edge.row < lattice.rows;
  const open = (edge:LatticeEdge) => insideEdge(edge) && (state.get(edgeKey(edge)) ?? "open") === "open";
  const detours = (edge:LatticeEdge):LatticeEdge[][] => edge.axis === "h"
    ? [
        [{ axis:"v", col:edge.col, row:edge.row - 1 }, { axis:"h", col:edge.col, row:edge.row - 1 }, { axis:"v", col:edge.col + 1, row:edge.row - 1 }],
        [{ axis:"v", col:edge.col, row:edge.row }, { axis:"h", col:edge.col, row:edge.row + 1 }, { axis:"v", col:edge.col + 1, row:edge.row }],
      ]
    : [
        [{ axis:"h", col:edge.col - 1, row:edge.row }, { axis:"v", col:edge.col - 1, row:edge.row }, { axis:"h", col:edge.col - 1, row:edge.row + 1 }],
        [{ axis:"h", col:edge.col, row:edge.row }, { axis:"v", col:edge.col + 1, row:edge.row }, { axis:"h", col:edge.col, row:edge.row + 1 }],
      ];
  panelEdges.forEach((edge) => {
    if (state.get(edgeKey(edge)) === "hatch" && detours(edge).some((route) => route.every(open))) {
      state.set(edgeKey(edge), "wall");
    }
  });

  // A doorway is settled before anything else, because it is what says which hubs
  // must NOT arm a direction. Double bulkheads go first: one fills the whole gap
  // between two bare hubs. Past those, a single bulkhead takes half the gap and
  // one hub arms the other half, which is still a wall with a door in it.
  type Job = {
    edge:LatticeEdge; a:LatticeNode; b:LatticeNode; dirA:Dir; dirB:Dir;
    hatch:boolean; wide?:BuildDef; single?:BuildDef; armedEnd?:"a" | "b";
  };
  const jobs:Job[] = panelEdges.map((edge) => {
    const [a, b] = nodesOfEdge(edge);
    return {
      edge, a, b, dirA:dirFromNode(edge, a), dirB:dirFromNode(edge, b),
      hatch:state.get(edgeKey(edge)) === "hatch",
    };
  });
  const doorways = jobs.filter((job) => job.hatch).length;
  for (const job of jobs) {
    if (!job.hatch) continue;
    const wide = spare(wideDoors);
    if (wide) { job.wide = take(wide); continue; }
    const single = spare(halfDoors);
    if (!single) return { ok:false, reason:`out of bulkheads: ${doorways} doorways need one` };
    job.single = take(single);
    job.armedEnd = random() < .5 ? "a" : "b";
  }

  // What each node wants walled. A doorway filled end to end by a double bulkhead
  // asks for no arm at all; one filled by a single bulkhead asks for exactly one,
  // at the end the bulkhead does not cover.
  const wanted = new Map<string, Set<Dir>>();
  const nodes = new Map<string, LatticeNode>();
  const askFor = (node:LatticeNode, dir:Dir) => {
    const key = nodeKey(node);
    const set = wanted.get(key) ?? new Set<Dir>();
    set.add(dir);
    wanted.set(key, set);
  };
  jobs.forEach((job) => {
    nodes.set(nodeKey(job.a), job.a);
    nodes.set(nodeKey(job.b), job.b);
    if (job.wide) return;
    if (job.single) {
      if (job.armedEnd === "a") askFor(job.a, job.dirA); else askFor(job.b, job.dirB);
      return;
    }
    askFor(job.a, job.dirA);
    askFor(job.b, job.dirB);
  });

  // Busiest nodes first, so the scarce three-armed castings land where three runs
  // actually meet rather than being spent on a corner a corner would have done.
  //
  // A node with one, two or three incident walls must use the casting made for
  // that exact shape.  Treating any subset as good enough is physically possible
  // only after filling every omitted arm with a loose single wall; that is how the
  // old pass produced column + single-wall pairs at the ends of runs while proper
  // stubs and straight pieces were the intended joint.  Four-way nodes are the
  // sole exception because Eberleg publishes no cross casting: a T plus one single
  // wall is the kit's real, unavoidable construction there.
  const chosen = new Map<string, { def:BuildDef; facing:0 | 90 | 180 | 270; arms:Dir[] }>();
  const busiest = [...nodes.keys()].sort((first, second) =>
    (wanted.get(second)?.size ?? 0) - (wanted.get(first)?.size ?? 0));
  for (const key of busiest) {
    const want = wanted.get(key) ?? new Set<Dir>();
    let best:{ def:BuildDef; facing:0 | 90 | 180 | 270; arms:Dir[] } | null = null;
    for (const def of hubDefs) {
      if (!has(def)) continue;
      for (let quarter = 0; quarter < 4; quarter++) {
        const arms = turn(CANONICAL_ARMS[def.shape!], quarter);
        // Never point a moulded arm at open floor.
        if (!arms.every((dir) => want.has(dir))) continue;
        if (want.size < 4 && arms.length !== want.size) continue;
        if (!best || arms.length > best.arms.length) {
          best = { def, facing:(quarter * 90) as 0 | 90 | 180 | 270, arms };
        }
      }
    }
    if (!best) return {
      ok:false,
      reason:`out of exact node castings: ${nodes.size} nodes need one (singles are reserved for four-way nodes)`,
    };
    take(best.def);
    chosen.set(key, best);
  }

  const armed = (node:LatticeNode, dir:Dir) => chosen.get(nodeKey(node))?.arms.includes(dir) ?? false;

  /**
   * Second pass: rescue any edge that came out of the first with no arm at all.
   *
   * Exact castings settle every node up to degree three. Only a four-way node can
   * drop a direction, because the range has no cross casting; two neighbouring
   * four-way nodes can independently drop the edge between them.
   *
   * The rescue is to re-pick one endpoint, handing its current casting back to the
   * box first so a like-for-like swap is always on the table.
   */
  const rescue = (node:LatticeNode, dir:Dir) => {
    const key = nodeKey(node);
    const current = chosen.get(key);
    if (!current) return false;
    const want = wanted.get(key) ?? new Set<Dir>();
    if (!want.has(dir)) return false;
    working.set(current.def.id, (working.get(current.def.id) ?? 0) + 1);
    let best:{ def:BuildDef; facing:0 | 90 | 180 | 270; arms:Dir[] } | null = null;
    for (const def of hubDefs) {
      if (!has(def)) continue;
      for (let quarter = 0; quarter < 4; quarter++) {
        const arms = turn(CANONICAL_ARMS[def.shape!], quarter);
        if (!arms.includes(dir)) continue;
        if (!arms.every((each) => want.has(each))) continue;
        if (want.size < 4 && arms.length !== want.size) continue;
        if (!best || arms.length > best.arms.length) {
          best = { def, facing:(quarter * 90) as 0 | 90 | 180 | 270, arms };
        }
      }
    }
    if (!best) { working.set(current.def.id, (working.get(current.def.id) ?? 0) - 1); return false; }
    take(best.def);
    chosen.set(key, best);
    return true;
  };
  jobs.forEach((job) => {
    if (job.wide || job.single) return;
    if (armed(job.a, job.dirA) || armed(job.b, job.dirB)) return;
    if (!rescue(job.a, job.dirA)) rescue(job.b, job.dirB);
  });

  // Every edge has to come out whole. One with a single arm is finished with a
  // half filler; one with no arm at all has nothing for that filler's inner end to
  // stand on, so rather than leave a panel hanging the build fails and the
  // generator tries a smaller board -- the same reject-and-retry as everywhere else.
  type Filler = { def:BuildDef; node:LatticeNode; dir:Dir };
  const fillers:Filler[] = [];
  for (const job of jobs) {
    if (job.wide) continue;
    const armsHere = (armed(job.a, job.dirA) ? 1 : 0) + (armed(job.b, job.dirB) ? 1 : 0);
    if (job.single) {
      if (!armsHere) return { ok:false, reason:"a doorway lost the arm facing its bulkhead" };
      const bare = job.armedEnd === "a" ? { node:job.b, dir:job.dirB } : { node:job.a, dir:job.dirA };
      fillers.push({ def:job.single, node:bare.node, dir:bare.dir });
      continue;
    }
    if (armsHere === 2) continue;
    // A missing arm can only belong to a four-way node (there is no cross
    // casting). A single wall supplies that one missing half. If both endpoints
    // are four-way T substitutions, two singles meet at the middle of the gap.
    const bare = armed(job.a, job.dirA)
      ? [{ node:job.b, dir:job.dirB }]
      : armed(job.b, job.dirB)
        ? [{ node:job.a, dir:job.dirA }]
        : [{ node:job.a, dir:job.dirA }, { node:job.b, dir:job.dirB }];
    for (const half of bare) {
      const filler = spare(halfWalls);
      if (!filler) return { ok:false, reason:"out of single walls to finish an edge no hub could arm" };
      take(filler);
      fillers.push({ def:filler, node:half.node, dir:half.dir });
    }
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------
  chosen.forEach(({ def, facing, arms }, key) => {
    const world = nodeWorld(lattice, nodes.get(key)!);
    const reach = (dir:Dir) => arms.includes(dir) ? reachOf(dir) : hubHalf;
    const width = reach("w") + reach("e");
    const height = reach("n") + reach("s");
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:world.x - reach("w"),
      y:world.y - reach("n"),
      // The box a set of arms makes is always the casting's own, one way round or
      // the other -- so which way round it is IS the rotation, and `facing` carries
      // the rest, since two opposite orientations share a box.
      rotation:width >= height ? 0 : 90,
      height:heights[def.id] ?? def.height,
      facing,
    });
  });

  fillers.forEach(({ def, node, dir }) => {
    const world = nodeWorld(lattice, node);
    const along = def.length;
    const across = def.depth;
    const horizontal = dir === "e" || dir === "w";
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:horizontal ? (dir === "e" ? world.x + hubHalf : world.x - hubHalf - along) : world.x - across / 2,
      y:horizontal ? world.y - across / 2 : (dir === "s" ? world.y + hubHalf : world.y - hubHalf - along),
      rotation:horizontal ? 0 : 90,
      height:heights[def.id] ?? def.height,
      servesDoorway:def.kind === "door",
    });
  });

  jobs.filter((job) => job.wide).forEach((job) => {
    const from = nodeWorld(lattice, job.a);
    const to = nodeWorld(lattice, job.b);
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const def = job.wide!;
    const horizontal = job.edge.axis === "h";
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:horizontal ? midX - def.length / 2 : midX - def.depth / 2,
      y:horizontal ? midY - def.depth / 2 : midY - def.length / 2,
      rotation:horizontal ? 0 : 90,
      height:heights[def.id] ?? def.height,
      servesDoorway:true,
    });
  });

  return { ok:true, pieces };
};

export const build = (input:BuildInput):BuildResult => {
  // A hub kit is a different assembly model end to end rather than a variation
  // on this one, so it gets its own pass instead of a flag threaded through here.
  if (input.defs.some((def) => def.shape !== undefined || def.halfEdge)) return buildHub(input);
  const { plan, defs, stock, heights, nextUid, seed } = input;
  const { lattice, state } = plan;
  const random = randomFactory(seed);
  const working = new Map(stock);

  // Interior edges, plus the perimeter edges the plan marked as the complex's own
  // outside wall.
  //
  // This dropped EVERY perimeter edge, which silently threw the hull away. A centred
  // 5 x 6 complex on a four-foot table plans 47 wall-cells of which 22 are its own
  // exterior, so two fifths of the plan was budgeted for, validated, drawn in the
  // ASCII map — and then never placed. The result was an unenclosed patch of interior
  // walls with stubs hanging off it, which is precisely the failure `exteriorEdges`
  // exists to prevent, and the interior was starved by the hull's worth of budget it
  // had been charged for and did not spend.
  //
  // A perimeter edge NOT in `exterior` is one lying along the table edge, and that
  // one genuinely needs no panel: the board border is the wall.
  const panelEdges = plan.panelEdges.filter((edge) =>
    !isBorderEdge(lattice, edge) || plan.exterior.has(edgeKey(edge)));
  if (!panelEdges.length) return { ok:false, reason:"plan carries no panels" };

  // Runs are tiled in a shuffled order. Tiling them as listed let one orientation
  // drain the long panels dry and leave the other with nothing but shorts, which
  // reads as one axis built properly and the other improvised.
  const runs = shuffle(edgeRuns(panelEdges), random);
  const placements:Placement[] = [];
  const pieces:BuiltPiece[] = [];
  runs.forEach((run, runIndex) => {
    const tiled = tileRun(run, state, defs, working, random);
    if (!tiled) return;
    const runId = `deck-${seed}-${runIndex}`;
    tiled.forEach((placement, sequence) => {
      placements.push(placement);
      pieces.push({ uid:nextUid(), ...placePanel(lattice, placement, heights, runId, sequence) });
    });
  });

  const tiledEdges = placements.reduce((sum, placement) => sum + placement.cells, 0);
  if (tiledEdges < panelEdges.length) {
    return { ok:false, reason:`only ${tiledEdges} of ${panelEdges.length} wall-cells could be built from stock` };
  }

  // ---------------------------------------------------------------------------
  // Nodes
  //
  // A column stands on every node a panel end reaches, and nowhere else. Nodes
  // covered by a piece that carries its own columns are already served, which is
  // where the loose-column budget gets the slack it needs.
  // ---------------------------------------------------------------------------
  const ends = new Map<string, { node:LatticeNode; count:number; horizontal:number; vertical:number }>();
  placements.forEach((placement) => {
    placement.ends.forEach((node) => {
      const key = nodeKey(node);
      const entry = ends.get(key) ?? { node, count:0, horizontal:0, vertical:0 };
      entry.count++;
      if (placement.edge.axis === "h") entry.horizontal++; else entry.vertical++;
      ends.set(key, entry);
    });
  });

  const columnDefs = defs.filter((def) => def.kind === "pillar" || def.kind === "connector");
  const capDefs = defs.filter((def) => def.kind === "end");

  for (const entry of [...ends.values()].sort((first, second) => second.count - first.count)) {
    // A wall-end cap is COSMETIC. It covers the exposed end of a panel that stops in
    // open floor; it brackets nothing and it cannot join one panel to another. So it is
    // only allowed where exactly one panel-carrying edge meets the node.
    //
    // The test used to be `entry.count === 1` — one panel END arriving — and that is not
    // the same thing. A run terminating against the flank of a long panel also has
    // exactly one end arriving at that node, while the long panel covers it with two more
    // panel edges. 30% of the caps on a board were sitting in that position, holding a
    // wall onto the side of another wall, which is a cap doing a connector's job.
    //
    // Where a cap is legitimate it still frees a column for a real junction, which is the
    // cheapest trade available on a column-limited board.
    const freeEnd = entry.count === 1 && panelsAtNode(entry.node, state) === 1;
    const cap = freeEnd ? capDefs.find((def) => (working.get(def.id) ?? 0) > 0) : undefined;
    const def = cap ?? columnDefs.find((candidate) => (working.get(candidate.id) ?? 0) > 0);
    if (!def) {
      return { ok:false, reason:`out of columns: ${ends.size} nodes need one` };
    }
    working.set(def.id, working.get(def.id)! - 1);

    const world = nodeWorld(lattice, entry.node);
    // The Gallowdark column is 28 x 25 mm — not square — so it is turned to run
    // its long side along whichever axis carries more of the panels meeting here.
    const alongX = entry.horizontal >= entry.vertical;
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:world.x - (alongX ? def.length : def.depth) / 2,
      y:world.y - (alongX ? def.depth : def.length) / 2,
      rotation:alongX ? 0 : 90,
      height:heights[def.id] ?? def.height,
    });
  }

  return { ok:true, pieces };
};
