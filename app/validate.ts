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
  cellInside, cellKey, cellRegions, edgeKey, edgeRuns, internalEdgeCount, isBorderEdge,
  nodeKey, nodesOfEdge, passable, sightLines,
  type LatticeCell, type LatticeEdge,
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
  /**
   * Share of panelled edges that are a DOORWAY — a hatchway the plan relies on as a
   * route.
   *
   * Was `hatchShare`, and the rename is the point. The old name and its 0.46 target
   * came from the kit's composition — 20 of the 32 panels in the box carry a hatchway,
   * so 62% of the panels you own have a door moulded into them — and that fact was
   * transplanted into a target for the LAYOUT. They are different things. A hatchway
   * panel standing in a wall run with its door shut is a wall; what makes an edge a
   * doorway is the plan choosing it as the way through. Scoring toward 0.46 asked for
   * 63 doorways a board and got them.
   */
  doorwayShare:number;
  /**
   * Share of compartment faces with no panel at all — the open faces.
   *
   * The metric the old profile had no equivalent of, which is why nothing could see the
   * defect: boards scored well on every number while running at 0% open faces and 100%
   * sealed compartments. A bay open along one side is the single most characteristic
   * feature of these boards.
   */
  openFaceShare:number;
  /**
   * Share of compartments that are an alcove: open along exactly one side.
   *
   * Counted in SIDES, not edges. A 2 x 3 bay open along its three-cell side has three
   * open edges and is still one alcove with one mouth, so counting edges reads a
   * textbook nook as a wide-open space.
   */
  alcoveShare:number;
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
  // Spend the box. Density and OPENNESS stopped competing when mouths and spur walls
  // arrived: surplus panels go into spurs standing inside a bay rather than into another
  // wall around one, so a board can carry the whole collection and still be open.
  density:.5,
  meanSight:2.6,
  // A lane of five squares is about 19" — long enough to be a real shooting lane and
  // well short of the table. The reference boards plainly have lanes this long down
  // their streets and across their open areas; the previous 4.5 was one of the two
  // constraints forcing the board to be chopped into small sealed boxes.
  longestSight:5,
  // Straight legs of two. This is what the photographed walls are actually made of —
  // the Ls, Ts and alcove sides are two panels a leg — with the long spines showing up
  // in `longestSolidRun` rather than in the mean. The old 2.8 was measured on a model
  // that walled every boundary, where every split line ran the width of its block.
  meanRun:2.2,
  // The spines.
  //
  // This one scales with how much terrain is on the table, which no single fixed profile
  // can express: measured 3.3 cells at two sets on a 2' board, 3.8 at two sets on 4', and
  // 5.3 at four sets on 4'. Long runs come from spur walls extending and merging into the
  // bulkheads they grow off, so a board with more panels has longer walls — and a one-set
  // board simply has no 5-cell unbroken wall in it once half its faces are open.
  //
  // Four is the middle of that range rather than the top of it. Aiming at the top would
  // penalise every small board for something the box cannot do, which is the mistake the
  // old profile made in the other direction.
  longestSolidRun:4,
  // Ls and Ts, where a spur meets a bulkhead or two split lines cross.
  //
  // Lowered from 0.4, and the reason is arithmetic rather than taste: a junction is a node
  // where three or four panels meet, so it needs three or four of that node's faces
  // walled. Half the faces on this board are deliberately open. You cannot have a wall on
  // every face AND an open face on every bay, and 0.4 was measured on a model that walled
  // every boundary — it is the old aesthetic's number, not a property of a good board.
  junctionShare:.25,
  // A 2 x 2 bay. Not 3: the partition floor is what keeps single-square closets rare,
  // and a bay you can stand a squad in is the unit these boards are built from.
  meanRoom:4,
  roomSpread:1.8,
  // A nook IS a dead end, and nooks are the point — "crevices in the corridor system
  // where you can fit troops". The old 0.12 was asking for a board with no cover on it.
  //
  // Worth being honest about what this number is: unlike density or doorway share, it is a
  // DESCRIPTION of the alcove-heavy aesthetic rather than an independent target drawn from
  // the photographs. A board that is half open faces and half bays lands here by
  // construction. It is kept in the profile, at low weight, so that a candidate which
  // wanders far from it still loses a little — not so that the scorer chases it.
  deadEndShare:.32,
  // Doors are tactical and rare: a bulkhead across a street, a store worth sealing, a
  // way in through the hull. Around one panel in twelve, against the old 0.46.
  doorwayShare:.08,
  // Most bay faces are open. This and `alcoveShare` are the two numbers that hold the
  // aesthetic, so they carry the most weight on the board — without them the scorer has
  // no way to prefer an open board over a sealed one.
  openFaceShare:.45,
  alcoveShare:.5,
  // Sight lines and run structure separate a deck from a scatter; openness separates
  // this generator's output from a warren. Density matters but is largely fixed by the
  // box.
  weights:{
    density:1, meanSight:2, longestSight:1.5, meanRun:2, longestSolidRun:1.25,
    junctionShare:1.25, meanRoom:1, roomSpread:.5, deadEndShare:.75,
    doorwayShare:2, openFaceShare:2.5, alcoveShare:2,
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

  // Openness, measured per compartment face. A face is a maximal contiguous run of
  // same-axis edges along one side of the compartment, so a three-cell-wide mouth counts
  // as ONE open side rather than three — the distinction between a bay with a mouth and
  // a bay with no wall at all.
  let openFaces = 0;
  let totalFaces = 0;
  let alcoves = 0;
  plan.regions.forEach((region) => {
    const inRegion = new Set(region.cells.map(cellKey));
    const outward:LatticeEdge[] = [];
    const openEdges:LatticeEdge[] = [];
    region.cells.forEach((cell) => {
      ([
        { edge:{ axis:"h", col:cell.col, row:cell.row }, next:{ col:cell.col, row:cell.row - 1 } },
        { edge:{ axis:"h", col:cell.col, row:cell.row + 1 }, next:{ col:cell.col, row:cell.row + 1 } },
        { edge:{ axis:"v", col:cell.col, row:cell.row }, next:{ col:cell.col - 1, row:cell.row } },
        { edge:{ axis:"v", col:cell.col + 1, row:cell.row }, next:{ col:cell.col + 1, row:cell.row } },
      ] as { edge:LatticeEdge; next:LatticeCell }[]).forEach(({ edge, next }) => {
        if (!cellInside(lattice, next) || inRegion.has(cellKey(next))) return;
        outward.push(edge);
        if (!passable(lattice, state, edge) || state.get(edgeKey(edge)) === "hatch") return;
        openEdges.push(edge);
      });
    });
    const sides = edgeRuns(outward).length;
    const openSides = edgeRuns(openEdges).length;
    totalFaces += sides;
    openFaces += openSides;
    if (openSides === 1) alcoves++;
  });

  return {
    density:panels.length / Math.max(1, internalEdgeCount(lattice.cols, lattice.rows)),
    meanSight:sight.mean,
    longestSight:sight.longest,
    meanRun:runLengths.length ? runLengths.reduce((sum, length) => sum + length, 0) / runLengths.length : 0,
    longestSolidRun:solidLengths.length ? Math.max(...solidLengths) : 0,
    junctionShare:nodeDegree.size ? junctions / nodeDegree.size : 0,
    meanRoom, roomSpread,
    deadEndShare:deadEnds / Math.max(1, lattice.cols * lattice.rows),
    doorwayShare:panels.length ? hatches / panels.length : 0,
    openFaceShare:totalFaces ? openFaces / totalFaces : 0,
    alcoveShare:plan.regions.length ? alcoves / plan.regions.length : 0,
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

  // 2. No firing lane across the table — measured with an allowance for any hall the
  //    user reserved.
  //
  //    A reserved zone is a single undivided compartment, so sight crosses the whole
  //    of it by definition. That is the POINT of a hangar or a generator hall, but the
  //    flat cap treated it as a defect and threw the board away: a thin zone across a
  //    four-foot board failed every seed, which is why generating with a zone drawn
  //    appeared to do nothing at all. The allowance is the largest reserved region's
  //    own extent, so the hall costs exactly what it spans and no more — a firing lane
  //    running past it still fails.
  const reservedExtent = Math.max(
    0,
    ...plan.regions.filter((region) => region.kind === "reserved")
      .map((region) => Math.max(region.bounds.cols, region.bounds.rows)),
  );
  const sightAllowance = maxSight + reservedExtent;
  const sight = sightLines(lattice, state);
  if (sight.longest > sightAllowance) {
    failures.push({ rule:"sight", detail:`open lane of ${sight.longest} cells, limit ${sightAllowance}` });
  }

  // 3. Every doorway the plan promised actually got a hatchway panel. A solid
  //    panel standing in for one would seal a route the connectivity check above
  //    assumed was open.
  //
  //    Counted against the doorways, not against zero. The test read
  //    `doorPanels < 1 && hatchEdges.length`, which only ever caught a board with no
  //    hatchway panels at all — one door against twenty planned doorways passed, and a
  //    board sealed at nineteen of them would have gone out looking fine. The tiler
  //    gives every doorway edge its own door panel, so one apiece is the real floor.
  //
  //    Restricted to the edges `build` is responsible for, which is the interior plus
  //    the hull: a perimeter edge lying along the table border is left to the board
  //    edge and never receives a panel of any kind.
  const buildable = (edge:LatticeEdge) => !isBorderEdge(lattice, edge) || plan.exterior.has(edgeKey(edge));
  const hatchEdges = plan.panelEdges.filter((edge) => buildable(edge) && state.get(edgeKey(edge)) === "hatch");
  const doorPanels = pieces.filter((piece) => defs.get(piece.defId)?.kind === "door").length;
  if (doorPanels < hatchEdges.length) {
    failures.push({ rule:"doorways", detail:`${hatchEdges.length} doorways planned, ${doorPanels} hatchway panels placed` });
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
  // Check every physical footprint, including supports. Checking panels alone let
  // half of every perimeter column hang outside the board while all invariants
  // still passed.
  pieces.forEach((piece) => {
    const rect = rectOf(piece, defs);
    if (rect.x < -.01 || rect.y < -.01 || rect.x + rect.width > boardWidth + .01 || rect.y + rect.height > boardHeight + .01) {
      failures.push({ rule:"bounds", detail:`${piece.defId} at ${rect.x.toFixed(2)},${rect.y.toFixed(2)} leaves the board` });
    }
  });
  structural.forEach((piece, index) => {
    const rect = rectOf(piece, defs);
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
    const def = defs.get(piece.defId);
    // Orientation comes from the piece's own placement, not from comparing the
    // rect's width to its height. That comparison happened to agree with rotation
    // for every panel in every catalogue up to Eberleg's fine module, whose
    // single wall is 50.8 mm long on a 51.91 mm depth — shorter than it is thick,
    // so a HORIZONTAL run of it has width < height. Read the aspect ratio there
    // and this piece is judged vertical while sitting flat, its ends are checked
    // against the wrong axis, and a perfectly bracketed wall is flagged as
    // floating in open floor.
    const alongX = piece.rotation !== 90;
    const ends = alongX
      ? [{ x:rect.x, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width, y:rect.y + rect.height / 2 }]
      : [{ x:rect.x + rect.width / 2, y:rect.y }, { x:rect.x + rect.width / 2, y:rect.y + rect.height }];
    const loose = ends.filter((end) => {
      // The board border is a wall in its own right, so an end reaching it is
      // terminated as validly as one meeting a column.
      const atHull = end.x <= .6 || end.y <= .6 || end.x >= boardWidth - .6 || end.y >= boardHeight - .6;
      if (atHull) return false;
      return !supports.some((support) => end.x >= support.x - .35 && end.x <= support.x + support.width + .35
        && end.y >= support.y - .35 && end.y <= support.y + support.height + .35);
    });
    // A hub kit's half filler reaches from one hub's face to the MIDDLE of the
    // gap, so only its outer end ever meets a casting — the inner one butts
    // against whatever covers the other half, an arm or a second filler. Holding
    // it to the both-ends rule condemns a joint the kit is built to make: two
    // 50 mm panels between two columns 152 mm apart is how the real thing goes
    // together when neither hub has an arm to spare.
    if (def?.halfEdge) return loose.length > 1;
    return loose.length > 0;
  });
  if (unsupported.length) {
    failures.push({ rule:"bracketed", detail:`${unsupported.length} panel ends stand on nothing` });
  }

  // 7. Every panel seats in its span, for the joint it actually makes.
  //
  //    A straddling panel slots into a column standing on the node, so it may be up to one
  //    column's width shorter than its span — that difference IS the slot. A butting panel
  //    sits between two connectors and must match the clear opening; longer, and it runs
  //    straight through the connectors it is supposed to sit between.
  //
  //    Nothing checked this per panel. `pitchIsBuildable` was applied once, to the
  //    SHORTEST panel in the kit, and the pitch itself came from `min(spanOf)` — so one
  //    46 mm Death Quadrant wall in a TTCombat palette put the whole board on a 96 mm
  //    pitch, and six of the thirteen panel types were then placed into a 46 mm opening
  //    64 mm wide, overlapping their connectors by 9 mm at each end.
  const pitch = Math.max(lattice.pitchX, lattice.pitchY);
  // Measured against the plain hub, so a hub kit's armed castings — which are a
  // whole pitch wide because they CARRY the wall — cannot inflate the figure every
  // filler is then checked against.
  const support = Math.max(0, ...[...defs.values()]
    .filter((def) => (def.kind === "pillar" || def.kind === "connector") && (def.shape ?? "column") === "column")
    .map((def) => Math.max(def.length, def.depth)));
  const misseated = [...new Set(structural.map((piece) => piece.defId))].filter((defId) => {
    const def = defs.get(defId);
    if (!def) return false;
    // A hub kit's half filler covers half an edge by definition, so "does it fill
    // its span" is the wrong question to ask of it — the arm reaching back from the
    // hub opposite covers the other half, and invariant 6 already checks both of
    // its ends land on something.
    if (def.halfEdge) return false;
    const span = def.cells * pitch;
    if (def.straddles) {
      // Generated schematics calibrate a nominal board by a few millimetres so the
      // real row count fits between complete perimeter supports. Catalogue lengths
      // remain untouched; this small drawing tolerance is allowed at the joint.
      const calibration = .12; // 3.05 mm across the complete placed panel.
      return def.length > span + calibration
        || span > def.length + support + (def.jointSlack ?? 0) + calibration;
    }
    return def.length > span - support + .04;
  });
  if (misseated.length) {
    failures.push({
      rule:"seating",
      detail:`${misseated.join(", ")} do not seat in their span — a panel is overlapping its supports`,
    });
  }

  // 8. A wall-end cap covers a free end, and nothing else.
  //
  //    A wall end is cosmetic — it hides the exposed end of a panel that stops in open
  //    floor. It brackets nothing, so it can never be the joint between two panels.
  //
  //    The build pass used to allow one wherever a single panel END arrived at a node,
  //    which is not the same test: a run terminating against the flank of a long panel has
  //    one end arriving there while the long panel covers the node with two more panel
  //    edges. 30% of the caps on a board were in that position, holding a wall onto the
  //    side of another wall. Invariant 6 could not see it, because a cap counts as support
  //    for a panel end and legitimately does — for a free end.
  const caps = pieces.filter((piece) => defs.get(piece.defId)?.kind === "end");
  const misusedCaps = caps.filter((piece) => {
    const rect = rectOf(piece, defs);
    const centre = { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2 };
    const col = Math.round((centre.x - lattice.originX) / lattice.pitchX);
    const row = Math.round((centre.y - lattice.originY) / lattice.pitchY);
    const carriesPanel = (edge:LatticeEdge) => {
      const value = state.get(edgeKey(edge));
      return value === "wall" || value === "hatch";
    };
    const touching = ([
      { axis:"h", col:col - 1, row }, { axis:"h", col, row },
      { axis:"v", col, row:row - 1 }, { axis:"v", col, row },
    ] as LatticeEdge[]).filter(carriesPanel).length;
    return touching !== 1;
  });
  if (misusedCaps.length) {
    failures.push({
      rule:"cap",
      detail:`${misusedCaps.length} wall ends are joining panels rather than capping a free end`,
    });
  }

  // 9. Reserved zones stay clear.
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
