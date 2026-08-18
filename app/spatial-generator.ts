import {
  buildMaze, edgeRuns, chooseDoorways, edgeKey, meanSightLine, panelsOf,
  type Plan, type PlanEdge,
} from "./floorplan.ts";

export type SpatialCatalogue = "boarding" | "ttcombat";

export type SpatialTerrainDef = {
  id:string; catalogue:SpatialCatalogue; width:number; depth:number; height:number;
  kind:"wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair";
  /**
   * Node-to-node span in inches, for kits built on a fixed assembly grid.
   *
   * Gallowdark is such a kit: its board is 7 × 6 squares of 9.7 cm, so a short
   * wall occupies one 97 mm square and a long wall two. When a span is given it
   * is authoritative for spacing and the piece is drawn centred inside it, with
   * the supports at each end covering the joint. Pieces without a span sit
   * between two supports, so their span is the panel plus half a support at each
   * end — which is how Iron Labyrinth works.
   */
  span?:number;
};

export type SpatialPiece = {
  uid:string; defId:string; x:number; y:number; rotation:0 | 90; height:number;
  runId?:string; sequenceIndex?:number;
};

type Zone = { x:number;y:number;width:number;height:number };
type Rect = { x:number;y:number;width:number;height:number };

export type SpatialGeneratorInput = {
  boardWidth:number; boardHeight:number; catalogue:SpatialCatalogue;
  definitions:SpatialTerrainDef[]; inventory:Record<string, number>;
  heights:Record<string, number>; zones:Zone[]; usage:number; seed:number;
  nextUid:() => string;
  /** Corridor width required between the board border and any terrain that
   *  does not meet the border outright. */
  borderStandoff?:number;
};

const clamp = (value:number, min:number, max:number) => Math.min(max, Math.max(min, value));
const snap = (value:number, size = .25) => Math.round(value / size) * size;

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

const shuffle = <T,>(values:T[], random:() => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

const pieceRect = (piece:SpatialPiece, definitions:Map<string, SpatialTerrainDef>):Rect => {
  const def = definitions.get(piece.defId)!;
  return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
};

const rectsOverlap = (first:Rect, second:Rect, padding = .04) => first.x < second.x + second.width + padding && first.x + first.width > second.x - padding && first.y < second.y + second.height + padding && first.y + first.height > second.y - padding;
const hitsZone = (rect:Rect, zones:Zone[]) => zones.some((zone) => rectsOverlap(rect, zone, .08));


// ---------------------------------------------------------------------------
// The lattice
//
// A Zone Mortalis board is not a scatter of shapes on open floor — it is a
// floorplan. Walls sit on the edges of an assembly lattice and supports on its
// vertices, so "the panel is centred in its span" and "pillars stand one pitch
// apart" hold by construction rather than being checked afterwards.
//
// The lattice is deliberately NOT uniform. Gallowdark is cut to a single 97 mm
// square, but Iron Labyrinth ships 64 mm walls, 94 mm high walls and 194 mm
// doors, and no one pitch fits them all: a cell longer than the piece standing
// in it opens a gap at each end that the support cannot cover. So every column
// carries its own width and every row its own height, drawn from the lengths the
// palette actually owns — which is how you would build it on the table anyway.
// ---------------------------------------------------------------------------

/** Node-to-node length a piece occupies: its own span, or the panel plus half a
 *  support at each end for kits that state no grid. */
const nodeLength = (def:SpatialTerrainDef, support:number) => def.span ?? support + def.width;

const LENGTH_TOLERANCE = .12;

/** Pieces grouped by the node-to-node length they fill. */
const lengthBank = (pool:SpatialTerrainDef[], support:number) => {
  const bank = new Map<number, SpatialTerrainDef[]>();
  pool.forEach((def) => {
    const length = nodeLength(def, support);
    const existing = [...bank.keys()].find((key) => Math.abs(key - length) <= LENGTH_TOLERANCE);
    const key = existing ?? Number(length.toFixed(3));
    bank.set(key, [...(bank.get(key) ?? []), def]);
  });
  return bank;
};

const takeByLength = (bank:Map<number, SpatialTerrainDef[]>, length:number) => {
  for (const [key, defs] of bank) {
    if (Math.abs(key - length) > LENGTH_TOLERANCE || !defs.length) continue;
    return defs.shift()!;
  }
  return null;
};

const cloneBank = (bank:Map<number, SpatialTerrainDef[]>) => new Map([...bank].map(([key, defs]) => [key, [...defs]] as [number, SpatialTerrainDef[]]));

/**
 * Lay out one axis as a run of cell widths drawn from the lengths available.
 *
 * The commonest length dominates, because that is what the kit is mostly made of
 * and repeating it is what keeps corridors reading as parallel. The rarer
 * lengths still come up often enough to be spent rather than stranded.
 */
const axisWidths = (cells:number, boardExtent:number, lengths:{ length:number; supply:number }[], random:() => number) => {
  const total = lengths.reduce((sum, entry) => sum + entry.supply, 0);
  const widths:number[] = [];
  let used = 0;
  for (let index = 0; index < cells; index++) {
    let roll = random() * total;
    let pick = lengths[0];
    for (const entry of lengths) { roll -= entry.supply; if (roll <= 0) { pick = entry; break; } }
    if (used + pick.length > boardExtent + .01) {
      const fits = lengths.filter((entry) => used + entry.length <= boardExtent + .01);
      if (!fits.length) return null;
      pick = fits[Math.floor(random() * fits.length)];
    }
    widths.push(pick.length);
    used += pick.length;
  }
  return widths;
};

/** Grid resolution for reachability, in inches. A 32 mm base is ~1.26", so a
 *  quarter-inch cell resolves every gap that matters to movement. */
const REACH_CELL = .25;
/** Clear width of a hatchway, in inches — enough for a 32 mm base to pass. */
const DOORWAY = 1.5;
/**
 * Share of the wall line given over to hatchways.
 *
 * A hatchway is an opening deliberately set into a wall, so it wants to be the
 * exception — roughly one panel in eight. Left to fill whatever the wall supply
 * could not, hatchways took over half the board and every run came out striped.
 */
const DOOR_SHARE = .13;

/**
 * Flood the walkable space and open any pocket that walls have sealed off.
 *
 * Walls and supports are impassable; a door is a wall with an opening in it, so
 * only the opening is passable. The largest connected region is the playable
 * board; every other region is a dead zone. For each dead zone worth reclaiming,
 * the wall separating it from the main region is replaced with a same-footprint
 * door, which is exactly the move a real board would make.
 *
 * The floorplan now gives every chamber a doorway outright, so this is a safety
 * net rather than the main event.
 */
const openSealedPockets = ({ placed, definitions, boardWidth, boardHeight, doors, heights, nextUid }:{
  placed:SpatialPiece[]; definitions:Map<string, SpatialTerrainDef>;
  boardWidth:number; boardHeight:number; doors:SpatialTerrainDef[];
  heights:Record<string, number>; nextUid:() => string;
}) => {
  const columns = Math.ceil(boardWidth / REACH_CELL);
  const rows = Math.ceil(boardHeight / REACH_CELL);
  const spareDoors = [...doors];

  const blockedBy = (pieces:SpatialPiece[]) => {
    const blocked = new Uint8Array(columns * rows);
    const owner = new Array<string | null>(columns * rows).fill(null);
    pieces.forEach((piece) => {
      const def = definitions.get(piece.defId)!;
      const rect = pieceRect(piece, definitions);
      // A 170 mm hatchway panel is mostly wall. Treating the whole footprint as
      // open let the flood walk through solid resin, so genuine pockets behind a
      // long door panel were never found and never opened.
      const opening = def.kind === "door" ? Math.min(DOORWAY, rect.width, rect.height) : 0;
      const alongX = rect.width >= rect.height;
      const openFrom = alongX ? rect.x + (rect.width - opening) / 2 : rect.y + (rect.height - opening) / 2;
      const fromX = Math.max(0, Math.floor(rect.x / REACH_CELL));
      const toX = Math.min(columns - 1, Math.ceil((rect.x + rect.width) / REACH_CELL) - 1);
      const fromY = Math.max(0, Math.floor(rect.y / REACH_CELL));
      const toY = Math.min(rows - 1, Math.ceil((rect.y + rect.height) / REACH_CELL) - 1);
      for (let y = fromY; y <= toY; y++) for (let x = fromX; x <= toX; x++) {
        if (opening > 0) {
          const centre = (alongX ? x : y) * REACH_CELL + REACH_CELL / 2;
          if (centre >= openFrom && centre <= openFrom + opening) continue;
        }
        const cell = y * columns + x;
        blocked[cell] = 1;
        if (def.kind === "wall") owner[cell] = piece.uid;
      }
    });
    return { blocked, owner };
  };

  const regionsOf = (blocked:Uint8Array) => {
    const label = new Int32Array(columns * rows).fill(-1);
    const sizes:number[] = [];
    for (let start = 0; start < label.length; start++) {
      if (blocked[start] || label[start] !== -1) continue;
      const id = sizes.length;
      let size = 0;
      const queue = [start];
      label[start] = id;
      while (queue.length) {
        const cell = queue.pop()!;
        size++;
        const x = cell % columns;
        const y = (cell - x) / columns;
        if (x > 0) { const n = cell - 1; if (!blocked[n] && label[n] === -1) { label[n] = id; queue.push(n); } }
        if (x < columns - 1) { const n = cell + 1; if (!blocked[n] && label[n] === -1) { label[n] = id; queue.push(n); } }
        if (y > 0) { const n = cell - columns; if (!blocked[n] && label[n] === -1) { label[n] = id; queue.push(n); } }
        if (y < rows - 1) { const n = cell + columns; if (!blocked[n] && label[n] === -1) { label[n] = id; queue.push(n); } }
      }
      sizes.push(size);
    }
    return { label, sizes };
  };

  // Reclaim a pocket only if it is big enough to stand a model in; a couple of
  // stray cells behind a wall is rounding, not a room.
  const minimumPocket = Math.ceil(1.5 / REACH_CELL / REACH_CELL);

  // One pocket per pass, then rebuild the flood. Opening a pocket rewrites the
  // topology, so judging the rest of a pass against the pre-opening labels cost
  // walls that no longer needed removing.
  for (let pass = 0; pass < 16; pass++) {
    const { blocked, owner } = blockedBy(placed);
    const { label, sizes } = regionsOf(blocked);
    if (sizes.length < 2) break;
    const mainRegion = sizes.indexOf(Math.max(...sizes));
    const pockets = sizes.map((size, id) => ({ size, id })).filter(({ size, id }) => id !== mainRegion && size >= minimumPocket);
    if (!pockets.length) break;
    const pocket = pockets.sort((first, second) => second.size - first.size)[0];

    const touchesPocket = new Map<string, number>();
    const touchesMain = new Map<string, number>();
    for (let cell = 0; cell < label.length; cell++) {
      const region = label[cell];
      if (region !== pocket.id && region !== mainRegion) continue;
      const x = cell % columns;
      const y = (cell - x) / columns;
      const side = region === pocket.id ? touchesPocket : touchesMain;
      [x > 0 ? cell - 1 : -1, x < columns - 1 ? cell + 1 : -1, y > 0 ? cell - columns : -1, y < rows - 1 ? cell + columns : -1]
        .forEach((neighbour) => {
          if (neighbour < 0) return;
          const uid = owner[neighbour];
          if (uid) side.set(uid, (side.get(uid) ?? 0) + 1);
        });
    }
    const sealing = [...touchesPocket.keys()]
      .filter((uid) => touchesMain.has(uid))
      .map((uid) => ({ uid, reach:Math.min(touchesPocket.get(uid)!, touchesMain.get(uid)!) }))
      .sort((first, second) => second.reach - first.reach);

    let opened = false;
    for (const { uid } of sealing) {
      const wall = placed.find((piece) => piece.uid === uid);
      if (!wall) continue;
      const wallDef = definitions.get(wall.defId)!;
      const doorIndex = spareDoors.findIndex((door) => Math.abs(door.width - wallDef.width) < .02 && Math.abs(door.depth - wallDef.depth) < .02);
      if (doorIndex < 0) continue;
      const door = spareDoors.splice(doorIndex, 1)[0];
      placed[placed.indexOf(wall)] = { ...wall, uid:nextUid(), defId:door.id, height:heights[door.id] ?? door.height };
      opened = true;
      break;
    }
    // No door of the right size left — pull the sealing wall out instead. One
    // unplaced wall costs far less than a sealed chunk of board.
    if (!opened && sealing.length) {
      const wall = placed.find((piece) => piece.uid === sealing[0].uid);
      if (wall) { placed.splice(placed.indexOf(wall), 1); opened = true; }
    }
    if (!opened) break;
  }

  // Removing a wall can strand a support with nothing attached to it. Drop any
  // support or cap that no longer touches a structural piece.
  const structuralRects = placed.filter((piece) => ["wall", "door"].includes(definitions.get(piece.defId)!.kind)).map((piece) => pieceRect(piece, definitions));
  for (let index = placed.length - 1; index >= 0; index--) {
    const def = definitions.get(placed[index].defId)!;
    if (!["pillar", "connector", "end"].includes(def.kind)) continue;
    const rect = pieceRect(placed[index], definitions);
    if (!structuralRects.some((other) => rectsOverlap(rect, other, .12))) placed.splice(index, 1);
  }
};

type Banks = {
  wall:Map<number, SpatialTerrainDef[]>;
  door:Map<number, SpatialTerrainDef[]>;
  support:SpatialTerrainDef[];
  end:SpatialTerrainDef[];
};

type Realised = { pieces:SpatialPiece[]; structural:number; unsupported:number };

/**
 * Turn a floorplan into actual kit pieces.
 *
 * Pure enough to be run inside the plan search, so a candidate is scored on the
 * terrain it genuinely places rather than on an estimate. That matters because
 * whether a run can be tiled depends on which lengths are still in the tray, and
 * no cheap formula predicts it.
 */
const realise = (
  plan:Plan, colWidth:number[], rowHeight:number[],
  originX:number, originY:number, banks:Banks, seed:number, doorShare:number,
  doorQuota:number, heights:Record<string, number>, nextUid:() => string,
):Realised => {
  const edges = panelsOf(plan);
  if (!edges.length) return { pieces:[], structural:0, unsupported:0 };
  const random = randomFactory(seed);
  const doorways = chooseDoorways(plan, doorShare, random);
  const runs = edgeRuns(edges);

  const gridX:number[] = [originX];
  colWidth.forEach((width) => gridX.push(gridX[gridX.length - 1] + width));
  const gridY:number[] = [originY];
  rowHeight.forEach((height) => gridY.push(gridY[gridY.length - 1] + height));

  const pieces:SpatialPiece[] = [];
  const vertices = new Map<string, { x:number; y:number; horizontal:boolean; count:number }>();
  const touch = (col:number, row:number, horizontal:boolean) => {
    const key = `${col},${row}`;
    const existing = vertices.get(key);
    if (existing) { existing.count++; return; }
    vertices.set(key, { x:gridX[col], y:gridY[row], horizontal, count:1 });
  };

  let structural = 0;
  // Hard ceiling on hatchways. Without it the tiler reaches for a door whenever
  // the exact wall LENGTH it needs has run out — Gallowdark ships four short
  // walls against twelve short hatchways — and a run comes out as alternating
  // wall, door, wall, door.
  let doorsPlaced = 0;
  // Tile the runs in a shuffled order. Tiling them as listed let one orientation
  // drain the wall bank dry and left the other with nothing but hatchways — a
  // board whose every upright was a door. The mix has to be spread across
  // orientations, not handed out in whatever order the plan produced them.
  shuffle(runs, random).forEach((run, runIndex) => {
    const runId = `complex-${seed}-${runIndex}`;
    const horizontal = run[0].axis === "h";
    const extent = (edge:PlanEdge) => horizontal ? colWidth[edge.col] : rowHeight[edge.row];
    let index = 0;
    let sequence = 0;
    while (index < run.length) {
      const edge = run[index];
      const isDoor = doorways.has(edgeKey(edge));
      let def:SpatialTerrainDef | null = null;
      let cells = 1;
      const doorsLeft = doorsPlaced < doorQuota;
      if (isDoor && doorsLeft) {
        // Nothing of this length in the tray — Iron Ultima ships no hatchway at
        // all. Leave it as an open passage rather than walling it up.
        def = takeByLength(banks.door, extent(edge));
        if (def) doorsPlaced++;
      } else {
        // A long panel is preferred wherever two plain cells run on. It is the
        // long unbroken wall a real board is built from, and it skips the pillar
        // a pair of short panels would need between them.
        const next = run[index + 1];
        if (next && !doorways.has(edgeKey(next))) {
          const pair = extent(edge) + extent(next);
          def = takeByLength(banks.wall, pair);
          if (!def && doorsLeft) { def = takeByLength(banks.door, pair); if (def) doorsPlaced++; }
          if (def) cells = 2;
        }
        if (!def) def = takeByLength(banks.wall, extent(edge));
        // A hatchway standing in for a wall is spent against the same quota, so
        // a short-wall shortage can never stripe the run with doors.
        if (!def && doorsLeft) { def = takeByLength(banks.door, extent(edge)); if (def) doorsPlaced++; }
      }
      // Nothing in the tray fits this cell. Skip it and carry on down the run:
      // one gap reads as an opening, whereas abandoning the run leaves the
      // chamber behind it standing on two and a half sides.
      if (!def) { index++; continue; }

      const fromCol = edge.col;
      const fromRow = edge.row;
      const toCol = horizontal ? fromCol + cells : fromCol;
      const toRow = horizontal ? fromRow : fromRow + cells;
      const centreX = horizontal ? (gridX[fromCol] + gridX[toCol]) / 2 : gridX[fromCol];
      const centreY = horizontal ? gridY[fromRow] : (gridY[fromRow] + gridY[toRow]) / 2;
      pieces.push({
        uid:nextUid(), defId:def.id,
        x:horizontal ? centreX - def.width / 2 : centreX - def.depth / 2,
        y:horizontal ? centreY - def.depth / 2 : centreY - def.width / 2,
        rotation:horizontal ? 0 : 90,
        height:heights[def.id] ?? def.height, runId, sequenceIndex:sequence++,
      });
      structural++;
      touch(fromCol, fromRow, horizontal);
      touch(toCol, toRow, horizontal);
      index += cells;
    }
  });

  // Supports at every vertex a panel actually reaches. A vertex with a single
  // panel arriving is a run terminus and takes a cap where the kit ships one —
  // that is what Iron Labyrinth's wall ends are for, and it frees a connector
  // for a real junction.
  let unsupported = 0;
  vertices.forEach((vertex) => {
    const cap = vertex.count === 1 ? banks.end.shift() : undefined;
    const def = cap ?? banks.support.shift();
    // A panel standing on a missing pillar has an unsupported end, which is the
    // one joint the kit cannot actually build. The caller rejects the whole
    // candidate rather than shipping it.
    if (!def) { unsupported++; return; }
    if (cap) {
      // The cap plate lies across the run, so its width spans the panel's
      // thickness and its depth runs along the axis.
      pieces.push({
        uid:nextUid(), defId:def.id,
        x:vertex.x - (vertex.horizontal ? def.depth : def.width) / 2,
        y:vertex.y - (vertex.horizontal ? def.width : def.depth) / 2,
        rotation:vertex.horizontal ? 90 : 0, height:heights[def.id] ?? def.height,
      });
      return;
    }
    pieces.push({
      uid:nextUid(), defId:def.id, x:vertex.x - def.width / 2, y:vertex.y - def.depth / 2,
      rotation:0, height:heights[def.id] ?? def.height,
    });
  });

  return { pieces, structural, unsupported };
};

export const generateSpatialLayout = (input:SpatialGeneratorInput):SpatialPiece[] => {
  const { boardWidth, boardHeight, catalogue, inventory, heights, zones, nextUid } = input;
  const definitions = new Map(input.definitions.map((def) => [def.id, def]));
  const random = randomFactory(input.seed);
  const systemDefs = input.definitions.filter((def) => def.catalogue === catalogue && (inventory[def.id] || 0) > 0);
  const expanded = (kinds:SpatialTerrainDef["kind"][]) => shuffle(systemDefs.filter((def) => kinds.includes(def.kind)).flatMap((def) => Array.from({ length:inventory[def.id] || 0 }, () => def)), random);
  const usage = clamp(input.usage, .05, 1);
  const share = (pool:SpatialTerrainDef[]) => pool.slice(0, Math.max(pool.length ? 1 : 0, Math.round(pool.length * usage)));
  const walls = share(expanded(["wall"]));
  const doors = share(expanded(["door"]));
  const supports = expanded(catalogue === "boarding" ? ["pillar"] : ["connector"]);
  const ends = expanded(["end"]);
  const accessories = expanded(["floor", "stair"]);
  if ((!walls.length && !doors.length) || !supports.length) return [];

  const supportExtent = Math.max(...supports.map((def) => Math.max(def.width, def.depth)));
  const wallBank = lengthBank(walls, supportExtent);
  const doorBank = lengthBank(doors, supportExtent);

  // Cell widths are only drawn from lengths a wall can fill. A cell sized to a
  // door alone would have to stay a doorway forever, and there are never enough
  // doors for that.
  const supplied = [...lengthBank([...walls, ...doors], supportExtent)]
    .map(([length, defs]) => ({ length, supply:defs.filter((def) => def.kind === "wall").length }))
    .filter((entry) => entry.supply > 0)
    .sort((first, second) => first.length - second.length);
  if (!supplied.length) return [];
  // A length that is a whole multiple of a shorter one is not a cell width — it
  // is a panel that spans that many cells. Gallowdark's long wall is exactly two
  // 97 mm squares, and offering it as a cell of its own put the whole board on a
  // 7.6" pitch: half as many cells, chambers that could not subdivide, and the
  // short walls left with nothing to fill. Dropping it here keeps the grid on the
  // kit's real square, and the run tiler still reaches for it two cells at a time.
  const lengths = supplied
    .filter((entry, index) => !supplied.slice(0, index).some((shorter) => {
      const ratio = entry.length / shorter.length;
      return ratio >= 1.8 && Math.abs(ratio - Math.round(ratio)) * shorter.length <= LENGTH_TOLERANCE;
    }))
    .sort((first, second) => second.supply - first.supply);
  if (!lengths.length) return [];

  const lane = input.borderStandoff ?? 2.75;

  // -------------------------------------------------------------------------
  // Size the complex to the terrain, not to the table.
  //
  // A kit populates a fixed area at real board density. Stretching it over a
  // larger table only thins the corridors out, so the complex is built at the
  // size its own terrain supports and the rest of the board is left as open
  // deck — hangar floor, exterior, somewhere for a tank to sit.
  // -------------------------------------------------------------------------
  let best:{ pieces:SpatialPiece[]; structural:number } | null = null;
  let bestScore = -Infinity;

  // How thick a panel is, measured across the run. A wall centred on a grid line
  // sticks out half its depth past the complex origin, so the hull needs that on
  // top of the corridor lane or the panel face ends up inside the border strip.
  const shortest = Math.min(...lengths.map((entry) => entry.length));
  const cellCap = (extent:number) => Math.max(2, Math.floor((extent + .01) / shortest));

  // A board is laid out in tiles about the size of one terrain box, so a four
  // foot table is four two-foot tiles. Corridor lanes are then chosen across the
  // whole board with one on every seam, which is what stops the tiles reading as
  // four unrelated squares: a corridor runs straight through from one into the
  // next, and only the room subdivision inside them varies.
  const commonest = lengths[0].length;
  // How many lattice cells of wall the palette can build, counting a long panel
  // as the two cells it covers.
  //
  // Sized from the WALLS, not from walls and hatchways together. Counting both
  // laid out a maze half again bigger than the solid panels could fill, and the
  // tiler padded the difference with hatchways — which is how a board ends up
  // with a door every other panel and wall runs that read as dashed lines. A
  // hatchway is a deliberate opening in a wall, so it gets a small explicit
  // allowance on top and a hard quota below, rather than being whatever is left
  // in the tray when the walls run out.
  const cellsOf = (pool:SpatialTerrainDef[]) =>
    pool.reduce((sum, def) => sum + Math.max(1, Math.round(nodeLength(def, supportExtent) / commonest)), 0);
  const solidCells = cellsOf(walls);
  const doorAllowance = Math.min(cellsOf(doors), Math.max(1, Math.round(solidCells * DOOR_SHARE)));
  const wallCellBudget = solidCells + doorAllowance;

  // A grid of c x r cells has exactly (c-1)(r-1) edges spare once a connected
  // maze has taken its passages, so the size that the terrain can actually fill
  // is solvable rather than searchable. Spreading one kit over a whole four-foot
  // table instead gives a scatter of fragments; the maze is built at the size it
  // can be built densely, and the rest of the board is open deck.
  const aspect = boardWidth / boardHeight;
  const idealCols = Math.round(Math.sqrt(wallCellBudget * aspect)) + 1;
  const idealRows = Math.round(Math.sqrt(wallCellBudget / aspect)) + 1;

  for (let attempt = 0; attempt < 70; attempt++) {
    const half = supportExtent / 2;
    const usableWidth = boardWidth - half;
    const usableHeight = boardHeight - half;
    const cols = Math.max(3, Math.min(idealCols, cellCap(usableWidth)));
    const rows = Math.max(3, Math.min(idealRows, cellCap(usableHeight)));
    const colWidth = axisWidths(cols, usableWidth, lengths, random);
    const rowHeight = axisWidths(rows, usableHeight, lengths, random);
    if (!colWidth || !rowHeight) continue;
    const gridWidth = colWidth.reduce((sum, width) => sum + width, 0);
    const gridHeight = rowHeight.reduce((sum, height) => sum + height, 0);
    if (gridWidth > usableWidth + .01 || gridHeight > usableHeight + .01) continue;

    // Where the maze sits. Filling the table it is simply centred, and the board
    // edge is its outer wall on all four sides. Smaller than the table it is
    // pushed into a corner, so two of its sides still use the board edge and the
    // open ground gathers on one side as deck rather than as a margin all round.
    const slackX = boardWidth - gridWidth - supportExtent;
    const slackY = boardHeight - gridHeight - supportExtent;
    const place = (slack:number) => slack < lane ? half + slack / 2 : (random() < .5 ? half : half + slack);
    const originX = place(Math.max(0, slackX));
    const originY = place(Math.max(0, slackY));

    const plan = buildMaze(colWidth.length, rowHeight.length, wallCellBudget, 0, random);
    if (!plan.walls.length) continue;

    const banks:Banks = { wall:cloneBank(wallBank), door:cloneBank(doorBank), support:[...supports], end:[...ends] };
    const trial = realise(plan, colWidth, rowHeight, originX, originY, banks, input.seed + attempt, DOOR_SHARE, doorAllowance, heights, nextUid);
    if (!trial.structural || trial.unsupported) continue;

    // A labyrinth is judged on how far you can see down it, not on how much
    // terrain got used. Chasing piece count is what produced sealed boxes: past a
    // point the only place left to put a wall is around something. Sight line is
    // the number that separates a corridor network from rectangles in a field.
    const sight = meanSightLine(plan);
    const score = -sight * 12 + trial.structural * 2 + plan.chambers * 6 + random();
    if (score > bestScore) { bestScore = score; best = trial; }
  }
  if (!best) return [];

  const placed = best.pieces;

  // A complex sitting flush against a border puts lattice vertices on the board
  // edge itself, and a support centred on one would hang half its width over the
  // side. Slide those back inside — the vertex stays covered and the pillar sits
  // hard against the edge, as it would on a real board. Panels are centred in
  // cells well inside the grid and never need this.
  // A hatchway needs terrain continuing past both of its ends, or it is a
  // freestanding frame models simply walk around. The plan only ever sites one
  // inline, but a run that ran out of panels mid-way can leave the neighbour it
  // was counting on unbuilt. Pull those: an open archway is a legitimate way into
  // a chamber, a door frame standing in space is not.
  const reach = supportExtent + .2;
  const endsOf = (piece:SpatialPiece) => {
    const box = pieceRect(piece, definitions);
    return box.width > box.height
      ? [{ x:box.x, y:box.y + box.height / 2 }, { x:box.x + box.width, y:box.y + box.height / 2 }]
      : [{ x:box.x + box.width / 2, y:box.y }, { x:box.x + box.width / 2, y:box.y + box.height }];
  };
  for (let index = placed.length - 1; index >= 0; index--) {
    if (definitions.get(placed[index].defId)!.kind !== "door") continue;
    const open = endsOf(placed[index]).some((point) => {
      // Per rule 9 the board border is itself a wall, so an end that reaches it
      // is terminated just as validly as one meeting more terrain.
      if (point.x <= reach || point.y <= reach || point.x >= boardWidth - reach || point.y >= boardHeight - reach) return false;
      return !placed.some((other) => other.uid !== placed[index].uid
        && ["wall", "door"].includes(definitions.get(other.defId)!.kind)
        && endsOf(other).some((candidate) => Math.hypot(point.x - candidate.x, point.y - candidate.y) <= reach));
    });
    if (open) placed.splice(index, 1);
  }

  // A reserved zone is clear space by definition, so anything the plan dropped
  // inside one comes straight back out.
  for (let index = placed.length - 1; index >= 0; index--) {
    if (hitsZone(pieceRect(placed[index], definitions), zones)) placed.splice(index, 1);
  }

  const spareDoors = doors.filter((def) => !placed.some((piece) => piece.defId === def.id));
  openSealedPockets({ placed, definitions, boardWidth, boardHeight, doors:spareDoors, heights, nextUid });

  // Accessories dress the open deck around and inside the complex.
  accessories.slice(0, Math.round(accessories.length * usage)).forEach((def, index) => {
    let accepted:SpatialPiece | null = null;
    for (let attempt = 0; attempt < 60 && !accepted; attempt++) {
      const rotation:(0 | 90) = (attempt + index) % 2 ? 90 : 0;
      const width = rotation === 90 ? def.depth : def.width;
      const height = rotation === 90 ? def.width : def.depth;
      const piece:SpatialPiece = { uid:nextUid(), defId:def.id, x:snap(random() * Math.max(0, boardWidth - width)), y:snap(random() * Math.max(0, boardHeight - height)), rotation, height:heights[def.id] ?? def.height };
      const rect = pieceRect(piece, definitions);
      if (!hitsZone(rect, zones) && !placed.some((other) => rectsOverlap(rect, pieceRect(other, definitions), .65))) accepted = piece;
    }
    if (accepted) placed.push(accepted);
  });

  return placed;
};
