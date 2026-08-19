/**
 * The generator: size the deck to the terrain, plan it, build it, judge it once.
 *
 * There is exactly ONE scorer in this codebase and it lives at the bottom of this
 * file. The previous version had two — an inner one penalising sight lines and an
 * outer one in the UI rewarding raw piece count — and the outer one systematically
 * overruled the inner one, which is the mechanism behind boards getting worse while
 * every tracked number improved. Nothing else may score a candidate.
 *
 * Sizing is the other half of the story. A kit populates a fixed area at real board
 * density: one Boarding Actions set is 48 wall-cells, and a 7 x 6 lattice has 71
 * internal edges, so one set fills roughly one card board. Spreading that same set
 * over a four-foot table cannot make more terrain; it can only make thinner
 * terrain, which is the "few pieces on open floor" complaint in its purest form. So
 * the complex is built at the size its own terrain supports and anchored on the
 * board, and the leftover is honest open deck rather than a thinned-out margin.
 */

import {
  internalEdgeCount, makeLattice, pitchIsBuildable, columnBite,
  type Lattice,
} from "./lattice.ts";
import { buildDeckPlan, renderPlan, type DeckPlan } from "./deckplan.ts";
import { build, type BuildDef, type BuiltPiece } from "./build.ts";
import {
  distanceFromReference, invariants, measure,
  PROVISIONAL_REFERENCE, type Metrics, type ReferenceProfile,
} from "./validate.ts";

export type KitCatalogue = "boarding" | "ttcombat";

export type KitDef = {
  id:string;
  catalogue:KitCatalogue;
  width:number; depth:number; height:number;
  kind:"wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair";
  /** Node-to-node span, for kits built on a fixed assembly grid. Gallowdark is
   *  such a kit: a short panel spans one 97 mm square and a long panel two. */
  span?:number;
  /** Columns moulded into the piece, at 0, 1 or 2 of its ends. */
  ownColumns?:0 | 1 | 2;
};

/** Where a complex smaller than the board is put. */
export type Anchor = "auto" | "corner" | "edge" | "centre";

export type Zone = { x:number; y:number; width:number; height:number };

export type GenerateInput = {
  boardWidth:number; boardHeight:number;
  catalogue:KitCatalogue;
  defs:KitDef[];
  /** Copies owned, by id, already multiplied by the number of sets. */
  inventory:Record<string, number>;
  heights:Record<string, number>;
  zones:Zone[];
  anchor?:Anchor;
  /** 0-1. Below 1 the palette is deliberately underspent. */
  usage?:number;
  seed:number;
  nextUid:() => string;
  candidates?:number;
  reference?:ReferenceProfile;
};

export type GenerateReport = {
  pieces:BuiltPiece[];
  /** Null when nothing could be built at all. */
  metrics:Metrics | null;
  lattice:Lattice | null;
  plan:DeckPlan | null;
  /** How much of the board the terrain can fill at reference density. */
  greed:number;
  anchor:Anchor;
  /** Sets-equivalent needed to fill this board at reference density. */
  setsToFill:number;
  /** Wall-cells of panel the palette owns but the board did not need. */
  leftover:number;
  score:number;
  rejected:Record<string, number>;
  note:string;
};

const randomFactory = (seed:number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
};

// ---------------------------------------------------------------------------
// Reading the kit
// ---------------------------------------------------------------------------

/**
 * Node-to-node length a piece occupies.
 *
 * The two kits meet their columns differently and this is the only place the
 * difference lives. Gallowdark states a span because the panel slots INTO a column
 * straddling the corner, so the square is the panel length. Iron Labyrinth states
 * none because the wall sits BETWEEN two connector blocks, so the square is the
 * wall plus a connector.
 */
const spanOf = (def:KitDef, support:number) => def.span ?? support + def.width;

export type KitReading = {
  pitch:number;
  support:number;
  cells:Map<string, number>;
  /** Lattice edges the palette can cover with a panel. */
  capacity:number;
  /** Hatchway panels, so doorways. A long hatchway carries one door, not two. */
  doorways:number;
  columns:number;
  caps:number;
  buildDefs:BuildDef[];
  accessories:KitDef[];
};

export const readKit = (defs:KitDef[], inventory:Record<string, number>, catalogue:KitCatalogue):KitReading | null => {
  const owned = defs.filter((def) => def.catalogue === catalogue && (inventory[def.id] ?? 0) > 0);
  const panels = owned.filter((def) => def.kind === "wall" || def.kind === "door");
  const supports = owned.filter((def) => def.kind === "pillar" || def.kind === "connector");
  const caps = owned.filter((def) => def.kind === "end");
  if (!panels.length || !supports.length) return null;

  const support = Math.max(...supports.map((def) => Math.max(def.width, def.depth)));
  // The shortest panel defines one square; the longer ones are whole multiples of
  // it. That is how both kits are cut, and it is why the long Gallowdark panel is
  // two squares rather than a cell width of its own — offering it as its own cell
  // put the whole board on a 7.6" pitch, which halved the cell count and left the
  // short panels with nothing to fill.
  const pitch = Math.min(...panels.map((def) => spanOf(def, support)));
  const cells = new Map(panels.map((def) => [def.id, Math.max(1, Math.round(spanOf(def, support) / pitch))]));

  const buildDefs:BuildDef[] = [
    ...panels.map((def) => ({
      id:def.id, kind:def.kind as "wall" | "door", length:def.width, depth:def.depth,
      cells:cells.get(def.id)!, ownColumns:def.ownColumns ?? 0, height:def.height,
    })),
    ...supports.map((def) => ({
      id:def.id, kind:def.kind as "pillar" | "connector", length:Math.max(def.width, def.depth),
      depth:Math.min(def.width, def.depth), cells:0, ownColumns:0 as const, height:def.height,
    })),
    ...caps.map((def) => ({
      id:def.id, kind:"end" as const, length:Math.max(def.width, def.depth),
      depth:Math.min(def.width, def.depth), cells:0, ownColumns:0 as const, height:def.height,
    })),
  ];

  return {
    pitch, support, cells,
    capacity:panels.reduce((sum, def) => sum + (inventory[def.id] ?? 0) * cells.get(def.id)!, 0),
    doorways:panels.filter((def) => def.kind === "door").reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    columns:supports.reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    caps:caps.reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    buildDefs,
    accessories:owned.filter((def) => def.kind === "floor" || def.kind === "stair"),
  };
};

// ---------------------------------------------------------------------------
// Sizing and anchoring
// ---------------------------------------------------------------------------

/**
 * The largest lattice the terrain can fill at reference density, capped by the
 * board.
 *
 * Density is held at the reference and the FOOTPRINT absorbs the surplus, so extra
 * sets make the complex bigger rather than denser — up to the point where it fills
 * the table, after which there is nowhere left to grow and the surplus does raise
 * density. Footprint first, density second.
 */
const sizeLattice = (
  boardWidth:number, boardHeight:number, pitch:number, support:number,
  capacity:number, targetDensity:number,
) => {
  // A lattice flush to the board edge would centre a column on the edge itself and
  // hang half of it over the side, so a margin is kept for the complex to be inset
  // into. Half a column, not a whole one: the real Gallowdark card board leaves a
  // 12.5 mm border against a 14 mm half-column, so its own corner columns overhang
  // the print slightly. Demanding a full column here is 1.5 mm stricter than Games
  // Workshop and costs a whole square off both axes — a 7 x 6 card board came out
  // 6 x 5.
  const maxCols = Math.floor((boardWidth - support / 2) / pitch);
  const maxRows = Math.floor((boardHeight - support / 2) / pitch);
  if (maxCols < 2 || maxRows < 2) return null;

  const aspect = Math.log(boardWidth / boardHeight);
  let best:{ cols:number; rows:number } | null = null;
  let bestKey = -Infinity;
  for (let cols = 2; cols <= maxCols; cols++) for (let rows = 2; rows <= maxRows; rows++) {
    if (internalEdgeCount(cols, rows) * targetDensity > capacity) continue;
    // Biggest first, but proportion matters enough to give up a cell or two for: on
    // a square table, 5 x 9 holds more cells than 6 x 7 and looks like a corridor
    // block rather than a deck. Compared as a log ratio so that being twice as long
    // as it should be costs the same as being half as long.
    const key = cols * rows - Math.abs(Math.log(cols / rows) - aspect) * 12;
    if (key > bestKey) { bestKey = key; best = { cols, rows }; }
  }
  // Nothing fits even at 2 x 2: the palette is tiny. Build the smallest thing that
  // can hold a wall rather than returning nothing.
  return { ...(best ?? { cols:2, rows:2 }), maxCols, maxRows };
};

/**
 * Where to put a complex smaller than the board.
 *
 * Not a cosmetic choice — the three options cost different amounts of terrain,
 * because the board border is a wall for free:
 *
 *   corner   two hull sides free. Cheapest, so the most of the kit goes into
 *            interior structure and a small complex still reads as dense.
 *   edge     one hull side free.
 *   centre   no hull sides. The complex has to build its own perimeter, which is
 *            roughly a perimeter's worth of panels spent on a hull instead of on
 *            rooms. Right when you want a free-standing structure with deck all
 *            round; expensive otherwise.
 */
const resolveAnchor = (requested:Anchor, greed:number, slackX:number, slackY:number, pitch:number):Anchor => {
  if (requested !== "auto") return requested;
  if (slackX < pitch && slackY < pitch) return "centre";
  return greed < .8 ? "corner" : "edge";
};

const originsFor = (anchor:Anchor, slackX:number, slackY:number, inset:number, random:() => number) => {
  const flushLow = inset;
  const flushHigh = (slack:number) => Math.max(inset, slack - inset);
  const middle = (slack:number) => slack / 2;
  const pick = (slack:number) => random() < .5 ? flushLow : flushHigh(slack);
  switch (anchor) {
    case "corner": return { x:pick(slackX), y:pick(slackY) };
    case "edge": return random() < .5
      ? { x:pick(slackX), y:middle(slackY) }
      : { x:middle(slackX), y:pick(slackY) };
    default: return { x:middle(slackX), y:middle(slackY) };
  }
};

const rectsOverlap = (
  first:{ x:number;y:number;width:number;height:number },
  second:{ x:number;y:number;width:number;height:number },
) => first.x < second.x + second.width && first.x + first.width > second.x
  && first.y < second.y + second.height && first.y + first.height > second.y;

const zoneOverlapArea = (rect:{ x:number;y:number;width:number;height:number }, zones:Zone[]) =>
  zones.reduce((sum, zone) => {
    const width = Math.min(rect.x + rect.width, zone.x + zone.width) - Math.max(rect.x, zone.x);
    const height = Math.min(rect.y + rect.height, zone.y + zone.height) - Math.max(rect.y, zone.y);
    return sum + (width > 0 && height > 0 ? width * height : 0);
  }, 0);

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export const generate = (input:GenerateInput):GenerateReport => {
  const { boardWidth, boardHeight, catalogue, defs, inventory, heights, zones, seed, nextUid } = input;
  const reference = input.reference ?? PROVISIONAL_REFERENCE;
  const usage = Math.min(1, Math.max(.05, input.usage ?? 1));
  const rejected:Record<string, number> = {};
  const empty = (note:string):GenerateReport => ({
    pieces:[], metrics:null, lattice:null, plan:null, greed:0,
    anchor:input.anchor ?? "auto", setsToFill:0, leftover:0, score:-Infinity, rejected, note,
  });

  const kit = readKit(defs, inventory, catalogue);
  if (!kit) return empty("the palette has no walls, or no columns to bracket them");

  const shortest = Math.min(...kit.buildDefs.filter((def) => def.cells === 1).map((def) => def.length));
  if (!pitchIsBuildable(shortest, kit.pitch, kit.support)) {
    // Refusing to build is the right answer here. A pitch outside this range
    // cannot be assembled from the kit, and every board the previous generator
    // produced was downstream of exactly this going unchecked.
    return empty(
      `unbuildable grid: a ${shortest.toFixed(2)}" panel on a ${kit.pitch.toFixed(2)}" pitch with `
      + `${kit.support.toFixed(2)}" columns leaves ${columnBite(shortest, kit.pitch, kit.support).toFixed(3)}" of joint`,
    );
  }

  const spendable = Math.max(1, Math.round(kit.capacity * usage));
  const sized = sizeLattice(boardWidth, boardHeight, kit.pitch, kit.support, spendable, reference.density);
  if (!sized) return empty("the board is smaller than one grid square");

  const boardEdges = internalEdgeCount(sized.maxCols, sized.maxRows);
  const greed = spendable / Math.max(1, boardEdges * reference.density);
  const setsToFill = Math.max(1, Math.ceil(1 / Math.max(greed, 1e-6)));

  const gridWidth = sized.cols * kit.pitch;
  const gridHeight = sized.rows * kit.pitch;
  const slackX = Math.max(0, boardWidth - gridWidth);
  const slackY = Math.max(0, boardHeight - gridHeight);
  const anchor = resolveAnchor(input.anchor ?? "auto", greed, slackX, slackY, kit.pitch);
  const inset = Math.min(kit.support / 2, slackX / 2, slackY / 2);

  const random = randomFactory(seed);
  const candidates = input.candidates ?? 40;
  // Spend up to reference density and no further, with a little headroom for
  // someone who wants to see their collection on the table. Past that, surplus
  // terrain stays in the box: four sets on one card board crammed in at 86%
  // density gives a compartment per square and a wall on nearly every edge, which
  // is not a denser board so much as a solid one. Terrain left over is a normal
  // outcome and is reported rather than forced onto the deck.
  const densityCap = Math.round(internalEdgeCount(sized.cols, sized.rows) * Math.min(1, reference.density * 1.15));
  let budget = Math.min(spendable, densityCap);
  let best:{ pieces:BuiltPiece[]; metrics:Metrics; lattice:Lattice; plan:DeckPlan; score:number } | null = null;
  const maxSight = Math.max(3, Math.round(reference.longestSight + 2));

  for (let attempt = 0; attempt < candidates; attempt++) {
    // Anchoring is re-rolled per candidate, and a position overlapping a reserved
    // zone is skipped rather than having its pieces deleted afterwards. Deleting
    // pieces from a finished layout is what leaves a bulkhead with a hole in it.
    let origin = originsFor(anchor, slackX, slackY, inset, random);
    if (zones.length) {
      const options = Array.from({ length:8 }, () => originsFor(anchor, slackX, slackY, inset, random))
        .map((candidate) => ({
          candidate,
          overlap:zoneOverlapArea({ x:candidate.x, y:candidate.y, width:gridWidth, height:gridHeight }, zones),
        }))
        .sort((first, second) => first.overlap - second.overlap);
      origin = options[0].candidate;
    }

    const lattice = makeLattice(sized.cols, sized.rows, kit.pitch, kit.pitch, origin.x, origin.y);
    const plan = buildDeckPlan({
      lattice,
      wallEdgeBudget:budget,
      hatchSupply:kit.doorways,
      random,
    });

    const stock = new Map(Object.entries(inventory).filter(([, count]) => count > 0));
    const built = build({ plan, defs:kit.buildDefs, stock, heights, nextUid, seed:seed + attempt * 7919 });
    if (!built.ok) {
      rejected[built.reason.replace(/\d+/g, "n")] = (rejected[built.reason.replace(/\d+/g, "n")] ?? 0) + 1;
      // Out of stock at this size. Ask for a slightly smaller plan rather than
      // abandoning the board: fewer, larger compartments is a real board, and a
      // plan the kit cannot finish is not.
      budget = Math.max(4, Math.floor(budget * .92));
      continue;
    }

    const defMap = new Map(kit.buildDefs.map((def) => [def.id, def]));
    const failures = invariants({
      plan, pieces:built.pieces, defs:defMap, inventory, boardWidth, boardHeight, maxSight,
    });
    if (failures.length) {
      failures.forEach((failure) => { rejected[failure.rule] = (rejected[failure.rule] ?? 0) + 1; });
      continue;
    }

    const metrics = measure(plan);
    // The single scorer. Distance to a reference board, so overshooting is
    // penalised exactly as much as undershooting and no metric can run away with
    // the result. Utilisation is deliberately absent: it is an output.
    const score = -distanceFromReference(metrics, reference);
    if (!best || score > best.score) best = { pieces:built.pieces, metrics, lattice, plan, score };
  }

  if (!best) {
    return empty(`no candidate survived: ${Object.entries(rejected).map(([rule, count]) => `${rule} x${count}`).join(", ") || "nothing built"}`);
  }

  const pieces = [...best.pieces];
  const builtCells = best.metrics ? best.plan.panelEdges.length : 0;
  const leftover = Math.max(0, kit.capacity - builtCells);

  // Accessories dress the open deck the complex does not occupy. They are scatter,
  // not structure, so they are placed last and never allowed to foul a doorway.
  if (kit.accessories.length) {
    const complex = { x:best.lattice.originX, y:best.lattice.originY, width:gridWidth, height:gridHeight };
    kit.accessories.forEach((def) => {
      const copies = Math.round((inventory[def.id] ?? 0) * usage);
      for (let copy = 0; copy < copies; copy++) {
        for (let attempt = 0; attempt < 40; attempt++) {
          const rotation:(0 | 90) = random() < .5 ? 0 : 90;
          const width = rotation === 90 ? def.depth : def.width;
          const height = rotation === 90 ? def.width : def.depth;
          const rect = {
            x:random() * Math.max(0, boardWidth - width),
            y:random() * Math.max(0, boardHeight - height),
            width, height,
          };
          if (rectsOverlap(rect, complex) || zoneOverlapArea(rect, zones) > 0) continue;
          if (pieces.some((piece) => rectsOverlap(rect, { x:piece.x, y:piece.y, width, height }))) continue;
          pieces.push({
            uid:nextUid(), defId:def.id, x:rect.x, y:rect.y, rotation,
            height:heights[def.id] ?? def.height,
          });
          break;
        }
      }
    });
  }

  const fills = Math.round(Math.min(1, greed) * 100);
  const grid = `${sized.cols} x ${sized.rows} squares`;
  const note = greed < .95
    ? `${grid} — this palette fills about ${fills}% of the board at real density; ${setsToFill} sets would fill it`
    : leftover > 2
      ? `${grid}, filling the board at real density — ${leftover} panels stay in the box`
      : `${grid}, filling the board`;
  return {
    pieces, metrics:best.metrics, lattice:best.lattice, plan:best.plan,
    greed, anchor, setsToFill, score:best.score, rejected, leftover, note,
  };
};

export { renderPlan };
