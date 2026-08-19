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

export const build = ({ plan, defs, stock, heights, nextUid, seed }:BuildInput):BuildResult => {
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
