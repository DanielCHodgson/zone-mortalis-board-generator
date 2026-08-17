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
  kind: "wall" | "door" | "pillar" | "connector" | "end";
  visual?: "solid" | "grid" | "pipe" | "vertical-pipe" | "reinforced" | "fan";
  note: string;
};

type PlacedPiece = {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rotation: 0 | 90;
  height: number;
};

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

const CATALOGUES = {
  boarding: { name:"Boarding Actions", maker:"Games Workshop", description:"Complete Gallowdark wall set", source:"Measured physical-kit dimensions" },
  ttcombat: { name:"Iron Labyrinth", maker:"TTCombat", description:"Ultima Complex bundle", source:"TTCombat published dimensions" },
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
];

// Each plan is a small network of continuous structural runs. Gaps between
// runs are intentional corridors, while door tokens preserve traversal.
const RUN_LAYOUTS: GeneratorRun[][] = [
  [
    { x: 2, y: 9, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 20, y: 1, rotation: 90, sequence: ["wall-long", "door-short", "wall-long"] },
    { x: 28, y: 9, rotation: 0, sequence: ["door-long", "wall-long"] },
    { x: 28, y: 10, rotation: 90, sequence: ["wall-long", "door-long"] },
    { x: 2, y: 25, rotation: 0, sequence: ["door-long", "wall-long"] },
    { x: 16, y: 25, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 25, y: 25, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 16, y: 42, rotation: 0, sequence: ["door-long", "wall-long", "wall-long"] },
    { x: 43, y: 25, rotation: 90, sequence: ["door-long", "wall-long"] },
  ],
  [
    { x: 7, y: 2, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 7, y: 20, rotation: 0, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 24, y: 2, rotation: 90, sequence: ["door-long", "wall-long"] },
    { x: 24, y: 19, rotation: 90, sequence: ["wall-short", "door-long", "wall-long"] },
    { x: 25, y: 10, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 7, y: 37, rotation: 0, sequence: ["door-long", "wall-long"] },
    { x: 24, y: 37, rotation: 0, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 41, y: 10, rotation: 90, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 7, y: 21, rotation: 90, sequence: ["door-long", "wall-long"] },
  ],
  [
    { x: 3, y: 12, rotation: 0, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 21, y: 3, rotation: 90, sequence: ["wall-long", "door-long", "wall-short"] },
    { x: 28, y: 12, rotation: 0, sequence: ["wall-long", "door-long", "wall-long"] },
    { x: 12, y: 13, rotation: 90, sequence: ["wall-long", "door-long"] },
    { x: 3, y: 31, rotation: 0, sequence: ["door-long", "wall-long"] },
    { x: 12, y: 31, rotation: 90, sequence: ["wall-long", "door-long"] },
    { x: 20, y: 31, rotation: 0, sequence: ["wall-short", "door-long", "wall-long"] },
    { x: 39, y: 13, rotation: 90, sequence: ["door-long", "wall-long", "wall-long"] },
    { x: 27, y: 44, rotation: 0, sequence: ["wall-long", "door-long"] },
  ],
];

const getDef = (id: string) => TERRAIN.find((item) => item.id === id)!;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeCatalogue, setActiveCatalogue] = useState<"boarding" | "ttcombat">("boarding");
  const [snap, setSnap] = useState(true);
  const [gridSize, setGridSize] = useState(1);
  const [theme, setTheme] = useState<"industrial" | "gothic" | "desert">("industrial");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, true])));
  const [limits, setLimits] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, item.limit])));
  const [heightDefaults, setHeightDefaults] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, item.height])));
  const [drag, setDrag] = useState<{ uid: string; dx: number; dy: number } | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<{ defId: string; x: number; y: number } | null>(null);
  const paletteDragRef = useRef<{ defId: string; x: number; y: number } | null>(null);
  const [message, setMessage] = useState("Ready to build");
  const uidRef = useRef(0);

  const catalogueTerrain = useMemo(() => TERRAIN.filter((item) => item.catalogue === activeCatalogue), [activeCatalogue]);
  const activeCatalogueMeta = CATALOGUES[activeCatalogue];
  const catalogueTotal = catalogueTerrain.reduce((sum, item) => sum + limits[item.id], 0);
  const selectedPiece = pieces.find((piece) => piece.uid === selected) || null;
  const used = useMemo(() => pieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]: (acc[piece.defId] || 0) + 1 }), {}), [pieces]);
  const wallPieces = pieces.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
  const coverage = Math.min(100, pieces.reduce((sum, piece) => { const def = getDef(piece.defId); return sum + def.width * def.depth; }, 0) / (BOARD_IN * BOARD_IN) * 100);
  const doors = pieces.filter((piece) => getDef(piece.defId).kind === "door").length;
  const loops = Math.max(0, Math.min(6, Math.floor(wallPieces.length / 5) - 1));
  const chambers = Math.max(0, Math.min(7, Math.floor(wallPieces.length / 4)));

  const nextUid = () => `piece-${++uidRef.current}`;
  const quantize = useCallback((value: number) => snap ? Math.round(value / gridSize) * gridSize : Math.round(value * 10) / 10, [gridSize, snap]);

  const familyFor = (def: TerrainDef) => (["wall", "door"].includes(def.kind) ? "wall" : ["pillar", "connector"].includes(def.kind) ? "support" : "end");
  const familyHeightMm = (family: "wall" | "support" | "end") => {
    const matching = catalogueTerrain.filter((def) => familyFor(def) === family);
    return Math.round((heightDefaults[matching[0]?.id] || 0) * MM_PER_IN);
  };
  const setFamilyHeightMm = (family: "wall" | "support" | "end", millimetres: number) => {
    const nextHeight = clamp(millimetres, 10, 300) / MM_PER_IN;
    const matchingIds = new Set(catalogueTerrain.filter((def) => familyFor(def) === family).map((def) => def.id));
    setHeightDefaults((current) => ({ ...current, ...Object.fromEntries([...matchingIds].map((id) => [id, nextHeight])) }));
    setPieces((current) => current.map((piece) => matchingIds.has(piece.defId) ? { ...piece, height:nextHeight } : piece));
    setMessage(`${activeCatalogueMeta.name} ${family === "wall" ? "wall" : family} height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  const setSelectedHeightMm = (millimetres: number) => {
    if (!selected) return;
    const nextHeight = clamp(millimetres, 10, 300) / MM_PER_IN;
    setPieces((current) => current.map((piece) => piece.uid === selected ? { ...piece, height:nextHeight } : piece));
    setMessage(`Selected piece height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  const addPiece = useCallback((defId: string, x = 24, y = 24, rotation: 0 | 90 = 0) => {
    const def = getDef(defId);
    const current = pieces.filter((piece) => piece.defId === defId).length;
    if (!enabled[defId] || current >= limits[defId]) { setMessage("No more of that piece available"); return; }
    const w = rotation === 90 ? def.depth : def.width;
    const h = rotation === 90 ? def.width : def.depth;
    const piece = { uid: nextUid(), defId, x: quantize(clamp(x - w / 2, 0, BOARD_IN - w)), y: quantize(clamp(y - h / 2, 0, BOARD_IN - h)), rotation, height:heightDefaults[defId] };
    setPieces((currentPieces) => [...currentPieces, piece]);
    setSelected(piece.uid);
    setMessage(`${def.shortName} placed`);
  }, [enabled, heightDefaults, limits, pieces, quantize]);

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
  }, [quantize]);

  const rotateSelected = useCallback(() => {
    if (selected) rotatePiece(selected);
  }, [rotatePiece, selected]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setPieces((current) => current.filter((piece) => piece.uid !== selected));
    setSelected(null);
    setMessage("Piece returned to inventory");
  }, [selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, select")) return;
      if (event.key.toLowerCase() === "r") rotateSelected();
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, rotateSelected]);

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
    const edgePlan: Array<[number, number, number, number]> = [
      [1,1,2,1], [2,1,3,1], [1,1,1,2], [1,2,1,3], [1,3,2,3], [2,3,3,3],
      [3,1,3,2], [3,2,4,2], [4,2,5,2], [5,1,6,1], [6,1,7,1], [7,1,7,2],
      [7,2,7,3], [5,3,6,3], [6,3,7,3], [5,1,5,2], [4,3,4,4], [4,4,4,5],
    ];
    const wallPool = catalogueTerrain.filter((def) => def.kind === "wall" && enabled[def.id]).flatMap((def) => Array.from({ length:limits[def.id] }, () => def)).sort(() => Math.random() - .5);
    const connectorDef = catalogueTerrain.find((def) => def.kind === "connector" && enabled[def.id] && limits[def.id] > 0);
    const endDef = catalogueTerrain.find((def) => def.kind === "end" && enabled[def.id] && limits[def.id] > 0);
    const pitch = (50 + 64) / MM_PER_IN;
    const originX = 3 + Math.round(Math.random() * 3);
    const originY = 4 + Math.round(Math.random() * 3);
    const nodePosition = (gx: number, gy: number) => ({ x:originX + gx * pitch, y:originY + gy * pitch });
    const chosenEdges = edgePlan.slice(0, Math.min(edgePlan.length, wallPool.length));
    const generated: PlacedPiece[] = [];
    const nodeKeys = new Set<string>();
    const degree: Record<string, number> = {};

    chosenEdges.forEach(([ax, ay, bx, by], index) => {
      const def = wallPool[index];
      const start = nodePosition(ax, ay);
      const rotation: 0 | 90 = ax === bx ? 90 : 0;
      const connectorSize = connectorDef?.width || 50 / MM_PER_IN;
      const x = rotation === 0 ? start.x + connectorSize : start.x + (connectorSize - def.depth) / 2;
      const y = rotation === 0 ? start.y + (connectorSize - def.depth) / 2 : start.y + connectorSize;
      generated.push({ uid:nextUid(), defId:def.id, x, y, rotation, height:heightDefaults[def.id] });
      const aKey = `${ax},${ay}`;
      const bKey = `${bx},${by}`;
      nodeKeys.add(aKey); nodeKeys.add(bKey);
      degree[aKey] = (degree[aKey] || 0) + 1;
      degree[bKey] = (degree[bKey] || 0) + 1;
    });

    if (connectorDef) {
      [...nodeKeys].slice(0, limits[connectorDef.id]).forEach((key) => {
        const [gx, gy] = key.split(",").map(Number);
        const point = nodePosition(gx, gy);
        generated.push({ uid:nextUid(), defId:connectorDef.id, x:point.x, y:point.y, rotation:0, height:heightDefaults[connectorDef.id] });
      });
    }

    if (endDef && connectorDef) {
      Object.entries(degree).filter(([, count]) => count === 1).slice(0, Math.min(8, limits[endDef.id])).forEach(([key]) => {
        const [gx, gy] = key.split(",").map(Number);
        const point = nodePosition(gx, gy);
        const horizontal = Math.abs(gx - 4) >= Math.abs(gy - 3);
        const towardNegative = horizontal ? gx < 4 : gy < 3;
        const rotation: 0 | 90 = horizontal ? 0 : 90;
        const width = rotation === 0 ? endDef.width : endDef.depth;
        const height = rotation === 0 ? endDef.depth : endDef.width;
        const x = horizontal ? point.x + (towardNegative ? -width : connectorDef.width) : point.x + (connectorDef.width - width) / 2;
        const y = horizontal ? point.y + (connectorDef.depth - height) / 2 : point.y + (towardNegative ? -height : connectorDef.depth);
        generated.push({ uid:nextUid(), defId:endDef.id, x:clamp(x, 0, BOARD_IN - width), y:clamp(y, 0, BOARD_IN - height), rotation, height:heightDefaults[endDef.id] });
      });
    }

    setPieces(generated);
    setSelected(null);
    setMessage(`Iron Labyrinth sector generated · ${generated.length} pieces`);
  };

  const generateLayout = () => {
    if (activeCatalogue === "ttcombat") { generateIronLabyrinth(); return; }
    const candidates = Array.from({ length: 16 }, (_, attempt) => {
      const base = RUN_LAYOUTS[(attempt + Math.floor(Math.random() * RUN_LAYOUTS.length)) % RUN_LAYOUTS.length];
      const quarterTurns = Math.floor(Math.random() * 4);
      const pool: Record<string, number> = {};
      const generated: PlacedPiece[] = [];
      base.forEach((run) => {
        let cursorX = run.x;
        let cursorY = run.y;
        run.sequence.forEach((token) => {
          const slot = { x: cursorX, y: cursorY, rotation: run.rotation, length: token.endsWith("long") ? "long" as const : "short" as const, door: token.startsWith("door") };
          const def = chooseDefinition(slot, pool);
          if (!def) return;
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
          generated.push({ uid: `candidate-${attempt}-${generated.length}`, defId: def.id, x: quantize(clamp(x, 0, BOARD_IN - w)), y: quantize(clamp(y, 0, BOARD_IN - h)), rotation, height:heightDefaults[def.id] });
          if (run.rotation === 0) cursorX += def.width;
          else cursorY += def.width;
        });
      });
      const doorCount = generated.filter((piece) => getDef(piece.defId).kind === "door").length;
      const longCount = generated.filter((piece) => getDef(piece.defId).width > 5).length;
      const score = generated.length * 4 + Math.min(doorCount, 9) * 5 + Math.min(longCount, 12) * 2 + base.length * 3 - Math.abs(8 - doorCount) * 3;
      return { generated, score };
    }).sort((a, b) => b.score - a.score)[0];

    const finalPieces = candidates.generated.map((piece) => ({ ...piece, uid: nextUid() }));
    const pool = finalPieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]: (acc[piece.defId] || 0) + 1 }), {});
    const supportDef = TERRAIN.find((item) => item.catalogue === activeCatalogue && ["pillar", "connector"].includes(item.kind) && enabled[item.id] && limits[item.id] > 0);
    if (supportDef) {
      const jointPoints = finalPieces.slice(0, Math.min(limits[supportDef.id], 12)).map((piece, index) => ({
        uid: nextUid(), defId: supportDef.id, x: clamp(piece.x - (index % 2 ? 0 : .5), 0, 47), y: clamp(piece.y - (index % 2 ? .5 : 0), 0, 47), rotation: 0 as const, height:heightDefaults[supportDef.id],
      }));
      finalPieces.push(...jointPoints);
      pool[supportDef.id] = jointPoints.length;
    }
    const endDef = TERRAIN.find((item) => item.catalogue === activeCatalogue && item.kind === "end" && enabled[item.id] && limits[item.id] > 0);
    if (endDef) {
      const wallEnds = finalPieces.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind)).filter((_, index) => index % 3 === 0).slice(0, Math.min(limits[endDef.id], activeCatalogue === "ttcombat" ? 8 : 4)).map((piece) => {
        const def = getDef(piece.defId);
        return { uid:nextUid(), defId:endDef.id, x:clamp(piece.x + (piece.rotation === 0 ? def.width : 0), 0, BOARD_IN - endDef.width), y:clamp(piece.y + (piece.rotation === 90 ? def.width : 0), 0, BOARD_IN - endDef.depth), rotation:piece.rotation, height:heightDefaults[endDef.id] };
      });
      finalPieces.push(...wallEnds);
    }
    setPieces(finalPieces);
    setSelected(null);
    setMessage(`${activeCatalogueMeta.name} sector generated · ${finalPieces.length} pieces`);
  };

  const boardPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * BOARD_IN, y: (clientY - rect.top) / rect.height * BOARD_IN };
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
    if (!drag || !boardRef.current) return;
    const point = boardPoint(event.clientX, event.clientY);
    setPieces((current) => current.map((piece) => {
      if (piece.uid !== drag.uid) return piece;
      const def = getDef(piece.defId);
      const w = piece.rotation === 90 ? def.depth : def.width;
      const h = piece.rotation === 90 ? def.width : def.depth;
      return { ...piece, x: quantize(clamp(point.x - drag.dx, 0, BOARD_IN - w)), y: quantize(clamp(point.y - drag.dy, 0, BOARD_IN - h)) };
    }));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Horus Heresy layout utility</p><h1>Mortalis Architect</h1></div>
        <div className="top-actions"><span className="board-chip">BOARD 48 × 48 IN</span><button className="primary" onClick={generateLayout}>Generate layout</button></div>
      </header>

      <section className="workspace">
        <aside className="catalogue panel">
          <div className="catalogue-tabs" aria-label="Terrain catalogue">
            {(Object.keys(CATALOGUES) as Array<keyof typeof CATALOGUES>).map((catalogueId) => <button key={catalogueId} className={activeCatalogue === catalogueId ? "active" : ""} onClick={() => setActiveCatalogue(catalogueId)}><span>{CATALOGUES[catalogueId].maker}</span><strong>{CATALOGUES[catalogueId].name}</strong></button>)}
          </div>
          <div className="panel-heading"><div><p className="eyebrow">Available terrain</p><h2>{activeCatalogueMeta.name}</h2><small className="catalogue-subtitle">{activeCatalogueMeta.description}</small></div><span className="count">{catalogueTotal} pcs</span></div>
          <details className="height-settings" open>
            <summary><span>Height defaults</span><em>Z axis · mm</em></summary>
            <div className="height-grid">
              <label><span>Walls {activeCatalogue === "boarding" ? "& doors" : ""}</span><input aria-label={`${activeCatalogueMeta.name} wall default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("wall")} onChange={(event) => setFamilyHeightMm("wall", Number(event.target.value))} /></label>
              <label><span>{activeCatalogue === "boarding" ? "Pillars" : "Connectors"}</span><input aria-label={`${activeCatalogueMeta.name} support default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("support")} onChange={(event) => setFamilyHeightMm("support", Number(event.target.value))} /></label>
              <label><span>Wall ends</span><input aria-label={`${activeCatalogueMeta.name} end default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("end")} onChange={(event) => setFamilyHeightMm("end", Number(event.target.value))} /></label>
            </div>
          </details>
          <div className="catalogue-scroll">
            {catalogueTerrain.map((def) => {
              const remaining = Math.max(0, limits[def.id] - (used[def.id] || 0));
              return (
                <div className={`terrain-row ${!enabled[def.id] ? "disabled" : ""}`} key={def.id} onPointerDown={(event) => { if (!enabled[def.id] || remaining === 0 || (event.target as HTMLElement).closest("input")) return; const nextDrag = { defId:def.id, x:event.clientX, y:event.clientY }; paletteDragRef.current = nextDrag; setPaletteDrag(nextDrag); }}>
                  <input aria-label={`Include ${def.name}`} type="checkbox" checked={enabled[def.id]} onChange={(event) => setEnabled((current) => ({ ...current, [def.id]: event.target.checked }))} />
                  <button className="piece-add" onClick={() => addPiece(def.id)} disabled={!enabled[def.id] || remaining === 0} aria-label={`Add ${def.name}`}>
                    <span className={`piece-icon ${def.kind} ${def.width > 5 ? "long" : "short"} ${def.visual ? `visual-${def.visual}` : ""}`}><i /></span>
                    <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · Z {Math.round(heightDefaults[def.id] * MM_PER_IN)} mm</small></span>
                  </button>
                  <label className="stock"><span>×</span><input aria-label={`${def.name} quantity`} type="number" min="0" max={def.limit} value={limits[def.id]} onChange={(event) => setLimits((current) => ({ ...current, [def.id]: clamp(Number(event.target.value), 0, def.limit) }))} /><em>{remaining} left</em></label>
                </div>
              );
            })}
          </div>
          <p className="hint">Drag or click to place. Quantities match one complete {activeCatalogueMeta.name} set. {activeCatalogueMeta.source}.</p>
        </aside>

        <div className="board-column">
          <div className="board-toolbar panel">
            <div className="tool-group"><button className="tool active">Select</button><button className="tool" onClick={rotateSelected} disabled={!selected}>Rotate 90° <kbd>R</kbd></button><button className="tool danger" onClick={deleteSelected} disabled={!selected}>Delete</button></div>
            <div className="tool-group settings">
              <label className="switch-label"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /><span className="toggle" /> Snap</label>
              {snap && <select aria-label="Snap grid size" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))}><option value="1">1″ grid</option><option value="0.5">½″ grid</option></select>}
              <div className="theme-switch" aria-label="Board style">{(["industrial", "gothic", "desert"] as const).map((item) => <button key={item} className={theme === item ? "active" : ""} onClick={() => setTheme(item)}>{item}</button>)}</div>
            </div>
          </div>

          <div className="board-frame">
            <div className="ruler ruler-top"><span>0</span><span>12</span><span>24</span><span>36</span><span>48″</span></div>
            <div className="ruler ruler-left"><span>0</span><span>12</span><span>24</span><span>36</span><span>48″</span></div>
            <div ref={boardRef} className={`board ${theme}-board ${drag ? "dragging" : ""}`} aria-label="48 by 48 inch layout board" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPointerMove={onBoardPointerMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)} onPointerDown={(event) => { if (event.target === boardRef.current) setSelected(null); }}>
              {pieces.length === 0 && <div className="board-mark"><strong>4′ × 4′</strong><span>DROP TERRAIN TO PLACE</span></div>}
              {pieces.map((piece) => {
                const def = getDef(piece.defId);
                const width = piece.rotation === 90 ? def.depth : def.width;
                const height = piece.rotation === 90 ? def.width : def.depth;
                return <button key={piece.uid} title={`${def.name} · ${def.note} × ${Math.round(piece.height * MM_PER_IN)} mm high`} aria-label={`${def.name}, ${Math.round(piece.height * MM_PER_IN)} millimetres high, selected ${selected === piece.uid}`} className={`placed-piece ${def.kind} ${def.visual ? `visual-${def.visual}` : ""} ${piece.rotation === 90 ? "rotated" : ""} ${selected === piece.uid ? "selected" : ""}`} style={{ left:`${piece.x / BOARD_IN * 100}%`, top:`${piece.y / BOARD_IN * 100}%`, width:`${width / BOARD_IN * 100}%`, height:`${height / BOARD_IN * 100}%` }} onDoubleClick={() => rotatePiece(piece.uid)} onContextMenu={(event) => { event.preventDefault(); setSelected(piece.uid); rotatePiece(piece.uid); }} onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); setSelected(piece.uid); const point = boardPoint(event.clientX, event.clientY); setDrag({ uid:piece.uid, dx:point.x - piece.x, dy:point.y - piece.y }); }}><span className="terrain-detail" /></button>;
              })}
            </div>
          </div>
          <div className="status-line"><span>{message}</span><span>{snap ? `Snap ${gridSize}″` : "Free placement"} · R rotate · Del remove</span></div>
        </div>

        <aside className="inspector panel">
          <p className="eyebrow">Layout analysis</p><h2>{pieces.length ? "Playable sector" : "Ready to build"}</h2>
          {selectedPiece && <div className="selected-piece-editor">
            <div><span>Selected piece</span><strong>{getDef(selectedPiece.defId).shortName}</strong></div>
            <label><span>Height · Z</span><span className="dimension-input"><input aria-label="Selected piece height" type="number" min="10" max="300" step="1" value={Math.round(selectedPiece.height * MM_PER_IN)} onChange={(event) => setSelectedHeightMm(Number(event.target.value))} /> mm</span></label>
            <small>{getDef(selectedPiece.defId).note} footprint</small>
          </div>}
          <div className="metric"><span>Terrain used</span><strong>{pieces.length} / {catalogueTotal}</strong></div>
          <div className="metric"><span>Active catalogue</span><strong>{activeCatalogueMeta.maker}</strong></div>
          <div className="metric"><span>Footprint coverage</span><strong>{coverage.toFixed(1)}%</strong></div><div className="meter"><i style={{ width:`${Math.min(coverage * 5, 100)}%` }} /></div>
          <div className="metric"><span>{activeCatalogue === "boarding" ? "Operable hatchways" : "Wall modules"}</span><strong>{activeCatalogue === "boarding" ? doors : wallPieces.length}</strong></div><div className="metric"><span>Corridor loops</span><strong>{loops}</strong></div><div className="metric"><span>Open chambers</span><strong>{chambers}</strong></div>
          <div className="divider" />
          <p className="inspector-copy">{activeCatalogue === "boarding" ? "The generator scores 16 candidates for route variety, door spacing, connected lanes and useful open negative space." : "Iron Labyrinth plans use a modular connector graph, preserving exact 50 mm nodes and 64 mm spans to form connected chambers and passage runs."}</p>
          <div className="layout-key">{activeCatalogue === "boarding" ? <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Hatchway</span><span><i className="key-pillar" /> Pillar</span></> : <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Wall end</span><span><i className="key-pillar" /> Connector</span></>}</div>
          <button className="secondary" disabled={!pieces.length} onClick={() => { setPieces([]); setSelected(null); setMessage("Board cleared"); }}>Clear board</button>
          <p className="accuracy-note">Scale basis: 48″ square board · 25.4 mm per inch. Iron Labyrinth dimensions are manufacturer-published; Boarding Actions footprints remain physical-kit approximations. Default wall height is 60 mm in both systems.</p>
        </aside>
      </section>
      {paletteDrag && <div className="drag-preview" style={{ left:paletteDrag.x, top:paletteDrag.y }}><span className={`piece-icon ${getDef(paletteDrag.defId).kind} ${getDef(paletteDrag.defId).width > 5 ? "long" : "short"} ${getDef(paletteDrag.defId).visual ? `visual-${getDef(paletteDrag.defId).visual}` : ""}`}><i /></span><small>{getDef(paletteDrag.defId).shortName}</small></div>}
    </main>
  );
}
