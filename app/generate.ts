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
  cellsOfEdge, edgeKey, internalEdgeCount, makeLattice, nodeWorld, columnBite,
  type Lattice, type LatticeEdge,
} from "./lattice.ts";
import { buildDeckPlan, renderPlan, type DeckPlan, type Rect } from "./deckplan.ts";
import { build, type BuildDef, type BuiltPiece } from "./build.ts";
import { placeScatter, type ScatterTier } from "./scatter.ts";
import { randomFactory } from "./random.ts";
import {
  distanceFromReference, invariants, measure,
  PROVISIONAL_REFERENCE, type Metrics, type ReferenceProfile,
} from "./validate.ts";

export type KitCatalogue = "boarding" | "mortalis" | "deathray" | "ttcombat" | "eberleg";

export type KitDef = {
  id:string;
  /** Only used to name pieces in the report. */
  name?:string;
  catalogue:KitCatalogue;
  width:number; depth:number; height:number;
  kind:"wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair" | "scatter";
  /** Size tier for scatter, deciding whether it may stand in a corridor. */
  scatter?:ScatterTier;
  /** Node-to-node span, for kits built on a fixed assembly grid. Gallowdark is
   *  such a kit: a short panel spans one 97 mm square and a long panel two. */
  span?:number;
  /** Columns moulded into the piece, at 0, 1 or 2 of its ends. */
  ownColumns?:0 | 1 | 2;
  /** HUB KITS ONLY: which arrangement of moulded wall arms this node casting
   *  carries — see BuildDef in build.ts. Undefined everywhere else. */
  shape?:"column" | "stub" | "straight" | "corner" | "t" | "cross";
  /** HUB KITS ONLY: a filler panel covering half an edge. */
  halfEdge?:boolean;
};

/**
 * Width of a 32 mm round base, in inches.
 *
 * The unit of "can anything actually happen here". Used to decide whether a strip
 * of deck is playable space or just a margin.
 */
const MODEL_BASE = 32 / 25.4;

/** Where a complex smaller than the board is put. */
export type Anchor = "auto" | "corner" | "edge" | "centre" | "fill";

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

// ---------------------------------------------------------------------------
// Reading the kit
// ---------------------------------------------------------------------------

/**
 * Node-to-node length a piece occupies.
 *
 * The catalogues meet their columns in one of two ways and this is the only place
 * the difference lives. A straddling range states a span, because the panel slots
 * INTO a column sitting on the corner, so the square is the panel length —
 * Gallowdark, Zone Mortalis and Deadbolt's Derelict. A butting range states none,
 * because the wall sits BETWEEN two connector blocks, so the square is the wall plus
 * a connector — Iron Labyrinth.
 */
const spanOf = (def:KitDef, support:number) => def.span ?? support + def.width;

/** Fallback tier for a scatter piece whose catalogue entry does not state one,
 *  taken from whether it would fit through a corridor. */
const tierFor = (width:number, depth:number):ScatterTier => {
  const across = Math.max(width, depth);
  return across <= 1.6 ? "small" : across <= 3.6 ? "medium" : "large";
};

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
  /** Panel ids the palette owns that do not fit the chosen pitch — a different module
   *  in the same catalogue. Reported so the board can say why they stayed in the box. */
  excluded:string[];
  /** Panel ids whose stated geometry fits no pitch at all. A kit holding one of these is
   *  refused rather than partly built. */
  unbuildable:string[];
  accessories:KitDef[];
};

/**
 * Whether a panel physically fits a span of `cells` squares, and how.
 *
 * The two joint models need different tests, and conflating them is what let panels be
 * placed straight through their own connectors.
 *
 *   straddle  the panel slots INTO a column standing on the node, so it may be shorter
 *             than the span by up to one column's width — that difference is the slot.
 *             `span - support <= width <= span`.
 *   butt      the panel sits BETWEEN two connectors, so it must match the clear opening.
 *             `width == span - support`, near enough to seat.
 *
 * A straddling piece is one that states its own span. Everything else butts.
 */
export const cellsThatFit = (def:KitDef, pitch:number, support:number):number | null => {
  const straddles = def.span !== undefined;
  const seat = .04; // ~1 mm, the slack a butt joint can absorb
  for (let cells = 1; cells <= 4; cells++) {
    const span = cells * pitch;
    if (straddles) {
      if (def.width <= span + 1e-6 && span - def.width <= support + 1e-6) return cells;
    } else if (Math.abs(def.width - (span - support)) <= seat) {
      return cells;
    }
  }
  return null;
};

/**
 * Read a HUB kit, where there are no edge panels at all and every casting stands
 * on a node carrying its own arms — see EBERLEG_GRID in terrain.ts.
 *
 * The numbers this has to produce are the same ones the straddle/butt path
 * produces, they are just counted differently:
 *
 *   pitch     twice an arm's reach. Every casting states it: one with two
 *             opposite arms is a full pitch wide, one with a single arm is an arm
 *             plus half a hub. So it can be read off whichever castings the
 *             palette happens to hold, and a palette of nothing but corners still
 *             lands on the same grid as one full of straight walls.
 *   capacity  an edge takes two arm-slots, so it is half the arms in the box,
 *             plus what the fillers can cover.
 *   columns   one casting per node, so simply how many castings there are.
 */
const HUB_ARMS:Record<string, number> = { column:0, stub:1, straight:2, corner:2, t:3, cross:4 };

const readHubKit = (owned:KitDef[], inventory:Record<string, number>):KitReading | null => {
  const castings = owned.filter((def) => def.shape !== undefined);
  const column = castings.find((def) => def.shape === "column");
  if (!castings.length || !column) return null;
  const copies = (def:KitDef) => inventory[def.id] ?? 0;

  const support = Math.max(column.width, column.depth);
  // An arm reaches half a pitch. A casting with arms on opposite sides spans two
  // of them; one with arms on a single axis spans one arm plus half a hub.
  const spans = castings.map((def) => {
    const arms = HUB_ARMS[def.shape!] ?? 0;
    const long = Math.max(def.width, def.depth);
    if (!arms) return null;
    return def.shape === "straight" || def.shape === "t" || def.shape === "cross"
      ? long
      : (long - support / 2) * 2;
  }).filter((value):value is number => value !== null && value > 0);
  if (!spans.length) return null;
  const pitch = Math.max(...spans);

  const halves = owned.filter((def) => def.halfEdge);
  const wides = owned.filter((def) => !def.halfEdge && def.shape === undefined && (def.kind === "wall" || def.kind === "door"));
  const armSlots = castings.reduce((sum, def) => sum + copies(def) * (HUB_ARMS[def.shape!] ?? 0), 0)
    + halves.reduce((sum, def) => sum + copies(def), 0)
    + wides.reduce((sum, def) => sum + copies(def) * 2, 0);

  const asBuildDef = (def:KitDef):BuildDef => ({
    id:def.id,
    kind:def.kind as "wall" | "door" | "pillar" | "connector" | "end",
    length:Math.max(def.width, def.depth),
    depth:Math.min(def.width, def.depth),
    cells:1,
    ownColumns:0,
    height:def.height,
    // A filler bites into the hub at its outer end exactly as a straddling panel
    // bites into a column, and `invariants` skips the span check for a half filler
    // outright — half an edge is not a span.
    straddles:true,
    shape:def.shape,
    halfEdge:def.halfEdge,
  });

  return {
    pitch, support,
    cells:new Map(castings.map((def) => [def.id, 1])),
    capacity:Math.floor(armSlots / 2),
    doorways:owned.filter((def) => def.kind === "door").reduce((sum, def) => sum + copies(def), 0),
    columns:castings.reduce((sum, def) => sum + copies(def), 0),
    caps:0,
    buildDefs:[...castings, ...halves, ...wides].map(asBuildDef),
    excluded:[],
    unbuildable:[],
    accessories:owned.filter((def) => def.kind === "floor" || def.kind === "stair"),
  };
};

export const readKit = (defs:KitDef[], inventory:Record<string, number>, catalogue:KitCatalogue):KitReading | null => {
  const owned = defs.filter((def) => def.catalogue === catalogue && (inventory[def.id] ?? 0) > 0);
  if (owned.some((def) => def.shape !== undefined || def.halfEdge)) return readHubKit(owned, inventory);
  const allPanels = owned.filter((def) => def.kind === "wall" || def.kind === "door");
  const supports = owned.filter((def) => def.kind === "pillar" || def.kind === "connector");
  const caps = owned.filter((def) => def.kind === "end");
  if (!allPanels.length || !supports.length) return null;

  const support = Math.max(...supports.map((def) => Math.max(def.width, def.depth)));

  /**
   * Choose the pitch that makes the MOST of the palette usable.
   *
   * This was `Math.min(...panels.map(spanOf))` — the shortest panel dictated the grid for
   * everything else, and `pitchIsBuildable` only ever checked that one panel. On a mixed
   * TTCombat palette the consequences were severe rather than cosmetic. A Death Quadrant
   * single wall is 46 mm and an Iron Labyrinth wall is 64 mm; both butt between 50 mm
   * connectors, so they want a 96 mm and a 114 mm pitch respectively. Taking the minimum
   * put the whole board on 96 mm, which leaves a 46 mm opening — and then six of the
   * thirteen panel types were placed into it 64 mm wide, overlapping their connectors by
   * 9 mm at each end. That is panels running straight through the connectors, and nothing
   * checked for it.
   *
   * It also made the output erratic in a way that looked random: the pitch jumped between
   * 96 mm and 114 mm depending on whether one 46 mm piece happened to be in the palette,
   * and the whole board changed with it. With the full palette nothing built at all.
   *
   * So each distinct span is tried as a pitch, every panel is tested against it, and the
   * pitch that yields the most buildable wall-cells wins. Pieces from a different module
   * stay in the box and are reported. Ties go to the smaller pitch, which gives a finer
   * lattice and more room to compose.
   */
  const candidates = [...new Set(allPanels.map((def) => spanOf(def, support)))].sort((first, second) => first - second);
  let chosen:{ pitch:number; cells:Map<string, number>; capacity:number } | null = null;
  for (const pitch of candidates) {
    const cells = new Map<string, number>();
    let capacity = 0;
    allPanels.forEach((def) => {
      const fits = cellsThatFit(def, pitch, support);
      if (fits === null) return;
      cells.set(def.id, fits);
      capacity += (inventory[def.id] ?? 0) * fits;
    });
    if (!cells.size) continue;
    if (!chosen || capacity > chosen.capacity) chosen = { pitch, cells, capacity };
  }
  if (!chosen) return null;

  const { pitch, cells } = chosen;
  const panels = allPanels.filter((def) => cells.has(def.id));
  const excluded = allPanels.filter((def) => !cells.has(def.id));

  /**
   * Panels that fit NO pitch the palette offers, which is a different thing from a panel
   * belonging to a different module.
   *
   * A 46 mm Death Quadrant wall does not fit a 114 mm Iron Labyrinth board, but it fits a
   * 96 mm one perfectly — it is a different module, and setting it aside is correct. A
   * panel that fits nothing at all means its stated geometry is incoherent: its own
   * declared span cannot hold it.
   *
   * That distinction is what keeps the 125 mm regression refused. At that pitch a bare
   * 80 mm Gallowdark panel ends 0.9" short of a 28 mm pillar and there is no whole number
   * of squares at which it reaches, so the kit is unbuildable and the honest answer is to
   * refuse. Without this, the per-panel fit quietly built a board out of the four panel
   * types that did fit — an eight-panel board, which is the exact symptom this generator
   * was rewritten to stop producing.
   */
  const unbuildable = excluded.filter((def) =>
    !candidates.some((candidate) => cellsThatFit(def, candidate, support) !== null));

  const buildDefs:BuildDef[] = [
    ...panels.map((def) => ({
      id:def.id, kind:def.kind as "wall" | "door", length:def.width, depth:def.depth,
      cells:cells.get(def.id)!, ownColumns:def.ownColumns ?? 0, height:def.height,
      straddles:def.span !== undefined,
    })),
    ...supports.map((def) => ({
      id:def.id, kind:def.kind as "pillar" | "connector", length:Math.max(def.width, def.depth),
      depth:Math.min(def.width, def.depth), cells:0, ownColumns:0 as const, height:def.height,
      straddles:false,
    })),
    ...caps.map((def) => ({
      id:def.id, kind:"end" as const, length:Math.max(def.width, def.depth),
      depth:Math.min(def.width, def.depth), cells:0, ownColumns:0 as const, height:def.height,
      straddles:false,
    })),
  ];

  return {
    pitch, support, cells,
    unbuildable:unbuildable.map((def) => def.id),
    capacity:chosen.capacity,
    doorways:panels.filter((def) => def.kind === "door").reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    columns:supports.reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    caps:caps.reduce((sum, def) => sum + (inventory[def.id] ?? 0), 0),
    buildDefs,
    excluded:excluded.map((def) => def.id),
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
/**
 * How many panels the outside wall will cost.
 *
 * A complex that fills the table borrows the board edge as its hull for free. One
 * that does not has to build its own, and that is not a rounding error: a 6 x 7
 * complex inset on a 4' board needs 26 panels of exterior before a single interior
 * bulkhead goes up, against a capacity of 48. Sizing that ignores it produces a
 * plan the kit cannot finish, and the build then backs off in 8% steps until it
 * fits — which works, but wastes the whole first half of the candidate budget.
 */
const hullCost = (cols:number, rows:number, fillsX:boolean, fillsY:boolean, anchor:Anchor) => {
  // Filling the table borrows all four sides, by definition — the lattice IS the
  // board, so its perimeter is the board edge and costs nothing.
  if (anchor === "fill") return 0;
  if (fillsX && fillsY) return 0;
  // Anchored into a corner, two sides are the table edge. Against an edge, one is.
  // Centred, the building pays for all four.
  const sidesX = anchor === "centre" ? 2 : anchor === "edge" ? 2 : 1;
  const sidesY = anchor === "centre" ? 2 : anchor === "edge" ? 1 : 1;
  return (fillsX ? 0 : sidesX * rows) + (fillsY ? 0 : sidesY * cols);
};

const sizeLattice = (
  boardWidth:number, boardHeight:number, pitch:number, support:number,
  capacity:number, targetDensity:number, anchor:Anchor,
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

  // Filling the table is the one mode that sizes to the BOARD instead of to the
  // palette. Everywhere else the complex is built at the size its own terrain can
  // support and anchored on the board, because spreading one set over a four-foot
  // table cannot make more terrain — it only makes thinner terrain, which is the
  // "few pieces on open floor" complaint this generator was rewritten to stop.
  // Here that trade is made deliberately: the runs reach the board edge on all
  // four sides and the board edge does the walling for free, at the cost of a
  // sparser interior. Worth it when you want the terrain to span the table, and
  // the reason it is a choice rather than the default.
  // Filling the table sizes to the board with the margin spent the other way: the
  // perimeter nodes are allowed to land ON the edge and half-overhang it, rather than
  // being held a half-column inside it.
  //
  // The margin above is right for an inset complex and wrong here, because on a real
  // board the slack it leaves is not a margin — it is a whole unused grid square, and
  // it is lost to rounding noise. Eberleg's pitch is 152.41 mm, or 6.0004", so ten
  // cells need 60.004" of a 60" table. Four thousandths of an inch over, and with a
  // further half-column held back, `floor(58.98 / 6.0004)` gives 9 columns and 54" of
  // lattice: 6" of slack, centred as a 3" gap on every side. The one mode that exists
  // to reach the board edge was drawing a three-inch moat around itself.
  //
  // Spending the half-column as overhang instead buys the tenth column, and a column
  // centred on the table edge is what the printed card board does with its own corner
  // columns — it is also what lets `exteriorEdges` read that perimeter as the hull and
  // charge no panels for it.
  if (anchor === "fill") {
    const fillCols = Math.max(2, Math.floor((boardWidth + support / 2) / pitch));
    const fillRows = Math.max(2, Math.floor((boardHeight + support / 2) / pitch));
    return {
      cols:fillCols, rows:fillRows,
      maxCols:Math.max(maxCols, fillCols), maxRows:Math.max(maxRows, fillRows),
    };
  }

  const aspect = Math.log(boardWidth / boardHeight);
  let best:{ cols:number; rows:number } | null = null;
  let bestKey = -Infinity;
  for (let cols = 2; cols <= maxCols; cols++) for (let rows = 2; rows <= maxRows; rows++) {
    const fillsX = cols >= maxCols;
    const fillsY = rows >= maxRows;
    const needed = internalEdgeCount(cols, rows) * targetDensity
      + hullCost(cols, rows, fillsX, fillsY, anchor);
    if (needed > capacity) continue;
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
const resolveAnchor = (requested:Anchor, slackX:number, slackY:number):Anchor => {
  if (requested !== "auto") return requested;
  // Centring is only free when the complex genuinely reaches the table edges — that
  // is, when halving the slack still leaves a strip too narrow to stand a model in.
  //
  // Deciding this on coverage alone was wrong, and 30 x 22 showed it plainly: a 7 x 5
  // lattice covers that board well enough to look full, but leaves 1.65" outside each
  // side, so centring made it build all four hull sides — 24 of its 48 panels — and
  // the interior it could then afford came out at 0.41 density with almost no
  // junctions. Hugging a corner borrows two of those sides from the table and spends
  // the difference on rooms.
  const reaches = (slack:number) => slack / 2 <= MODEL_BASE;
  if (reaches(slackX) && reaches(slackY)) return "centre";
  // Otherwise the cheapest hull wins, because every panel not spent on the outside
  // wall is a panel available for a bulkhead. "edge" is only preferred where one axis
  // already reaches, so the choice costs nothing.
  if (reaches(slackX) || reaches(slackY)) return "edge";
  return "corner";
};

const originsFor = (anchor:Anchor, slackX:number, slackY:number, inset:number, random:() => number) => {
  const flushLow = inset;
  const flushHigh = (slack:number) => Math.max(inset, slack - inset);
  const middle = (slack:number) => slack / 2;
  const pick = (slack:number) => random() < .5 ? flushLow : flushHigh(slack);
  switch (anchor) {
    // Centred, so the border left over is even on all four sides rather than
    // piled up against two of them — the same look the printed card board has.
    case "fill": return { x:middle(slackX), y:middle(slackY) };
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

/**
 * Which perimeter edges face open deck and so need building as the outside wall.
 *
 * An edge sitting on the table border is the hull for free. One that is not is the
 * complex's own exterior, and the difference between building those and leaving
 * them bare is the difference between a sectioned-off structure and a patch of
 * corridors with stubs hanging off it.
 */
/** `exteriorEdges` returns keys; this reads one back. */
const parseEdge = (key:string):LatticeEdge => {
  const [axis, col, row] = key.split(":");
  return { axis:axis as "h" | "v", col:Number(col), row:Number(row) };
};

const exteriorEdges = (lattice:Lattice, boardWidth:number, boardHeight:number, support:number) => {
  // The lattice is deliberately inset by half a column wherever it meets a border,
  // so that a column centred on a perimeter node sits hard against the table edge
  // instead of hanging over it. That inset still counts as "at the board" — reading
  // it as open deck makes a complex that fills the table build a second hull just
  // inside the table edge, which swallowed the entire panel budget and left the
  // interior almost unsubdivided.
  //
  // The test is PLAYABILITY, not exact coincidence with the table edge. A strip of
  // deck narrower than a model's base is not somewhere anyone can stand or shoot
  // from, so a perimeter that close to the edge is the hull and needs no panel. A
  // 12 x 12 complex on a 4' table leaves 1.1" behind it once centred; measuring that
  // as open deck made it build a 48-panel outside wall against a wall it already
  // had, which is most of a set spent on nothing and an interior it then could not
  // afford to subdivide.
  const tolerance = Math.max(support / 2 + .2, MODEL_BASE);
  const atBoard = (value:number, limit:number) => value <= tolerance || value >= limit - tolerance;
  const exterior = new Set<string>();
  for (let col = 0; col < lattice.cols; col++) {
    [0, lattice.rows].forEach((row) => {
      const { y } = nodeWorld(lattice, { col, row });
      if (!atBoard(y, boardHeight)) exterior.add(edgeKey({ axis:"h", col, row }));
    });
  }
  for (let row = 0; row < lattice.rows; row++) {
    [0, lattice.cols].forEach((col) => {
      const { x } = nodeWorld(lattice, { col, row });
      if (!atBoard(x, boardWidth)) exterior.add(edgeKey({ axis:"v", col, row }));
    });
  }
  return exterior;
};

/**
 * Whether a perimeter edge borders a reserved cell.
 *
 * Decided on the CELL rather than on where the panel's own midpoint would fall.
 * Midpoints look like the right test — the zone invariant uses them — but they only
 * describe a panel once its length is known, and the tiler chooses that later: two
 * adjacent one-cell edges either side of a thin zone both have midpoints outside it,
 * and the long panel the tiler merges them into has its midpoint square in the
 * middle. Asking whether the cell is reserved settles it before tiling gets a say.
 */
const edgeBordersReserved = (lattice:Lattice, edge:LatticeEdge, reserved:Rect[]) =>
  reserved.length > 0 && cellsOfEdge(lattice, edge).some((cell) => cell !== null && reserved.some(
    (rect) => cell.col >= rect.col && cell.col < rect.col + rect.cols
      && cell.row >= rect.row && cell.row < rect.row + rect.rows,
  ));

/**
 * Reserved zones, expressed as whole lattice cells.
 *
 * Rounded OUTWARD — every cell the zone touches at all is reserved, not just the
 * ones it mostly covers. A zone is drawn freehand and will not line up with the
 * grid, so snapping to the nearest line leaves the reserved area offset from the
 * drawn rectangle by up to half a square, and the walls around the reserved region
 * then land *inside* the rectangle the user drew. Rounding outward guarantees the
 * reserved cells cover the drawn zone, so its boundary walls fall outside it.
 *
 * The cost is that a zone claims a little more floor than was drawn. That is the
 * right trade: the point of the tool is that nothing is generated in there.
 */
const reservedRects = (lattice:Lattice, zones:Zone[]):Rect[] =>
  zones.map((zone) => {
    const low = (value:number, origin:number, pitch:number) => Math.floor((value - origin) / pitch);
    const high = (value:number, origin:number, pitch:number) => Math.ceil((value - origin) / pitch);
    const col = Math.max(0, low(zone.x, lattice.originX, lattice.pitchX));
    const row = Math.max(0, low(zone.y, lattice.originY, lattice.pitchY));
    const right = Math.min(lattice.cols, high(zone.x + zone.width, lattice.originX, lattice.pitchX));
    const bottom = Math.min(lattice.rows, high(zone.y + zone.height, lattice.originY, lattice.pitchY));
    return { col, row, cols:right - col, rows:bottom - row };
  }).filter((rect) => rect.cols > 0 && rect.rows > 0);

/**
 * The largest rectangle on the board that no zone touches.
 *
 * Needed for the case where a zone is too big to be a room. A zone covering most of
 * the table cannot be contained by the complex, and it cannot be avoided by nudging
 * the origin either — every cell of the lattice ends up reserved, so the partition has
 * nothing to divide, the plan carries no panels, and generating appears to do nothing
 * at all. The answer is to build BESIDE the zone, at whatever size actually fits.
 *
 * Exact rather than approximate, and cheap because zones are axis-aligned rectangles:
 * their edges are the only interesting cut lines, so the maximal free rectangle has
 * its sides on them. A few zones give a handful of candidate lines and a brute-force
 * sweep is far simpler to trust than a clever sweep-line.
 */
const largestFreeRect = (boardWidth:number, boardHeight:number, zones:Zone[]) => {
  if (!zones.length) return { x:0, y:0, width:boardWidth, height:boardHeight };
  const xs = [...new Set([0, boardWidth, ...zones.flatMap((zone) => [zone.x, zone.x + zone.width])])]
    .filter((value) => value >= 0 && value <= boardWidth).sort((a, b) => a - b);
  const ys = [...new Set([0, boardHeight, ...zones.flatMap((zone) => [zone.y, zone.y + zone.height])])]
    .filter((value) => value >= 0 && value <= boardHeight).sort((a, b) => a - b);
  let best = { x:0, y:0, width:0, height:0 };
  for (let left = 0; left < xs.length - 1; left++) {
    for (let right = left + 1; right < xs.length; right++) {
      for (let top = 0; top < ys.length - 1; top++) {
        for (let bottom = top + 1; bottom < ys.length; bottom++) {
          const rect = { x:xs[left], y:ys[top], width:xs[right] - xs[left], height:ys[bottom] - ys[top] };
          if (rect.width * rect.height <= best.width * best.height) continue;
          if (zones.some((zone) => rect.x < zone.x + zone.width && rect.x + rect.width > zone.x
            && rect.y < zone.y + zone.height && rect.y + rect.height > zone.y)) continue;
          best = rect;
        }
      }
    }
  }
  return best;
};

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

  // Refusing to build is the right answer when a panel's stated geometry fits no grid the
  // palette can form. A pitch outside the buildable range cannot be assembled, and every
  // board the previous generator produced was downstream of exactly this going unchecked.
  //
  // Checked per panel now, against every pitch the palette offers, rather than once
  // against the shortest panel on the pitch that panel happened to dictate.
  if (kit.unbuildable.length) {
    const worst = kit.unbuildable[0];
    const def = defs.find((candidate) => candidate.id === worst)!;
    return empty(
      `unbuildable grid: a ${def.width.toFixed(2)}" panel fits no whole number of squares on any `
      + `pitch this palette can form, with ${kit.support.toFixed(2)}" columns — `
      + `at ${kit.pitch.toFixed(2)}" it leaves ${Math.abs(columnBite(def.width, kit.pitch, kit.support)).toFixed(3)}" of joint`,
    );
  }

  /**
   * Columns a wall-cell costs, on average, once a board is tiled.
   *
   * Measured across 72 generated boards spanning every preset and one, two and four
   * sets: median 0.92, tenth percentile 0.76, ninetieth 1.00. Long runs share nodes and
   * push it down; spurs and junction-poor layouts push it up.
   *
   * It is an estimate for SIZING and nothing more — the retry loop corrects any board
   * where it turns out optimistic. Re-measure it after any change to how panels are
   * CHOSEN, because it moves: an experiment that stopped long panels spanning an occupied
   * node took it to 0.79, and a stale figure here mis-sizes every board on the first try.
   */
  const COLUMNS_PER_WALL_CELL = .9;

  /**
   * What the kit can actually build, which is not what it can panel.
   *
   * A Boarding Actions set holds 48 wall-cells of panel and 32 loose columns plus 4 wall
   * ends. At 0.9 columns a wall-cell those 36 supports bracket about 40 wall-cells, so
   * the last 8 panels in the box have nothing to stand on. Sizing did not know that: it
   * solved `internalEdges x density + hull <= 48` and handed back a lattice the kit could
   * never finish, `build` failed on columns, and the retry loop spent its candidates
   * walking the footprint back down again.
   *
   * Sizing against the lesser of the two is the same fact stated once, up front, instead
   * of discovered forty times per board. It is also why the note reports sets-to-fill
   * higher than raw panel arithmetic suggests — which is correct, and is the constraint
   * the README already calls the binding one.
   */
  const bracketable = Math.floor((kit.columns + kit.caps) / COLUMNS_PER_WALL_CELL);
  const usable = Math.min(kit.capacity, bracketable);
  const spendable = Math.max(1, Math.round(usable * usage));

  // Anchoring is settled before sizing, because the two depend on each other: how
  // big the complex can be depends on how much outside wall it has to build, which
  // depends on how many sides borrow the table edge. Resolving the anchor from
  // coverage alone breaks the circle.
  const roughCols = Math.floor((boardWidth - kit.support / 2) / kit.pitch);
  const roughRows = Math.floor((boardHeight - kit.support / 2) / kit.pitch);
  if (roughCols < 2 || roughRows < 2) return empty("the board is smaller than one grid square");
  const boardEdges = internalEdgeCount(roughCols, roughRows);
  const greed = spendable / Math.max(1, boardEdges * reference.density);
  const setsToFill = Math.max(1, Math.ceil(1 / Math.max(greed, 1e-6)));
  // Judged on the slack the LARGEST possible lattice would leave. Sizing may then
  // pick something smaller, which only ever leaves more slack — so a complex judged
  // not to reach the edges never turns out to reach them after all.
  const anchor = resolveAnchor(
    input.anchor ?? "auto",
    Math.max(0, boardWidth - roughCols * kit.pitch),
    Math.max(0, boardHeight - roughRows * kit.pitch),
  );

  const sized = sizeLattice(boardWidth, boardHeight, kit.pitch, kit.support, spendable, reference.density, anchor);
  if (!sized) return empty("the board is smaller than one grid square");

  // Mutable, because a reserved zone can make a given size unbuildable and the honest
  // response is to build something smaller beside it rather than to give up. A zone
  // covering most of the lattice leaves no cells to partition, so the plan comes back
  // with no panels at all and the board comes out empty — which is what "generate does
  // nothing when I draw a zone" was.
  let cols = sized.cols;
  let rows = sized.rows;

  // A zone too big to be a room is an exclusion, and the complex has to fit beside it.
  // Capping the footprint to the largest zone-free rectangle is what makes that
  // happen; without it the lattice keeps overlapping the zone whatever the origin, and
  // every cell comes out reserved.
  // Measured against the LATTICE, not the board. A 24" zone is a quarter of a
  // four-foot table and looks modest by that yardstick, but one set only builds a
  // 27" x 23" complex, so the same zone is 94% of the footprint and cannot possibly be
  // a room inside it. Judging against the board let that case through as "contain",
  // the origin search then pushed the complex onto the zone to cover it, every cell
  // came out reserved, and the board came out empty.
  const zonesArea = zones.reduce((sum, zone) => sum + zone.width * zone.height, 0);
  const excluding = zones.length > 0 && zonesArea > cols * rows * kit.pitch * kit.pitch * .5;
  // Where a zone is too big to contain AND too big to sit beside, the honest answer is
  // to refuse and say why.
  //
  // The tempting alternative — cover the zone and wall the hall off inside it, giving a
  // hall with a ring of rooms around it — was tried and reverted. It only works by
  // putting the hall's own wall on the outermost cell of the DRAWN zone, and the one
  // thing the zone tool promises is that terrain never appears where a zone is. A
  // salvaged board that quietly breaks that is worse than a refusal that explains
  // itself, and it would make the zone invariant untrustworthy everywhere else.
  if (excluding) {
    const free = largestFreeRect(boardWidth, boardHeight, zones);
    const fitCols = Math.floor((free.width - kit.support / 2) / kit.pitch);
    const fitRows = Math.floor((free.height - kit.support / 2) / kit.pitch);
    if (fitCols >= 2 && fitRows >= 2) {
      cols = Math.max(2, Math.min(cols, fitCols));
      rows = Math.max(2, Math.min(rows, fitRows));
    } else {
      return empty(
        "the reserved zones leave no room for a complex — "
        + `the largest clear area is ${free.width.toFixed(1)}" x ${free.height.toFixed(1)}", `
        + `and one grid square is ${kit.pitch.toFixed(1)}". Shrink a zone, or draw it to one side.`,
      );
    }
  }

  const free = excluding ? largestFreeRect(boardWidth, boardHeight, zones) : null;
  const random = randomFactory(seed);
  const candidates = input.candidates ?? 40;
  // Spend up to reference density and no further, with a little headroom for
  // someone who wants to see their collection on the table. Past that, surplus
  // terrain stays in the box: four sets on one card board crammed in at 86%
  // density gives a compartment per square and a wall on nearly every edge, which
  // is not a denser board so much as a solid one. Terrain left over is a normal
  // outcome and is reported rather than forced onto the deck.
  //
  // Counted on INTERIOR edges only, and the hull is added per candidate below. The
  // deck plan measures its budget against every panel it places, hull included, so
  // handing it an interior-only figure made the outside wall compete with the rooms
  // for the same allowance: an inset complex spent 24 of a 35-panel budget on its
  // own perimeter and had 11 left for the entire interior. That is why 30 x 22 came
  // out identical at one, two and four sets — the cap, not the kit, was the limit —
  // and why every inset board sat at 0.38 interior density against a 0.52 target.
  /**
   * The interior density ceiling.
   *
   * Held near the reference so surplus terrain goes into FOOTPRINT rather than into a
   * denser board — right up until the footprint has nowhere left to grow, at which point
   * holding the line achieves nothing except leaving the collection in the box. Two sets
   * on a 30 x 22 board are already at the largest lattice that fits, and with a flat
   * ceiling they built exactly the same board as one set.
   *
   * The higher ceiling is only safe because of spur walls. Under the old model every
   * panel closed something, so pushing density past the reference meant a compartment per
   * square and a wall on nearly every edge — a solid board, not a dense one. A spur
   * closes nothing: it stands inside a bay as cover. So a full board can carry its whole
   * collection and stay open, which is what the reference photographs of a big collection
   * on a small table actually look like.
   */
  const interiorCapFor = (atCols:number, atRows:number) => {
    const full = atCols >= sized.maxCols && atRows >= sized.maxRows;
    return Math.round(internalEdgeCount(atCols, atRows) * Math.min(1, reference.density * (full ? 1.4 : 1.15)));
  };
  let interiorBudget = Math.min(spendable, interiorCapFor(cols, rows));
  // Spurs start unbounded by count — the wall budget still caps them — and the retry
  // below backs them off when the columns cannot bracket them.
  let spurBudget = kit.capacity;
  let best:{ pieces:BuiltPiece[]; metrics:Metrics; lattice:Lattice; plan:DeckPlan; score:number } | null = null;
  const maxSight = Math.max(3, Math.round(reference.longestSight + 2));

  const shrink = () => {
    if (cols >= rows && cols > 3) cols--;
    else if (rows > 3) rows--;
    else if (cols > 2) cols--;
    else return false;
    interiorBudget = Math.min(spendable, interiorCapFor(cols, rows));
    return true;
  };

  /**
   * A candidate can also be thrown out by an INVARIANT rather than by the build
   * running short of pieces, and that case had no lever at all — which was a real
   * bug rather than a missing nicety. A plan that builds perfectly well but fails,
   * say, the sight-line rule fails it for a reason no reseed can fix: the lattice
   * is bigger than the palette can subdivide, so every seed leaves a firing lane
   * down it. The loop simply `continue`d, so all forty attempts ran with identical
   * parameters and the generator returned nothing at all. Asking a four-foot board
   * to fill the table with one set failed 88 times in 100 that way.
   *
   * So the search runs in PASSES: a full round of candidates, and only if that
   * round produced nothing at all does the footprint give way and another round
   * run at the smaller size. Deciding it on the whole round rather than on a
   * running tally of failures is what keeps it deterministic — the footprint then
   * depends on the palette and the board, not on how many unlucky seeds happened
   * to come up first, which is the difference between a board that reproduces and
   * one whose size wanders between generations.
   */
  // Fill holds its footprint inside a pass and only lets it go at the pass boundary,
  // so it needs more boundaries to walk down from a board-spanning lattice to one a
  // thin palette can actually build. Without them, Zone Mortalis on a 5' board ran out
  // of passes before it ran out of footprint and returned nothing at all.
  const passes = anchor === "fill" ? 10 : 5;
  for (let pass = 0; pass < passes && !best; pass++) {
  if (pass > 0 && !shrink()) break;
  for (let attempt = 0; attempt < candidates; attempt++) {
    const gridWidth = cols * kit.pitch;
    const gridHeight = rows * kit.pitch;
    const slackX = Math.max(0, boardWidth - gridWidth);
    const slackY = Math.max(0, boardHeight - gridHeight);
    const inset = Math.min(kit.support / 2, slackX / 2, slackY / 2);
    // Where zones exist, the complex is nudged to CONTAIN them rather than to avoid
    // them. A hangar or command room drawn on the board is meant to be a room in the
    // building — it is only useful as one if the building is around it. (The previous
    // pass did the opposite, shoving the complex away to minimise overlap, which is
    // why a zone in the middle of the table pushed the whole complex into a corner
    // and left the zone as bare deck.)
    //
    // Containing only makes sense while the zone is small enough to BE a room. Past
    // that it is an exclusion — an apron, a landing area — and the right answer is a
    // complex beside it, so the preference flips to avoiding it and the candidate
    // origins are drawn from the clear area rather than from the board as a whole.
    // Flush-and-centre positions relative to the whole board will happily never land in
    // the clear area at all.
    const options = free
      ? Array.from({ length:12 }, () => ({
        x:free.x + random() * Math.max(0, free.width - gridWidth),
        y:free.y + random() * Math.max(0, free.height - gridHeight),
      }))
      : Array.from({ length:10 }, () => originsFor(anchor, slackX, slackY, inset, random));
    const origin = zones.length
      ? options
        .map((option) => ({
          option,
          covered:zoneOverlapArea({ x:option.x, y:option.y, width:gridWidth, height:gridHeight }, zones),
        }))
        .sort((first, second) => excluding ? first.covered - second.covered : second.covered - first.covered)[0].option
      : originsFor(anchor, slackX, slackY, inset, random);
    const lattice = makeLattice(cols, rows, kit.pitch, kit.pitch, origin.x, origin.y);
    // The outside wall is not optional and not negotiable, so it is added on top of
    // the interior allowance rather than taken out of it — capped by what the kit
    // actually holds, so a hull it cannot afford still fails honestly in `build`.
    // ...minus the stretches of it that border a reserved cell. Reserved cells are
    // rounded outward and then clamped to the lattice, so a zone drawn overhanging the
    // complex leaves its own boundary sitting exactly on the lattice perimeter — and
    // that perimeter is inside the rectangle the user drew. Walling it puts panels in a
    // zone whose entire promise is that nothing is generated in it, which the zone
    // invariant then rejects, seed after seed. Leaving the gap open is the right answer
    // as well as the passing one: the zone is an apron, and the complex opens onto it.
    const reserved = reservedRects(lattice, zones);
    // Filling the table has no exterior: every perimeter edge IS the board edge,
    // whatever strip of border the pitch happens to leave outside it. Measuring
    // those edges as open deck is what built a second hull a few inches inside the
    // table edge — a long wall parallel to a wall the board already gives for
    // free, which is the single most expensive thing a thin palette can be made
    // to spend itself on.
    const exterior = anchor === "fill" ? new Set<string>() : new Set(
      [...exteriorEdges(lattice, boardWidth, boardHeight, kit.support)]
        .filter((key) => !edgeBordersReserved(lattice, parseEdge(key), reserved)),
    );
    const plan = buildDeckPlan({
      lattice,
      wallEdgeBudget:Math.min(spendable, interiorBudget + exterior.size),
      hatchSupply:kit.doorways,
      exterior,
      reserved,
      spurBudget,
      random,
    });

    const stock = new Map(Object.entries(inventory).filter(([, count]) => count > 0));
    const built = build({ plan, defs:kit.buildDefs, stock, heights, nextUid, seed:seed + attempt * 7919 });
    if (!built.ok) {
      rejected[built.reason.replace(/\d+/g, "n")] = (rejected[built.reason.replace(/\d+/g, "n")] ?? 0) + 1;
      // Out of columns: give up SPURS first, then the footprint. A spur is cover
      // standing in a bay and the cheapest thing on the board to lose; the footprint is
      // the board itself. Backing off in the other order shrank a one-set card board to
      // 5 x 6 to pay for cover it did not need.
      if (built.reason.startsWith("out of columns")) {
        if (spurBudget > 0) spurBudget = Math.floor(spurBudget / 2);
        else shrink();
        continue;
      }
      // Short of panels instead. Trimming the interior budget merges compartments, and
      // fewer larger rooms is a real board — but it can only ever reduce interior
      // density, so once density is already at the reference the FOOTPRINT gives way
      // instead. Pulling the budget lever regardless is how a 4' board with one set came
      // out at full footprint with a 0.37 interior where a smaller complex would have hit
      // 0.52 properly.
      const atReference = interiorBudget <= internalEdgeCount(cols, rows) * reference.density;
      // Filling the table is a promise about the footprint, so a palette that runs
      // short of a PIECE TYPE thins the interior and keeps the board — the two levers
      // are not interchangeable here. Eberleg makes the difference plain: it has no
      // four-armed cross casting, so every crossroads costs a T plus a single wall, and
      // a board-spanning lattice asks for more single walls than the kit holds. Reading
      // that as "the board is too big" shrank a 4' board to 5 x 5 and centred it, which
      // is the margin of open deck this mode exists to remove. Fewer, larger
      // compartments across the whole table is the honest trade instead.
      //
      // Quality failures still shrink the footprint (below): a firing lane down a
      // sparse board is not fixed by making the board sparser.
      //
      // The footprint still gives way if this never works — but at the PASS boundary
      // rather than mid-pass, so each size is given a full round of attempts at a
      // thinner interior before being judged too big. Fill gets extra passes to pay
      // for that (see `passes`), because a palette that genuinely cannot span the board
      // now needs several rounds to walk down to a size that can.
      if (anchor === "fill" && interiorBudget > 8) {
        interiorBudget = Math.max(8, Math.floor(interiorBudget * .9));
        continue;
      }
      // Once the lattice is down to its floor there is nothing left to give but the
      // budget, so keep trimming rather than spinning through the remaining attempts.
      if (!atReference || !shrink()) interiorBudget = Math.max(4, Math.floor(interiorBudget * .92));
      continue;
    }

    const defMap = new Map(kit.buildDefs.map((def) => [def.id, def]));
    const failures = invariants({
      plan, pieces:built.pieces, defs:defMap, inventory, boardWidth, boardHeight, maxSight, zones,
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
  }

  if (!best) {
    return empty(`no candidate survived: ${Object.entries(rejected).map(([rule, count]) => `${rule} x${count}`).join(", ") || "nothing built"}`);
  }

  const pieces = [...best.pieces];
  // The winning candidate's own footprint. A reserved zone can shrink the lattice
  // mid-search, so anything downstream that needs the complex's extent has to read it
  // off the lattice that was actually kept rather than the size sizing first proposed.
  const gridWidth = best.lattice.cols * best.lattice.pitchX;
  const gridHeight = best.lattice.rows * best.lattice.pitchY;
  const leftover = Math.max(0, kit.capacity - best.plan.panelEdges.length);

  // Scatter dresses the finished deck: crates in the corridors, machinery in the
  // halls. Placed last, after the layout has passed every invariant, so it cannot
  // break one — it carries no wall and blocks no route.
  const scatterDefs = defs
    .filter((def) => def.catalogue === catalogue && def.kind === "scatter" && (inventory[def.id] ?? 0) > 0)
    .map((def) => ({
      id:def.id, width:def.width, depth:def.depth, height:def.height,
      tier:def.scatter ?? tierFor(def.width, def.depth),
    }));
  // The plan-space footprint of a placed piece. Scatter and accessories both need it
  // to keep off the terrain already on the board.
  //
  // Measured against the WHOLE catalogue, not `kit.buildDefs`. buildDefs holds only
  // panels, columns and caps, so every scatter piece missed the lookup and fell back
  // to a 0.5" stub — which let the open-deck pass drop a 120 mm container on top of a
  // conduit it had placed moments earlier, because it thought both were half-inch dots.
  // `length` in buildDefs is `width` here, so the catalogue serves both.
  const sizeOf = new Map(defs.map((def) => [def.id, { along:def.width, across:def.depth }]));
  const boxOf = (piece:BuiltPiece) => {
    const size = sizeOf.get(piece.defId);
    const along = size?.along ?? .5;
    const across = size?.across ?? .5;
    return piece.rotation === 90
      ? { x:piece.x, y:piece.y, width:across, height:along }
      : { x:piece.x, y:piece.y, width:along, height:across };
  };

  if (scatterDefs.length) {
    const wanted = Object.fromEntries(scatterDefs.map((def) => [def.id, Math.round((inventory[def.id] ?? 0) * usage)]));
    const inside = placeScatter({
      plan:best.plan, defs:scatterDefs, stock:wanted, heights,
      occupied:pieces.map(boxOf), nextUid, random,
    });
    pieces.push(...inside);

    // Whatever would not fit inside the complex dresses the open deck around it,
    // preferring any reserved zone that fell outside the footprint. A zone drawn on
    // bare deck is still a designated space — a hangar apron, a loading bay — and
    // filling it is the whole point of the tool. This is also where the large
    // line-of-sight blockers end up on a board whose complex has no hall big enough
    // for them.
    const complex = { x:best.lattice.originX, y:best.lattice.originY, width:gridWidth, height:gridHeight };
    const footprints = [...pieces.map(boxOf)];
    const placedCounts = new Map<string, number>();
    inside.forEach((piece) => placedCounts.set(piece.defId, (placedCounts.get(piece.defId) ?? 0) + 1));
    const outerZones = zones.filter((zone) => zoneOverlapArea(zone, [complex]) < zone.width * zone.height * .5);

    scatterDefs.forEach((def) => {
      const remaining = (wanted[def.id] ?? 0) - (placedCounts.get(def.id) ?? 0);
      for (let copy = 0; copy < remaining; copy++) {
        for (let attempt = 0; attempt < 50; attempt++) {
          const rotation:(0 | 90) = random() < .5 ? 0 : 90;
          const width = rotation === 90 ? def.depth : def.width;
          const height = rotation === 90 ? def.width : def.depth;
          // Aim inside a reserved zone while there is one; otherwise anywhere on the
          // open deck. Zones are tried first so they fill up before the rest.
          const target = outerZones.length && attempt < 35
            ? outerZones[Math.floor(random() * outerZones.length)]
            : { x:0, y:0, width:boardWidth, height:boardHeight };
          const rect = {
            x:target.x + random() * Math.max(0, target.width - width),
            y:target.y + random() * Math.max(0, target.height - height),
            width, height,
          };
          if (rect.x < 0 || rect.y < 0 || rect.x + width > boardWidth || rect.y + height > boardHeight) continue;
          if (rectsOverlap(rect, complex)) continue;
          if (footprints.some((other) => rectsOverlap(rect, other))) continue;
          const piece:BuiltPiece = {
            uid:nextUid(), defId:def.id, x:rect.x, y:rect.y, rotation,
            height:heights[def.id] ?? def.height,
          };
          pieces.push(piece);
          footprints.push(rect);
          break;
        }
      }
    });
  }

  // Accessories — the Iron Labyrinth floors and stair sections — are large enough to
  // be terrain features rather than scatter, so they go on the open deck OUTSIDE the
  // complex, where there is room for them.
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
          if (pieces.some((piece) => rectsOverlap(rect, boxOf(piece)))) continue;
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
  const grid = `${best.lattice.cols} x ${best.lattice.rows} squares`;
  // A palette can hold pieces from two incompatible modules — TTCombat's 46 mm Death
  // Quadrant walls and 64 mm Iron Labyrinth walls both butt between 50 mm connectors, so
  // they want different pitches and cannot share a lattice. The board is built on the
  // pitch that uses the most of the palette; saying which pieces were left out is the
  // difference between "the generator consumed a random amount" and a stated reason.
  const setAside = kit.excluded.length
    ? ` · ${kit.excluded.length} piece type${kit.excluded.length === 1 ? "" : "s"} `
      + `(${kit.excluded.map((id) => defs.find((def) => def.id === id)?.name ?? id).join(", ")}) `
      + `belong to a different module at this pitch and stay in the box`
    : "";
  const note = (greed < .95
    ? `${grid} — this palette fills about ${fills}% of the board at real density; ${setsToFill} sets would fill it`
    : leftover > 2
      ? `${grid}, filling the board at real density — ${leftover} panels stay in the box`
      : `${grid}, filling the board`) + setAside;
  return {
    pieces, metrics:best.metrics, lattice:best.lattice, plan:best.plan,
    greed, anchor, setsToFill, score:best.score, rejected, leftover, note,
  };
};

export { renderPlan };
