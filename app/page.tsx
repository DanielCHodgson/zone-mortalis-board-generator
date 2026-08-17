"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TerrainDef = {
  id: string;
  catalogue: "boarding" | "ttcombat";
  name: string;
  shortName: string;
  width: number;
  depth: number;
  height: number;
  limit: number;
  kind: "wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair";
  visual?: "solid" | "grid" | "pipe" | "vertical-pipe" | "reinforced" | "fan" | "floor" | "stair" | "door";
  note: string;
};

type CatalogueId = TerrainDef["catalogue"];

type TerrainKit = {
  id: string;
  catalogue: CatalogueId;
  maker: string;
  name: string;
  description: string;
  source: string;
  sourceUrl: string;
  inventory: Record<string, number>;
  caveat?: string;
};

type PlacedPiece = {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rotation: 0 | 90;
  height: number;
  runId?: string;
  sequenceIndex?: number;
};

type ReservedZone = {
  uid: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ZoneCorner = "nw" | "ne" | "sw" | "se";

type GeneratorSlot = {
  x: number;
  y: number;
  rotation: 0 | 90;
  length: "long" | "short";
  door?: boolean;
};

type RunToken = "wall-long" | "door-long" | "wall-short" | "door-short";
type GeneratorRun = { x: number; y: number; rotation: 0 | 90; sequence: RunToken[] };

const BOARD_IN = 48;
const MM_PER_IN = 25.4;

const MANUFACTURERS: Record<CatalogueId, { name:string; range:string }> = {
  boarding: { name:"Games Workshop", range:"Boarding Actions" },
  ttcombat: { name:"TTCombat", range:"Iron Labyrinth" },
} as const;

// Approximate assembled footprints based on the 97 mm Gallowdark board grid
// and published physical measurements of ~170 mm / ~80 mm wall sections.
const TERRAIN: TerrainDef[] = [
  { id:"short-door-pillars-a", catalogue:"boarding", name:"Short hatchway + pillars A", shortName:"Hatch A", width:3.82, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"door", note:"97 × 28 mm" },
  { id:"short-door-pillars-b", catalogue:"boarding", name:"Short hatchway + pillars B", shortName:"Hatch B", width:3.82, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"door", note:"97 × 28 mm" },
  { id:"short-door", catalogue:"boarding", name:"Short wall with hatchway", shortName:"Short hatch", width:3.15, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"door", note:"80 × 28 mm" },
  { id:"long-door-pillars", catalogue:"boarding", name:"Long hatchway + pillars", shortName:"Long hatch +", width:7.2, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"door", note:"183 × 28 mm" },
  { id:"long-door", catalogue:"boarding", name:"Long wall with hatchway", shortName:"Long hatch", width:6.69, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"door", note:"170 × 28 mm" },
  { id:"long-wall-pillars", catalogue:"boarding", name:"Long wall + pillars", shortName:"Long wall +", width:7.2, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"wall", note:"183 × 28 mm" },
  { id:"long-wall", catalogue:"boarding", name:"Long wall", shortName:"Long wall", width:6.69, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"wall", note:"170 × 28 mm" },
  { id:"short-wall", catalogue:"boarding", name:"Short wall", shortName:"Short wall", width:3.15, depth:1.1, height:60/MM_PER_IN, limit:4, kind:"wall", note:"80 × 28 mm" },
  { id:"pillar", catalogue:"boarding", name:"Pillar", shortName:"Pillar", width:.98, depth:.98, height:60/MM_PER_IN, limit:32, kind:"pillar", note:"25 × 25 mm" },
  { id:"wall-end", catalogue:"boarding", name:"Wall end", shortName:"Wall end", width:.98, depth:.55, height:60/MM_PER_IN, limit:4, kind:"end", note:"25 × 14 mm approx." },

  { id:"tt-connector", catalogue:"ttcombat", name:"Iron Labyrinth connector block", shortName:"Connector", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:24, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-wall-end", catalogue:"ttcombat", name:"Iron Labyrinth wall end", shortName:"Wall end", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:21, kind:"end", note:"46 × 33 mm" },
  { id:"tt-solid-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid wall", shortName:"Solid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:8, kind:"wall", visual:"solid", note:"64 × 33 mm" },
  { id:"tt-grid-wall", catalogue:"ttcombat", name:"Iron Labyrinth grid wall", shortName:"Grid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"grid", note:"64 × 33 mm" },
  { id:"tt-solid-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid pipe wall", shortName:"Solid pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"pipe", note:"64 × 33 mm" },
  { id:"tt-vertical-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth vertical pipe wall", shortName:"Vertical pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"vertical-pipe", note:"64 × 33 mm" },
  { id:"tt-reinforced-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth reinforced pipe wall", shortName:"Reinforced", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"reinforced", note:"64 × 33 mm" },
  { id:"tt-fan-wall", catalogue:"ttcombat", name:"Iron Labyrinth fan wall", shortName:"Fan wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"fan", note:"64 × 33 mm" },
  { id:"tt-vertical-door", catalogue:"ttcombat", name:"Iron Labyrinth vertical door", shortName:"Vertical door", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:120/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"94 × 33 mm" },
  { id:"tt-sliding-door", catalogue:"ttcombat", name:"Iron Labyrinth sliding door", shortName:"Sliding door", width:194/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"194 × 50 mm" },
  { id:"tt-large-floor", catalogue:"ttcombat", name:"Iron Labyrinth large floor", shortName:"Large floor", width:194/MM_PER_IN, depth:194/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"floor", visual:"floor", note:"194 × 194 mm" },
  { id:"tt-small-floor", catalogue:"ttcombat", name:"Iron Labyrinth small floor", shortName:"Small floor", width:94/MM_PER_IN, depth:94/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"floor", visual:"floor", note:"94 × 94 mm" },
  { id:"tt-high-connector", catalogue:"ttcombat", name:"Iron Labyrinth high column", shortName:"High column", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:120/MM_PER_IN, limit:3, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-high-wall", catalogue:"ttcombat", name:"Iron Labyrinth high wall", shortName:"High wall", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:120/MM_PER_IN, limit:5, kind:"wall", visual:"reinforced", note:"94 × 33 mm" },
  { id:"tt-stair", catalogue:"ttcombat", name:"Iron Labyrinth stair section", shortName:"Stair section", width:94/MM_PER_IN, depth:160/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"stair", visual:"stair", note:"94 × 160 mm" },
  { id:"tt-dq-column", catalogue:"ttcombat", name:"Death Quadrant column", shortName:"DQ column", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:11, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-dq-single-wall", catalogue:"ttcombat", name:"Death Quadrant single wall", shortName:"Single wall", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", visual:"grid", note:"46 × 33 mm" },
  { id:"tt-dq-double-wall", catalogue:"ttcombat", name:"Death Quadrant double wall", shortName:"Double wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", visual:"reinforced", note:"64 × 33 mm" },
  { id:"tt-dq-single-door", catalogue:"ttcombat", name:"Death Quadrant single door", shortName:"Single door", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"46 × 33 mm · module width" },
  { id:"tt-dq-double-door", catalogue:"ttcombat", name:"Death Quadrant double door", shortName:"Double door", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"door", visual:"door", note:"64 × 33 mm · module width" },
];

const BOARDING_INVENTORY = Object.fromEntries(TERRAIN.filter((item) => item.catalogue === "boarding").map((item) => [item.id, item.limit]));

const TERRAIN_KITS: TerrainKit[] = [
  { id:"boarding-actions", catalogue:"boarding", maker:"Games Workshop", name:"Boarding Actions Terrain Set", description:"Complete Gallowdark wall and hatchway set", source:"Physical-kit measurements and assembly instructions", sourceUrl:"https://buildinstructions.com/pdf-downloads/Boarding-Actions-Terrain-Set.pdf", inventory:BOARDING_INVENTORY },
  { id:"iron-alpha", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Alpha", description:"Lattice and solid-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-alpha", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-grid-wall":2, "tt-solid-pipe-wall":2 } },
  { id:"iron-beta", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Beta", description:"Solid and reinforced wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-beta", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-solid-wall":2, "tt-reinforced-pipe-wall":2 } },
  { id:"iron-gamma", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Gamma", description:"Fan and vertical-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-gamma", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-vertical-pipe-wall":2, "tt-fan-wall":2 } },
  { id:"iron-doors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Doors", description:"Two sliding and two removable vertical doors", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-doors", inventory:{ "tt-sliding-door":2, "tt-vertical-door":2 } },
  { id:"iron-floors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Floors", description:"One large and one small elevated floor", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-floors", inventory:{ "tt-large-floor":1, "tt-small-floor":1 } },
  { id:"iron-high-walls", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth High Walls", description:"Double-height walls and columns", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-high-walls", inventory:{ "tt-high-connector":3, "tt-high-wall":5 } },
  { id:"iron-stairs", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Stairs", description:"Two connector-compatible stair sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-stairs", inventory:{ "tt-stair":2 } },
  { id:"iron-death-quadrant", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth – Death Quadrant Complex", description:"Dimensioned columns, walls, and door modules", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-death-quadrant-complex", inventory:{ "tt-dq-column":11, "tt-dq-double-wall":4, "tt-dq-single-wall":4, "tt-dq-double-door":1, "tt-dq-single-door":2 }, caveat:"Platforms, tiles, ladders, and stairs are listed by TTCombat but omitted from the scaled palette because their footprints are not published." },
  { id:"iron-ultima", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Ultima Complex", description:"24 connectors, 21 ends, and 18 wall sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-bundle", inventory:{ "tt-connector":24, "tt-wall-end":21, "tt-solid-wall":8, "tt-grid-wall":2, "tt-solid-pipe-wall":2, "tt-vertical-pipe-wall":2, "tt-reinforced-pipe-wall":2, "tt-fan-wall":2 } },
];

// Each plan is a small network of continuous structural runs. Gaps between
// runs are intentional corridors, while door tokens preserve traversal.
const RUN_LAYOUTS: GeneratorRun[][] = [
  [
    { x: 2, y: 7, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 27, y: 7, rotation: 0, sequence: ["wall-long", "door-short", "wall-long"] },
    { x: 2, y: 24, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 27, y: 24, rotation: 0, sequence: ["wall-long", "door-short", "wall-long"] },
    { x: 12, y: 29, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 36, y: 29, rotation: 90, sequence: ["wall-long", "door-short", "wall-short"] },
  ],
  [
    { x: 7, y: 2, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 24, y: 2, rotation: 90, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 41, y: 2, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 2, y: 29, rotation: 0, sequence: ["wall-short", "door-long", "wall-long"] },
    { x: 25, y: 29, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 14, y: 44, rotation: 0, sequence: ["wall-long", "door-long", "wall-long"] },
  ],
  [
    { x: 2, y: 25, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 27, y: 25, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 24, y: 1, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 14, y: 44, rotation: 0, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 12, y: 29, rotation: 90, sequence: ["wall-short", "door-long", "wall-long"] },
    { x: 36, y: 26, rotation: 90, sequence: ["wall-long", "door-short", "wall-long"] },
  ],
];

const getDef = (id: string) => TERRAIN.find((item) => item.id === id)!;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeCatalogue, setActiveCatalogue] = useState<CatalogueId>("boarding");
  const [activeKitId, setActiveKitId] = useState("boarding-actions");
  const [snap, setSnap] = useState(true);
  const [smartFit, setSmartFit] = useState(true);
  const [gridSize, setGridSize] = useState(1);
  const [theme, setTheme] = useState<"industrial" | "gothic" | "desert">("industrial");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, true])));
  const [limits, setLimits] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, BOARDING_INVENTORY[item.id] || 0])));
  const [heightDefaults, setHeightDefaults] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, item.height])));
  const [drag, setDrag] = useState<{ uids:string[]; startX:number; startY:number; origins:Record<string, {x:number;y:number}> } | null>(null);
  const [marquee, setMarquee] = useState<{ startX:number; startY:number; currentX:number; currentY:number; additive:boolean } | null>(null);
  const [copyBuffer, setCopyBuffer] = useState<{ pieces:PlacedPiece[]; pasteCount:number } | null>(null);
  const [zones, setZones] = useState<ReservedZone[]>([]);
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneName, setZoneName] = useState("Hangar");
  const [zoneDraft, setZoneDraft] = useState<{ startX:number; startY:number; currentX:number; currentY:number } | null>(null);
  const [zoneResize, setZoneResize] = useState<{ uid:string; corner:ZoneCorner; anchorX:number; anchorY:number } | null>(null);
  const [focusedZone, setFocusedZone] = useState<string | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<{ defId: string; x: number; y: number } | null>(null);
  const paletteDragRef = useRef<{ defId: string; x: number; y: number } | null>(null);
  const [message, setMessage] = useState("Ready to build");
  const uidRef = useRef(0);

  const manufacturerKits = useMemo(() => TERRAIN_KITS.filter((kit) => kit.catalogue === activeCatalogue), [activeCatalogue]);
  const activeCatalogueMeta = TERRAIN_KITS.find((kit) => kit.id === activeKitId) || TERRAIN_KITS[0];
  const catalogueTerrain = useMemo(() => TERRAIN.filter((item) => (activeCatalogueMeta.inventory[item.id] || 0) > 0), [activeCatalogueMeta]);
  const catalogueTotal = catalogueTerrain.reduce((sum, item) => sum + limits[item.id], 0);
  const selectedPiece = pieces.find((piece) => piece.uid === selected) || null;
  const used = useMemo(() => pieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]: (acc[piece.defId] || 0) + 1 }), {}), [pieces]);
  const activeKitUsed = pieces.filter((piece) => Boolean(activeCatalogueMeta.inventory[piece.defId])).length;
  const wallPieces = pieces.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
  const coverage = Math.min(100, pieces.reduce((sum, piece) => { const def = getDef(piece.defId); return sum + def.width * def.depth; }, 0) / (BOARD_IN * BOARD_IN) * 100);
  const doors = pieces.filter((piece) => getDef(piece.defId).kind === "door").length;
  const loops = Math.max(0, Math.min(6, Math.floor(wallPieces.length / 5) - 1));
  const chambers = Math.max(0, Math.min(7, Math.floor(wallPieces.length / 4)));

  const selectKit = (kitId: string) => {
    const kit = TERRAIN_KITS.find((candidate) => candidate.id === kitId);
    if (!kit) return;
    setActiveCatalogue(kit.catalogue);
    setActiveKitId(kit.id);
    setLimits(Object.fromEntries(TERRAIN.map((item) => [item.id, kit.inventory[item.id] || 0])));
    setEnabled(Object.fromEntries(TERRAIN.map((item) => [item.id, Boolean(kit.inventory[item.id])])));
    setMessage(`${kit.name} palette loaded · existing layout preserved`);
  };

  const selectManufacturer = (catalogue: CatalogueId) => {
    const firstKit = TERRAIN_KITS.find((kit) => kit.catalogue === catalogue);
    if (firstKit) selectKit(firstKit.id);
  };

  const nextUid = () => `piece-${++uidRef.current}`;
  const selectOnly = useCallback((uid: string | null) => {
    setSelected(uid);
    setSelectedIds(uid ? [uid] : []);
  }, []);
  const quantize = useCallback((value: number) => snap ? Math.round(value / gridSize) * gridSize : Math.round(value * 10) / 10, [gridSize, snap]);
  const normaliseZoneDraft = (draft: { startX:number; startY:number; currentX:number; currentY:number }) => ({
    x:Math.min(draft.startX, draft.currentX),
    y:Math.min(draft.startY, draft.currentY),
    width:Math.abs(draft.currentX - draft.startX),
    height:Math.abs(draft.currentY - draft.startY),
  });
  const pieceIntersectsReservedZone = (piece: PlacedPiece, padding = .08) => {
    const def = getDef(piece.defId);
    const width = piece.rotation === 90 ? def.depth : def.width;
    const height = piece.rotation === 90 ? def.width : def.depth;
    return zones.some((zone) => piece.x < zone.x + zone.width + padding && piece.x + width > zone.x - padding && piece.y < zone.y + zone.height + padding && piece.y + height > zone.y - padding);
  };
  const reservedCoverage = zones.reduce((sum, zone) => sum + zone.width * zone.height, 0) / (BOARD_IN * BOARD_IN) * 100;
  const pieceRect = (piece: PlacedPiece) => {
    const def = getDef(piece.defId);
    return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
  };
  const pieceCentre = (piece: PlacedPiece) => { const rect = pieceRect(piece); return { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2 }; };
  const structuralEndpoints = (piece: PlacedPiece) => {
    const def = getDef(piece.defId);
    const centre = def.depth / 2;
    return piece.rotation === 0
      ? [{ x:piece.x, y:piece.y + centre }, { x:piece.x + def.width, y:piece.y + centre }]
      : [{ x:piece.x + centre, y:piece.y }, { x:piece.x + centre, y:piece.y + def.width }];
  };
  const endAttachmentPoints = (piece: PlacedPiece) => {
    const rect = pieceRect(piece);
    return piece.rotation === 90
      ? [{ x:rect.x, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width, y:rect.y + rect.height / 2 }]
      : [{ x:rect.x + rect.width / 2, y:rect.y }, { x:rect.x + rect.width / 2, y:rect.y + rect.height }];
  };
  const connectorFaces = (piece: PlacedPiece) => { const rect = pieceRect(piece); return [{ x:rect.x, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width / 2, y:rect.y }, { x:rect.x + rect.width / 2, y:rect.y + rect.height }]; };
  const connectionCandidates = (moving: PlacedPiece, fixed: PlacedPiece) => {
    const movingDef = getDef(moving.defId);
    const fixedDef = getDef(fixed.defId);
    if (movingDef.catalogue !== fixedDef.catalogue) return [] as Array<{ dx:number;dy:number;rotation?:0|90 }>;
    const movingStructural = ["wall", "door"].includes(movingDef.kind);
    const fixedStructural = ["wall", "door"].includes(fixedDef.kind);
    let movingPoints: Array<{x:number;y:number}> = [];
    let fixedPoints: Array<{x:number;y:number}> = [];
    let rotation: 0 | 90 | undefined;
    if (movingDef.catalogue === "boarding") {
      if (movingStructural && fixedStructural) { movingPoints = structuralEndpoints(moving); fixedPoints = structuralEndpoints(fixed); }
      else if (movingStructural && fixedDef.kind === "pillar") { movingPoints = structuralEndpoints(moving); fixedPoints = [pieceCentre(fixed)]; }
      else if (movingDef.kind === "pillar" && fixedStructural) { movingPoints = [pieceCentre(moving)]; fixedPoints = structuralEndpoints(fixed); }
      else if (movingDef.kind === "end" && fixedStructural) {
        rotation = fixed.rotation === 0 ? 90 : 0;
        movingPoints = endAttachmentPoints({ ...moving, rotation });
        fixedPoints = structuralEndpoints(fixed);
      }
      else if (movingStructural && fixedDef.kind === "end") { movingPoints = structuralEndpoints(moving); fixedPoints = endAttachmentPoints(fixed); }
    } else {
      if (movingStructural && fixedDef.kind === "connector") { movingPoints = structuralEndpoints(moving); fixedPoints = connectorFaces(fixed); }
      else if (movingDef.kind === "connector" && fixedStructural) { movingPoints = connectorFaces(moving); fixedPoints = structuralEndpoints(fixed); }
      else if (movingDef.kind === "end" && fixedDef.kind === "connector") {
        return connectorFaces(fixed).flatMap((fixedPoint, faceIndex) => {
          const nextRotation: 0 | 90 = faceIndex < 2 ? 0 : 90;
          return structuralEndpoints({ ...moving, rotation:nextRotation }).map((movingPoint) => ({ dx:fixedPoint.x - movingPoint.x, dy:fixedPoint.y - movingPoint.y, rotation:nextRotation }));
        });
      }
      else if (movingDef.kind === "connector" && fixedDef.kind === "end") { movingPoints = connectorFaces(moving); fixedPoints = structuralEndpoints(fixed); }
    }
    return movingPoints.flatMap((movingPoint) => fixedPoints.map((fixedPoint) => ({ dx:fixedPoint.x - movingPoint.x, dy:fixedPoint.y - movingPoint.y, rotation })));
  };
  const piecesOverlap = (first: PlacedPiece, second: PlacedPiece, padding = .06) => {
    const a = pieceRect(first);
    const b = pieceRect(second);
    return a.x < b.x + b.width + padding && a.x + a.width > b.x - padding && a.y < b.y + b.height + padding && a.y + a.height > b.y - padding;
  };

  const finalizeGeneratedLayout = (basePieces: PlacedPiece[]) => {
    const counts: Record<string, number> = {};
    const framePieces: PlacedPiece[] = [];
    const frameJointPoints: Array<{ x:number; y:number }> = [];
    const supportKinds = new Set(["pillar", "connector"]);
    const frameWalls = catalogueTerrain.filter((def) => def.kind === "wall" && enabled[def.id] && limits[def.id] > 0);
    const frameDoors = catalogueTerrain.filter((def) => def.kind === "door" && enabled[def.id] && limits[def.id] > 0);
    const frameSupport = catalogueTerrain.find((def) => supportKinds.has(def.kind) && enabled[def.id] && limits[def.id] > 0);
    const moduleGap = activeCatalogue === "ttcombat" ? frameSupport?.width || 0 : 0;
    const frameClearanceDepth = Math.max(...frameWalls.map((def) => def.depth), activeCatalogue === "ttcombat" ? frameSupport?.depth || 0 : 0);

    const takeDefinition = (kind: "wall" | "door", maximumWidth: number, preferLongest = true) => {
      const source = kind === "wall" ? frameWalls : frameDoors;
      const candidates = source.filter((def) => def.width <= maximumWidth + .01 && (counts[def.id] || 0) < limits[def.id]).sort((a, b) => preferLongest ? b.width - a.width : a.width - b.width);
      const chosen = candidates[0];
      if (chosen) counts[chosen.id] = (counts[chosen.id] || 0) + 1;
      return chosen;
    };

    const buildModules = (span: number) => {
      const modules: TerrainDef[] = [];
      const framedDoorOptions = frameDoors.flatMap((door) => frameWalls.flatMap((firstWall) => frameWalls.map((secondWall) => ({ door, firstWall, secondWall, total:firstWall.width + door.width + secondWall.width })))).filter((option) => {
        if (option.total > span + .01) return false;
        const required = [option.door, option.firstWall, option.secondWall].reduce<Record<string, number>>((acc, def) => ({ ...acc, [def.id]:(acc[def.id] || 0) + 1 }), {});
        return Object.entries(required).every(([defId, quantity]) => (counts[defId] || 0) + quantity <= limits[defId]);
      }).sort((a, b) => b.total - a.total);
      const framedDoor = framedDoorOptions[0];
      if (framedDoor) {
        modules.push(framedDoor.firstWall, framedDoor.door, framedDoor.secondWall);
        modules.forEach((def) => { counts[def.id] = (counts[def.id] || 0) + 1; });
      }
      if (!modules.length) {
        const firstWall = takeDefinition("wall", span, true);
        if (firstWall) modules.push(firstWall);
      }
      let usedWidth = modules.reduce((sum, def) => sum + def.width, 0);
      while (modules.length < 6) {
        const nextGap = modules.length ? moduleGap : 0;
        const wall = takeDefinition("wall", span - usedWidth - nextGap, true);
        if (!wall) break;
        modules.push(wall);
        usedWidth += nextGap + wall.width;
      }
      return modules;
    };

    const placeSide = (zone: ReservedZone, side: "top" | "bottom" | "left" | "right") => {
      const horizontal = side === "top" || side === "bottom";
      const span = horizontal ? zone.width : zone.height;
      if (span < Math.min(...frameWalls.map((def) => def.width), BOARD_IN)) return;
      const hasOutsideRoom = side === "top" ? zone.y >= frameClearanceDepth + .15 : side === "bottom" ? zone.y + zone.height + frameClearanceDepth + .15 <= BOARD_IN : side === "left" ? zone.x >= frameClearanceDepth + .15 : zone.x + zone.width + frameClearanceDepth + .15 <= BOARD_IN;
      if (!hasOutsideRoom) return;
      const modules = buildModules(span);
      if (!modules.length) return;
      const totalLength = modules.reduce((sum, def) => sum + def.width, 0) + Math.max(0, modules.length - 1) * moduleGap;
      const frameDepth = Math.max(...modules.map((def) => def.depth), activeCatalogue === "ttcombat" ? frameSupport?.depth || 0 : 0);
      let cursor = (horizontal ? zone.x : zone.y) + (span - totalLength) / 2;
      const jointPoints: Array<{ x:number; y:number }> = [];
      const candidates = modules.map((def, index) => {
        const rotation: 0 | 90 = horizontal ? 0 : 90;
        const lineX = side === "left" ? zone.x - frameDepth - .12 : zone.x + zone.width + .12;
        const lineY = side === "top" ? zone.y - frameDepth - .12 : zone.y + zone.height + .12;
        const x = horizontal ? cursor : lineX + (frameDepth - def.depth) / 2;
        const y = horizontal ? lineY + (frameDepth - def.depth) / 2 : cursor;
        const piece = { uid:nextUid(), defId:def.id, x, y, rotation, height:heightDefaults[def.id] };
        cursor += def.width + (index < modules.length - 1 ? moduleGap : 0);
        return piece;
      });
      const accepted = candidates.every((piece) => !pieceIntersectsReservedZone(piece) && !framePieces.some((existing) => piecesOverlap(existing, piece, .02)));
      if (!accepted) return;
      framePieces.push(...candidates);
      candidates.forEach((piece) => {
        const def = getDef(piece.defId);
        const centre = def.depth / 2;
        if (activeCatalogue === "ttcombat") {
          jointPoints.push(horizontal ? { x:piece.x - moduleGap / 2, y:piece.y + centre } : { x:piece.x + centre, y:piece.y - moduleGap / 2 });
          jointPoints.push(horizontal ? { x:piece.x + def.width + moduleGap / 2, y:piece.y + centre } : { x:piece.x + centre, y:piece.y + def.width + moduleGap / 2 });
        } else {
          jointPoints.push(horizontal ? { x:piece.x, y:piece.y + centre } : { x:piece.x + centre, y:piece.y });
          jointPoints.push(horizontal ? { x:piece.x + def.width, y:piece.y + centre } : { x:piece.x + centre, y:piece.y + def.width });
        }
      });
      frameJointPoints.push(...jointPoints);
    };

    if (zones.length && frameWalls.length) zones.forEach((zone) => (["top","bottom","left","right"] as const).forEach((side) => placeSide(zone, side)));

    const structuralBase = basePieces.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
    const supportBase = basePieces.filter((piece) => supportKinds.has(getDef(piece.defId).kind));
    const endBase = basePieces.filter((piece) => getDef(piece.defId).kind === "end");
    const result = [...framePieces];
    const structuralEndpointsFor = (piece: PlacedPiece) => {
      const def = getDef(piece.defId);
      const centre = def.depth / 2;
      return piece.rotation === 0
        ? [{ x:piece.x, y:piece.y + centre }, { x:piece.x + def.width, y:piece.y + centre }]
        : [{ x:piece.x + centre, y:piece.y }, { x:piece.x + centre, y:piece.y + def.width }];
    };
    const piecesShareEndpoint = (first: PlacedPiece, second: PlacedPiece) => structuralEndpointsFor(first).some((firstPoint) => structuralEndpointsFor(second).some((secondPoint) => Math.abs(firstPoint.x - secondPoint.x) < .15 && Math.abs(firstPoint.y - secondPoint.y) < .15));
    const clearanceBetween = (first: PlacedPiece, second: PlacedPiece) => {
      const a = pieceRect(first);
      const b = pieceRect(second);
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
      return Math.hypot(gapX, gapY);
    };
    const structuralGroups = new Map<string, PlacedPiece[]>();
    structuralBase.forEach((piece) => {
      const key = activeCatalogue === "boarding" ? piece.runId || piece.uid : piece.uid;
      structuralGroups.set(key, [...(structuralGroups.get(key) || []), piece]);
    });
    structuralGroups.forEach((unsortedGroup) => {
      const group = [...unsortedGroup].sort((a, b) => (a.sequenceIndex || 0) - (b.sequenceIndex || 0));
      const doorsAreInternal = group.filter((piece) => getDef(piece.defId).kind === "door").every((door) => structuralEndpointsFor(door).every((endpoint) => group.some((candidate) => {
        if (getDef(candidate.defId).kind !== "wall" || candidate.rotation !== door.rotation) return false;
        return structuralEndpointsFor(candidate).some((wallEndpoint) => Math.abs(wallEndpoint.x - endpoint.x) < .12 && Math.abs(wallEndpoint.y - endpoint.y) < .12);
      })));
      const groupCounts = group.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]:(acc[piece.defId] || 0) + 1 }), {});
      const inventoryAvailable = Object.entries(groupCounts).every(([defId, quantity]) => enabled[defId] && (counts[defId] || 0) + quantity <= limits[defId]);
      const existingStructures = result.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
      const connectedExistingRuns = new Set(existingStructures.filter((existing) => group.some((piece) => piecesShareEndpoint(existing, piece))).map((piece) => piece.runId || piece.uid));
      const overlapsExisting = group.some((piece) => existingStructures.some((existing) => piecesOverlap(existing, piece, -.03) && !piecesShareEndpoint(existing, piece)));
      const createsNearMiss = group.some((piece) => existingStructures.some((existing) => !connectedExistingRuns.has(existing.runId || existing.uid) && !piecesShareEndpoint(existing, piece) && clearanceBetween(existing, piece) < 3));
      const overlapsItself = group.some((piece, index) => group.some((other, otherIndex) => otherIndex > index && piecesOverlap(piece, other, -.03)));
      if (!doorsAreInternal || !inventoryAvailable || overlapsExisting || overlapsItself || createsNearMiss) return;
      Object.entries(groupCounts).forEach(([defId, quantity]) => { counts[defId] = (counts[defId] || 0) + quantity; });
      result.push(...group);
    });

    const endpointRecords = result.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind)).flatMap((piece) => {
      const def = getDef(piece.defId);
      const centre = def.depth / 2;
      return piece.rotation === 0
        ? [{ piece, atStart:true, x:piece.x, y:piece.y + centre }, { piece, atStart:false, x:piece.x + def.width, y:piece.y + centre }]
        : [{ piece, atStart:true, x:piece.x + centre, y:piece.y }, { piece, atStart:false, x:piece.x + centre, y:piece.y + def.width }];
    });
    const pointTouchesPiece = (point: { x:number; y:number }, piece: PlacedPiece, tolerance = .08) => {
      const rect = pieceRect(piece);
      return point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
    };
    const endpointIsShared = (point: typeof endpointRecords[number], index: number) => endpointRecords.some((candidate, candidateIndex) => candidateIndex !== index && candidate.piece.uid !== point.piece.uid && Math.abs(candidate.x - point.x) < .2 && Math.abs(candidate.y - point.y) < .2);
    const cappedPoints: Array<{ x:number; y:number }> = [];
    if (activeCatalogue === "boarding") {
      const endDef = catalogueTerrain.find((def) => def.kind === "end" && enabled[def.id] && limits[def.id] > 0);
      endpointRecords.forEach((point, index) => {
        if (!endDef || (counts[endDef.id] || 0) >= limits[endDef.id] || getDef(point.piece.defId).kind !== "wall" || endpointIsShared(point, index)) return;
        const rotation: 0 | 90 = point.piece.rotation === 0 ? 90 : 0;
        const width = rotation === 0 ? endDef.width : endDef.depth;
        const height = rotation === 0 ? endDef.depth : endDef.width;
        const x = point.piece.rotation === 0 ? point.x + (point.atStart ? -width : 0) : point.x - width / 2;
        const y = point.piece.rotation === 0 ? point.y - height / 2 : point.y + (point.atStart ? -height : 0);
        if (x < 0 || y < 0 || x + width > BOARD_IN || y + height > BOARD_IN) return;
        const cap = { uid:nextUid(), defId:endDef.id, x, y, rotation, height:heightDefaults[endDef.id] };
        const hitsAnotherStructure = result.some((piece) => piece.uid !== point.piece.uid && ["wall", "door"].includes(getDef(piece.defId).kind) && piecesOverlap(piece, cap, -.02));
        if (pieceIntersectsReservedZone(cap) || hitsAnotherStructure) return;
        counts[endDef.id] = (counts[endDef.id] || 0) + 1;
        result.push(cap);
        cappedPoints.push({ x:point.x, y:point.y });
      });
    }

    const supportDef = catalogueTerrain.find((def) => supportKinds.has(def.kind) && enabled[def.id] && limits[def.id] > 0);
    if (supportDef) {
      const doorPoints = endpointRecords.filter((point) => getDef(point.piece.defId).kind === "door");
      const uncappedPoints = endpointRecords.filter((point) => !cappedPoints.some((capped) => Math.abs(capped.x - point.x) < .2 && Math.abs(capped.y - point.y) < .2));
      const requiredPoints: Array<{ x:number; y:number }> = activeCatalogue === "boarding" ? [...doorPoints, ...uncappedPoints] : [...frameJointPoints];
      const uniquePoints = requiredPoints.filter((point, index, points) => points.findIndex((candidate) => Math.abs(candidate.x - point.x) < .2 && Math.abs(candidate.y - point.y) < .2) === index);
      uniquePoints.forEach((point) => {
        if ((counts[supportDef.id] || 0) >= limits[supportDef.id]) return;
        const support = { uid:nextUid(), defId:supportDef.id, x:clamp(point.x - supportDef.width / 2, 0, BOARD_IN - supportDef.width), y:clamp(point.y - supportDef.depth / 2, 0, BOARD_IN - supportDef.depth), rotation:0 as const, height:heightDefaults[supportDef.id] };
        if (pieceIntersectsReservedZone(support)) return;
        counts[supportDef.id] = (counts[supportDef.id] || 0) + 1;
        result.push(support);
      });
    }

    supportBase.forEach((piece) => {
      if (activeCatalogue !== "ttcombat") return;
      if ((counts[piece.defId] || 0) >= limits[piece.defId] || pieceIntersectsReservedZone(piece)) return;
      if (!endpointRecords.some((point) => pointTouchesPiece(point, piece))) return;
      if (result.some((existing) => supportKinds.has(getDef(existing.defId).kind) && Math.abs(existing.x - piece.x) < .25 && Math.abs(existing.y - piece.y) < .25)) return;
      counts[piece.defId] = (counts[piece.defId] || 0) + 1;
      result.push(piece);
    });
    if (activeCatalogue === "ttcombat") {
      const validSupports = result.filter((piece) => supportKinds.has(getDef(piece.defId).kind));
      endBase.forEach((piece) => {
        if ((counts[piece.defId] || 0) >= limits[piece.defId] || pieceIntersectsReservedZone(piece) || !validSupports.some((support) => piecesOverlap(support, piece, .03))) return;
        counts[piece.defId] = (counts[piece.defId] || 0) + 1;
        result.push(piece);
      });
    }
    return result;
  };

  const familyFor = (def: TerrainDef) => (["wall", "door", "floor", "stair"].includes(def.kind) ? "wall" : ["pillar", "connector"].includes(def.kind) ? "support" : "end");
  const familyHeightMm = (family: "wall" | "support" | "end") => {
    const matching = catalogueTerrain.filter((def) => familyFor(def) === family);
    return Math.round((heightDefaults[matching[0]?.id] || 0) * MM_PER_IN);
  };
  const familyIsAvailable = (family: "wall" | "support" | "end") => catalogueTerrain.some((def) => familyFor(def) === family);
  const setFamilyHeightMm = (family: "wall" | "support" | "end", millimetres: number) => {
    const nextHeight = clamp(millimetres, 10, 300) / MM_PER_IN;
    const matchingIds = new Set(catalogueTerrain.filter((def) => familyFor(def) === family).map((def) => def.id));
    setHeightDefaults((current) => ({ ...current, ...Object.fromEntries([...matchingIds].map((id) => [id, nextHeight])) }));
    setPieces((current) => current.map((piece) => matchingIds.has(piece.defId) ? { ...piece, height:nextHeight } : piece));
    setMessage(`${activeCatalogueMeta.name} ${family === "wall" ? "wall" : family} height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  const setSelectedHeightMm = (millimetres: number) => {
    if (!selectedIds.length) return;
    const nextHeight = clamp(millimetres, 10, 300) / MM_PER_IN;
    setPieces((current) => current.map((piece) => selectedIds.includes(piece.uid) ? { ...piece, height:nextHeight } : piece));
    setMessage(`${selectedIds.length === 1 ? "Selected piece" : `${selectedIds.length} selected pieces`} height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  const addPiece = useCallback((defId: string, x = 24, y = 24, rotation: 0 | 90 = 0) => {
    const def = getDef(defId);
    const current = pieces.filter((piece) => piece.defId === defId).length;
    if (!enabled[defId] || current >= limits[defId]) { setMessage("No more of that piece available"); return; }
    const w = rotation === 90 ? def.depth : def.width;
    const h = rotation === 90 ? def.width : def.depth;
    const piece = { uid: nextUid(), defId, x: quantize(clamp(x - w / 2, 0, BOARD_IN - w)), y: quantize(clamp(y - h / 2, 0, BOARD_IN - h)), rotation, height:heightDefaults[defId] };
    setPieces((currentPieces) => [...currentPieces, piece]);
    selectOnly(piece.uid);
    setMessage(`${def.shortName} placed`);
  }, [enabled, heightDefaults, limits, pieces, quantize, selectOnly]);

  const rotatePiece = useCallback((uid: string) => {
    setPieces((current) => current.map((piece) => {
      if (piece.uid !== uid) return piece;
      const def = getDef(piece.defId);
      const rotation = piece.rotation === 0 ? 90 : 0;
      const w = rotation === 90 ? def.depth : def.width;
      const h = rotation === 90 ? def.width : def.depth;
      return { ...piece, rotation, x: quantize(clamp(piece.x, 0, BOARD_IN - w)), y: quantize(clamp(piece.y, 0, BOARD_IN - h)) };
    }));
    setMessage("Piece rotated 90°");
  }, [quantize, setMessage]);

  const rotateSelected = useCallback(() => {
    if (!selectedIds.length) return;
    selectedIds.forEach((uid) => rotatePiece(uid));
    setMessage(`${selectedIds.length === 1 ? "Piece" : `${selectedIds.length} pieces`} rotated 90°`);
  }, [rotatePiece, selectedIds, setMessage]);

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    setPieces((current) => current.filter((piece) => !selectedIds.includes(piece.uid)));
    selectOnly(null);
    setMessage(`${selectedIds.length} piece${selectedIds.length === 1 ? "" : "s"} returned to inventory`);
  }, [selectOnly, selectedIds, setMessage]);

  const duplicateSelected = useCallback(() => {
    const sources = pieces.filter((piece) => selectedIds.includes(piece.uid));
    if (!sources.length) return;
    const required = sources.reduce<Record<string, number>>((counts, piece) => ({ ...counts, [piece.defId]:(counts[piece.defId] || 0) + 1 }), {});
    const unavailable = Object.entries(required).find(([defId, count]) => pieces.filter((piece) => piece.defId === defId).length + count > (limits[defId] || 0));
    if (unavailable) { setMessage(`Not enough ${getDef(unavailable[0]).shortName} pieces available to duplicate the selection`); return; }
    const offset = snap ? gridSize : 1;
    const minX = Math.min(...sources.map((piece) => piece.x));
    const minY = Math.min(...sources.map((piece) => piece.y));
    const maxX = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.x + rect.width; }));
    const maxY = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.y + rect.height; }));
    const deltaX = clamp(offset, -minX, BOARD_IN - maxX);
    const deltaY = clamp(offset, -minY, BOARD_IN - maxY);
    const duplicates = sources.map((source) => ({ ...source, uid:nextUid(), x:quantize(source.x + deltaX), y:quantize(source.y + deltaY), runId:undefined, sequenceIndex:undefined }));
    setPieces((current) => [...current, ...duplicates]);
    setSelectedIds(duplicates.map((piece) => piece.uid));
    setSelected(duplicates[0].uid);
    setMessage(`${duplicates.length} piece${duplicates.length === 1 ? "" : "s"} duplicated`);
  }, [gridSize, limits, pieces, quantize, selectedIds, snap]);

  const copySelected = useCallback(() => {
    const sources = pieces.filter((piece) => selectedIds.includes(piece.uid));
    if (!sources.length) return;
    setCopyBuffer({ pieces:sources.map((piece) => ({ ...piece })), pasteCount:0 });
    setMessage(`${sources.length} piece${sources.length === 1 ? "" : "s"} copied · paste with Ctrl V`);
  }, [pieces, selectedIds, setMessage]);

  const pasteCopied = useCallback(() => {
    if (!copyBuffer?.pieces.length) return;
    const required = copyBuffer.pieces.reduce<Record<string, number>>((counts, piece) => ({ ...counts, [piece.defId]:(counts[piece.defId] || 0) + 1 }), {});
    const unavailable = Object.entries(required).find(([defId, count]) => pieces.filter((piece) => piece.defId === defId).length + count > (limits[defId] || 0));
    if (unavailable) { setMessage(`Not enough ${getDef(unavailable[0]).shortName} pieces available to paste the group`); return; }
    const step = (copyBuffer.pasteCount + 1) * (snap ? gridSize : 1);
    const minX = Math.min(...copyBuffer.pieces.map((piece) => piece.x));
    const minY = Math.min(...copyBuffer.pieces.map((piece) => piece.y));
    const maxX = Math.max(...copyBuffer.pieces.map((piece) => { const rect = pieceRect(piece); return rect.x + rect.width; }));
    const maxY = Math.max(...copyBuffer.pieces.map((piece) => { const rect = pieceRect(piece); return rect.y + rect.height; }));
    const deltaX = clamp(step, -minX, BOARD_IN - maxX);
    const deltaY = clamp(step, -minY, BOARD_IN - maxY);
    const pasted = copyBuffer.pieces.map((source) => ({ ...source, uid:nextUid(), x:quantize(source.x + deltaX), y:quantize(source.y + deltaY), runId:undefined, sequenceIndex:undefined }));
    setPieces((current) => [...current, ...pasted]);
    setCopyBuffer((current) => current ? { ...current, pasteCount:current.pasteCount + 1 } : current);
    setSelectedIds(pasted.map((piece) => piece.uid));
    setSelected(pasted[0].uid);
    setMessage(`${pasted.length} piece${pasted.length === 1 ? "" : "s"} pasted`);
  }, [copyBuffer, gridSize, limits, pieces, quantize, snap]);

  const moveSelected = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedIds.length) return;
    const sources = pieces.filter((piece) => selectedIds.includes(piece.uid));
    const minX = Math.min(...sources.map((piece) => piece.x));
    const minY = Math.min(...sources.map((piece) => piece.y));
    const maxX = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.x + rect.width; }));
    const maxY = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.y + rect.height; }));
    const requestedX = deltaX * gridSize;
    const requestedY = deltaY * gridSize;
    const allowedX = clamp(requestedX, -minX, BOARD_IN - maxX);
    const allowedY = clamp(requestedY, -minY, BOARD_IN - maxY);
    setPieces((current) => current.map((piece) => {
      if (!selectedIds.includes(piece.uid)) return piece;
      return { ...piece, x:Math.round((piece.x + allowedX) * 100) / 100, y:Math.round((piece.y + allowedY) * 100) / 100 };
    }));
    setMessage(`${selectedIds.length === 1 ? "Piece" : `${selectedIds.length} pieces`} moved ${gridSize}″`);
  }, [gridSize, pieces, selectedIds]);

  const clearTerrain = useCallback(() => {
    setPieces([]);
    selectOnly(null);
    setMessage("Terrain cleared · reserved zones preserved");
  }, [selectOnly, setMessage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, select, textarea, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelected(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { event.preventDefault(); pasteCopied(); return; }
      if (event.key.toLowerCase() === "r") rotateSelected();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateSelected(); }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      if (event.key === "Escape") { selectOnly(null); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMarquee(null); setZoneMode(false); }
      const direction = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[event.key] as [number, number] | undefined;
      if (direction && selectedIds.length) { event.preventDefault(); moveSelected(direction[0], direction[1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelected, deleteSelected, duplicateSelected, moveSelected, pasteCopied, rotateSelected, selectOnly, selectedIds]);

  const chooseDefinition = (slot: GeneratorSlot, pool: Record<string, number>) => {
    const hasEnabledDoors = TERRAIN.some((def) => def.catalogue === activeCatalogue && def.kind === "door" && enabled[def.id] && limits[def.id] > 0);
    const candidates = TERRAIN.filter((def) => {
      if (def.catalogue !== activeCatalogue) return false;
      if (!enabled[def.id] || (pool[def.id] || 0) >= limits[def.id]) return false;
      if (slot.door && hasEnabledDoors && def.kind !== "door") return false;
      if (slot.door && !hasEnabledDoors && def.kind !== "wall") return false;
      if (!slot.door && def.kind !== "wall") return false;
      if (activeCatalogue === "ttcombat") return true;
      return slot.length === "long" ? def.width > 5 : def.width <= 5;
    });
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (chosen) pool[chosen.id] = (pool[chosen.id] || 0) + 1;
    return chosen;
  };

  const generateIronLabyrinth = () => {
    type Direction = "right" | "down" | "left" | "up";
    type NetworkNode = { piece:PlacedPiece; links:Direction[]; network:number };
    const directions: Direction[] = ["right", "down", "left", "up"];
    const opposite: Record<Direction, Direction> = { right:"left", left:"right", up:"down", down:"up" };
    const shuffle = <T,>(values: T[]) => [...values].sort(() => Math.random() - .5);
    const structuralPool = catalogueTerrain.filter((def) => ["wall", "door"].includes(def.kind) && enabled[def.id] && limits[def.id] > 0).flatMap((def) => Array.from({ length:limits[def.id] }, () => def));
    const accessoryPool = catalogueTerrain.filter((def) => ["floor", "stair"].includes(def.kind) && enabled[def.id] && limits[def.id] > 0).flatMap((def) => Array.from({ length:limits[def.id] }, () => def));
    const connectorDef = catalogueTerrain.find((def) => def.kind === "connector" && enabled[def.id] && limits[def.id] > 0);
    const endDef = catalogueTerrain.find((def) => def.kind === "end" && enabled[def.id] && limits[def.id] > 0);
    const clearance = (first: PlacedPiece, second: PlacedPiece) => {
      const a = pieceRect(first);
      const b = pieceRect(second);
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
      return Math.hypot(gapX, gapY);
    };
    const insideBoard = (piece: PlacedPiece) => {
      const rect = pieceRect(piece);
      return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= BOARD_IN && rect.y + rect.height <= BOARD_IN;
    };

    const placeStandaloneSet = (attempt: number) => {
      const modules = shuffle([...structuralPool, ...accessoryPool]);
      const templates = [
        [{x:5,y:11,r:0},{x:29,y:11,r:0},{x:11,y:31,r:90},{x:33,y:31,r:90}],
        [{x:7,y:8,r:90},{x:25,y:8,r:90},{x:7,y:31,r:90},{x:25,y:31,r:90}],
        [{x:4,y:14,r:0},{x:27,y:14,r:0},{x:14,y:34,r:0},{x:30,y:34,r:0}],
      ] as Array<Array<{x:number;y:number;r:0|90}>>;
      const template = templates[attempt % templates.length];
      const quarterTurns = Math.floor(attempt / templates.length) % 4;
      const generated: PlacedPiece[] = [];
      modules.forEach((def, index) => {
        const slot = template[index % template.length];
        let x = slot.x + (index >= template.length ? (index % 2) * 5 : 0);
        let y = slot.y + (index >= template.length ? Math.floor(index / 2) * 3 : 0);
        let rotation = slot.r;
        for (let turn = 0; turn < quarterTurns; turn++) {
          const h = rotation === 90 ? def.width : def.depth;
          [x, y, rotation] = [BOARD_IN - y - h, x, rotation === 0 ? 90 : 0];
        }
        const piece: PlacedPiece = { uid:`tt-standalone-${attempt}-${index}`, defId:def.id, x, y, rotation, height:heightDefaults[def.id], runId:`tt-standalone-${attempt}`, sequenceIndex:index };
        if (!insideBoard(piece) || pieceIntersectsReservedZone(piece) || generated.some((existing) => piecesOverlap(existing, piece, .08) || clearance(existing, piece) < 3)) return;
        generated.push(piece);
      });
      const bounds = generated.reduce((acc, piece) => { const rect = pieceRect(piece); return { minX:Math.min(acc.minX, rect.x), minY:Math.min(acc.minY, rect.y), maxX:Math.max(acc.maxX, rect.x + rect.width), maxY:Math.max(acc.maxY, rect.y + rect.height) }; }, { minX:BOARD_IN, minY:BOARD_IN, maxX:0, maxY:0 });
      return { generated, score:generated.length * 30 + (bounds.maxX - bounds.minX) + (bounds.maxY - bounds.minY) + Math.random() * 8 };
    };

    const buildNetwork = (attempt: number) => {
      if (!connectorDef || !structuralPool.length) return placeStandaloneSet(attempt);
      const generated: PlacedPiece[] = [];
      const nodes: NetworkNode[] = [];
      const connectorLimit = limits[connectorDef.id];
      const connectorWidth = connectorDef.width;
      const connectorDepth = connectorDef.depth;
      const connectorSlack = connectorLimit - structuralPool.length;
      const networkCount = structuralPool.length >= 12 && connectorSlack >= 3 ? 3 : structuralPool.length >= 8 && connectorSlack >= 2 ? 2 : 1;
      const anchorSets = [
        [{x:6,y:7},{x:31,y:9},{x:16,y:31}],
        [{x:8,y:12},{x:32,y:6},{x:31,y:32}],
        [{x:5,y:29},{x:21,y:6},{x:34,y:25}],
        [{x:10,y:5},{x:33,y:16},{x:9,y:34}],
      ];
      const anchors = anchorSets[attempt % anchorSets.length];
      for (let network = 0; network < networkCount; network++) {
        const seedZone = zones.length && network === 0 ? zones[attempt % zones.length] : null;
        const seedSide = directions[attempt % directions.length];
        let seedX = anchors[network].x + (Math.random() - .5) * 2;
        let seedY = anchors[network].y + (Math.random() - .5) * 2;
        if (seedZone) {
          if (seedSide === "left") { seedX = seedZone.x - connectorWidth - .3; seedY = seedZone.y + seedZone.height / 2 - connectorDepth / 2; }
          if (seedSide === "right") { seedX = seedZone.x + seedZone.width + .3; seedY = seedZone.y + seedZone.height / 2 - connectorDepth / 2; }
          if (seedSide === "up") { seedX = seedZone.x + seedZone.width / 2 - connectorWidth / 2; seedY = seedZone.y - connectorDepth - .3; }
          if (seedSide === "down") { seedX = seedZone.x + seedZone.width / 2 - connectorWidth / 2; seedY = seedZone.y + seedZone.height + .3; }
        }
        seedX = clamp(seedX, .5, BOARD_IN - connectorWidth - .5);
        seedY = clamp(seedY, .5, BOARD_IN - connectorDepth - .5);
        const seed: PlacedPiece = { uid:`tt-node-${attempt}-${network}`, defId:connectorDef.id, x:seedX, y:seedY, rotation:0, height:heightDefaults[connectorDef.id] };
        if (pieceIntersectsReservedZone(seed) || generated.some((piece) => piecesOverlap(piece, seed, .1) || clearance(piece, seed) < 3)) continue;
        generated.push(seed);
        nodes.push({ piece:seed, links:[], network });
      }
      if (!nodes.length) return placeStandaloneSet(attempt);

      shuffle(structuralPool).forEach((def, edgeIndex) => {
        if (nodes.length >= connectorLimit) return;
        const networkEdgeCounts = generated.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind)).reduce<Record<number, number>>((counts, piece) => { const network = Number(piece.runId?.split("-").at(-1) || 0); counts[network] = (counts[network] || 0) + 1; return counts; }, {});
        const nodeOrder = shuffle(nodes.filter((node) => node.links.length < 3)).sort((a, b) => (networkEdgeCounts[a.network] || 0) - (networkEdgeCounts[b.network] || 0));
        let placed = false;
        for (const source of nodeOrder) {
          const directionOrder = shuffle(directions.filter((direction) => !source.links.includes(direction)));
          for (const direction of directionOrder) {
            const horizontal = direction === "left" || direction === "right";
            const rotation: 0 | 90 = horizontal ? 0 : 90;
            let wallX = source.piece.x + (connectorWidth - def.depth) / 2;
            let wallY = source.piece.y + (connectorDepth - def.depth) / 2;
            let targetX = source.piece.x;
            let targetY = source.piece.y;
            if (direction === "right") { wallX = source.piece.x + connectorWidth; targetX = wallX + def.width; }
            if (direction === "left") { wallX = source.piece.x - def.width; targetX = wallX - connectorWidth; }
            if (direction === "down") { wallY = source.piece.y + connectorDepth; targetY = wallY + def.width; }
            if (direction === "up") { wallY = source.piece.y - def.width; targetY = wallY - connectorDepth; }
            const wall: PlacedPiece = { uid:`tt-edge-${attempt}-${edgeIndex}`, defId:def.id, x:wallX, y:wallY, rotation, height:heightDefaults[def.id], runId:`tt-network-${attempt}-${source.network}`, sequenceIndex:edgeIndex };
            const target: PlacedPiece = { uid:`tt-node-${attempt}-${nodes.length}`, defId:connectorDef.id, x:targetX, y:targetY, rotation:0, height:heightDefaults[connectorDef.id] };
            if (!insideBoard(wall) || !insideBoard(target) || pieceIntersectsReservedZone(wall) || pieceIntersectsReservedZone(target)) continue;
            const sourceIncident = generated.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind) && piecesOverlap(piece, source.piece, .04));
            const blockedWall = generated.some((piece) => piece.uid !== source.piece.uid && !sourceIncident.some((incident) => incident.uid === piece.uid) && (piecesOverlap(piece, wall, .04) || (["wall", "door"].includes(getDef(piece.defId).kind) && clearance(piece, wall) < 3)));
            const blockedTarget = generated.some((piece) => piece.uid !== source.piece.uid && (piecesOverlap(piece, target, .04) || (["wall", "door"].includes(getDef(piece.defId).kind) && clearance(piece, target) < .35)));
            if (blockedWall || blockedTarget) continue;
            generated.push(wall, target);
            source.links.push(direction);
            nodes.push({ piece:target, links:[opposite[direction]], network:source.network });
            placed = true;
            break;
          }
          if (placed) break;
        }
      });

      if (endDef && enabled[endDef.id]) {
        nodes.filter((node) => node.links.length === 1).slice(0, limits[endDef.id]).forEach((node, index) => {
          const direction = opposite[node.links[0]];
          const horizontal = direction === "left" || direction === "right";
          const rotation: 0 | 90 = horizontal ? 0 : 90;
          let x = node.piece.x + (connectorWidth - endDef.depth) / 2;
          let y = node.piece.y + (connectorDepth - endDef.depth) / 2;
          if (direction === "right") x = node.piece.x + connectorWidth;
          if (direction === "left") x = node.piece.x - endDef.width;
          if (direction === "down") y = node.piece.y + connectorDepth;
          if (direction === "up") y = node.piece.y - endDef.width;
          const wallEnd: PlacedPiece = { uid:`tt-end-${attempt}-${index}`, defId:endDef.id, x, y, rotation, height:heightDefaults[endDef.id], runId:`tt-network-${attempt}-${node.network}` };
          const collides = generated.some((piece) => piece.uid !== node.piece.uid && piecesOverlap(piece, wallEnd, .03));
          if (insideBoard(wallEnd) && !pieceIntersectsReservedZone(wallEnd) && !collides) generated.push(wallEnd);
        });
      }

      const degrees = nodes.map((node) => node.links.length);
      const turns = nodes.filter((node) => node.links.length === 2 && node.links[0] !== opposite[node.links[1]]).length;
      const branches = degrees.filter((degree) => degree >= 3).length;
      const structureCount = generated.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind)).length;
      const bounds = generated.reduce((acc, piece) => { const rect = pieceRect(piece); return { minX:Math.min(acc.minX, rect.x), minY:Math.min(acc.minY, rect.y), maxX:Math.max(acc.maxX, rect.x + rect.width), maxY:Math.max(acc.maxY, rect.y + rect.height) }; }, { minX:BOARD_IN, minY:BOARD_IN, maxX:0, maxY:0 });
      const spread = Math.min(30, ((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)) / 35);
      const zoneFrameBonus = zones.reduce((sum, zone) => sum + generated.filter((piece) => { const rect = pieceRect(piece); const closeX = Math.abs(rect.x + rect.width - zone.x) < 2 || Math.abs(rect.x - (zone.x + zone.width)) < 2; const closeY = Math.abs(rect.y + rect.height - zone.y) < 2 || Math.abs(rect.y - (zone.y + zone.height)) < 2; return closeX || closeY; }).length * 4, 0);
      return { generated, score:structureCount * 30 + turns * 7 + branches * 12 + spread + zoneFrameBonus + Math.random() * 12 };
    };

    const candidates = Array.from({ length:64 }, (_, attempt) => buildNetwork(attempt)).sort((a, b) => b.score - a.score);
    const shortlist = candidates.slice(0, Math.min(8, candidates.length));
    const chosen = shortlist[Math.floor(Math.random() * shortlist.length)] || { generated:[], score:0 };
    const finalized = chosen.generated.map((piece) => ({ ...piece, uid:nextUid() }));
    setPieces(finalized);
    selectOnly(null);
    setMessage(`${activeCatalogueMeta.name} layout generated · ${finalized.length} pieces${zones.length ? ` · ${zones.length} zone${zones.length === 1 ? "" : "s"} respected` : ""}`);
  };

  const generateLayout = () => {
    if (activeCatalogue === "ttcombat") { generateIronLabyrinth(); return; }
    const candidates = Array.from({ length: 32 }, (_, attempt) => {
      const layoutIndex = (attempt + Math.floor(Math.random() * RUN_LAYOUTS.length)) % RUN_LAYOUTS.length;
      const base = RUN_LAYOUTS[layoutIndex];
      const quarterTurns = layoutIndex === 2 ? 0 : attempt % 4;
      const pool: Record<string, number> = {};
      const generated: PlacedPiece[] = [];
      base.forEach((run, runIndex) => {
        let complete = true;
        const runDefs: TerrainDef[] = [];
        run.sequence.forEach((token) => {
          if (!complete) return;
          const slot = { x:run.x, y:run.y, rotation:run.rotation, length:token.endsWith("long") ? "long" as const : "short" as const, door:token.startsWith("door") };
          const def = chooseDefinition(slot, pool);
          if (!def) { complete = false; return; }
          runDefs.push(def);
        });
        if (!complete || runDefs.length !== run.sequence.length) {
          runDefs.forEach((def) => { pool[def.id] = Math.max(0, (pool[def.id] || 1) - 1); });
          return;
        }

        const totalLength = runDefs.reduce((sum, def) => sum + def.width, 0);
        let cursorX = run.x;
        let cursorY = layoutIndex === 1 && runIndex < 3 ? 23 - totalLength : layoutIndex === 2 && runIndex === 2 ? 19 - totalLength : run.y;
        if (layoutIndex === 2 && runIndex >= 4) {
          const targetRunIndex = runIndex === 4 ? 0 : 1;
          const targetPiece = generated.find((piece) => piece.runId === `candidate-run-${attempt}-${targetRunIndex}` && piece.sequenceIndex === 2);
          if (!targetPiece) {
            runDefs.forEach((def) => { pool[def.id] = Math.max(0, (pool[def.id] || 1) - 1); });
            return;
          }
          const targetDef = getDef(targetPiece.defId);
          cursorX = targetPiece.x - runDefs[0].depth / 2;
          cursorY = targetPiece.y + targetDef.depth / 2 - totalLength;
        }

        const runPieces: PlacedPiece[] = [];
        runDefs.forEach((def, sequenceIndex) => {
          let x = cursorX;
          let y = cursorY;
          let rotation = run.rotation;
          for (let turn = 0; turn < quarterTurns; turn++) {
            const currentH = rotation === 90 ? def.width : def.depth;
            const nextX = BOARD_IN - y - currentH;
            const nextY = x;
            x = nextX;
            y = nextY;
            rotation = rotation === 0 ? 90 : 0;
          }
          const w = rotation === 90 ? def.depth : def.width;
          const h = rotation === 90 ? def.width : def.depth;
          runPieces.push({ uid:`candidate-${attempt}-${runIndex}-${sequenceIndex}`, defId:def.id, x:clamp(x, 0, BOARD_IN - w), y:clamp(y, 0, BOARD_IN - h), rotation, height:heightDefaults[def.id], runId:`candidate-run-${attempt}-${runIndex}`, sequenceIndex });
          if (run.rotation === 0) cursorX += def.width;
          else cursorY += def.width;
        });
        if (runPieces.some((piece) => pieceIntersectsReservedZone(piece))) {
          runDefs.forEach((def) => { pool[def.id] = Math.max(0, (pool[def.id] || 1) - 1); });
          return;
        }
        generated.push(...runPieces);
      });
      const doorCount = generated.filter((piece) => getDef(piece.defId).kind === "door").length;
      const longCount = generated.filter((piece) => getDef(piece.defId).width > 5).length;
      const score = generated.length * 7 + Math.min(doorCount, 9) * 5 + Math.min(longCount, 12) * 2 + base.length * 3 - Math.abs(8 - doorCount) * 3;
      return { generated, score };
    }).sort((a, b) => b.score - a.score)[0];

    const finalPieces = candidates.generated.map((piece) => ({ ...piece, uid:nextUid() }));
    const finalized = finalizeGeneratedLayout(finalPieces);
    setPieces(finalized);
    selectOnly(null);
    setMessage(`${activeCatalogueMeta.name} sector generated · ${finalized.length} pieces${zones.length ? ` · ${zones.length} zone${zones.length === 1 ? "" : "s"} framed` : ""}`);
  };

  const exportLayoutPng = () => {
    if (!pieces.length) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1800;
    canvas.height = 1320;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setMessage("PNG export is unavailable in this browser"); return; }

    const boardX = 70;
    const boardY = 160;
    const boardSize = 1080;
    const boardScale = boardSize / BOARD_IN;
    const manifestX = 1200;
    const manifestWidth = 530;
    const themeColours = {
      industrial: { board:"#858e89", minor:"rgba(238,243,239,.16)", major:"rgba(28,37,34,.30)" },
      gothic: { board:"#626967", minor:"rgba(235,237,230,.13)", major:"rgba(18,23,22,.36)" },
      desert: { board:"#b9aa8b", minor:"rgba(255,248,226,.25)", major:"rgba(77,65,45,.28)" },
    }[theme];
    const manifest = TERRAIN.map((def) => {
      const matches = pieces.filter((piece) => piece.defId === def.id);
      const heightCounts = matches.reduce<Record<string, number>>((counts, piece) => {
        const height = String(Math.round(piece.height * MM_PER_IN));
        return { ...counts, [height]:(counts[height] || 0) + 1 };
      }, {});
      return { def, count:matches.length, heightCounts };
    }).filter((item) => item.count > 0);
    const cataloguesUsed = [...new Set(manifest.map((item) => item.def.catalogue))];

    ctx.fillStyle = "#f2f3f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#17201e";
    ctx.font = "700 38px Arial, sans-serif";
    ctx.fillText("MORTALIS ARCHITECT", 70, 70);
    ctx.fillStyle = "#68736e";
    ctx.font = "700 15px Arial, sans-serif";
    ctx.fillText("HORUS HERESY LAYOUT SHEET", 72, 102);
    ctx.textAlign = "right";
    ctx.font = "700 17px Arial, sans-serif";
    ctx.fillText("BOARD 48 × 48 IN  ·  SCALE 1:1 DATA", 1730, 76);
    ctx.font = "15px Arial, sans-serif";
    ctx.fillText(`${activeCatalogueMeta.maker} · ${activeCatalogueMeta.name}`, 1730, 103);
    ctx.textAlign = "left";

    ctx.fillStyle = themeColours.board;
    ctx.fillRect(boardX, boardY, boardSize, boardSize);
    for (let inch = 0; inch <= BOARD_IN; inch++) {
      const position = boardX + inch * boardScale;
      ctx.beginPath();
      ctx.strokeStyle = inch % 12 === 0 ? themeColours.major : themeColours.minor;
      ctx.lineWidth = inch % 12 === 0 ? 3 : 1;
      ctx.moveTo(position, boardY);
      ctx.lineTo(position, boardY + boardSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(boardX, boardY + inch * boardScale);
      ctx.lineTo(boardX + boardSize, boardY + inch * boardScale);
      ctx.stroke();
    }
    ctx.strokeStyle = "#17201e";
    ctx.lineWidth = 5;
    ctx.strokeRect(boardX, boardY, boardSize, boardSize);
    ctx.fillStyle = "#5f6965";
    ctx.font = "13px Arial, sans-serif";
    ctx.textAlign = "center";
    [0, 12, 24, 36, 48].forEach((inch) => ctx.fillText(`${inch}${inch === 48 ? "″" : ""}`, boardX + inch * boardScale, boardY - 17));
    ctx.textAlign = "right";
    [0, 12, 24, 36, 48].forEach((inch) => ctx.fillText(`${inch}${inch === 48 ? "″" : ""}`, boardX - 17, boardY + inch * boardScale + 5));
    ctx.textAlign = "left";

    zones.forEach((zone) => {
      const x = boardX + zone.x * boardScale;
      const y = boardY + zone.y * boardScale;
      const width = zone.width * boardScale;
      const height = zone.height * boardScale;
      ctx.fillStyle = "rgba(226,214,164,.58)";
      ctx.fillRect(x, y, width, height);
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.strokeStyle = "#815f29";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, width, height);
      ctx.restore();
      ctx.fillStyle = "#3c321f";
      ctx.font = "700 17px Arial, sans-serif";
      ctx.fillText(zone.name || "Reserved zone", x + 10, y + 26);
      ctx.font = "13px Arial, sans-serif";
      ctx.fillText(`${zone.width.toFixed(1)} × ${zone.height.toFixed(1)}″ CLEAR`, x + 10, y + 48);
    });

    pieces.forEach((piece) => {
      const def = getDef(piece.defId);
      const widthIn = piece.rotation === 90 ? def.depth : def.width;
      const depthIn = piece.rotation === 90 ? def.width : def.depth;
      const x = boardX + piece.x * boardScale;
      const y = boardY + piece.y * boardScale;
      const width = Math.max(4, widthIn * boardScale);
      const depth = Math.max(4, depthIn * boardScale);
      const colour = def.kind === "door" ? "#7d4b39" : def.kind === "wall" ? "#3d4844" : def.kind === "end" ? "#56615c" : "#2d3934";
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, width, depth);
      ctx.strokeStyle = "#18211e";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, depth);
      ctx.strokeStyle = "rgba(226,233,228,.48)";
      ctx.lineWidth = 2;
      if (def.kind === "door") {
        ctx.fillStyle = "#252d2a";
        if (width >= depth) ctx.fillRect(x + width * .35, y + 3, width * .3, Math.max(2, depth - 6));
        else ctx.fillRect(x + 3, y + depth * .35, Math.max(2, width - 6), depth * .3);
      } else if (["pillar", "connector"].includes(def.kind)) {
        ctx.strokeRect(x + 4, y + 4, Math.max(1, width - 8), Math.max(1, depth - 8));
      } else if (def.visual === "grid") {
        for (let offset = 5; offset < Math.max(width, depth); offset += 8) {
          ctx.beginPath(); ctx.moveTo(x + Math.min(offset, width), y); ctx.lineTo(x + Math.min(offset, width), y + depth); ctx.stroke();
        }
      } else if (["pipe", "vertical-pipe"].includes(def.visual || "")) {
        ctx.beginPath();
        if (width >= depth) { ctx.moveTo(x + 5, y + depth * .35); ctx.lineTo(x + width - 5, y + depth * .35); ctx.moveTo(x + 5, y + depth * .65); ctx.lineTo(x + width - 5, y + depth * .65); }
        else { ctx.moveTo(x + width * .35, y + 5); ctx.lineTo(x + width * .35, y + depth - 5); ctx.moveTo(x + width * .65, y + 5); ctx.lineTo(x + width * .65, y + depth - 5); }
        ctx.stroke();
      } else if (def.visual === "reinforced") {
        ctx.strokeRect(x + 4, y + 4, Math.max(1, width - 8), Math.max(1, depth - 8));
      } else if (def.visual === "fan") {
        ctx.beginPath(); ctx.arc(x + width / 2, y + depth / 2, Math.max(2, Math.min(width, depth) * .28), 0, Math.PI * 2); ctx.stroke();
      }
    });

    ctx.fillStyle = "#fafbf9";
    ctx.fillRect(manifestX, boardY, manifestWidth, boardSize);
    ctx.strokeStyle = "#d0d6d2";
    ctx.lineWidth = 2;
    ctx.strokeRect(manifestX, boardY, manifestWidth, boardSize);
    ctx.fillStyle = "#17201e";
    ctx.font = "700 25px Arial, sans-serif";
    ctx.fillText("PIECES USED", manifestX + 30, boardY + 48);
    ctx.fillStyle = "#68736e";
    ctx.font = "15px Arial, sans-serif";
    ctx.fillText(`${pieces.length} terrain pieces  ·  ${coverage.toFixed(1)}% footprint coverage`, manifestX + 30, boardY + 77);
    if (zones.length) {
      ctx.fillStyle = "#815f29";
      ctx.font = "700 13px Arial, sans-serif";
      const zoneNames = zones.map((zone) => zone.name || "Reserved zone").join(" · ");
      ctx.fillText(`${zones.length} RESERVED · ${zoneNames.length > 46 ? `${zoneNames.slice(0, 43)}…` : zoneNames}`, manifestX + 30, boardY + 104);
    }
    let rowY = boardY + (zones.length ? 142 : 118);
    cataloguesUsed.forEach((catalogueId) => {
      ctx.fillStyle = "#eef1ed";
      ctx.fillRect(manifestX + 20, rowY - 22, manifestWidth - 40, 34);
      ctx.fillStyle = "#4e5a55";
      ctx.font = "700 13px Arial, sans-serif";
      ctx.fillText(`${MANUFACTURERS[catalogueId].name.toUpperCase()} · ${MANUFACTURERS[catalogueId].range.toUpperCase()}`, manifestX + 30, rowY);
      rowY += 42;
      manifest.filter((item) => item.def.catalogue === catalogueId).forEach(({ def, count, heightCounts }) => {
        ctx.fillStyle = def.kind === "door" ? "#7d4b39" : def.kind === "wall" ? "#3d4844" : def.kind === "end" ? "#56615c" : "#2d3934";
        ctx.fillRect(manifestX + 30, rowY - 16, 12, 12);
        ctx.fillStyle = "#17201e";
        ctx.font = "700 16px Arial, sans-serif";
        ctx.fillText(`${count} × ${def.shortName}`, manifestX + 55, rowY - 4);
        ctx.fillStyle = "#68736e";
        ctx.font = "13px Arial, sans-serif";
        const heightEntries = Object.entries(heightCounts).sort(([a], [b]) => Number(a) - Number(b));
        const zText = heightEntries.length === 1 ? `${heightEntries[0][0]} mm` : heightEntries.map(([height, quantity]) => `${quantity}×${height}`).join(" / ") + " mm";
        ctx.fillText(`${def.note}  ·  Z ${zText}`, manifestX + 55, rowY + 15);
        rowY += 42;
      });
      rowY += 10;
    });
    ctx.fillStyle = "#68736e";
    ctx.font = "13px Arial, sans-serif";
    ctx.fillText("Bird's-eye placement diagram · dimensions shown at real-world scale", manifestX + 30, boardY + boardSize - 35);
    ctx.fillText("Generated with Mortalis Architect", 70, 1286);
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }), 1730, 1286);
    ctx.textAlign = "left";

    setMessage("Preparing PNG layout sheet…");
    canvas.toBlob((blob) => {
      if (!blob) { setMessage("PNG export could not be created"); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const catalogueSlug = activeCatalogueMeta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.href = url;
      link.download = `mortalis-layout-${catalogueSlug}-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`PNG exported · ${pieces.length} pieces listed`);
    }, "image/png");
  };

  const boardPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * BOARD_IN, y: (clientY - rect.top) / rect.height * BOARD_IN };
  };

  const beginZone = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!zoneMode || !boardRef.current) {
      if (event.target === boardRef.current && boardRef.current) {
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
        const point = boardPoint(event.clientX, event.clientY);
        const additive = event.shiftKey || event.ctrlKey || event.metaKey;
        if (!additive) selectOnly(null);
        setFocusedZone(null);
        setMarquee({ startX:point.x, startY:point.y, currentX:point.x, currentY:point.y, additive });
        setMessage("Drag across terrain to select a group · hold Shift to add");
      }
      return;
    }
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const point = boardPoint(event.clientX, event.clientY);
    const x = clamp(quantize(point.x), 0, BOARD_IN);
    const y = clamp(quantize(point.y), 0, BOARD_IN);
    selectOnly(null);
    setDrag(null);
    setZoneDraft({ startX:x, startY:y, currentX:x, currentY:y });
    setMessage("Drag to size the reserved zone · hold Shift for a perfect square");
  };

  const finishMarquee = () => {
    if (!marquee) return;
    const left = Math.min(marquee.startX, marquee.currentX);
    const top = Math.min(marquee.startY, marquee.currentY);
    const right = Math.max(marquee.startX, marquee.currentX);
    const bottom = Math.max(marquee.startY, marquee.currentY);
    const found = pieces.filter((piece) => { const rect = pieceRect(piece); return rect.x < right && rect.x + rect.width > left && rect.y < bottom && rect.y + rect.height > top; }).map((piece) => piece.uid);
    const next = marquee.additive ? [...new Set([...selectedIds, ...found])] : found;
    setSelectedIds(next);
    setSelected(next[0] || null);
    setMarquee(null);
    setMessage(next.length ? `${next.length} piece${next.length === 1 ? "" : "s"} selected · drag any selected piece to move the group` : "Selection cleared");
  };

  const beginPieceDrag = (event: React.PointerEvent<HTMLButtonElement>, piece: PlacedPiece) => {
    event.stopPropagation();
    setFocusedZone(null);
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (additive) {
      const next = selectedIds.includes(piece.uid) ? selectedIds.filter((uid) => uid !== piece.uid) : [...selectedIds, piece.uid];
      setSelectedIds(next);
      setSelected(next.includes(piece.uid) ? piece.uid : next[0] || null);
      setMessage(`${next.length} piece${next.length === 1 ? "" : "s"} selected`);
      return;
    }
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const uids = selectedIds.includes(piece.uid) ? selectedIds : [piece.uid];
    if (!selectedIds.includes(piece.uid)) selectOnly(piece.uid);
    const point = boardPoint(event.clientX, event.clientY);
    const origins = Object.fromEntries(pieces.filter((candidate) => uids.includes(candidate.uid)).map((candidate) => [candidate.uid, { x:candidate.x, y:candidate.y }]));
    setDrag({ uids, startX:point.x, startY:point.y, origins });
  };

  const finishZone = () => {
    if (!zoneDraft) return;
    const zone = normaliseZoneDraft(zoneDraft);
    const minimumSize = snap ? gridSize : .5;
    if (zone.width < minimumSize || zone.height < minimumSize) {
      setZoneDraft(null);
      setMessage("Drag a larger area to create a zone");
      return;
    }
    const name = zoneName.trim() || `Hangar ${zones.length + 1}`;
    const uid = `zone-${Date.now()}`;
    setZones((current) => [...current, { uid, name, ...zone }]);
    setZoneDraft(null);
    setZoneMode(false);
    setFocusedZone(uid);
    setZoneName(`Hangar ${zones.length + 2}`);
    setMessage(`${name} reserved · drag a corner handle to refine its size`);
  };

  const beginZoneResize = (event: React.PointerEvent<HTMLButtonElement>, zone: ReservedZone, corner: ZoneCorner) => {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const anchorX = corner.endsWith("w") ? zone.x + zone.width : zone.x;
    const anchorY = corner.startsWith("n") ? zone.y + zone.height : zone.y;
    setZoneResize({ uid:zone.uid, corner, anchorX, anchorY });
    setFocusedZone(zone.uid);
    selectOnly(null);
    setMessage(`Resizing ${zone.name} · hold Shift for a perfect square`);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const defId = event.dataTransfer.getData("terrain/def-id");
    if (!defId || !boardRef.current) return;
    const point = boardPoint(event.clientX, event.clientY);
    addPiece(defId, point.x, point.y);
  };

  useEffect(() => {
    const onPaletteMove = (event: PointerEvent) => {
      if (!paletteDragRef.current) return;
      const nextDrag = { ...paletteDragRef.current, x:event.clientX, y:event.clientY };
      paletteDragRef.current = nextDrag;
      setPaletteDrag(nextDrag);
    };
    const onPaletteUp = (event: PointerEvent) => {
      const currentPaletteDrag = paletteDragRef.current;
      if (!currentPaletteDrag || !boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        const point = boardPoint(event.clientX, event.clientY);
        addPiece(currentPaletteDrag.defId, point.x, point.y);
      }
      paletteDragRef.current = null;
      setPaletteDrag(null);
    };
    window.addEventListener("pointermove", onPaletteMove);
    window.addEventListener("pointerup", onPaletteUp);
    window.addEventListener("pointercancel", onPaletteUp);
    return () => {
      window.removeEventListener("pointermove", onPaletteMove);
      window.removeEventListener("pointerup", onPaletteUp);
      window.removeEventListener("pointercancel", onPaletteUp);
    };
  }, [addPiece]);

  const onBoardPointerMove = (event: React.PointerEvent) => {
    if (zoneResize && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      const minimumSize = snap ? gridSize : .5;
      const directionX = zoneResize.corner.endsWith("w") ? -1 : 1;
      const directionY = zoneResize.corner.startsWith("n") ? -1 : 1;
      let currentX = clamp(quantize(point.x), 0, BOARD_IN);
      let currentY = clamp(quantize(point.y), 0, BOARD_IN);
      currentX = directionX > 0 ? Math.max(currentX, zoneResize.anchorX + minimumSize) : Math.min(currentX, zoneResize.anchorX - minimumSize);
      currentY = directionY > 0 ? Math.max(currentY, zoneResize.anchorY + minimumSize) : Math.min(currentY, zoneResize.anchorY - minimumSize);
      currentX = clamp(currentX, 0, BOARD_IN);
      currentY = clamp(currentY, 0, BOARD_IN);
      if (event.shiftKey) {
        const maximumSide = Math.min(directionX > 0 ? BOARD_IN - zoneResize.anchorX : zoneResize.anchorX, directionY > 0 ? BOARD_IN - zoneResize.anchorY : zoneResize.anchorY);
        const side = clamp(Math.max(Math.abs(currentX - zoneResize.anchorX), Math.abs(currentY - zoneResize.anchorY)), minimumSize, maximumSide);
        currentX = zoneResize.anchorX + directionX * side;
        currentY = zoneResize.anchorY + directionY * side;
      }
      const x = Math.min(currentX, zoneResize.anchorX);
      const y = Math.min(currentY, zoneResize.anchorY);
      const width = Math.abs(currentX - zoneResize.anchorX);
      const height = Math.abs(currentY - zoneResize.anchorY);
      setZones((current) => current.map((zone) => zone.uid === zoneResize.uid ? { ...zone, x, y, width, height } : zone));
      return;
    }
    if (zoneDraft && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      let currentX = clamp(quantize(point.x), 0, BOARD_IN);
      let currentY = clamp(quantize(point.y), 0, BOARD_IN);
      if (event.shiftKey) {
        const dx = currentX - zoneDraft.startX;
        const dy = currentY - zoneDraft.startY;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        currentX = clamp(zoneDraft.startX + (dx < 0 ? -side : side), 0, BOARD_IN);
        currentY = clamp(zoneDraft.startY + (dy < 0 ? -side : side), 0, BOARD_IN);
      }
      setZoneDraft((current) => current ? { ...current, currentX, currentY } : null);
      return;
    }
    if (marquee && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      setMarquee((current) => current ? { ...current, currentX:clamp(point.x, 0, BOARD_IN), currentY:clamp(point.y, 0, BOARD_IN) } : null);
      return;
    }
    if (!drag || !boardRef.current) return;
    const point = boardPoint(event.clientX, event.clientY);
    const rawDeltaX = point.x - drag.startX;
    const rawDeltaY = point.y - drag.startY;
    const requestedX = snap ? Math.round(rawDeltaX / gridSize) * gridSize : Math.round(rawDeltaX * 10) / 10;
    const requestedY = snap ? Math.round(rawDeltaY / gridSize) * gridSize : Math.round(rawDeltaY * 10) / 10;
    const draggedPieces = pieces.filter((piece) => drag.uids.includes(piece.uid));
    const minX = Math.min(...draggedPieces.map((piece) => drag.origins[piece.uid].x));
    const minY = Math.min(...draggedPieces.map((piece) => drag.origins[piece.uid].y));
    const maxX = Math.max(...draggedPieces.map((piece) => { const rect = pieceRect({ ...piece, ...drag.origins[piece.uid] }); return rect.x + rect.width; }));
    const maxY = Math.max(...draggedPieces.map((piece) => { const rect = pieceRect({ ...piece, ...drag.origins[piece.uid] }); return rect.y + rect.height; }));
    let allowedX = clamp(requestedX, -minX, BOARD_IN - maxX);
    let allowedY = clamp(requestedY, -minY, BOARD_IN - maxY);
    const fixedPieces = pieces.filter((piece) => !drag.uids.includes(piece.uid));
    let rotationOverride: { uid:string; rotation:0|90 } | null = null;
    if (smartFit) {
      const tentative = draggedPieces.map((piece) => ({ ...piece, x:drag.origins[piece.uid].x + allowedX, y:drag.origins[piece.uid].y + allowedY }));
      const fitCandidates = tentative.flatMap((moving) => fixedPieces.flatMap((fixed) => connectionCandidates(moving, fixed).map((candidate) => ({ ...candidate, uid:moving.uid, distance:Math.hypot(candidate.dx, candidate.dy) })))).filter((candidate) => candidate.distance <= Math.max(.75, gridSize));
      fitCandidates.sort((a, b) => a.distance - b.distance);
      const bestFit = fitCandidates[0];
      if (bestFit) {
        allowedX = clamp(allowedX + bestFit.dx, -minX, BOARD_IN - maxX);
        allowedY = clamp(allowedY + bestFit.dy, -minY, BOARD_IN - maxY);
        if (bestFit.rotation !== undefined) rotationOverride = { uid:bestFit.uid, rotation:bestFit.rotation };
      }
    }
    const tentativePieces = draggedPieces.map((piece) => {
      const origin = drag.origins[piece.uid];
      let moved = { ...piece, x:Math.round((origin.x + allowedX) * 100) / 100, y:Math.round((origin.y + allowedY) * 100) / 100 };
      if (rotationOverride?.uid === piece.uid && moved.rotation !== rotationOverride.rotation) {
        // The fit delta was calculated against this prospective orientation,
        // so preserve its snapped top-left rather than re-centering afterwards.
        moved = { ...moved, rotation:rotationOverride.rotation };
      }
      return moved;
    });
    const invalidPlacement = smartFit && tentativePieces.some((moving) => {
      const rect = pieceRect(moving);
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > BOARD_IN || rect.y + rect.height > BOARD_IN) return true;
      return fixedPieces.some((fixed) => {
        if (!piecesOverlap(moving, fixed, -.03)) return false;
        return !connectionCandidates(moving, fixed).some((candidate) => Math.abs(candidate.dx) < .18 && Math.abs(candidate.dy) < .18);
      });
    });
    if (invalidPlacement) { setMessage("Smart fit blocked an overlapping placement"); return; }
    const movedById = new Map(tentativePieces.map((piece) => [piece.uid, piece]));
    setPieces((current) => current.map((piece) => movedById.get(piece.uid) || piece));
  };

  return (
    <main className="app-shell">
      <a className="skip-link" href="#layout-board">Skip to layout board</a>
      <header className="topbar">
        <div><p className="eyebrow">Horus Heresy layout utility</p><h1>Mortalis Architect</h1></div>
        <div className="top-actions"><span className="board-chip">BOARD 48 × 48 IN</span><button className="export-action" onClick={exportLayoutPng} disabled={!pieces.length} aria-label="Export layout and piece manifest as PNG">Export PNG</button><button className="primary" onClick={generateLayout}>Generate layout</button></div>
      </header>

      <section className="workspace">
        <aside className="catalogue panel">
          <div className="catalogue-selectors" aria-label="Terrain source">
            <label><span>Manufacturer</span><select value={activeCatalogue} onChange={(event) => selectManufacturer(event.target.value as CatalogueId)}>{(Object.keys(MANUFACTURERS) as CatalogueId[]).map((catalogueId) => <option key={catalogueId} value={catalogueId}>{MANUFACTURERS[catalogueId].name}</option>)}</select></label>
            <label><span>Kit</span><select value={activeKitId} onChange={(event) => selectKit(event.target.value)}>{manufacturerKits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
          </div>
          <div className="panel-heading"><div><p className="eyebrow">Available terrain</p><h2>{activeCatalogueMeta.name}</h2><small className="catalogue-subtitle">{activeCatalogueMeta.description}</small></div><span className="count">{catalogueTotal} pcs</span></div>
          <section className="current-palette" aria-labelledby="current-terrain-heading">
            <div className="current-palette-heading"><strong id="current-terrain-heading">Current terrain</strong><span>{pieces.length} placed</span></div>
            <div className="current-palette-items">
              {!pieces.length && <small>No terrain placed yet</small>}
              {Object.entries(used).filter(([, count]) => count > 0).map(([defId, count]) => { const def = getDef(defId); return <button key={defId} title={`Select next ${def.name}`} onClick={() => { const matches = pieces.filter((piece) => piece.defId === defId); const currentIndex = matches.findIndex((piece) => piece.uid === selected); const next = matches[(currentIndex + 1) % matches.length]; if (next) { selectOnly(next.uid); setFocusedZone(null); setMessage(`${def.shortName} selected from current terrain`); } }}><span className={`piece-icon ${def.kind} ${def.width > 5 ? "long" : "short"} ${def.visual ? `visual-${def.visual}` : ""}`}><i /></span><span>{def.shortName}</span><em>×{count}</em></button>; })}
            </div>
          </section>
          <details className="height-settings" open>
            <summary><span>Height defaults</span><em>Z axis · mm</em></summary>
            <div className="height-grid">
              {familyIsAvailable("wall") && <label><span>Structures</span><input aria-label={`${activeCatalogueMeta.name} structure default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("wall")} onChange={(event) => setFamilyHeightMm("wall", Number(event.target.value))} /></label>}
              {familyIsAvailable("support") && <label><span>{activeCatalogue === "boarding" ? "Pillars" : "Connectors"}</span><input aria-label={`${activeCatalogueMeta.name} support default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("support")} onChange={(event) => setFamilyHeightMm("support", Number(event.target.value))} /></label>}
              {familyIsAvailable("end") && <label><span>Wall ends</span><input aria-label={`${activeCatalogueMeta.name} end default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("end")} onChange={(event) => setFamilyHeightMm("end", Number(event.target.value))} /></label>}
            </div>
          </details>
          <div className="catalogue-scroll" aria-label={`${activeCatalogueMeta.name} terrain palette`}>
            {catalogueTerrain.map((def) => {
              const remaining = Math.max(0, limits[def.id] - (used[def.id] || 0));
              return (
                <div className={`terrain-row ${!enabled[def.id] ? "disabled" : ""}`} key={def.id} onPointerDown={(event) => { if (!enabled[def.id] || remaining === 0 || (event.target as HTMLElement).closest("input")) return; const nextDrag = { defId:def.id, x:event.clientX, y:event.clientY }; paletteDragRef.current = nextDrag; setPaletteDrag(nextDrag); }}>
                  <input aria-label={`Include ${def.name}`} type="checkbox" checked={enabled[def.id]} onChange={(event) => setEnabled((current) => ({ ...current, [def.id]: event.target.checked }))} />
                  <button className="piece-add" onClick={() => addPiece(def.id)} disabled={!enabled[def.id] || remaining === 0} aria-label={`Add ${def.name}`}>
                    <span className={`piece-icon ${def.kind} ${def.width > 5 ? "long" : "short"} ${def.visual ? `visual-${def.visual}` : ""}`}><i /></span>
                    <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · Z {Math.round(heightDefaults[def.id] * MM_PER_IN)} mm</small></span>
                  </button>
                  <label className="stock"><span aria-hidden="true">×</span><input aria-label={`${def.name} available quantity`} type="number" min="0" max={activeCatalogueMeta.inventory[def.id] || def.limit} value={limits[def.id]} onChange={(event) => setLimits((current) => ({ ...current, [def.id]: clamp(Number(event.target.value), 0, activeCatalogueMeta.inventory[def.id] || def.limit) }))} /><em>{remaining} left</em></label>
                </div>
              );
            })}
          </div>
          {activeCatalogueMeta.caveat && <p className="kit-caveat">{activeCatalogueMeta.caveat}</p>}
          <p className="hint">Drag or click to place. Quantities match one complete kit. <a href={activeCatalogueMeta.sourceUrl} target="_blank" rel="noreferrer">{activeCatalogueMeta.source}</a>.</p>
        </aside>

        <div className="board-column">
          <div className="board-toolbar panel" role="toolbar" aria-label="Layout tools">
            <div className="tool-group primary-tools"><button className={`tool ${!zoneMode ? "active" : ""}`} aria-pressed={!zoneMode} onClick={() => { setZoneMode(false); setZoneDraft(null); }}>Select</button><button className={`tool ${zoneMode ? "active zone-tool" : ""}`} aria-pressed={zoneMode} onClick={() => { setZoneMode(true); selectOnly(null); setFocusedZone(null); setZoneResize(null); setMarquee(null); setMessage("Name the zone, then drag it on the board"); }}>Draw zone</button><span className="tool-divider" aria-hidden="true" /><button className="tool" title="Copy selected terrain" onClick={copySelected} disabled={!selectedIds.length || zoneMode}>Copy <kbd>Ctrl C</kbd></button><button className="tool" title="Paste copied terrain" onClick={pasteCopied} disabled={!copyBuffer || zoneMode}>Paste <kbd>Ctrl V</kbd></button><button className="tool" title="Duplicate selected terrain" onClick={duplicateSelected} disabled={!selectedIds.length || zoneMode}>Duplicate <kbd>Ctrl D</kbd></button><button className="tool" onClick={rotateSelected} disabled={!selectedIds.length || zoneMode}>Rotate <kbd>R</kbd></button><button className="tool danger" onClick={deleteSelected} disabled={!selectedIds.length || zoneMode}>Delete</button><span className="tool-divider" aria-hidden="true" /><button className="tool danger" title="Remove terrain but preserve reserved zones" onClick={clearTerrain} disabled={!pieces.length}>Clear terrain</button><button className="tool danger" title="Remove reserved zones but preserve terrain" onClick={() => { setZones([]); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMessage("Reserved zones cleared · terrain preserved"); }} disabled={!zones.length}>Clear zones</button></div>
            <div className="tool-group settings">
              <label className="switch-label"><input type="checkbox" checked={smartFit} onChange={(event) => { setSmartFit(event.target.checked); setMessage(event.target.checked ? "Smart fit enabled · compatible parts snap and collisions are blocked" : "Smart fit disabled · free overlap allowed"); }} /><span className="toggle" /> Smart fit</label>
              <label className="switch-label"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /><span className="toggle" /> Snap</label>
              {snap && <select aria-label="Snap grid size" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))}><option value="1">1″ grid</option><option value="0.5">½″ grid</option><option value="0.25">¼″ grid</option></select>}
              <div className="theme-switch" aria-label="Board style">{(["industrial", "gothic", "desert"] as const).map((item) => <button key={item} className={theme === item ? "active" : ""} aria-pressed={theme === item} onClick={() => setTheme(item)}>{item}</button>)}</div>
            </div>
          </div>
          {zoneMode && <div className="zone-designator panel"><label><span>Zone name</span><input aria-label="Zone name" value={zoneName} maxLength={32} onChange={(event) => setZoneName(event.target.value)} /></label><p>Drag on the grid to reserve a clear area. Hold <kbd>Shift</kbd> while dragging for a perfect square.</p><strong>{zones.length} saved</strong></div>}

          <div className="board-area"><div className="board-frame">
            <div className="ruler ruler-top"><span>0</span><span>12</span><span>24</span><span>36</span><span>48″</span></div>
            <div className="ruler ruler-left"><span>0</span><span>12</span><span>24</span><span>36</span><span>48″</span></div>
            <div id="layout-board" ref={boardRef} className={`board ${theme}-board ${drag ? "dragging" : ""} ${marquee ? "selecting" : ""} ${zoneMode ? "zone-mode" : ""} ${zoneResize ? "resizing-zone" : ""}`} aria-label="48 by 48 inch layout board" aria-describedby="board-help" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPointerMove={onBoardPointerMove} onPointerUp={() => { if (zoneDraft) finishZone(); if (marquee) finishMarquee(); if (zoneResize) { const zone = zones.find((item) => item.uid === zoneResize.uid); if (zone) setMessage(`${zone.name} resized · ${zone.width.toFixed(1)} × ${zone.height.toFixed(1)} in`); setZoneResize(null); } setDrag(null); }} onPointerCancel={() => { setZoneDraft(null); setZoneResize(null); setMarquee(null); setDrag(null); }} onPointerDown={beginZone}>
              {pieces.length === 0 && <div className="board-mark"><strong>4′ × 4′</strong><span>{zoneMode ? "DRAG TO RESERVE A CLEAR ZONE" : "DROP TERRAIN TO PLACE"}</span></div>}
              {zones.map((zone) => <div key={zone.uid} role="group" tabIndex={zoneMode ? -1 : 0} aria-label={`${zone.name}, reserved zone ${zone.width.toFixed(1)} by ${zone.height.toFixed(1)} inches`} className={`reserved-zone ${focusedZone === zone.uid ? "focused" : ""} ${zoneResize?.uid === zone.uid ? "resizing" : ""}`} style={{ left:`${zone.x / BOARD_IN * 100}%`, top:`${zone.y / BOARD_IN * 100}%`, width:`${zone.width / BOARD_IN * 100}%`, height:`${zone.height / BOARD_IN * 100}%` }} onPointerDown={(event) => { if (zoneMode) return; event.stopPropagation(); setFocusedZone(zone.uid); selectOnly(null); setMessage(`${zone.name} selected · drag a corner to resize`); }} onFocus={() => setFocusedZone(zone.uid)}><strong>{zone.name}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span>{!zoneMode && (["nw","ne","sw","se"] as ZoneCorner[]).map((corner) => <button key={corner} className={`zone-handle ${corner}`} aria-label={`Resize ${zone.name} from ${corner} corner`} title="Drag to resize" onPointerDown={(event) => beginZoneResize(event, zone, corner)} />)}</div>)}
              {zoneDraft && (() => { const zone = normaliseZoneDraft(zoneDraft); return <div className="reserved-zone draft" style={{ left:`${zone.x / BOARD_IN * 100}%`, top:`${zone.y / BOARD_IN * 100}%`, width:`${zone.width / BOARD_IN * 100}%`, height:`${zone.height / BOARD_IN * 100}%` }}><strong>{zoneName.trim() || "Hangar"}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span></div>; })()}
              {marquee && (() => { const left = Math.min(marquee.startX, marquee.currentX); const top = Math.min(marquee.startY, marquee.currentY); return <div className="selection-marquee" aria-hidden="true" style={{ left:`${left / BOARD_IN * 100}%`, top:`${top / BOARD_IN * 100}%`, width:`${Math.abs(marquee.currentX - marquee.startX) / BOARD_IN * 100}%`, height:`${Math.abs(marquee.currentY - marquee.startY) / BOARD_IN * 100}%` }} />; })()}
              {pieces.map((piece) => {
                const def = getDef(piece.defId);
                const width = piece.rotation === 90 ? def.depth : def.width;
                const height = piece.rotation === 90 ? def.width : def.depth;
                const isSelected = selectedIds.includes(piece.uid);
                return <button key={piece.uid} title={`${def.name} · ${def.note} × ${Math.round(piece.height * MM_PER_IN)} mm high`} aria-label={`${def.name}, ${Math.round(piece.height * MM_PER_IN)} millimetres high${isSelected ? ", selected" : ""}`} aria-pressed={isSelected} className={`placed-piece ${def.kind} ${def.visual ? `visual-${def.visual}` : ""} ${piece.rotation === 90 ? "rotated" : ""} ${isSelected ? "selected" : ""}`} style={{ left:`${piece.x / BOARD_IN * 100}%`, top:`${piece.y / BOARD_IN * 100}%`, width:`${width / BOARD_IN * 100}%`, height:`${height / BOARD_IN * 100}%` }} onDoubleClick={() => rotatePiece(piece.uid)} onContextMenu={(event) => { event.preventDefault(); setFocusedZone(null); selectOnly(piece.uid); rotatePiece(piece.uid); }} onPointerDown={(event) => beginPieceDrag(event, piece)}><span className="terrain-detail" /></button>;
              })}
            </div>
          </div></div>
          <div className="status-line" id="board-help"><span role="status" aria-live="polite">{message}</span><span>{smartFit ? "Smart fit · " : "Overlap allowed · "}{zones.length ? `${zones.length} zone${zones.length === 1 ? "" : "s"} · ` : ""}{snap ? `Grid ${gridSize}″` : "Free placement"} · Drag empty space to multi-select · Ctrl C / V</span></div>
        </div>

        <aside className="inspector panel">
          <p className="eyebrow">Layout analysis</p><h2>{pieces.length ? "Playable sector" : "Ready to build"}</h2>
          {selectedPiece && <div className="selected-piece-editor">
            <div><span>{selectedIds.length > 1 ? "Selected group" : "Selected piece"}</span><strong>{selectedIds.length > 1 ? `${selectedIds.length} pieces` : getDef(selectedPiece.defId).shortName}</strong></div>
            <label><span>Height · Z</span><span className="dimension-input"><input aria-label="Selected piece height" type="number" min="10" max="300" step="1" value={Math.round(selectedPiece.height * MM_PER_IN)} onChange={(event) => setSelectedHeightMm(Number(event.target.value))} /> mm</span></label>
            <small>{selectedIds.length > 1 ? "Height changes apply to the whole selection" : `${getDef(selectedPiece.defId).note} footprint`}</small>
          </div>}
          <div className="metric"><span>Current layout</span><strong>{pieces.length} pcs</strong></div>
          <div className="metric"><span>Selected kit used</span><strong>{activeKitUsed} / {catalogueTotal}</strong></div>
          <div className="metric"><span>Active kit</span><strong>{activeCatalogueMeta.name}</strong></div>
          <div className="metric"><span>Footprint coverage</span><strong>{coverage.toFixed(1)}%</strong></div><div className="meter"><i style={{ width:`${Math.min(coverage * 5, 100)}%` }} /></div>
          <div className="metric"><span>Reserved clear space</span><strong>{zones.length} · {reservedCoverage.toFixed(1)}%</strong></div>
          <div className="metric"><span>{activeCatalogue === "boarding" ? "Operable hatchways" : "Wall modules"}</span><strong>{activeCatalogue === "boarding" ? doors : wallPieces.length}</strong></div><div className="metric"><span>Corridor loops</span><strong>{loops}</strong></div><div className="metric"><span>Open chambers</span><strong>{chambers}</strong></div>
          <div className="divider" />
          <p className="inspector-copy">{activeCatalogue === "boarding" ? "The generator scores 32 candidates, requires every hatch between collinear walls, rejects sub-3-inch near misses, and builds either exact junctions or consistent room-scale passages." : "Iron Labyrinth generation grows varied connector networks, keeps doors supported, rejects cramped near-misses, and favours turns, branches, corridors, and reserved-zone framing."}</p>
          <div className="layout-key">{activeCatalogue === "boarding" ? <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Hatchway</span><span><i className="key-pillar" /> Pillar</span></> : <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Wall end</span><span><i className="key-pillar" /> Connector</span></>}</div>
          {zones.length > 0 && <div className="zone-list"><div className="zone-list-heading"><span>Reserved zones</span><button onClick={() => { setZones([]); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMessage("Reserved zones cleared"); }}>Clear all</button></div><small className="zone-list-hint">Hover a zone for temporary handles, or click it to keep them active.</small>{zones.map((zone) => <div className={`zone-list-row ${focusedZone === zone.uid ? "active" : ""}`} key={zone.uid} onPointerDown={() => setFocusedZone(zone.uid)}><input aria-label={`Rename ${zone.name}`} value={zone.name} maxLength={32} onFocus={() => setFocusedZone(zone.uid)} onChange={(event) => setZones((current) => current.map((item) => item.uid === zone.uid ? { ...item, name:event.target.value } : item))} /><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span><button aria-label={`Remove ${zone.name}`} onClick={() => { setZones((current) => current.filter((item) => item.uid !== zone.uid)); if (focusedZone === zone.uid) setFocusedZone(null); if (zoneResize?.uid === zone.uid) setZoneResize(null); }}>×</button></div>)}</div>}
          <p className="accuracy-note">Scale basis: 48″ square board · 25.4 mm per inch. Iron Labyrinth dimensions are manufacturer-published; Boarding Actions footprints remain physical-kit approximations. Default wall height is 60 mm in both systems.</p>
        </aside>
      </section>
      {paletteDrag && <div className="drag-preview" style={{ left:paletteDrag.x, top:paletteDrag.y }}><span className={`piece-icon ${getDef(paletteDrag.defId).kind} ${getDef(paletteDrag.defId).width > 5 ? "long" : "short"} ${getDef(paletteDrag.defId).visual ? `visual-${getDef(paletteDrag.defId).visual}` : ""}`}><i /></span><small>{getDef(paletteDrag.defId).shortName}</small></div>}
    </main>
  );
}
