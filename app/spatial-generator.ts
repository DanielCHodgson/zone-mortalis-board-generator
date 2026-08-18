export type SpatialCatalogue = "boarding" | "ttcombat";

export type SpatialTerrainDef = {
  id:string; catalogue:SpatialCatalogue; width:number; depth:number; height:number;
  kind:"wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair";
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

type LocalComponent = { pieces:SpatialPiece[]; supports:SpatialPiece[]; bounds:Rect; nodeCount:number };

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
  if (!defs.length || supportDefs.length < defs.length + 1) return null;
  const nodes = new Map<number, Point>([[0, { x:0, y:0 }]]);
  const pieces:SpatialPiece[] = [];
  const usedEdges = pattern.slice(0, defs.length);
  for (let index = 0; index < usedEdges.length; index++) {
    const edge = usedEdges[index];
    const parent = nodes.get(edge.from);
    if (!parent) return null;
    const def = defs[index];
    const supportDef = supportDefs[index];
    const direction = rotateDirection(edge.direction, turns, mirror);
    const distance = supportDef.width + def.width;
    const delta = direction === "east" ? { x:distance, y:0 } : direction === "west" ? { x:-distance, y:0 } : direction === "south" ? { x:0, y:distance } : { x:0, y:-distance };
    const child = { x:parent.x + delta.x, y:parent.y + delta.y };
    nodes.set(edge.to, child);
    const horizontal = direction === "east" || direction === "west";
    const start = direction === "east" || direction === "south" ? parent : child;
    pieces.push({
      uid:nextUid(), defId:def.id,
      x:horizontal ? start.x + supportDef.width / 2 : start.x - def.depth / 2,
      y:horizontal ? start.y - def.depth / 2 : start.y + supportDef.width / 2,
      rotation:horizontal ? 0 : 90,
      height:heights[def.id] ?? def.height, runId, sequenceIndex:index,
    });
  }
  const nodeIds = [...new Set(usedEdges.flatMap((edge) => [edge.from, edge.to]))];
  const componentSupports = nodeIds.map((nodeId, index) => {
    const point = nodes.get(nodeId)!;
    const def = supportDefs[index];
    return { uid:nextUid(), defId:def.id, x:point.x - def.width / 2, y:point.y - def.depth / 2, rotation:0 as const, height:heights[def.id] ?? def.height, runId };
  });
  const allRects = [...pieces, ...componentSupports].map((piece) => pieceRect(piece, definitions));
  const minX = Math.min(...allRects.map((rect) => rect.x));
  const minY = Math.min(...allRects.map((rect) => rect.y));
  const maxX = Math.max(...allRects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...allRects.map((rect) => rect.y + rect.height));
  return { pieces, supports:componentSupports, bounds:{ x:minX, y:minY, width:maxX - minX, height:maxY - minY }, nodeCount:nodeIds.length };
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
  let targets = componentTargets(structuralDefs.length, boardWidth, boardHeight, maximumComponentSize);
  while (targets.reduce((sum, value) => sum + value, 0) + targets.length > supports.length && targets.length > 1) {
    const removed = targets.pop()!;
    targets[targets.length - 1] += removed;
  }
  const maximumEdges = Math.min(structuralDefs.length, Math.max(0, supports.length - targets.length));
  structuralDefs.length = maximumEdges;
  targets = componentTargets(maximumEdges, boardWidth, boardHeight, maximumComponentSize);

  const placed:SpatialPiece[] = [];
  const placedComponents:Rect[] = [];
  let defCursor = 0;
  let supportCursor = 0;
  targets.forEach((requestedEdges, componentIndex) => {
    const edgeCount = Math.min(requestedEdges, structuralDefs.length - defCursor, supports.length - supportCursor - 1);
    if (edgeCount <= 0) return;
    const defs = structuralDefs.slice(defCursor, defCursor + edgeCount);
    const supportDefs = supports.slice(supportCursor, supportCursor + edgeCount + 1);
    let accepted:{ component:LocalComponent; dx:number;dy:number } | null = null;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 180; attempt++) {
      const pattern = PATTERNS[(componentIndex + attempt) % PATTERNS.length];
      if (pattern.length < edgeCount) continue;
      const component = buildComponent(defs, supportDefs, pattern, (componentIndex + attempt) % 4, (input.seed + attempt) % 2 === 0, `network-${input.seed}-${componentIndex}`, heights, nextUid, definitions);
      if (!component || component.bounds.width > boardWidth - 1 || component.bounds.height > boardHeight - 1) continue;
      const margin = .35;
      const dx = snap(margin - component.bounds.x + random() * Math.max(0, boardWidth - component.bounds.width - margin * 2));
      const dy = snap(margin - component.bounds.y + random() * Math.max(0, boardHeight - component.bounds.height - margin * 2));
      const moved = [...component.pieces, ...component.supports].map((piece) => ({ ...piece, x:piece.x + dx, y:piece.y + dy }));
      const rects = moved.map((piece) => pieceRect(piece, definitions));
      if (rects.some((rect) => rect.x < 0 || rect.y < 0 || rect.x + rect.width > boardWidth || rect.y + rect.height > boardHeight || hitsZone(rect, zones))) continue;
      // Gallowdark walls are substantially longer than Iron modules. A 2.75"
      // hard minimum still admits 32 mm bases and a model, while the anchor
      // score naturally leaves most lanes in the 4–7" range.
      const clearance = catalogue === "boarding" ? 2.75 : 3.8;
      if (rects.some((rect) => placed.some((piece) => rectDistance(rect, pieceRect(piece, definitions)) < clearance))) continue;
      const movedBounds = { x:component.bounds.x + dx, y:component.bounds.y + dy, width:component.bounds.width, height:component.bounds.height };
      const centreX = movedBounds.x + movedBounds.width / 2;
      const centreY = movedBounds.y + movedBounds.height / 2;
      const edgeUse = Math.min(centreX, boardWidth - centreX, centreY, boardHeight - centreY);
      const separation = placedComponents.length ? Math.min(...placedComponents.map((other) => rectDistance(movedBounds, other))) : 8;
      const anchors = [
        { x:.5, y:.18 }, { x:.2, y:.66 }, { x:.8, y:.78 },
        { x:.82, y:.28 }, { x:.18, y:.22 }, { x:.5, y:.82 },
      ];
      const anchor = anchors[componentIndex % anchors.length];
      const anchorDistance = Math.hypot(centreX - boardWidth * anchor.x, centreY - boardHeight * anchor.y);
      const score = Math.min(separation, 8) * 3 + (edgeUse < 4 ? 5 : 0) - anchorDistance * 1.4 + random();
      if (score > bestScore) { bestScore = score; accepted = { component, dx, dy }; }
    }
    if (!accepted) return;
    const moved = [...accepted.component.pieces, ...accepted.component.supports].map((piece) => ({ ...piece, x:piece.x + accepted!.dx, y:piece.y + accepted!.dy }));
    placed.push(...moved);
    placedComponents.push({ x:accepted.component.bounds.x + accepted.dx, y:accepted.component.bounds.y + accepted.dy, width:accepted.component.bounds.width, height:accepted.component.bounds.height });
    defCursor += edgeCount;
    supportCursor += accepted.component.nodeCount;
  });

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
