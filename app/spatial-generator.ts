export type SpatialCatalogue = "boarding" | "ttcombat";

export type SpatialTerrainDef = {
  id:string; catalogue:SpatialCatalogue; width:number; depth:number; height:number;
  kind:"wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair";
  /**
   * True for kit pieces whose stated width is measured pillar-centreline to
   * pillar-centreline rather than as a bare panel, because the piece carries
   * half a pillar moulded on each end. Such a width is already a node-to-node
   * span, so adding a further pillar width to it over-spaces the run.
   */
  bringsPillars?:boolean;
};

export type SpatialPiece = {
  uid:string; defId:string; x:number; y:number; rotation:0 | 90; height:number;
  runId?:string; sequenceIndex?:number;
};

type Zone = { x:number;y:number;width:number;height:number };
type Rect = { x:number;y:number;width:number;height:number };
type Direction = "east" | "south" | "west" | "north";
type PatternEdge = { from:number; to:number; direction:Direction };
type Point = { x:number;y:number };

export type SpatialGeneratorInput = {
  boardWidth:number; boardHeight:number; catalogue:SpatialCatalogue;
  definitions:SpatialTerrainDef[]; inventory:Record<string, number>;
  heights:Record<string, number>; zones:Zone[]; usage:number; seed:number;
  nextUid:() => string;
  /** Corridor width required between the board border and any terrain that
   *  does not meet the border outright. */
  borderStandoff?:number;
};

const PATTERNS:PatternEdge[][] = [
  [
    { from:0, to:1, direction:"east" }, { from:1, to:2, direction:"east" },
    { from:2, to:3, direction:"south" }, { from:3, to:4, direction:"west" },
    { from:1, to:5, direction:"north" },
  ],
  [
    { from:0, to:1, direction:"east" }, { from:1, to:2, direction:"east" },
    { from:1, to:3, direction:"south" }, { from:3, to:4, direction:"south" },
    { from:3, to:5, direction:"west" },
  ],
  [
    { from:0, to:1, direction:"east" }, { from:0, to:2, direction:"south" },
    { from:0, to:3, direction:"west" }, { from:0, to:4, direction:"north" },
  ],
  [
    { from:0, to:1, direction:"east" }, { from:1, to:2, direction:"south" },
    { from:2, to:3, direction:"south" }, { from:2, to:4, direction:"west" },
  ],
  [
    { from:0, to:1, direction:"south" }, { from:1, to:2, direction:"east" },
    { from:2, to:3, direction:"east" }, { from:3, to:4, direction:"north" },
  ],
  [
    { from:0, to:1, direction:"east" }, { from:1, to:2, direction:"south" },
    { from:1, to:3, direction:"north" },
  ],
];

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
const rectDistance = (first:Rect, second:Rect) => Math.hypot(
  Math.max(0, first.x - second.x - second.width, second.x - first.x - first.width),
  Math.max(0, first.y - second.y - second.height, second.y - first.y - first.height),
);

const rotateDirection = (direction:Direction, turns:number, mirror:boolean):Direction => {
  const directions:Direction[] = ["east", "south", "west", "north"];
  let transformed = direction;
  if (mirror && (direction === "east" || direction === "west")) transformed = direction === "east" ? "west" : "east";
  return directions[(directions.indexOf(transformed) + turns) % 4];
};

const componentTargets = (pieceCount:number, boardWidth:number, boardHeight:number, maximumSize = 5) => {
  const areaScale = Math.max(1, Math.round(boardWidth * boardHeight / (24 * 24)));
  const desired = clamp(Math.ceil(pieceCount / maximumSize), Math.min(2, pieceCount), Math.min(pieceCount, 6 * areaScale));
  const sizes:number[] = [];
  let remaining = pieceCount;
  for (let index = 0; index < desired; index++) {
    const componentsLeft = desired - index;
    const size = clamp(Math.ceil(remaining / componentsLeft), 1, maximumSize);
    sizes.push(size);
    remaining -= size;
  }
  while (remaining > 0) {
    const index = sizes.findIndex((size) => size < maximumSize);
    if (index >= 0) { sizes[index]++; remaining--; }
    else { sizes.push(Math.min(maximumSize, remaining)); remaining -= Math.min(maximumSize, remaining); }
  }
  return sizes.filter(Boolean);
};

type LocalComponent = { pieces:SpatialPiece[]; supports:SpatialPiece[]; bounds:Rect; nodeCount:number; corners:number; deadEnds:number };

const buildComponent = (
  defs:SpatialTerrainDef[],
  supportDefs:SpatialTerrainDef[],
  pattern:PatternEdge[],
  turns:number,
  mirror:boolean,
  runId:string,
  heights:Record<string, number>,
  nextUid:() => string,
  definitions:Map<string, SpatialTerrainDef>,
):LocalComponent | null => {
  if (!defs.length) return null;
  const usedEdges = pattern.slice(0, defs.length);
  const nodeIds = [...new Set(usedEdges.flatMap((edge) => [edge.from, edge.to]))];
  if (supportDefs.length < nodeIds.length) return null;
  // Each graph node owns one support, assigned before any geometry so a wall
  // span can be derived from the two supports that will actually bracket it.
  // Deriving the span from a single support only holds while every support is
  // square and identically sized.
  const nodeSupport = new Map(nodeIds.map((nodeId, index) => [nodeId, supportDefs[index]]));
  // A door only means anything inline in a wall run: both of its nodes must
  // carry another structural edge. On a leaf edge the far support has nothing
  // beyond it, so the door is a freestanding frame models simply walk around.
  const degree = new Map<number, number>();
  usedEdges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  });
  const inline = usedEdges.map((edge) => (degree.get(edge.from) ?? 0) >= 2 && (degree.get(edge.to) ?? 0) >= 2);
  const doorDefs = defs.filter((def) => def.kind === "door");
  const wallDefs = defs.filter((def) => def.kind !== "door");
  if (doorDefs.length > inline.filter(Boolean).length) return null;
  let doorCursor = 0;
  let wallCursor = 0;
  const ordered = usedEdges.map((_, index) => inline[index] && doorCursor < doorDefs.length ? doorDefs[doorCursor++] : wallDefs[wallCursor++]);
  const nodes = new Map<number, Point>([[usedEdges[0].from, { x:0, y:0 }]]);
  const pieces:SpatialPiece[] = [];
  // A node carrying both a horizontal and a vertical edge is a corner; a node
  // with a single edge is a dead end. Both are the interesting geometry that
  // terrain saved from the board border should be spent on.
  const orientationAtNode = new Map<number, Set<boolean>>(nodeIds.map((nodeId) => [nodeId, new Set<boolean>()]));
  for (let index = 0; index < usedEdges.length; index++) {
    const edge = usedEdges[index];
    const parent = nodes.get(edge.from);
    if (!parent) return null;
    const def = ordered[index];
    const direction = rotateDirection(edge.direction, turns, mirror);
    const horizontal = direction === "east" || direction === "west";
    const extent = (support:SpatialTerrainDef) => horizontal ? support.width : support.depth;
    // A piece that carries its own half-pillars is already measured node centre
    // to node centre, so its width IS the span. A bare panel sits between two
    // supports, so the span is the panel plus half a support at each end.
    const distance = def.bringsPillars
      ? def.width
      : extent(nodeSupport.get(edge.from)!) / 2 + def.width + extent(nodeSupport.get(edge.to)!) / 2;
    const delta = direction === "east" ? { x:distance, y:0 } : direction === "west" ? { x:-distance, y:0 } : direction === "south" ? { x:0, y:distance } : { x:0, y:-distance };
    const child = { x:parent.x + delta.x, y:parent.y + delta.y };
    nodes.set(edge.to, child);
    const forward = direction === "east" || direction === "south";
    const start = forward ? parent : child;
    // Bare panels start at the far face of their support; self-supporting pieces
    // start at the node centre, because their own half-pillar covers that end.
    const startHalf = def.bringsPillars ? 0 : extent(nodeSupport.get(forward ? edge.from : edge.to)!) / 2;
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:horizontal ? start.x + startHalf : start.x - def.depth / 2,
      y:horizontal ? start.y - def.depth / 2 : start.y + startHalf,
      rotation:horizontal ? 0 : 90,
      height:heights[def.id] ?? def.height, runId, sequenceIndex:index,
    });
    orientationAtNode.get(edge.from)!.add(horizontal);
    orientationAtNode.get(edge.to)!.add(horizontal);
  }
  // Rule 3: every network must be a shaped structure, never an isolated
  // straight row. Shrinking a rejected component can otherwise bottom out at a
  // single edge, which is exactly a lone barricade floating in open space.
  if (new Set(pieces.map((piece) => piece.rotation)).size < 2) return null;
  const componentSupports = nodeIds.map((nodeId) => {
    const point = nodes.get(nodeId)!;
    const def = nodeSupport.get(nodeId)!;
    return { uid:nextUid(), defId:def.id, x:point.x - def.width / 2, y:point.y - def.depth / 2, rotation:0 as const, height:heights[def.id] ?? def.height, runId };
  });
  const allRects = [...pieces, ...componentSupports].map((piece) => pieceRect(piece, definitions));
  const minX = Math.min(...allRects.map((rect) => rect.x));
  const minY = Math.min(...allRects.map((rect) => rect.y));
  const maxX = Math.max(...allRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...allRects.map((rect) => rect.y + rect.height));
  const corners = nodeIds.filter((nodeId) => orientationAtNode.get(nodeId)!.size === 2).length;
  const deadEnds = nodeIds.filter((nodeId) => (degree.get(nodeId) ?? 0) === 1).length;
  return { pieces, supports:componentSupports, bounds:{ x:minX, y:minY, width:maxX - minX, height:maxY - minY }, nodeCount:nodeIds.length, corners, deadEnds };
};

/** Grid resolution for reachability, in inches. A 32 mm base is ~1.26", so a
 *  quarter-inch cell resolves every gap that matters to movement. */
const REACH_CELL = .25;

/**
 * Flood the walkable space and open any pocket that walls have sealed off.
 *
 * Walls and supports are impassable, doors are passable. The largest connected
 * region is the playable board; every other region is a dead zone. For each dead
 * zone worth reclaiming, the wall separating it from the main region is replaced
 * with a same-footprint door, which is exactly the move a real board would make.
 */
const openSealedPockets = ({ placed, definitions, boardWidth, boardHeight, doors, heights, nextUid }:{
  placed:SpatialPiece[]; definitions:Map<string, SpatialTerrainDef>;
  boardWidth:number; boardHeight:number; doors:SpatialTerrainDef[];
  heights:Record<string, number>; nextUid:() => string;
}) => {
  const columns = Math.ceil(boardWidth / REACH_CELL);
  const rows = Math.ceil(boardHeight / REACH_CELL);
  const spareDoors = [...doors];

  // Cells blocked by a given set of pieces, plus which wall owns each cell so a
  // pocket's sealing walls can be found by adjacency instead of brute force.
  const blockedBy = (pieces:SpatialPiece[]) => {
    const blocked = new Uint8Array(columns * rows);
    const owner = new Array<string | null>(columns * rows).fill(null);
    pieces.forEach((piece) => {
      const def = definitions.get(piece.defId)!;
      if (def.kind === "door") return;
      const rect = pieceRect(piece, definitions);
      const fromX = Math.max(0, Math.floor(rect.x / REACH_CELL));
      const toX = Math.min(columns - 1, Math.ceil((rect.x + rect.width) / REACH_CELL) - 1);
      const fromY = Math.max(0, Math.floor(rect.y / REACH_CELL));
      const toY = Math.min(rows - 1, Math.ceil((rect.y + rect.height) / REACH_CELL) - 1);
      for (let y = fromY; y <= toY; y++) for (let x = fromX; x <= toX; x++) {
        const cell = y * columns + x;
        blocked[cell] = 1;
        if (def.kind === "wall") owner[cell] = piece.uid;
      }
    });
    return { blocked, owner };
  };

  // Label every open cell with its connected region, four-way.
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

  for (let pass = 0; pass < 4; pass++) {
    const { blocked, owner } = blockedBy(placed);
    const { label, sizes } = regionsOf(blocked);
    if (sizes.length < 2) break;
    const mainRegion = sizes.indexOf(Math.max(...sizes));
    const pockets = sizes.map((size, id) => ({ size, id })).filter(({ size, id }) => id !== mainRegion && size >= minimumPocket);
    if (!pockets.length) break;

    let openedAny = false;
    for (const pocket of pockets) {
      // Only a wall touching this pocket can be sealing it. Score each such wall
      // by how much of the main region it also touches: the wall between the two
      // is the one worth cutting a door through.
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

      // Cutting a door is the good outcome: the terrain stays and the pocket
      // becomes a room. Try every sealing wall for a door of matching footprint.
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
      // No door of the right size left — Iron in particular owns very few. Then
      // pull the sealing wall out altogether: one unplaced wall costs far less
      // than a sealed chunk of board nobody can reach or play in.
      if (!opened && sealing.length) {
        const wall = placed.find((piece) => piece.uid === sealing[0].uid);
        if (wall) { placed.splice(placed.indexOf(wall), 1); opened = true; }
      }
      openedAny = openedAny || opened;
    }
    if (!openedAny) break;
  }

  // Removing a wall can strand a support with nothing attached to it, which
  // rule 3 forbids. Drop any support that no longer touches a structural piece.
  const structuralRects = placed.filter((piece) => ["wall", "door"].includes(definitions.get(piece.defId)!.kind)).map((piece) => pieceRect(piece, definitions));
  for (let index = placed.length - 1; index >= 0; index--) {
    const def = definitions.get(placed[index].defId)!;
    if (!["pillar", "connector"].includes(def.kind)) continue;
    const rect = pieceRect(placed[index], definitions);
    if (!structuralRects.some((other) => rectsOverlap(rect, other, .12))) placed.splice(index, 1);
  }
};

export const generateSpatialLayout = (input:SpatialGeneratorInput):SpatialPiece[] => {
  const { boardWidth, boardHeight, catalogue, inventory, heights, zones, nextUid } = input;
  const definitions = new Map(input.definitions.map((def) => [def.id, def]));
  const random = randomFactory(input.seed);
  const systemDefs = input.definitions.filter((def) => def.catalogue === catalogue && (inventory[def.id] || 0) > 0);
  const expanded = (kinds:SpatialTerrainDef["kind"][]) => shuffle(systemDefs.filter((def) => kinds.includes(def.kind)).flatMap((def) => Array.from({ length:inventory[def.id] || 0 }, () => def)), random);
  const walls = expanded(["wall"]);
  const doors = expanded(["door"]);
  const supports = expanded(catalogue === "boarding" ? ["pillar"] : ["connector"]);
  const accessories = expanded(["floor", "stair"]);
  const availableStructural = walls.length + doors.length;
  if (!availableStructural) return [];

  const structuralTarget = clamp(Math.round(availableStructural * input.usage), Math.min(availableStructural, 3), availableStructural);
  const desiredDoors = walls.length >= 2 ? Math.min(doors.length, Math.max(0, Math.floor(structuralTarget / 5))) : 0;
  const selectedWalls = walls.slice(0, Math.min(walls.length, structuralTarget - desiredDoors));
  const selectedDoors = doors.slice(0, desiredDoors);
  const structuralDefs:SpatialTerrainDef[] = [];
  let wallIndex = 0;
  let doorIndex = 0;
  while (structuralDefs.length < structuralTarget && (wallIndex < selectedWalls.length || doorIndex < selectedDoors.length)) {
    const wantsDoor = structuralDefs.length % 5 === 2 && doorIndex < selectedDoors.length;
    if (wantsDoor) structuralDefs.push(selectedDoors[doorIndex++]);
    else if (wallIndex < selectedWalls.length) structuralDefs.push(selectedWalls[wallIndex++]);
    else structuralDefs.push(selectedDoors[doorIndex++]);
  }

  const maximumComponentSize = catalogue === "boarding" ? 4 : 5;
  // Every component is a tree, so it needs one support per node: edges + 1.
  // Trim the structural budget until the whole plan fits the supports actually
  // owned. Merging components instead would demand a single cluster far larger
  // than any pattern can build, which silently zeroed the trailing components.
  let structuralBudget = structuralDefs.length;
  let targets = componentTargets(structuralBudget, boardWidth, boardHeight, maximumComponentSize);
  while (structuralBudget > 0 && structuralBudget + targets.length > supports.length) {
    structuralBudget--;
    targets = componentTargets(structuralBudget, boardWidth, boardHeight, maximumComponentSize);
  }
  structuralDefs.length = structuralBudget;

  // Rule 9: the board border IS a wall. A piece may either meet it, in which
  // case the border terminates the run exactly as a wall would, or stand a full
  // lane clear of it. The sliver in between is board nobody can use or play in.
  //
  // Orientation decides which options are open. A piece running PERPENDICULAR to
  // an edge may butt against it — that is a legitimate corner or dead end
  // against the board wall. A piece running PARALLEL to an edge must always keep
  // the lane, because laying terrain along the border merely duplicates a wall
  // the board already provides and seals a strip of dead space behind it.
  // A corridor wide enough for based models to pass, per the same reasoning that
  // sets the inter-network clearance.
  const lane = input.borderStandoff ?? 2.75;
  const edgeFault = (rect:Rect, structural:boolean) => {
    // Supports and perpendicular arms may reach the border freely — that is how
    // a run legitimately terminates against it. Only a piece lying ALONGSIDE the
    // border is at fault, and only then because it walls off a dead strip.
    if (!structural) return false;
    const horizontal = rect.width > rect.height;
    // `alongX` marks the two edges that a horizontal piece lies parallel to.
    return ([
      { gap:rect.x, alongX:false },
      { gap:boardWidth - (rect.x + rect.width), alongX:false },
      { gap:rect.y, alongX:true },
      { gap:boardHeight - (rect.y + rect.height), alongX:true },
    ]).some(({ gap, alongX }) => horizontal === alongX && gap < lane - .01);
  };
  const placed:SpatialPiece[] = [];
  const placedComponents:Rect[] = [];
  const anchors = [
    { x:.5, y:.18 }, { x:.2, y:.66 }, { x:.8, y:.78 },
    { x:.82, y:.28 }, { x:.18, y:.22 }, { x:.5, y:.82 },
  ];
  const anchorRotation = input.seed % anchors.length;
  let defCursor = 0;
  let supportCursor = 0;

  const tryPlaceComponent = (edgeCount:number, componentIndex:number) => {
    if (edgeCount <= 0) return false;
    const defs = structuralDefs.slice(defCursor, defCursor + edgeCount);
    const supportDefs = supports.slice(supportCursor, supportCursor + edgeCount + 1);
    if (supportDefs.length < edgeCount + 1) return false;
    const anchor = anchors[(componentIndex + anchorRotation) % anchors.length];
    // Jitter the anchor once per component, not per attempt, so the target
    // stays a fixed point while candidates are compared against it.
    const anchorX = boardWidth * clamp(anchor.x + (random() - .5) * .18, .12, .88);
    const anchorY = boardHeight * clamp(anchor.y + (random() - .5) * .18, .12, .88);
    let accepted:{ component:LocalComponent; dx:number;dy:number } | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 180; attempt++) {
      const pattern = PATTERNS[(componentIndex + attempt) % PATTERNS.length];
      if (pattern.length < edgeCount) continue;
      // Advance rotation on a different stride to the pattern, otherwise the
      // two stay correlated and only half the shape/orientation pairs occur.
      const turns = (componentIndex + Math.floor(attempt / PATTERNS.length)) % 4;
      const component = buildComponent(defs, supportDefs, pattern, turns, (input.seed + attempt) % 2 === 0, `network-${input.seed}-${componentIndex}`, heights, nextUid, definitions);
      if (!component || component.bounds.width > boardWidth || component.bounds.height > boardHeight) continue;
      // Sampling spans the whole board, right up to the border, because meeting
      // the border is a legal placement. `edgeFault` below rejects only the
      // unusable middle ground.
      const looseX = snap(-component.bounds.x + random() * Math.max(0, boardWidth - component.bounds.width));
      const looseY = snap(-component.bounds.y + random() * Math.max(0, boardHeight - component.bounds.height));
      // A run that stops just short of the border leaves a sliver nobody can
      // enter — the gap has no play value and reads as a mistake. If an
      // extremity already reaches into the border lane, slide the component the
      // rest of the way so its end piece actually meets the edge. Anything that
      // does not reach the lane stays a full lane clear of it.
      const snapAxis = (loose:number, boundsStart:number, extent:number, boardExtent:number) => {
        const start = boundsStart + loose;
        if (start < lane) return loose - start;
        const endGap = boardExtent - (start + extent);
        if (endGap < lane) return loose + endGap;
        return loose;
      };
      const dx = snapAxis(looseX, component.bounds.x, component.bounds.width, boardWidth);
      const dy = snapAxis(looseY, component.bounds.y, component.bounds.height, boardHeight);
      const moved = [...component.pieces, ...component.supports].map((piece) => ({ ...piece, x:piece.x + dx, y:piece.y + dy }));
      const rects = moved.map((piece) => pieceRect(piece, definitions));
      if (rects.some((rect) => rect.x < -.01 || rect.y < -.01 || rect.x + rect.width > boardWidth + .01 || rect.y + rect.height > boardHeight + .01 || hitsZone(rect, zones))) continue;
      // Structural pieces come first in `moved`, then the supports.
      if (rects.some((rect, rectIndex) => edgeFault(rect, rectIndex < component.pieces.length))) continue;
      // Gallowdark walls are substantially longer than Iron modules. A 2.75"
      // hard minimum still admits 32 mm bases and a model, while the anchor
      // score naturally leaves most lanes in the 4–7" range.
      const clearance = catalogue === "boarding" ? 2.75 : 3.8;
      if (rects.some((rect) => placed.some((piece) => rectDistance(rect, pieceRect(piece, definitions)) < clearance))) continue;
      const movedBounds = { x:component.bounds.x + dx, y:component.bounds.y + dy, width:component.bounds.width, height:component.bounds.height };
      const centreX = movedBounds.x + movedBounds.width / 2;
      const centreY = movedBounds.y + movedBounds.height / 2;
      const separation = placedComponents.length ? Math.min(...placedComponents.map((other) => rectDistance(movedBounds, other))) : 8;
      const anchorDistance = Math.hypot(centreX - anchorX, centreY - anchorY);
      // Terrain no longer spent duplicating the board border is spent on shape
      // instead: corners and dead ends are what make a lane worth walking down.
      // Anchor pull stays deliberately weaker than the separation reward — at
      // its original weight it dominated every other term, pinning components
      // to a fixed table of spots and banding the board into regular stripes.
      const score = Math.min(separation, 8) * 3 + component.corners * 3 + component.deadEnds * 1.5 - anchorDistance * .55 + random();
      if (score > bestScore) { bestScore = score; accepted = { component, dx, dy }; }
    }
    if (!accepted) return false;
    const moved = [...accepted.component.pieces, ...accepted.component.supports].map((piece) => ({ ...piece, x:piece.x + accepted!.dx, y:piece.y + accepted!.dy }));
    placed.push(...moved);
    placedComponents.push({ x:accepted.component.bounds.x + accepted.dx, y:accepted.component.bounds.y + accepted.dy, width:accepted.component.bounds.width, height:accepted.component.bounds.height });
    defCursor += edgeCount;
    supportCursor += accepted.component.nodeCount;
    return true;
  };

  // A component that cannot be sited anywhere is retried smaller before its
  // pieces are abandoned, so one crowded board does not orphan four walls.
  const placeWithShrink = (requestedEdges:number, componentIndex:number) => {
    let edgeCount = Math.min(requestedEdges, structuralDefs.length - defCursor, supports.length - supportCursor - 1);
    // Two edges is the floor: a single edge can only ever be a straight row.
    while (edgeCount >= 2) {
      if (tryPlaceComponent(edgeCount, componentIndex)) return true;
      edgeCount--;
    }
    return false;
  };

  targets.forEach((requestedEdges, componentIndex) => { placeWithShrink(requestedEdges, componentIndex); });

  // Pieces left over by shrunk or rejected components get their own smaller
  // networks, so a crowded board still spends as much of the kit as it can.
  for (let componentIndex = targets.length; defCursor < structuralDefs.length && supportCursor + 1 < supports.length; componentIndex++) {
    if (!placeWithShrink(maximumComponentSize, componentIndex)) break;
  }

  // A wall that seals a pocket off from the rest of the board wastes whatever it
  // encloses: models cannot enter, so the space is not playable. Flood the open
  // space, find the pockets, and cut a door through the wall that seals each one.
  openSealedPockets({ placed, definitions, boardWidth, boardHeight, doors:doors.slice(desiredDoors), heights, nextUid });

  accessories.slice(0, Math.round(accessories.length * input.usage)).forEach((def, index) => {
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
