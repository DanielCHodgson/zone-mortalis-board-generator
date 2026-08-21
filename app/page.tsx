"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generate, type Anchor, type GenerateReport } from "./generate.ts";
import {
  APPEARANCE_STORAGE_KEY, BOARDING_INVENTORY, BOARD_SIZES, BOARD_STORAGE_KEY, MANUFACTURERS,
  MM_PER_IN, PALETTE_STORAGE_KEY, TERRAIN, TERRAIN_KITS, getDef,
  type Appearance, type BoardPreset, type CatalogueId, type TerrainDef,
} from "./terrain.ts";

type PlacedPiece = {
  uid: string;
  defId: string;
  x: number;
  y: number;
  rotation: 0 | 90;
  height: number;
  runId?: string;
  sequenceIndex?: number;
  /** Set by the generator on a hatchway panel whose door is a route the plan uses. A
   *  hatchway panel without it is standing in a wall run with its door shut. */
  servesDoorway?: boolean;
  /** Set by the generator on a shaped corner/T casting — which way its icon points. */
  facing?: 0 | 90 | 180 | 270;
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

const MIN_BOARD_SIZE = 12;
const MAX_BOARD_WIDTH = BOARD_SIZES["60x48"].width;
const MAX_BOARD_HEIGHT = BOARD_SIZES["60x48"].height;
const BOARD_ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200] as const;
const EBERLEG_LEGEND = TERRAIN.filter((def) => def.catalogue === "eberleg");
const pieceIconClass = (def:TerrainDef) => `piece-icon piece-${def.id} ${def.kind} ${def.width > 5 ? "long" : "short"} ${def.visual ? `visual-${def.visual}` : ""}`;

/** A piece being dragged toward the board. "palette" drags an existing palette
 *  entry (already counted in `limits`); "catalogue" drags a not-yet-added kit
 *  piece, which drops with `amount` copies added to the palette on release. */
type PaletteDragState = { defId: string; x: number; y: number; source: "palette" | "catalogue"; amount?: number };

/** One way a dragged piece could meet a fixed one: the offset that joins them, and
 *  the rotation the move implies where the joint only works at right angles (a wall
 *  end capping a run, or a wall meeting a connector face). */
type ConnectionCandidate = { dx:number; dy:number; rotation?:0 | 90 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Decorrelates the seeds of the several lattices a mixed board generates, so two
 *  catalogues on the same table at the same size do not come out mirror-identical.
 *  Derived from the id so a new catalogue needs nothing added here. */
const catalogueSalt = (catalogue: CatalogueId) =>
  [...catalogue].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 17);

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const boardPanRef = useRef<{ pointerId:number; x:number; y:number; scrollLeft:number; scrollTop:number } | null>(null);
  const zoomAnchorRef = useRef<{ xRatio:number; yRatio:number; clientX:number; clientY:number } | null>(null);
  const [pieces, setPieces] = useState<PlacedPiece[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeCatalogue, setActiveCatalogue] = useState<CatalogueId>("boarding");
  const [activeKitId, setActiveKitId] = useState("boarding-actions");
  const [snap, setSnap] = useState(true);
  const [smartFit, setSmartFit] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"palette" | "analysis">("palette");
  // Spend the whole palette by default. This used to default to 60% and cap at 60%,
  // which made every generated board 40% short of what the box could build — and it
  // was needed back when nothing else stopped the generator cramming terrain in.
  // The density cap in generate.ts does that job properly now, so this is back to
  // being what it says: a deliberate way to hold pieces back.
  const [generationPercent, setGenerationPercent] = useState(100);
  const [gridSize, setGridSize] = useState(1);
  const [boardZoom, setBoardZoom] = useState(100);
  const [boardPanning, setBoardPanning] = useState(false);
  const [theme, setTheme] = useState<"industrial" | "gothic" | "desert">("industrial");
  const [boardPreset, setBoardPreset] = useState<BoardPreset | "custom">("card");
  const [boardReady, setBoardReady] = useState(false);
  // Only meaningful while boardPreset is "custom" — set the moment a drag resize
  // starts (from whatever the board size was at that point) and kept in sync on
  // every pointer move. Picking a preset from the dropdown ignores this entirely.
  const [customBoardSize, setCustomBoardSize] = useState<{ width:number; height:number }>(BOARD_SIZES.card);
  const [boardResize, setBoardResize] = useState<{ scale:number; startX:number; startY:number; startWidth:number; startHeight:number } | null>(null);
  // Light or dark for the whole application, distinct from the board STYLE below
  // (industrial / gothic / desert), which is what the terrain is made of rather than
  // how the interface is lit. Starts from the operating system and is remembered
  // once the user chooses.
  const [appearance, setAppearance] = useState<Appearance>("light");
  const [appearanceReady, setAppearanceReady] = useState(false);
  // The last generator report, so the board can show what it actually built —
  // grid size, density, sight line and what stayed in the box. The generator
  // computes all of it; not surfacing it was leaving the reader to guess.
  const [layoutReport, setLayoutReport] = useState<GenerateReport | null>(null);
  // Where a complex smaller than the board goes. Not cosmetic — the board border is
  // a free wall, so a corner uses two of them and spends more of the kit on interior
  // structure, while a centred island has to build its own perimeter.
  const [anchor, setAnchor] = useState<Anchor>("fill");
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, Boolean(BOARDING_INVENTORY[item.id])])));
  const [limits, setLimits] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, BOARDING_INVENTORY[item.id] || 0])));
  const [kitAddAmounts, setKitAddAmounts] = useState<Record<string, number>>({});
  const [paletteReady, setPaletteReady] = useState(false);
  const [heightDefaults, setHeightDefaults] = useState<Record<string, number>>(() => Object.fromEntries(TERRAIN.map((item) => [item.id, item.height])));
  const [drag, setDrag] = useState<{ uids:string[]; startX:number; startY:number; origins:Record<string, {x:number;y:number}> } | null>(null);
  const [marquee, setMarquee] = useState<{ startX:number; startY:number; currentX:number; currentY:number; additive:boolean } | null>(null);
  const [copyBuffer, setCopyBuffer] = useState<{ pieces:PlacedPiece[]; pasteCount:number } | null>(null);
  const [zones, setZones] = useState<ReservedZone[]>([]);
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneName, setZoneName] = useState("Hangar");
  const [zoneDraft, setZoneDraft] = useState<{ startX:number; startY:number; currentX:number; currentY:number } | null>(null);
  const [zoneResize, setZoneResize] = useState<{ uid:string; corner:ZoneCorner; anchorX:number; anchorY:number } | null>(null);
  const [zoneDrag, setZoneDrag] = useState<{ uid:string; startX:number; startY:number; originX:number; originY:number } | null>(null);
  const [focusedZone, setFocusedZone] = useState<string | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDragState | null>(null);
  const paletteDragRef = useRef<PaletteDragState | null>(null);
  const [message, setMessage] = useState("Ready to build");
  const uidRef = useRef(0);
  const generationInventoryRef = useRef<Record<string, number> | null>(null);
  const lastReportRef = useRef<GenerateReport | null>(null);
  const { width:boardWidth, height:boardHeight } = boardPreset === "custom" ? customBoardSize : BOARD_SIZES[boardPreset];
  const changeBoardZoom = (direction:-1 | 1) => {
    setBoardZoom((current) => {
      const index = BOARD_ZOOM_STEPS.findIndex((value) => value === current);
      const next = BOARD_ZOOM_STEPS[clamp(index + direction, 0, BOARD_ZOOM_STEPS.length - 1)];
      setMessage(`Board zoom ${next}%`);
      return next;
    });
  };
  const zoomBoardAtPointer = (event:React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) < Math.abs(event.deltaX) || !boardRef.current) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const index = BOARD_ZOOM_STEPS.findIndex((value) => value === boardZoom);
    if (index + direction < 0 || index + direction >= BOARD_ZOOM_STEPS.length) {
      zoomAnchorRef.current = null;
      return;
    }
    const rect = boardRef.current.getBoundingClientRect();
    zoomAnchorRef.current = {
      xRatio:clamp((event.clientX - rect.left) / rect.width, 0, 1),
      yRatio:clamp((event.clientY - rect.top) / rect.height, 0, 1),
      clientX:event.clientX,
      clientY:event.clientY,
    };
    changeBoardZoom(direction);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (!anchor || !boardAreaRef.current || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const nextClientX = rect.left + rect.width * anchor.xRatio;
    const nextClientY = rect.top + rect.height * anchor.yRatio;
    boardAreaRef.current.scrollLeft += nextClientX - anchor.clientX;
    boardAreaRef.current.scrollTop += nextClientY - anchor.clientY;
    zoomAnchorRef.current = null;
  }, [boardZoom]);
  const beginBoardPan = (event:React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 || !boardAreaRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    boardPanRef.current = { pointerId:event.pointerId, x:event.clientX, y:event.clientY, scrollLeft:boardAreaRef.current.scrollLeft, scrollTop:boardAreaRef.current.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    setBoardPanning(true);
  };
  const moveBoardPan = (event:React.PointerEvent<HTMLDivElement>) => {
    const pan = boardPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId || !boardAreaRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    boardAreaRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    boardAreaRef.current.scrollTop = pan.scrollTop - (event.clientY - pan.y);
  };
  const finishBoardPan = (event:React.PointerEvent<HTMLDivElement>) => {
    if (boardPanRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    boardPanRef.current = null;
    setBoardPanning(false);
  };

  const manufacturerKits = useMemo(() => TERRAIN_KITS.filter((kit) => kit.catalogue === activeCatalogue), [activeCatalogue]);
  const activeCatalogueMeta = TERRAIN_KITS.find((kit) => kit.id === activeKitId) || TERRAIN_KITS[0];
  const kitTerrain = useMemo(() => TERRAIN.filter((item) => (activeCatalogueMeta.inventory[item.id] || 0) > 0), [activeCatalogueMeta]);
  const paletteCatalogues = useMemo(() => ([...new Set(TERRAIN.filter((item) => (limits[item.id] || 0) > 0).map((item) => item.catalogue))]), [limits]);
  const catalogueTerrain = useMemo(() => TERRAIN.filter((item) => (limits[item.id] || 0) > 0), [limits]);
  const catalogueTotal = catalogueTerrain.reduce((sum, item) => sum + (limits[item.id] || 0), 0);
  const activeKitTotal = kitTerrain.reduce((sum, item) => sum + (activeCatalogueMeta.inventory[item.id] || 0), 0);
  const paletteMaker = paletteCatalogues.length ? paletteCatalogues.map((catalogue) => MANUFACTURERS[catalogue].name).join(" + ") : null;
  // Named from the catalogue rather than spelled out per range: with the two names
  // hard-coded, a Zone Mortalis or Deadbolt's Derelict palette fell through to
  // "Empty palette" while holding a full kit.
  const paletteLabel = paletteCatalogues.length > 1
    ? "Mixed terrain palette"
    : paletteCatalogues[0] ? `${MANUFACTURERS[paletteCatalogues[0]].range} palette` : "Empty palette";
  const generationCatalogue = paletteCatalogues[0] || activeCatalogue;
  // Whether the generated board is described in straddling-column or butting-
  // connector terms. Was `generationCatalogue === "boarding"`, so Zone Mortalis and
  // Deadbolt's Derelict — both straddling ranges — got Iron Labyrinth's copy.
  const generationJoint = MANUFACTURERS[generationCatalogue].joint;
  const generationRange = MANUFACTURERS[generationCatalogue].range;
  const selectedPiece = pieces.find((piece) => piece.uid === selected) || null;
  const used = useMemo(() => pieces.reduce<Record<string, number>>((acc, piece) => ({ ...acc, [piece.defId]: (acc[piece.defId] || 0) + 1 }), {}), [pieces]);
  // What you'd need to pull off the sprue to build the CURRENT board, not what the
  // palette has available. Grouped by catalogue because a mixed-kit board needs
  // pieces out of more than one box. Ordered the way TERRAIN already lists them
  // (walls, then doors, then supports, per catalogue) rather than sorting again.
  const usedInventory = useMemo(() => {
    const groups: { catalogue:CatalogueId; maker:string; range:string; items:{ def:TerrainDef; count:number }[] }[] = [];
    TERRAIN.forEach((def) => {
      const count = used[def.id] || 0;
      if (!count) return;
      let group = groups.find((candidate) => candidate.catalogue === def.catalogue);
      if (!group) {
        const meta = MANUFACTURERS[def.catalogue];
        group = { catalogue:def.catalogue, maker:meta.name, range:meta.range, items:[] };
        groups.push(group);
      }
      group.items.push({ def, count });
    });
    return groups;
  }, [used]);
  const usedTotal = pieces.length;
  const paletteUsed = catalogueTerrain.reduce((sum, def) => sum + Math.min(used[def.id] || 0, limits[def.id] || 0), 0);
  const wallPieces = pieces.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
  const coverage = Math.min(100, pieces.reduce((sum, piece) => { const def = getDef(piece.defId); return sum + def.width * def.depth; }, 0) / (boardWidth * boardHeight) * 100);
  const doors = pieces.filter((piece) => getDef(piece.defId).kind === "door").length;
  const loops = Math.max(0, Math.min(6, Math.floor(wallPieces.length / 5) - 1));
  const chambers = Math.max(0, Math.min(7, Math.floor(wallPieces.length / 4)));

  const selectKit = (kitId: string) => {
    const kit = TERRAIN_KITS.find((candidate) => candidate.id === kitId);
    if (!kit) return;
    setActiveCatalogue(kit.catalogue);
    setActiveKitId(kit.id);
    setMessage(`${kit.name} opened · choose pieces to add to the persistent palette`);
  };

  const selectManufacturer = (catalogue: CatalogueId) => {
    const firstKit = TERRAIN_KITS.find((kit) => kit.catalogue === catalogue);
    if (firstKit) selectKit(firstKit.id);
  };

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(PALETTE_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Record<string, number>;
          const restored = Object.fromEntries(TERRAIN.map((item) => [item.id, clamp(Number(parsed[item.id]) || 0, 0, 999)]));
          setLimits(restored);
          setEnabled(Object.fromEntries(TERRAIN.map((item) => [item.id, restored[item.id] > 0])));
        }
      } catch { /* Ignore unavailable or malformed device-local storage. */ }
      setPaletteReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!paletteReady) return;
    try { window.localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(limits)); } catch { /* Persistence is a convenience, not a requirement. */ }
  }, [limits, paletteReady]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(BOARD_STORAGE_KEY) as BoardPreset | null;
        if (saved && saved in BOARD_SIZES) setBoardPreset(saved);
      } catch { /* Board size persistence is optional. */ }
      setBoardReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  // Appearance: follow the operating system until the user says otherwise, then
  // remember the choice. Read after mount rather than during render, because the
  // server has no way to know what the device prefers and guessing produces a flash
  // of the wrong theme.
  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      let saved: Appearance | null = null;
      try { saved = window.localStorage.getItem(APPEARANCE_STORAGE_KEY) as Appearance | null; } catch { /* Appearance persistence is optional. */ }
      if (saved === "light" || saved === "dark") setAppearance(saved);
      else setAppearance(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      setAppearanceReady(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    // The attribute is applied on every change, but the write to storage waits for
    // the restore pass. Writing unconditionally means this effect runs once on mount
    // with the initial default and overwrites the saved choice before the restore
    // has had a chance to read it — so the app always came back light.
    document.documentElement.dataset.appearance = appearance;
    if (!appearanceReady) return;
    try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance); } catch { /* Appearance persistence is optional. */ }
  }, [appearance, appearanceReady]);

  useEffect(() => {
    // A drag-resized "custom" board isn't a BOARD_SIZES key, so it can't be
    // restored — leave the last preset on disk rather than an unresolvable value.
    if (!boardReady || boardPreset === "custom") return;
    try { window.localStorage.setItem(BOARD_STORAGE_KEY, boardPreset); } catch { /* Board size persistence is optional. */ }
  }, [boardPreset, boardReady]);

  const setPaletteQuantity = (defId: string, quantity: number) => {
    const nextQuantity = clamp(Math.round(quantity || 0), 0, 999);
    setLimits((current) => ({ ...current, [defId]:nextQuantity }));
    setEnabled((current) => ({ ...current, [defId]:nextQuantity > 0 }));
  };

  const addToPalette = (defId: string, quantity: number) => {
    const def = getDef(defId);
    const amount = clamp(Math.round(quantity || 0), 1, 999);
    setLimits((current) => ({ ...current, [defId]:clamp((current[defId] || 0) + amount, 0, 999) }));
    setEnabled((current) => ({ ...current, [defId]:true }));
    setMessage(`${amount} × ${def.shortName} added to the generator palette`);
  };

  const addKitToPalette = () => {
    setLimits((current) => ({ ...current, ...Object.fromEntries(kitTerrain.map((def) => [def.id, clamp((current[def.id] || 0) + (activeCatalogueMeta.inventory[def.id] || 0), 0, 999)])) }));
    setEnabled((current) => ({ ...current, ...Object.fromEntries(kitTerrain.map((def) => [def.id, true])) }));
    setMessage(`${activeCatalogueMeta.name} added to the generator palette`);
  };

  const clearPalette = () => {
    setLimits(Object.fromEntries(TERRAIN.map((item) => [item.id, 0])));
    setEnabled(Object.fromEntries(TERRAIN.map((item) => [item.id, false])));
    setMessage("Terrain palette cleared · pieces already on the board were preserved");
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
  const reservedCoverage = zones.reduce((sum, zone) => sum + zone.width * zone.height, 0) / (boardWidth * boardHeight) * 100;
  const pieceRect = (piece: PlacedPiece) => {
    const def = getDef(piece.defId);
    return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
  };
  const fitTerrainToBoardSize = (next: { width:number; height:number }) => {
    setPieces((current) => current.map((piece) => {
      const rect = pieceRect(piece);
      return { ...piece, x:clamp(piece.x, 0, Math.max(0, next.width - rect.width)), y:clamp(piece.y, 0, Math.max(0, next.height - rect.height)) };
    }));
    setZones((current) => current.map((zone) => {
      const width = Math.min(zone.width, next.width);
      const height = Math.min(zone.height, next.height);
      return { ...zone, width, height, x:clamp(zone.x, 0, next.width - width), y:clamp(zone.y, 0, next.height - height) };
    }));
  };
  const changeBoardSize = (preset: BoardPreset) => {
    const next = BOARD_SIZES[preset];
    setBoardPreset(preset);
    fitTerrainToBoardSize(next);
    selectOnly(null);
    setMessage(`Board changed to ${next.label} · existing terrain kept within bounds`);
  };
  // The floor a manual drag can shrink to — unlike picking a preset from the
  // dropdown, dragging must never move or clip terrain that's already on the
  // board, so it can only shrink as far as the furthest piece or reserved zone
  // edge allows.
  const minimumBoardWidth = () => Math.max(MIN_BOARD_SIZE, ...pieces.map((piece) => { const rect = pieceRect(piece); return rect.x + rect.width; }), ...zones.map((zone) => zone.x + zone.width));
  const minimumBoardHeight = () => Math.max(MIN_BOARD_SIZE, ...pieces.map((piece) => { const rect = pieceRect(piece); return rect.y + rect.height; }), ...zones.map((zone) => zone.y + zone.height));
  const beginBoardResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!boardRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const rect = boardRef.current.getBoundingClientRect();
    setBoardResize({ scale:rect.width / boardWidth, startX:event.clientX, startY:event.clientY, startWidth:boardWidth, startHeight:boardHeight });
    setMessage(pieces.length || zones.length ? `Resizing board · terrain already placed blocks it from shrinking past that · max ${MAX_BOARD_WIDTH}″ × ${MAX_BOARD_HEIGHT}″` : `Resizing board · max ${MAX_BOARD_WIDTH}″ × ${MAX_BOARD_HEIGHT}″`);
  };
  const onBoardResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!boardResize) return;
    const width = clamp(quantize(boardResize.startWidth + (event.clientX - boardResize.startX) / boardResize.scale), minimumBoardWidth(), MAX_BOARD_WIDTH);
    const height = clamp(quantize(boardResize.startHeight + (event.clientY - boardResize.startY) / boardResize.scale), minimumBoardHeight(), MAX_BOARD_HEIGHT);
    setBoardPreset("custom");
    setCustomBoardSize({ width, height });
  };
  const finishBoardResize = () => {
    if (!boardResize) return;
    setBoardResize(null);
    setMessage(`Board resized to ${boardWidth.toFixed(1)}″ × ${boardHeight.toFixed(1)}″`);
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
  const connectionCandidates = (moving: PlacedPiece, fixed: PlacedPiece): ConnectionCandidate[] => {
    const movingDef = getDef(moving.defId);
    const fixedDef = getDef(fixed.defId);
    const movingStructural = ["wall", "door"].includes(movingDef.kind);
    const fixedStructural = ["wall", "door"].includes(fixedDef.kind);
    if (movingDef.catalogue !== fixedDef.catalogue) {
      const hasSpecialFace = (def: TerrainDef) => ["pipe", "vertical-pipe", "floor", "stair"].includes(def.visual || "");
      if (!movingStructural || !fixedStructural || hasSpecialFace(movingDef) || hasSpecialFace(fixedDef)) return [];
      if (Math.abs(movingDef.depth - fixedDef.depth) > .55) return [];
      return structuralEndpoints(moving).flatMap((movingPoint) => structuralEndpoints(fixed).map((fixedPoint) => ({ dx:fixedPoint.x - movingPoint.x, dy:fixedPoint.y - movingPoint.y })));
    }
    let movingPoints: Array<{x:number;y:number}> = [];
    let fixedPoints: Array<{x:number;y:number}> = [];
    let rotation: 0 | 90 | undefined;
    // Branch on the JOINT MODEL, not the maker. A straddling column takes panel
    // ends at its centre; a butting connector takes them at its faces. Gallowdark,
    // Zone Mortalis and Deadbolt's Derelict all straddle, so keying this on
    // `=== "boarding"` silently gave the two new straddling ranges the connector
    // treatment and snapped their panels half a column out of place.
    if (MANUFACTURERS[movingDef.catalogue].joint === "straddle") {
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
    setMessage(`${paletteLabel} ${family === "wall" ? "wall" : family} height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  const setSelectedHeightMm = (millimetres: number) => {
    if (!selectedIds.length) return;
    const nextHeight = clamp(millimetres, 10, 300) / MM_PER_IN;
    setPieces((current) => current.map((piece) => selectedIds.includes(piece.uid) ? { ...piece, height:nextHeight } : piece));
    setMessage(`${selectedIds.length === 1 ? "Selected piece" : `${selectedIds.length} selected pieces`} height set to ${Math.round(nextHeight * MM_PER_IN)} mm`);
  };

  /** Drops a piece on the board with no check against the palette's remaining
   *  stock — callers that just topped up the stock themselves (addFromCatalogue)
   *  use this directly; addPiece gates ordinary placement through it. */
  const placeNewPiece = useCallback((defId: string, x = boardWidth / 2, y = boardHeight / 2, rotation: 0 | 90 = 0) => {
    const w = rotation === 90 ? getDef(defId).depth : getDef(defId).width;
    const h = rotation === 90 ? getDef(defId).width : getDef(defId).depth;
    const piece = { uid: nextUid(), defId, x: quantize(clamp(x - w / 2, 0, boardWidth - w)), y: quantize(clamp(y - h / 2, 0, boardHeight - h)), rotation, height:heightDefaults[defId] };
    setPieces((currentPieces) => [...currentPieces, piece]);
    selectOnly(piece.uid);
    return piece;
  }, [boardHeight, boardWidth, heightDefaults, quantize, selectOnly]);

  const addPiece = useCallback((defId: string, x = boardWidth / 2, y = boardHeight / 2, rotation: 0 | 90 = 0) => {
    const def = getDef(defId);
    const current = pieces.filter((piece) => piece.defId === defId).length;
    if (!enabled[defId] || current >= limits[defId]) { setMessage("No more of that piece available"); return; }
    placeNewPiece(defId, x, y, rotation);
    setMessage(`${def.shortName} placed`);
  }, [boardHeight, boardWidth, enabled, limits, pieces, placeNewPiece]);

  /** The catalogue's combined "Add" action: tops up the palette by `quantity` and
   *  drops one copy straight onto the board, so a click does something visible
   *  instead of only growing a number in the palette tab. */
  const addFromCatalogue = useCallback((defId: string, quantity: number, x = boardWidth / 2, y = boardHeight / 2) => {
    const def = getDef(defId);
    const amount = clamp(Math.round(quantity || 0), 1, 999);
    setLimits((current) => ({ ...current, [defId]:clamp((current[defId] || 0) + amount, 0, 999) }));
    setEnabled((current) => ({ ...current, [defId]:true }));
    placeNewPiece(defId, x, y);
    setMessage(`${amount} × ${def.shortName} added to the palette · 1 placed on the board`);
  }, [boardHeight, boardWidth, placeNewPiece]);

  const rotatePiece = useCallback((uid: string) => {
    setPieces((current) => current.map((piece) => {
      if (piece.uid !== uid) return piece;
      const def = getDef(piece.defId);
      // A shaped corner/T casting turns by advancing `facing`, not by flipping
      // `rotation` on its own — a plain 0/90 flip has only two states and
      // these shapes have four (the two extra are the mirror pairs `rotation`
      // alone cannot tell apart, e.g. a T's stub pointing north vs south).
      // `rotation` is still derived from the new facing, because it is still
      // what decides the bounding box for a non-square shape like the T.
      if (piece.facing !== undefined) {
        const facing = ((piece.facing + 90) % 360) as 0 | 90 | 180 | 270;
        const rotation: 0 | 90 = facing === 90 || facing === 270 ? 90 : 0;
        const w = rotation === 90 ? def.depth : def.width;
        const h = rotation === 90 ? def.width : def.depth;
        return { ...piece, facing, rotation, x: quantize(clamp(piece.x, 0, boardWidth - w)), y: quantize(clamp(piece.y, 0, boardHeight - h)) };
      }
      const rotation = piece.rotation === 0 ? 90 : 0;
      const w = rotation === 90 ? def.depth : def.width;
      const h = rotation === 90 ? def.width : def.depth;
      return { ...piece, rotation, x: quantize(clamp(piece.x, 0, boardWidth - w)), y: quantize(clamp(piece.y, 0, boardHeight - h)) };
    }));
    setMessage("Piece rotated 90°");
  }, [boardHeight, boardWidth, quantize, setMessage]);

  const rotateSelected = useCallback(() => {
    if (!selectedIds.length) return;
    if (selectedIds.length === 1) {
      rotatePiece(selectedIds[0]);
      return;
    }

    const selectedSet = new Set(selectedIds);
    setPieces((current) => {
      const selection = current.filter((piece) => selectedSet.has(piece.uid));
      if (selection.length < 2) return current;

      const rects = selection.map((piece) => {
        const def = getDef(piece.defId);
        const width = piece.rotation === 90 ? def.depth : def.width;
        const height = piece.rotation === 90 ? def.width : def.depth;
        return { piece, width, height };
      });
      const minX = Math.min(...rects.map(({ piece }) => piece.x));
      const minY = Math.min(...rects.map(({ piece }) => piece.y));
      const maxX = Math.max(...rects.map(({ piece, width }) => piece.x + width));
      const maxY = Math.max(...rects.map(({ piece, height }) => piece.y + height));
      const centreX = (minX + maxX) / 2;
      const centreY = (minY + maxY) / 2;

      const rotated = rects.map(({ piece, width, height }) => {
        const pieceCentreX = piece.x + width / 2;
        const pieceCentreY = piece.y + height / 2;
        // See `rotatePiece` for why a shaped corner/T casting turns by
        // advancing `facing` rather than by flipping `rotation` alone.
        const facing = piece.facing !== undefined ? ((piece.facing + 90) % 360) as 0 | 90 | 180 | 270 : undefined;
        const rotation: 0 | 90 = facing !== undefined
          ? (facing === 90 || facing === 270 ? 90 : 0)
          : piece.rotation === 0 ? 90 : 0;
        const nextWidth = height;
        const nextHeight = width;
        const nextCentreX = centreX - (pieceCentreY - centreY);
        const nextCentreY = centreY + (pieceCentreX - centreX);
        return {
          piece:{ ...piece, rotation, facing, x:nextCentreX - nextWidth / 2, y:nextCentreY - nextHeight / 2 },
          width:nextWidth,
          height:nextHeight,
        };
      });

      const rotatedMinX = Math.min(...rotated.map(({ piece }) => piece.x));
      const rotatedMinY = Math.min(...rotated.map(({ piece }) => piece.y));
      const rotatedMaxX = Math.max(...rotated.map(({ piece, width }) => piece.x + width));
      const rotatedMaxY = Math.max(...rotated.map(({ piece, height }) => piece.y + height));
      const shiftX = rotatedMinX < 0 ? -rotatedMinX : rotatedMaxX > boardWidth ? boardWidth - rotatedMaxX : 0;
      const shiftY = rotatedMinY < 0 ? -rotatedMinY : rotatedMaxY > boardHeight ? boardHeight - rotatedMaxY : 0;
      const rotatedById = new Map(rotated.map(({ piece }) => [
        piece.uid,
        { ...piece, x:Math.round((piece.x + shiftX) * 1000) / 1000, y:Math.round((piece.y + shiftY) * 1000) / 1000 },
      ]));

      return current.map((piece) => rotatedById.get(piece.uid) || piece);
    });
    setMessage(`${selectedIds.length} pieces rotated as a group 90°`);
  }, [boardHeight, boardWidth, rotatePiece, selectedIds, setMessage]);

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
    const deltaX = clamp(offset, -minX, boardWidth - maxX);
    const deltaY = clamp(offset, -minY, boardHeight - maxY);
    const duplicates = sources.map((source) => ({ ...source, uid:nextUid(), x:quantize(source.x + deltaX), y:quantize(source.y + deltaY), runId:undefined, sequenceIndex:undefined }));
    setPieces((current) => [...current, ...duplicates]);
    setSelectedIds(duplicates.map((piece) => piece.uid));
    setSelected(duplicates[0].uid);
    setMessage(`${duplicates.length} piece${duplicates.length === 1 ? "" : "s"} duplicated`);
  }, [boardHeight, boardWidth, gridSize, limits, pieces, quantize, selectedIds, snap]);

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
    const deltaX = clamp(step, -minX, boardWidth - maxX);
    const deltaY = clamp(step, -minY, boardHeight - maxY);
    const pasted = copyBuffer.pieces.map((source) => ({ ...source, uid:nextUid(), x:quantize(source.x + deltaX), y:quantize(source.y + deltaY), runId:undefined, sequenceIndex:undefined }));
    setPieces((current) => [...current, ...pasted]);
    setCopyBuffer((current) => current ? { ...current, pasteCount:current.pasteCount + 1 } : current);
    setSelectedIds(pasted.map((piece) => piece.uid));
    setSelected(pasted[0].uid);
    setMessage(`${pasted.length} piece${pasted.length === 1 ? "" : "s"} pasted`);
  }, [boardHeight, boardWidth, copyBuffer, gridSize, limits, pieces, quantize, snap]);

  const moveSelected = useCallback((deltaX: number, deltaY: number) => {
    if (!selectedIds.length) return;
    const sources = pieces.filter((piece) => selectedIds.includes(piece.uid));
    const minX = Math.min(...sources.map((piece) => piece.x));
    const minY = Math.min(...sources.map((piece) => piece.y));
    const maxX = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.x + rect.width; }));
    const maxY = Math.max(...sources.map((piece) => { const rect = pieceRect(piece); return rect.y + rect.height; }));
    const requestedX = deltaX * gridSize;
    const requestedY = deltaY * gridSize;
    const allowedX = clamp(requestedX, -minX, boardWidth - maxX);
    const allowedY = clamp(requestedY, -minY, boardHeight - maxY);
    setPieces((current) => current.map((piece) => {
      if (!selectedIds.includes(piece.uid)) return piece;
      return { ...piece, x:Math.round((piece.x + allowedX) * 100) / 100, y:Math.round((piece.y + allowedY) * 100) / 100 };
    }));
    setMessage(`${selectedIds.length === 1 ? "Piece" : `${selectedIds.length} pieces`} moved ${gridSize}″`);
  }, [boardHeight, boardWidth, gridSize, pieces, selectedIds]);

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


  const mergeGeneratedSystems = (layouts: PlacedPiece[][]) => {
    const orderedLayouts = layouts.filter((layout) => layout.length).sort((a, b) => b.length - a.length);
    if (!orderedLayouts.length) return [] as PlacedPiece[];
    const accepted = [...orderedLayouts[0]];
    const rectClearance = (first: PlacedPiece, second: PlacedPiece) => {
      const a = pieceRect(first);
      const b = pieceRect(second);
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
      return Math.hypot(gapX, gapY);
    };
    const splitComponents = (layout: PlacedPiece[]) => {
      const remaining = new Set(layout.map((piece) => piece.uid));
      const components: PlacedPiece[][] = [];
      while (remaining.size) {
        const firstUid = remaining.values().next().value as string;
        const queue = [layout.find((piece) => piece.uid === firstUid)!];
        const component: PlacedPiece[] = [];
        remaining.delete(firstUid);
        while (queue.length) {
          const current = queue.shift()!;
          component.push(current);
          layout.forEach((candidate) => {
            if (!remaining.has(candidate.uid) || !piecesOverlap(current, candidate, .1)) return;
            remaining.delete(candidate.uid);
            queue.push(candidate);
          });
        }
        components.push(component);
      }
      return components.sort((a, b) => b.length - a.length);
    };
    const transform = (component: PlacedPiece[], dx: number, dy: number) => component.map((piece) => ({ ...piece, x:piece.x + dx, y:piece.y + dy }));
    const candidateFits = (component: PlacedPiece[]) => component.every((piece) => {
      const rect = pieceRect(piece);
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > boardWidth || rect.y + rect.height > boardHeight || pieceIntersectsReservedZone(piece)) return false;
      return accepted.every((fixed) => {
        if (piecesOverlap(piece, fixed, -.04)) return false;
        if (rectClearance(piece, fixed) >= .45) return true;
        return connectionCandidates(piece, fixed).some((fit) => Math.hypot(fit.dx, fit.dy) < .14);
      });
    });
    const joinCount = (component: PlacedPiece[]) => component.reduce((sum, piece) => sum + accepted.filter((fixed) => connectionCandidates(piece, fixed).some((fit) => Math.hypot(fit.dx, fit.dy) < .14)).length, 0);

    orderedLayouts.slice(1).flatMap(splitComponents).forEach((component) => {
      const translations: Array<{ dx:number; dy:number }> = [{ dx:0, dy:0 }];
      const movingStructures = component.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
      const fixedStructures = accepted.filter((piece) => ["wall", "door"].includes(getDef(piece.defId).kind));
      movingStructures.forEach((moving) => structuralEndpoints(moving).forEach((movingPoint) => fixedStructures.forEach((fixed) => structuralEndpoints(fixed).forEach((fixedPoint) => {
        const dx = fixedPoint.x - movingPoint.x;
        const dy = fixedPoint.y - movingPoint.y;
        if (Math.abs(dx) <= 18 && Math.abs(dy) <= 18) translations.push({ dx, dy });
      }))));
      [-8, -4, 4, 8].forEach((dx) => [-8, -4, 4, 8].forEach((dy) => translations.push({ dx, dy })));
      const options = translations.map(({ dx, dy }) => transform(component, dx, dy)).filter(candidateFits).map((candidate) => ({ candidate, joins:joinCount(candidate), shift:Math.abs(candidate[0].x - component[0].x) + Math.abs(candidate[0].y - component[0].y) }));
      options.sort((a, b) => b.joins - a.joins || a.shift - b.shift);
      if (options[0]) accepted.push(...options[0].candidate);
    });
    return accepted.map((piece) => ({ ...piece, uid:nextUid() }));
  };

  // The generator scores its own candidates against a reference board, once, in
  // app/generate.ts. There is deliberately no scoring here: the previous version
  // re-ranked 24 finished layouts on `structures * 50 + span * 45 + ...`, which
  // rewarded raw piece count and table spread and systematically overruled the
  // inner scorer's judgement about sight lines. Two scorers pulling in different
  // directions is how boards got worse while every tracked number improved.
  const generateSpatialSystem = (catalogue: CatalogueId) => {
    const override = generationInventoryRef.current;
    // The palette IS the inventory. Wanting a second set means adding it from the kit
    // browser above, which is where quantities belong.
    const inventory = Object.fromEntries(TERRAIN.map((def) => [def.id, override ? override[def.id] || 0 : limits[def.id] || 0]));
    const seed = (Date.now() + uidRef.current * 2654435761 + boardWidth * 101 + boardHeight * 211 + catalogueSalt(catalogue)) >>> 0;
    const report = generate({
      boardWidth,
      boardHeight,
      catalogue,
      defs:TERRAIN,
      inventory,
      heights:heightDefaults,
      zones,
      anchor,
      usage:override ? 1 : generationPercent / 100,
      seed,
      nextUid,
    });
    lastReportRef.current = report;
    setLayoutReport(report);
    return report.pieces as PlacedPiece[];
  };

  const generateFromPalette = () => {
    if (!catalogueTotal) { setMessage("Add terrain to the current palette before generating"); return; }
    if (!catalogueTerrain.some((def) => ["wall", "door", "floor", "stair"].includes(def.kind))) { setMessage("Add at least one wall, door, floor, or stair piece before generating"); return; }
    const layouts: PlacedPiece[][] = [];
    // Every catalogue in the palette, not the two that used to be named here. With
    // the pair hard-coded, adding a Zone Mortalis or Deadbolt's Derelict kit built a
    // palette the button then silently ignored — it generated the Boarding Actions
    // half of a mixed palette and left the new range sitting in the inventory.
    (Object.keys(MANUFACTURERS) as CatalogueId[])
      .filter((id) => paletteCatalogues.includes(id))
      .forEach((id) => layouts.push(generateSpatialSystem(id)));
    const finalized = layouts.length === 1 ? layouts[0] : mergeGeneratedSystems(layouts);
    if (!finalized.length) {
      // The generator explains why it refused, and the reason is usually
      // actionable — an unbuildable grid, or a palette with no columns. Passing it
      // through beats a generic failure message.
      setMessage(lastReportRef.current?.note || "That palette cannot form a supported layout · add compatible walls or connectors");
      return;
    }
    setPieces(finalized);
    selectOnly(null);
    const joined = paletteCatalogues.length > 1 ? " · compatible cross-kit wall joins enabled" : "";
    const fit = lastReportRef.current?.note ? ` · ${lastReportRef.current.note}` : "";
    setMessage(`${paletteLabel} generated · ${finalized.length} pieces${zones.length ? ` · ${zones.length} zone${zones.length === 1 ? "" : "s"} respected` : ""}${joined}${fit}`);
  };

  const generateLayout = () => {
    if (!pieces.length) { setMessage("Place terrain on the board before generating a new layout"); return; }
    const placed = pieces.reduce<Record<string, number>>((counts, piece) => ({ ...counts, [piece.defId]:(counts[piece.defId] || 0) + 1 }), {});
    // Remix stock is the palette OR what is on the board, whichever holds more of
    // each piece — never the board alone.
    //
    // Taking the board alone made this button destructive. The generator
    // deliberately leaves surplus in the box, so a remix always places fewer pieces
    // than it was offered; feeding that thinned board back in as the next remix's
    // inventory shrinks the stock every click. Four presses took a full board down
    // to a couple of panels and a fifth emptied it. The palette is the inventory —
    // the board is a result — so a remix draws from the palette and is lossless.
    //
    // The max() covers the case the palette cannot: pieces dragged on by hand when
    // the palette is empty or smaller than the board, which would otherwise have
    // nothing to remix from.
    const inventory = Object.fromEntries(TERRAIN.map((def) => [
      def.id, Math.max(limits[def.id] || 0, placed[def.id] || 0),
    ]));
    const sourceHeights = pieces.reduce<Record<string, number[]>>((heights, piece) => ({ ...heights, [piece.defId]:[...(heights[piece.defId] || []), piece.height] }), {});
    const catalogues = [...new Set(pieces.map((piece) => getDef(piece.defId).catalogue))];
    generationInventoryRef.current = inventory;
    try {
      const layouts: PlacedPiece[][] = [];
      // Every catalogue on the table gets its own lattice. This was two hard-coded
      // lines, so a board built from any later-added range generated nothing at all.
      (Object.keys(MANUFACTURERS) as CatalogueId[])
        .filter((id) => catalogues.includes(id))
        .forEach((id) => layouts.push(generateSpatialSystem(id)));
      const generated = layouts.length === 1 ? layouts[0] : mergeGeneratedSystems(layouts);
      // Use the layout the generator actually built.
      //
      // This used to demand that generation spend every placed piece exactly —
      // `usedEverything` — and otherwise fall back to `losslessRemix`, which is
      // just the existing layout mirrored in X and Y. Since the generator
      // deliberately leaves surplus in the box, that condition was essentially
      // never true, so this button always fell through to the mirror: the same
      // board, flipped. It looked like it was sliding the whole complex around,
      // because it was.
      //
      // Heights are reassigned from the pieces that were on the board, per piece
      // type, so a manually raised wall keeps its height through a remix.
      const heightQueues = Object.fromEntries(Object.entries(sourceHeights).map(([defId, heights]) => [defId, [...heights]]));
      const finalized = generated.length
        ? generated.map((piece) => ({ ...piece, height:heightQueues[piece.defId]?.shift() ?? piece.height }))
        : null;
      if (!finalized) {
        setMessage(lastReportRef.current?.note || "That terrain cannot form a supported layout");
        return;
      }
      setPieces(finalized);
      selectOnly(null);
      const held = pieces.length - finalized.length;
      setMessage(`Layout regenerated · ${finalized.length} pieces${held > 0 ? ` · ${held} held back` : ""}${lastReportRef.current?.note ? ` · ${lastReportRef.current.note}` : ""}`);
    } finally {
      generationInventoryRef.current = null;
    }
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
    const boardScale = Math.min(1080 / boardWidth, 1080 / boardHeight);
    const boardPixelWidth = boardWidth * boardScale;
    const boardPixelHeight = boardHeight * boardScale;
    const exportPanelHeight = 1080;
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
    ctx.fillText(`BOARD ${boardWidth} × ${boardHeight} IN  ·  SCALE 1:1 DATA`, 1730, 76);
    ctx.font = "15px Arial, sans-serif";
    const exportSource = cataloguesUsed.length === 1
      ? `${MANUFACTURERS[cataloguesUsed[0]].name} · ${MANUFACTURERS[cataloguesUsed[0]].range}`
      : "Mixed terrain layout";
    ctx.fillText(exportSource, 1730, 103);
    ctx.textAlign = "left";

    ctx.fillStyle = themeColours.board;
    ctx.fillRect(boardX, boardY, boardPixelWidth, boardPixelHeight);
    for (let inch = 0; inch <= boardWidth; inch++) {
      const position = boardX + inch * boardScale;
      ctx.beginPath();
      ctx.strokeStyle = inch % 12 === 0 ? themeColours.major : themeColours.minor;
      ctx.lineWidth = inch % 12 === 0 ? 3 : 1;
      ctx.moveTo(position, boardY);
      ctx.lineTo(position, boardY + boardPixelHeight);
      ctx.stroke();
    }
    for (let inch = 0; inch <= boardHeight; inch++) {
      ctx.beginPath();
      ctx.strokeStyle = inch % 12 === 0 ? themeColours.major : themeColours.minor;
      ctx.lineWidth = inch % 12 === 0 ? 3 : 1;
      ctx.moveTo(boardX, boardY + inch * boardScale);
      ctx.lineTo(boardX + boardPixelWidth, boardY + inch * boardScale);
      ctx.stroke();
    }
    ctx.strokeStyle = "#17201e";
    ctx.lineWidth = 5;
    ctx.strokeRect(boardX, boardY, boardPixelWidth, boardPixelHeight);
    ctx.fillStyle = "#5f6965";
    ctx.font = "13px Arial, sans-serif";
    ctx.textAlign = "center";
    Array.from({ length:boardWidth / 12 + 1 }, (_, index) => index * 12).forEach((inch) => ctx.fillText(`${inch}${inch === boardWidth ? "″" : ""}`, boardX + inch * boardScale, boardY - 17));
    ctx.textAlign = "right";
    Array.from({ length:boardHeight / 12 + 1 }, (_, index) => index * 12).forEach((inch) => ctx.fillText(`${inch}${inch === boardHeight ? "″" : ""}`, boardX - 17, boardY + inch * boardScale + 5));
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
      // The export always prints on paper, whichever appearance the app is set to.
      // A sheet you take to the table wants ink on white, not a screenshot of a dark
      // viewport, so these are deliberately the light palette's literals rather than
      // the live tokens.
      // A hatchway panel the plan uses as a WALL prints as wall — same piece, door shut.
      // Colouring every door-kind panel as an opening is what made a board running 8%
      // doorways read as 58% doors. The manifest below still lists it as a hatchway,
      // because that is the piece you reach into the box for.
      const asDoorway = def.kind === "door" && piece.servesDoorway !== false;
      const colour = asDoorway ? "#7d4b39"
        : def.kind === "wall" || def.kind === "door" ? "#3d4844"
          : def.kind === "end" ? "#56615c"
            : def.kind === "scatter" ? "#4c6f66"
              : "#2d3934";
      if (def.catalogue === "eberleg") {
        // The arm meets the straight face of the 18%-chamfered 51.91 mm node:
        // 64% × 51.91 = 33.22 mm. Door frames retain their measured 43.97 mm depth.
        const wallThickness = 51.91 * .64 / MM_PER_IN * boardScale;
        const doorFrameThickness = 43.97 / MM_PER_IN * boardScale;
        const hubSize = 51.91 / MM_PER_IN * boardScale;
        const armReach = 76.2 / MM_PER_IN * boardScale;
        const baseArms:Record<string, Array<"n" | "e" | "s" | "w">> = {
          column:[], stub:["e"], straight:["w","e"], corner:["w","s"], t:["w","e","s"], cross:["n","e","s","w"],
        };
        const clockwise = { n:"e", e:"s", s:"w", w:"n" } as const;
        let arms = [...(baseArms[def.shape || "column"] || [])];
        for (let turn = 0; turn < (piece.facing || 0) / 90; turn++) arms = arms.map((dir) => clockwise[dir]);

        if (def.shape) {
          const nodeX = x + (arms.includes("w") ? armReach : hubSize / 2);
          const nodeY = y + (arms.includes("n") ? armReach : hubSize / 2);
          ctx.fillStyle = "#3d4844";
          if (arms.includes("w")) ctx.fillRect(x, nodeY - wallThickness / 2, nodeX - x, wallThickness);
          if (arms.includes("e")) ctx.fillRect(nodeX, nodeY - wallThickness / 2, x + width - nodeX, wallThickness);
          if (arms.includes("n")) ctx.fillRect(nodeX - wallThickness / 2, y, wallThickness, nodeY - y);
          if (arms.includes("s")) ctx.fillRect(nodeX - wallThickness / 2, nodeY, wallThickness, y + depth - nodeY);
          const half = hubSize / 2;
          const bevel = hubSize * .18;
          ctx.beginPath();
          ctx.moveTo(nodeX - half + bevel, nodeY - half);
          ctx.lineTo(nodeX + half - bevel, nodeY - half);
          ctx.lineTo(nodeX + half, nodeY - half + bevel);
          ctx.lineTo(nodeX + half, nodeY + half - bevel);
          ctx.lineTo(nodeX + half - bevel, nodeY + half);
          ctx.lineTo(nodeX - half + bevel, nodeY + half);
          ctx.lineTo(nodeX - half, nodeY + half - bevel);
          ctx.lineTo(nodeX - half, nodeY - half + bevel);
          ctx.closePath();
          ctx.fillStyle = "#2d3934";
          ctx.fill();
          ctx.strokeStyle = "#18211e";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          const horizontal = piece.rotation !== 90;
          const thickness = def.kind === "door" ? doorFrameThickness : wallThickness;
          const bar = horizontal
            ? { x, y:y + (depth - thickness) / 2, width, height:thickness }
            : { x:x + (width - thickness) / 2, y, width:thickness, height:depth };
          ctx.fillStyle = asDoorway ? "#7d4b39" : "#3d4844";
          ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
          if (asDoorway) {
            ctx.fillStyle = "#252d2a";
            if (horizontal) ctx.fillRect(x + width * .32, bar.y + 2, width * .36, Math.max(2, bar.height - 4));
            else ctx.fillRect(bar.x + 2, y + depth * .32, Math.max(2, bar.width - 4), depth * .36);
          }
        }
        return;
      }
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, width, depth);
      ctx.strokeStyle = "#18211e";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, depth);
      ctx.strokeStyle = "rgba(226,233,228,.48)";
      ctx.lineWidth = 2;
      if (asDoorway) {
        ctx.fillStyle = "#252d2a";
        if (width >= depth) ctx.fillRect(x + width * .35, y + 3, width * .3, Math.max(2, depth - 6));
        else ctx.fillRect(x + 3, y + depth * .35, Math.max(2, width - 6), depth * .3);
      } else if (def.kind === "door") {
        // Shut, but still outlined: the sheet is a build guide and you need to know
        // which panel goes here.
        ctx.strokeStyle = "rgba(189,113,82,.45)";
        if (width >= depth) ctx.strokeRect(x + width * .35, y + 3, width * .3, Math.max(2, depth - 6));
        else ctx.strokeRect(x + 3, y + depth * .35, Math.max(2, width - 6), depth * .3);
        ctx.strokeStyle = "rgba(226,233,228,.48)";
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
    ctx.fillRect(manifestX, boardY, manifestWidth, exportPanelHeight);
    ctx.strokeStyle = "#d0d6d2";
    ctx.lineWidth = 2;
    ctx.strokeRect(manifestX, boardY, manifestWidth, exportPanelHeight);
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
        // The manifest lists piece TYPES, so a hatchway panel shows as a hatchway here
        // whatever the layout uses it for — this is the shopping list, not the board.
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
    ctx.fillText("Bird's-eye placement diagram · dimensions shown at real-world scale", manifestX + 30, boardY + exportPanelHeight - 35);
    ctx.fillText("Generated with Mortalis Architect", 70, 1286);
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }), 1730, 1286);
    ctx.textAlign = "left";

    setMessage("Preparing PNG layout sheet…");
    canvas.toBlob((blob) => {
      if (!blob) { setMessage("PNG export could not be created"); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const catalogueSlug = (cataloguesUsed.length === 1 ? MANUFACTURERS[cataloguesUsed[0]].range : "mixed-terrain").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.href = url;
      link.download = `mortalis-layout-${catalogueSlug}-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`PNG exported · ${pieces.length} pieces listed`);
    }, "image/png");
  };

  const boardPoint = useCallback((clientX: number, clientY: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * boardWidth, y: (clientY - rect.top) / rect.height * boardHeight };
  }, [boardHeight, boardWidth]);

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
    const x = clamp(quantize(point.x), 0, boardWidth);
    const y = clamp(quantize(point.y), 0, boardHeight);
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

  const beginZoneDrag = (event: React.PointerEvent<HTMLDivElement>, zone: ReservedZone) => {
    if (zoneMode || (event.target as HTMLElement).closest(".zone-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    const point = boardPoint(event.clientX, event.clientY);
    setFocusedZone(zone.uid);
    selectOnly(null);
    setZoneDrag({ uid:zone.uid, startX:point.x, startY:point.y, originX:zone.x, originY:zone.y });
    setMessage(`Moving ${zone.name} · release to place`);
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
        if (currentPaletteDrag.source === "catalogue") {
          addFromCatalogue(currentPaletteDrag.defId, currentPaletteDrag.amount ?? 1, point.x, point.y);
        } else {
          addPiece(currentPaletteDrag.defId, point.x, point.y);
        }
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
  }, [addFromCatalogue, addPiece, boardPoint]);

  const onBoardPointerMove = (event: React.PointerEvent) => {
    if (zoneResize && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      const minimumSize = snap ? gridSize : .5;
      const directionX = zoneResize.corner.endsWith("w") ? -1 : 1;
      const directionY = zoneResize.corner.startsWith("n") ? -1 : 1;
      let currentX = clamp(quantize(point.x), 0, boardWidth);
      let currentY = clamp(quantize(point.y), 0, boardHeight);
      currentX = directionX > 0 ? Math.max(currentX, zoneResize.anchorX + minimumSize) : Math.min(currentX, zoneResize.anchorX - minimumSize);
      currentY = directionY > 0 ? Math.max(currentY, zoneResize.anchorY + minimumSize) : Math.min(currentY, zoneResize.anchorY - minimumSize);
      currentX = clamp(currentX, 0, boardWidth);
      currentY = clamp(currentY, 0, boardHeight);
      if (event.shiftKey) {
        const maximumSide = Math.min(directionX > 0 ? boardWidth - zoneResize.anchorX : zoneResize.anchorX, directionY > 0 ? boardHeight - zoneResize.anchorY : zoneResize.anchorY);
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
    if (zoneDrag && boardRef.current) {
      const zone = zones.find((item) => item.uid === zoneDrag.uid);
      if (!zone) { setZoneDrag(null); return; }
      const point = boardPoint(event.clientX, event.clientY);
      const rawX = zoneDrag.originX + point.x - zoneDrag.startX;
      const rawY = zoneDrag.originY + point.y - zoneDrag.startY;
      const x = clamp(quantize(rawX), 0, boardWidth - zone.width);
      const y = clamp(quantize(rawY), 0, boardHeight - zone.height);
      setZones((current) => current.map((item) => item.uid === zone.uid ? { ...item, x, y } : item));
      return;
    }
    if (zoneDraft && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      let currentX = clamp(quantize(point.x), 0, boardWidth);
      let currentY = clamp(quantize(point.y), 0, boardHeight);
      if (event.shiftKey) {
        const dx = currentX - zoneDraft.startX;
        const dy = currentY - zoneDraft.startY;
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        currentX = clamp(zoneDraft.startX + (dx < 0 ? -side : side), 0, boardWidth);
        currentY = clamp(zoneDraft.startY + (dy < 0 ? -side : side), 0, boardHeight);
      }
      setZoneDraft((current) => current ? { ...current, currentX, currentY } : null);
      return;
    }
    if (marquee && boardRef.current) {
      const point = boardPoint(event.clientX, event.clientY);
      setMarquee((current) => current ? { ...current, currentX:clamp(point.x, 0, boardWidth), currentY:clamp(point.y, 0, boardHeight) } : null);
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
    let allowedX = clamp(requestedX, -minX, boardWidth - maxX);
    let allowedY = clamp(requestedY, -minY, boardHeight - maxY);
    const fixedPieces = pieces.filter((piece) => !drag.uids.includes(piece.uid));
    let rotationOverride: { uid:string; rotation:0|90 } | null = null;
    if (smartFit) {
      const tentative = draggedPieces.map((piece) => ({ ...piece, x:drag.origins[piece.uid].x + allowedX, y:drag.origins[piece.uid].y + allowedY }));
      const fitCandidates = tentative.flatMap((moving) => fixedPieces.flatMap((fixed) => connectionCandidates(moving, fixed).map((candidate) => ({ ...candidate, uid:moving.uid, distance:Math.hypot(candidate.dx, candidate.dy) })))).filter((candidate) => candidate.distance <= Math.max(.75, gridSize));
      fitCandidates.sort((a, b) => a.distance - b.distance);
      const bestFit = fitCandidates[0];
      if (bestFit) {
        allowedX = clamp(allowedX + bestFit.dx, -minX, boardWidth - maxX);
        allowedY = clamp(allowedY + bestFit.dy, -minY, boardHeight - maxY);
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
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > boardWidth || rect.y + rect.height > boardHeight) return true;
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
        <div className="top-actions"><div className="appearance-switch" role="group" aria-label="Appearance">{(["light", "dark"] as const).map((mode) => <button key={mode} className={appearance === mode ? "active" : ""} aria-pressed={appearance === mode} onClick={() => setAppearance(mode)}>{mode}</button>)}</div><label className="board-size-control"><span>Board</span><select aria-label="Board size" value={boardPreset} onChange={(event) => changeBoardSize(event.target.value as BoardPreset)}>{boardPreset === "custom" && <option value="custom">{boardWidth.toFixed(1)}″ × {boardHeight.toFixed(1)}″ · custom</option>}{(Object.entries(BOARD_SIZES) as Array<[BoardPreset, typeof BOARD_SIZES[BoardPreset]]>).map(([value, size]) => <option key={value} value={value}>{size.label}</option>)}</select></label><span className="board-chip">{boardWidth.toFixed(1)} × {boardHeight.toFixed(1)} IN</span><button className="export-action" onClick={exportLayoutPng} disabled={!pieces.length} aria-label="Export layout and piece manifest as PNG">Export PNG</button><button className="primary" onClick={generateLayout} disabled={!pieces.length} aria-label="Generate a new layout using every piece currently on the board">Generate layout</button></div>
      </header>

      <section className="workspace">
        <aside className="catalogue panel">
          <div className="catalogue-selectors" aria-label="Terrain source">
            <label><span>Manufacturer</span><select value={activeCatalogue} onChange={(event) => selectManufacturer(event.target.value as CatalogueId)}>{(Object.keys(MANUFACTURERS) as CatalogueId[]).map((catalogueId) => <option key={catalogueId} value={catalogueId}>{MANUFACTURERS[catalogueId].name} · {MANUFACTURERS[catalogueId].range}</option>)}</select></label>
            <label><span>Kit</span><select value={activeKitId} onChange={(event) => selectKit(event.target.value)}>{manufacturerKits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
          </div>
          <section className="kit-browser" aria-labelledby="kit-browser-heading">
            <div className="section-heading">
              <div><p className="eyebrow">Available pieces · selected kit</p><h2 id="kit-browser-heading">{activeCatalogueMeta.name}</h2></div>
              <button className="add-kit" onClick={addKitToPalette}>Add full kit · {activeKitTotal}</button>
            </div>
            <p className="section-intro">{activeCatalogueMeta.description} <a href={activeCatalogueMeta.sourceUrl} target="_blank" rel="noreferrer">Source</a></p>
            <div className="kit-piece-list" aria-label={`${activeCatalogueMeta.name} available pieces`}>
              {kitTerrain.map((def) => {
                const amountKey = `${activeKitId}:${def.id}`;
                const kitAmount = kitAddAmounts[amountKey] ?? activeCatalogueMeta.inventory[def.id] ?? 1;
                return <div className="kit-piece-row" key={def.id} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("input, button")) return; const nextDrag: PaletteDragState = { defId:def.id, x:event.clientX, y:event.clientY, source:"catalogue", amount:kitAmount }; paletteDragRef.current = nextDrag; setPaletteDrag(nextDrag); }}>
                  <span className={pieceIconClass(def)}><i /></span>
                  <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · kit includes {activeCatalogueMeta.inventory[def.id]}</small></span>
                  <div className="kit-piece-actions">
                    <label className="add-amount"><span className="sr-only">Amount of {def.name} to add</span><input aria-label={`Amount of ${def.name} to add`} type="number" min="1" max="999" value={kitAmount} onChange={(event) => setKitAddAmounts((current) => ({ ...current, [amountKey]:clamp(Number(event.target.value), 1, 999) }))} /></label>
                    <div className="kit-piece-buttons">
                      <button className="add-piece-to-palette" onClick={() => addToPalette(def.id, kitAmount)} aria-label={`Add ${kitAmount} ${def.name} to the palette only`} title="Add to the palette without placing it on the board">To palette</button>
                      <button className="add-piece-to-board" onClick={() => addFromCatalogue(def.id, kitAmount)} aria-label={`Add ${kitAmount} ${def.name} to the palette and place one on the board`} title="Add to the palette and drop one on the board">Add</button>
                    </div>
                  </div>
                </div>;
              })}
            </div>
            {activeCatalogueMeta.caveat && <p className="kit-caveat">{activeCatalogueMeta.caveat}</p>}
          </section>
        </aside>

        <div className="board-column">
          <div className="board-toolbar panel" role="toolbar" aria-label="Layout tools">
            <div className="tool-group primary-tools"><button className={`tool ${!zoneMode ? "active" : ""}`} aria-pressed={!zoneMode} onClick={() => { setZoneMode(false); setZoneDraft(null); }}>Select</button><button className={`tool ${zoneMode ? "active zone-tool" : ""}`} aria-pressed={zoneMode} onClick={() => { setZoneMode(true); selectOnly(null); setFocusedZone(null); setZoneResize(null); setMarquee(null); setMessage("Name the zone, then drag it on the board"); }}>Draw zone</button><span className="tool-divider" aria-hidden="true" /><button className="tool" title="Copy selected terrain" onClick={copySelected} disabled={!selectedIds.length || zoneMode}>Copy <kbd>Ctrl C</kbd></button><button className="tool" title="Paste copied terrain" onClick={pasteCopied} disabled={!copyBuffer || zoneMode}>Paste <kbd>Ctrl V</kbd></button><button className="tool" title="Duplicate selected terrain" onClick={duplicateSelected} disabled={!selectedIds.length || zoneMode}>Duplicate <kbd>Ctrl D</kbd></button><button className="tool" onClick={rotateSelected} disabled={!selectedIds.length || zoneMode}>Rotate <kbd>R</kbd></button><button className="tool danger" onClick={deleteSelected} disabled={!selectedIds.length || zoneMode}>Delete</button><span className="tool-divider" aria-hidden="true" /><button className="tool danger" title="Remove terrain but preserve reserved zones" onClick={clearTerrain} disabled={!pieces.length}>Clear terrain</button><button className="tool danger" title="Remove reserved zones but preserve terrain" onClick={() => { setZones([]); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMessage("Reserved zones cleared · terrain preserved"); }} disabled={!zones.length}>Clear zones</button></div>
            <div className="tool-group settings">
              <div className="zoom-control" role="group" aria-label="Board zoom"><button aria-label="Zoom board out" title="Zoom out" onClick={() => changeBoardZoom(-1)} disabled={boardZoom === BOARD_ZOOM_STEPS[0]}>−</button><button className="zoom-value" aria-label={`Reset board zoom, currently ${boardZoom}%`} title="Reset to 100%" onClick={() => { setBoardZoom(100); setMessage("Board zoom 100%"); }}>{boardZoom}%</button><button aria-label="Zoom board in" title="Zoom in" onClick={() => changeBoardZoom(1)} disabled={boardZoom === BOARD_ZOOM_STEPS.at(-1)}>+</button></div>
              <label className="switch-label" title="Snaps matching kit connectors and compatible ordinary wall faces across kits"><input type="checkbox" checked={smartFit} onChange={(event) => { setSmartFit(event.target.checked); setMessage(event.target.checked ? "Smart fit enabled · compatible same-kit and cross-kit wall faces snap cleanly" : "Smart fit disabled · free overlap allowed"); }} /><span className="toggle" /> Smart fit</label>
              <label className="switch-label"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /><span className="toggle" /> Snap</label>
              {snap && <select aria-label="Snap grid size" value={gridSize} onChange={(event) => setGridSize(Number(event.target.value))}><option value="1">1″ grid</option><option value="0.5">½″ grid</option><option value="0.25">¼″ grid</option></select>}
              <div className="theme-switch" aria-label="Board style">{(["industrial", "gothic", "desert"] as const).map((item) => <button key={item} className={theme === item ? "active" : ""} aria-pressed={theme === item} onClick={() => setTheme(item)}>{item}</button>)}</div>
            </div>
          </div>
          {zoneMode && <div className="zone-designator panel"><label><span>Zone name</span><input aria-label="Zone name" value={zoneName} maxLength={32} onChange={(event) => setZoneName(event.target.value)} /></label><p>Drag on the grid to reserve a clear area. Hold <kbd>Shift</kbd> while dragging for a perfect square.</p><strong>{zones.length} saved</strong></div>}

          <div ref={boardAreaRef} className={`board-area ${boardPanning ? "panning" : ""}`} title="Scroll to zoom · hold the mouse wheel and drag to pan" onWheel={zoomBoardAtPointer} onPointerDownCapture={beginBoardPan} onPointerMoveCapture={moveBoardPan} onPointerUpCapture={finishBoardPan} onPointerCancelCapture={finishBoardPan} onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}><div className="board-pan-stage" style={{ "--board-stage-width":`${boardZoom + Math.max(0, boardZoom - 100) * .9}cqw`, "--board-stage-height":`${boardZoom + Math.max(0, boardZoom - 100) * .9}cqh` } as CSSProperties}><div className="board-frame" style={{ "--board-ratio":boardWidth / boardHeight, "--board-zoom":boardZoom / 100 } as CSSProperties}>
            <div className="ruler ruler-top">{Array.from({ length:boardWidth / 12 + 1 }, (_, index) => index * 12).map((inch) => <span key={inch}>{inch}{inch === boardWidth ? "″" : ""}</span>)}</div>
            <div className="ruler ruler-left">{Array.from({ length:boardHeight / 12 + 1 }, (_, index) => index * 12).map((inch) => <span key={inch}>{inch}{inch === boardHeight ? "″" : ""}</span>)}</div>
            <div id="layout-board" ref={boardRef} style={{ "--minor-x":`${100 / boardWidth}%`, "--minor-y":`${100 / boardHeight}%`, "--major-x":`${1200 / boardWidth}%`, "--major-y":`${1200 / boardHeight}%` } as CSSProperties} className={`board ${theme}-board ${drag ? "dragging" : ""} ${marquee ? "selecting" : ""} ${zoneMode ? "zone-mode" : ""} ${zoneResize ? "resizing-zone" : ""} ${zoneDrag ? "dragging-zone" : ""}`} aria-label={`${boardWidth.toFixed(1)} by ${boardHeight.toFixed(1)} inch layout board`} aria-describedby="board-help" onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onPointerMove={onBoardPointerMove} onPointerUp={() => { if (zoneDraft) finishZone(); if (marquee) finishMarquee(); if (zoneResize) { const zone = zones.find((item) => item.uid === zoneResize.uid); if (zone) setMessage(`${zone.name} resized · ${zone.width.toFixed(1)} × ${zone.height.toFixed(1)} in`); setZoneResize(null); } if (zoneDrag) { const zone = zones.find((item) => item.uid === zoneDrag.uid); if (zone) setMessage(`${zone.name} moved · ${zone.x.toFixed(1)}, ${zone.y.toFixed(1)} in`); setZoneDrag(null); } setDrag(null); }} onPointerCancel={() => { setZoneDraft(null); setZoneResize(null); setZoneDrag(null); setMarquee(null); setDrag(null); }} onPointerDown={beginZone}>
              {pieces.length === 0 && <div className="board-mark"><strong>{boardPreset === "custom" ? `${boardWidth.toFixed(1)}″ × ${boardHeight.toFixed(1)}″` : BOARD_SIZES[boardPreset].label}</strong><span>{zoneMode ? "DRAG TO RESERVE A CLEAR ZONE" : "DROP TERRAIN TO PLACE"}</span></div>}
              {zones.map((zone) => <div key={zone.uid} role="group" tabIndex={zoneMode ? -1 : 0} aria-label={`${zone.name}, reserved zone ${zone.width.toFixed(1)} by ${zone.height.toFixed(1)} inches`} className={`reserved-zone ${focusedZone === zone.uid ? "focused" : ""} ${zoneResize?.uid === zone.uid ? "resizing" : ""} ${zoneDrag?.uid === zone.uid ? "moving" : ""}`} style={{ left:`${zone.x / boardWidth * 100}%`, top:`${zone.y / boardHeight * 100}%`, width:`${zone.width / boardWidth * 100}%`, height:`${zone.height / boardHeight * 100}%` }} onPointerDown={(event) => beginZoneDrag(event, zone)} onFocus={() => setFocusedZone(zone.uid)}><strong>{zone.name}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span>{!zoneMode && (["nw","ne","sw","se"] as ZoneCorner[]).map((corner) => <button key={corner} className={`zone-handle ${corner}`} aria-label={`Resize ${zone.name} from ${corner} corner`} title="Drag to resize" onPointerDown={(event) => beginZoneResize(event, zone, corner)} />)}</div>)}
              {zoneDraft && (() => { const zone = normaliseZoneDraft(zoneDraft); return <div className="reserved-zone draft" style={{ left:`${zone.x / boardWidth * 100}%`, top:`${zone.y / boardHeight * 100}%`, width:`${zone.width / boardWidth * 100}%`, height:`${zone.height / boardHeight * 100}%` }}><strong>{zoneName.trim() || "Hangar"}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span></div>; })()}
              {marquee && (() => { const left = Math.min(marquee.startX, marquee.currentX); const top = Math.min(marquee.startY, marquee.currentY); return <div className="selection-marquee" aria-hidden="true" style={{ left:`${left / boardWidth * 100}%`, top:`${top / boardHeight * 100}%`, width:`${Math.abs(marquee.currentX - marquee.startX) / boardWidth * 100}%`, height:`${Math.abs(marquee.currentY - marquee.startY) / boardHeight * 100}%` }} />; })()}
              {pieces.map((piece) => {
                const def = getDef(piece.defId);
                const width = piece.rotation === 90 ? def.depth : def.width;
                const height = piece.rotation === 90 ? def.width : def.depth;
                const isSelected = selectedIds.includes(piece.uid);
                return <button key={piece.uid} title={`${def.name} · ${def.note} × ${Math.round(piece.height * MM_PER_IN)} mm high`} aria-label={`${def.name}, ${Math.round(piece.height * MM_PER_IN)} millimetres high${isSelected ? ", selected" : ""}`} aria-pressed={isSelected} className={`placed-piece piece-${def.id} ${def.kind} ${def.kind === "door" && piece.servesDoorway === false ? "shut" : ""} ${def.visual ? `visual-${def.visual}` : ""} ${piece.facing !== undefined ? `facing-${piece.facing}` : ""} ${piece.rotation === 90 ? "rotated" : ""} ${isSelected ? "selected" : ""}`} style={{ left:`${piece.x / boardWidth * 100}%`, top:`${piece.y / boardHeight * 100}%`, width:`${width / boardWidth * 100}%`, height:`${height / boardHeight * 100}%` }} onDoubleClick={() => rotatePiece(piece.uid)} onContextMenu={(event) => { event.preventDefault(); setFocusedZone(null); selectOnly(piece.uid); rotatePiece(piece.uid); }} onPointerDown={(event) => beginPieceDrag(event, piece)}><span className="terrain-detail" /></button>;
              })}
            </div>
            <button className={`board-resize-handle ${boardResize ? "resizing" : ""}`} aria-label="Resize board" title={`Drag to resize the board · max ${MAX_BOARD_WIDTH}″ × ${MAX_BOARD_HEIGHT}″`} onPointerDown={beginBoardResize} onPointerMove={onBoardResizeMove} onPointerUp={finishBoardResize} onPointerCancel={finishBoardResize} />
          </div></div></div>
          {layoutReport?.metrics && <div className="metrics-strip" aria-label="Generated layout readings"><span><strong>{layoutReport.plan?.lattice.cols} × {layoutReport.plan?.lattice.rows}</strong> squares</span><span>density <strong>{layoutReport.metrics.density.toFixed(2)}</strong></span><span>sight <strong>{layoutReport.metrics.meanSight.toFixed(1)}</strong> / {layoutReport.metrics.longestSight} sq</span><span>runs <strong>{layoutReport.metrics.meanRun.toFixed(1)}</strong> avg</span><span>{layoutReport.leftover > 0 ? <><strong>{layoutReport.leftover}</strong> panels in the box</> : <>whole palette spent</>}</span></div>}
          <div className="status-line" id="board-help"><span role="status" aria-live="polite">{message}</span><span>Zoom {boardZoom}% (scroll) · Wheel-drag to pan · {smartFit ? "Smart fit · " : "Overlap allowed · "}{zones.length ? `${zones.length} zone${zones.length === 1 ? "" : "s"} · ` : ""}{snap ? `Grid ${gridSize}″` : "Free placement"} · Drag empty space to multi-select · Ctrl C / V</span></div>
        </div>

        <aside className="inspector panel">
          <div className="inspector-tabs" role="tablist" aria-label="Right panel view">
            <button role="tab" aria-selected={inspectorTab === "palette"} className={`inspector-tab ${inspectorTab === "palette" ? "active" : ""}`} onClick={() => setInspectorTab("palette")}>Palette{catalogueTotal > 0 ? ` · ${catalogueTotal}` : ""}</button>
            <button role="tab" aria-selected={inspectorTab === "analysis"} className={`inspector-tab ${inspectorTab === "analysis" ? "active" : ""}`} onClick={() => setInspectorTab("analysis")}>Analysis</button>
          </div>
          {inspectorTab === "palette" ? <section className="palette-builder" aria-labelledby="generator-palette-heading">
            <div className="palette-selection-summary" aria-label="Current board selection">
              {selectedPiece ? <>
                <span className={pieceIconClass(getDef(selectedPiece.defId))}><i /></span>
                <div className="palette-selection-copy"><span>{selectedIds.length > 1 ? "Selected group" : "Selected piece"}</span><strong>{selectedIds.length > 1 ? `${selectedIds.length} pieces` : getDef(selectedPiece.defId).shortName}</strong><small>{selectedIds.length > 1 ? "Edit height for the full selection" : `${Math.round((selectedPiece.rotation === 90 ? getDef(selectedPiece.defId).depth : getDef(selectedPiece.defId).width) * MM_PER_IN)} × ${Math.round((selectedPiece.rotation === 90 ? getDef(selectedPiece.defId).width : getDef(selectedPiece.defId).depth) * MM_PER_IN)} mm · ${selectedPiece.rotation}°`}</small></div>
                <label className="palette-selection-height"><span>Z height</span><span className="dimension-input"><input aria-label="Selected piece height in palette view" type="number" min="10" max="300" step="1" value={Math.round(selectedPiece.height * MM_PER_IN)} onChange={(event) => setSelectedHeightMm(Number(event.target.value))} /> mm</span></label>
              </> : <div className="palette-selection-copy empty"><span>Board selection</span><strong>No terrain selected</strong><small>Click a piece to inspect it here</small></div>}
              <div className="palette-selection-stats"><span><strong>{pieces.length}</strong> placed</span><span><strong>{paletteUsed}</strong> / {catalogueTotal} used</span><span><strong>{zones.length}</strong> zones</span></div>
            </div>
            <div className="section-heading">
              <div><p className="eyebrow">Layout inventory</p><h2 id="generator-palette-heading">Current generator palette</h2></div>
              <div className="section-actions"><span className="count">{catalogueTotal} pcs</span><button className="text-action danger" onClick={clearPalette} disabled={!catalogueTotal}>Clear</button></div>
            </div>
            {catalogueTotal > 0 && <div className="palette-generation-controls">
              <label className="generation-target palette-generation-target" title="Share of the palette the generator may spend. The board is filled to real density regardless; lower this only to deliberately hold pieces back."><span>Spend <strong>{generationPercent}%</strong></span><input type="range" min="20" max="100" step="5" value={generationPercent} onChange={(event) => setGenerationPercent(Number(event.target.value))} aria-label="Footprint coverage target" /></label>
              <label className="generation-target palette-generation-target" title="Where a complex smaller than the board sits. The board border is a free wall, so a corner spends more of the kit on interior structure and a centred island must build its own perimeter. Fill the table sizes the grid to the BOARD instead of to the palette: runs reach the board edge on every side and no panel is spent on a perimeter, at the cost of a thinner interior when the palette is small for the table."><span>Placement</span><select value={anchor} onChange={(event) => setAnchor(event.target.value as Anchor)} aria-label="Where to anchor a complex smaller than the board"><option value="fill">Fill the table</option><option value="corner">Into a corner</option><option value="edge">Against an edge</option><option value="centre">Centred island</option></select></label>
              <button className="primary palette-generate" onClick={generateFromPalette} aria-label="Generate layout from current terrain palette">Generate from palette</button>
            </div>}
            {catalogueTotal > 0 && <div className="palette-range"><span>{paletteMaker}</span><strong>{paletteLabel}</strong><em>{Math.max(0, catalogueTotal - paletteUsed)} unplaced</em></div>}
            <div className="palette-list" aria-label="Current generator terrain palette">
              {!catalogueTotal && <div className="palette-empty"><strong>Your palette is empty</strong><span>Add individual pieces or a full kit from the catalogue.</span></div>}
              {catalogueTerrain.map((def) => {
                const remaining = Math.max(0, limits[def.id] - (used[def.id] || 0));
                return (
                <div className="palette-row" key={def.id} onPointerDown={(event) => { if (remaining === 0 || (event.target as HTMLElement).closest("input, .remove-palette")) return; const nextDrag: PaletteDragState = { defId:def.id, x:event.clientX, y:event.clientY, source:"palette" }; paletteDragRef.current = nextDrag; setPaletteDrag(nextDrag); }}>
                  <button className="piece-add" onClick={() => addPiece(def.id)} disabled={remaining === 0} aria-label={`Place ${def.name}`}>
                    <span className={pieceIconClass(def)}><i /></span>
                    <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · Z {Math.round(heightDefaults[def.id] * MM_PER_IN)} mm</small></span>
                  </button>
                  <label className="palette-quantity"><span>Available</span><input aria-label={`${def.name} palette quantity`} type="number" min="0" max="999" value={limits[def.id]} onChange={(event) => setPaletteQuantity(def.id, Number(event.target.value))} /><em>{remaining} left</em></label>
                  <button className="remove-palette" aria-label={`Remove ${def.name} from palette`} title="Remove from palette" onClick={() => setPaletteQuantity(def.id, 0)}>×</button>
                </div>
              );
            })}
            </div>
          </section> : <>
            <p className="eyebrow">Layout analysis</p><h2>{pieces.length ? "Playable sector" : "Ready to build"}</h2>
            {selectedPiece && <div className="selected-piece-editor">
              <div><span>{selectedIds.length > 1 ? "Selected group" : "Selected piece"}</span><strong>{selectedIds.length > 1 ? `${selectedIds.length} pieces` : getDef(selectedPiece.defId).shortName}</strong></div>
              <label><span>Height · Z</span><span className="dimension-input"><input aria-label="Selected piece height" type="number" min="10" max="300" step="1" value={Math.round(selectedPiece.height * MM_PER_IN)} onChange={(event) => setSelectedHeightMm(Number(event.target.value))} /> mm</span></label>
              <small>{selectedIds.length > 1 ? "Height changes apply to the whole selection" : `${getDef(selectedPiece.defId).note} footprint`}</small>
            </div>}
            <div className="metric"><span>Current layout</span><strong>{pieces.length} pcs</strong></div>
            <div className="metric"><span>Palette used</span><strong>{paletteUsed} / {catalogueTotal}</strong></div>
            <div className="metric"><span>Generator palette</span><strong>{paletteMaker || "None"}</strong></div>
            <div className="metric"><span>Footprint coverage</span><strong>{coverage.toFixed(1)}%</strong></div><div className="meter"><i style={{ width:`${Math.min(coverage * 5, 100)}%` }} /></div>
            <div className="metric"><span>Reserved clear space</span><strong>{zones.length} · {reservedCoverage.toFixed(1)}%</strong></div>
            <div className="metric"><span>{paletteCatalogues.length > 1 ? "Walls + hatchways" : generationJoint === "straddle" ? "Operable doorways" : "Wall modules"}</span><strong>{paletteCatalogues.length > 1 ? wallPieces.length : generationJoint === "straddle" ? doors : wallPieces.length}</strong></div><div className="metric"><span>Corridor loops</span><strong>{loops}</strong></div><div className="metric"><span>Open chambers</span><strong>{chambers}</strong></div>
            <div className="divider" />
            <p className="inspector-copy">{paletteCatalogues.length === 1 && paletteCatalogues[0] === "eberleg" ? "An unofficial, print-at-home proxy for Games Workshop’s Zone Mortalis terrain. Not affiliated with or endorsed by Games Workshop." : paletteCatalogues.length > 1 ? "Each terrain system keeps its own physical assembly rules while compatible ordinary wall faces align across kits." : generationJoint === "straddle" ? `Walls and doors slot into the ${generationRange} support grid.` : `${generationRange} pieces retain their own connector system.`}</p>
            {paletteCatalogues.length === 1 && paletteCatalogues[0] === "eberleg" ? <div className="eberleg-legend" aria-label="Eberleg terrain legend">{EBERLEG_LEGEND.map((def) => <span key={def.id}><span className={pieceIconClass(def)}><i /></span><small>{def.shortName.replace("Eb ", "")}</small></span>)}</div> : <div className="layout-key">{paletteCatalogues.length > 1 ? <><span><i className="key-wall" /> Compatible wall</span><span><i className="key-door" /> Door / hatch</span><span><i className="key-pillar" /> System support</span></> : generationJoint === "straddle" ? <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Doorway</span><span><i className="key-pillar" /> Column</span><span><i className="key-open" /> Open face</span></> : <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Wall end</span><span><i className="key-pillar" /> Connector</span></>}</div>}
            {usedInventory.length > 0 && <div className="bom">
              <div className="bom-heading"><strong>What to pull off the sprue</strong><span>{usedTotal} pcs total</span></div>
              <p className="bom-intro">Every piece on the board right now, so you can pull the same pieces from your own kit.</p>
              {usedInventory.map((group) => <div className="bom-group" key={group.catalogue}>
                {usedInventory.length > 1 && <div className="bom-group-heading">{group.maker} · {group.range}</div>}
                {group.items.map(({ def, count }) => <div className="bom-row" key={def.id}>
                  <span className={pieceIconClass(def)}><i /></span>
                  <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note}</small></span>
                  <strong className="bom-count">× {count}</strong>
                </div>)}
              </div>)}
            </div>}
            {catalogueTotal > 0 && <details className="height-settings inspector-height">
              <summary><span><strong>Advanced dimensions</strong><small>3D and export height defaults</small></span><em>Z axis · mm</em></summary>
              <p className="height-explainer">Optional vertical dimensions. They do not change the bird&apos;s-eye footprint.</p>
              <div className="height-grid">
                {familyIsAvailable("wall") && <label><span>Structures</span><input aria-label={`${paletteLabel} structure default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("wall")} onChange={(event) => setFamilyHeightMm("wall", Number(event.target.value))} /></label>}
                {familyIsAvailable("support") && <label><span>{paletteCatalogues.length > 1 ? "Supports" : generationJoint === "straddle" ? "Columns" : "Connectors"}</span><input aria-label={`${paletteLabel} support default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("support")} onChange={(event) => setFamilyHeightMm("support", Number(event.target.value))} /></label>}
                {familyIsAvailable("end") && <label><span>Wall ends</span><input aria-label={`${paletteLabel} end default height`} type="number" min="10" max="300" step="1" value={familyHeightMm("end")} onChange={(event) => setFamilyHeightMm("end", Number(event.target.value))} /></label>}
              </div>
            </details>}
            {zones.length > 0 && <div className="zone-list"><div className="zone-list-heading"><span>Reserved zones</span><button onClick={() => { setZones([]); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMessage("Reserved zones cleared"); }}>Clear all</button></div><small className="zone-list-hint">Hover a zone for temporary handles, or click it to keep them active.</small>{zones.map((zone) => <div className={`zone-list-row ${focusedZone === zone.uid ? "active" : ""}`} key={zone.uid} onPointerDown={() => setFocusedZone(zone.uid)}><input aria-label={`Rename ${zone.name}`} value={zone.name} maxLength={32} onFocus={() => setFocusedZone(zone.uid)} onChange={(event) => setZones((current) => current.map((item) => item.uid === zone.uid ? { ...item, name:event.target.value } : item))} /><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span><button aria-label={`Remove ${zone.name}`} onClick={() => { setZones((current) => current.filter((item) => item.uid !== zone.uid)); if (focusedZone === zone.uid) setFocusedZone(null); if (zoneResize?.uid === zone.uid) setZoneResize(null); }}>×</button></div>)}</div>}
            <p className="accuracy-note">Scale basis: {boardWidth} × {boardHeight}″ board · 25.4 mm per inch. Iron Labyrinth dimensions are manufacturer-published; Boarding Actions footprints remain physical-kit approximations. Default wall height is 60 mm in both systems.</p>
          </>}
        </aside>
      </section>
      {paletteDrag && <div className="drag-preview" style={{ left:paletteDrag.x, top:paletteDrag.y }}><span className={pieceIconClass(getDef(paletteDrag.defId))}><i /></span><small>{getDef(paletteDrag.defId).shortName}</small></div>}
    </main>
  );
}
