"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { generate, type Anchor, type GenerateReport } from "./generate.ts";
import { exportLayoutPng } from "./export-layout-png.ts";
import {
  APPEARANCE_STORAGE_KEY, BOARDING_INVENTORY, BOARD_SIZES, BOARD_STORAGE_KEY, MANUFACTURERS,
  MM_PER_IN, PALETTE_STORAGE_KEY, TERRAIN, TERRAIN_KITS, getDef,
  type Appearance, type BoardPreset, type CatalogueId, type TerrainDef,
} from "./terrain.ts";
import {
  boundsOf, clamp, connectionCandidates, fitLayoutToContent, normaliseZoneDraft, pieceRect, piecesOverlap, structuralEndpoints,
  type PlacedPiece, type ReservedZone,
} from "./board/model.ts";
import { UiIcon } from "./ui/icon.tsx";
import { BoardToolbar, type BoardTheme } from "./ui/board-toolbar.tsx";
import { AnalysisPanel, type InventoryGroup } from "./ui/analysis-panel.tsx";
import { BoardSelectionSummary } from "./ui/board-selection-summary.tsx";
import { PalettePanel } from "./ui/palette-panel.tsx";
import { TerrainLibrary } from "./ui/terrain-library.tsx";
import { Topbar } from "./ui/topbar.tsx";

type ZoneCorner = "nw" | "ne" | "sw" | "se";

const MIN_BOARD_SIZE = 12;
const MAX_BOARD_WIDTH = BOARD_SIZES["60x48"].width;
const MAX_BOARD_HEIGHT = BOARD_SIZES["60x48"].height;
const BOARD_ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200] as const;


/** A piece being dragged toward the board. "palette" drags an existing palette
 *  entry (already counted in `limits`); "catalogue" drags a not-yet-added kit
 *  piece, which drops with `amount` copies added to the palette on release. */
type PaletteDragState = { defId:string; x:number; y:number; startX:number; startY:number; source:"palette" | "catalogue"; amount?:number; moved:boolean };
type DropPreview = { defId:string; x:number; y:number; width:number; height:number };

/** One way a dragged piece could meet a fixed one: the offset that joins them, and
 *  the rotation the move implies where the joint only works at right angles (a wall
 *  end capping a run, or a wall meeting a connector face). */
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
  const [showGrid, setShowGrid] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"palette" | "analysis">("palette");
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [shrinkAfterGeneration, setShrinkAfterGeneration] = useState(true);
  const [doorRange, setDoorRange] = useState({ min:2, max:5 });
  const [gridSize, setGridSize] = useState(1);
  const [boardZoom, setBoardZoom] = useState(100);
  const [boardPanning, setBoardPanning] = useState(false);
  const [theme, setTheme] = useState<BoardTheme>("industrial");
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
  const suppressMenuClickRef = useRef(false);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
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
  const paletteDoorTotal = catalogueTerrain.filter((item) => item.kind === "door")
    .reduce((sum, item) => sum + (limits[item.id] || 0), 0);
  const effectiveDoorMin = Math.min(doorRange.min, paletteDoorTotal);
  const effectiveDoorMax = Math.max(effectiveDoorMin, Math.min(doorRange.max, paletteDoorTotal));
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
  const usedInventory = useMemo<InventoryGroup[]>(() => {
    const groups:InventoryGroup[] = [];
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
      else if (saved === "ocean" || saved === "taupe") setAppearance("light");
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
  };

  const addToPalette = (defId: string, quantity: number) => {
    const def = getDef(defId);
    const amount = clamp(Math.round(quantity || 0), 1, 999);
    setLimits((current) => ({ ...current, [defId]:clamp((current[defId] || 0) + amount, 0, 999) }));
    setMessage(`${amount} × ${def.shortName} added to the generator palette`);
  };

  const addKitToPalette = () => {
    setLimits((current) => ({ ...current, ...Object.fromEntries(kitTerrain.map((def) => [def.id, clamp((current[def.id] || 0) + (activeCatalogueMeta.inventory[def.id] || 0), 0, 999)])) }));
    setMessage(`${activeCatalogueMeta.name} added to the generator palette`);
  };

  const clearPalette = () => {
    setLimits(Object.fromEntries(TERRAIN.map((item) => [item.id, 0])));
    setMessage("Terrain palette cleared · pieces already on the board were preserved");
  };

  const nextUid = () => `piece-${++uidRef.current}`;
  const selectOnly = useCallback((uid: string | null) => {
    setSelected(uid);
    setSelectedIds(uid ? [uid] : []);
  }, []);
  const quantize = useCallback((value: number) => snap ? Math.round(value / gridSize) * gridSize : Math.round(value * 10) / 10, [gridSize, snap]);
  const pieceIntersectsReservedZone = (piece: PlacedPiece, padding = .08) => {
    const def = getDef(piece.defId);
    const width = piece.rotation === 90 ? def.depth : def.width;
    const height = piece.rotation === 90 ? def.width : def.depth;
    return zones.some((zone) => piece.x < zone.x + zone.width + padding && piece.x + width > zone.x - padding && piece.y < zone.y + zone.height + padding && piece.y + height > zone.y - padding);
  };
  const reservedCoverage = zones.reduce((sum, zone) => sum + zone.width * zone.height, 0) / (boardWidth * boardHeight) * 100;
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
  const changeBoardSize = (preset: BoardPreset | "custom") => {
    if (preset === "custom") return;
    const next = BOARD_SIZES[preset];
    setBoardPreset(preset);
    fitTerrainToBoardSize(next);
    selectOnly(null);
    setMessage(`Board changed to ${next.label} · existing terrain kept within bounds`);
  };
  const shrinkBoardToTerrain = () => {
    const fitted = fitLayoutToContent(pieces, zones, MIN_BOARD_SIZE, { width:MAX_BOARD_WIDTH, height:MAX_BOARD_HEIGHT });
    if (!fitted) return;
    setPieces(fitted.pieces);
    setZones(fitted.zones);
    setCustomBoardSize(fitted.size);
    setBoardPreset("custom");
    selectOnly(null);
    setMessage(`Board shrunk to terrain · ${fitted.size.width.toFixed(1)}″ × ${fitted.size.height.toFixed(1)}″`);
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
    if ((limits[defId] ?? 0) <= 0 || current >= limits[defId]) { setMessage("No more of that piece available"); return; }
    placeNewPiece(defId, x, y, rotation);
    setMessage(`${def.shortName} placed`);
  }, [boardHeight, boardWidth, limits, pieces, placeNewPiece]);

  /** The catalogue's combined "Add" action: tops up the palette by `quantity` and
   *  drops one copy straight onto the board, so a click does something visible
   *  instead of only growing a number in the palette tab. */
  const addFromCatalogue = useCallback((defId: string, quantity: number, x = boardWidth / 2, y = boardHeight / 2) => {
    const def = getDef(defId);
    const amount = clamp(Math.round(quantity || 0), 1, 999);
    setLimits((current) => ({ ...current, [defId]:clamp((current[defId] || 0) + amount, 0, 999) }));
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
    const bounds = boundsOf(sources.map(pieceRect))!;
    const deltaX = clamp(offset, -bounds.x, boardWidth - bounds.x - bounds.width);
    const deltaY = clamp(offset, -bounds.y, boardHeight - bounds.y - bounds.height);
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
    const bounds = boundsOf(copyBuffer.pieces.map(pieceRect))!;
    const deltaX = clamp(step, -bounds.x, boardWidth - bounds.x - bounds.width);
    const deltaY = clamp(step, -bounds.y, boardHeight - bounds.y - bounds.height);
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
    const bounds = boundsOf(sources.map(pieceRect))!;
    const requestedX = deltaX * gridSize;
    const requestedY = deltaY * gridSize;
    const allowedX = clamp(requestedX, -bounds.x, boardWidth - bounds.x - bounds.width);
    const allowedY = clamp(requestedY, -bounds.y, boardHeight - bounds.y - bounds.height);
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
      usage:1,
      doorRange:{ min:effectiveDoorMin, max:effectiveDoorMax },
      seed,
      nextUid,
    });
    lastReportRef.current = report;
    setLayoutReport(report);
    return report.pieces as PlacedPiece[];
  };

  const commitGeneratedLayout = (generated:PlacedPiece[]) => {
    if (!shrinkAfterGeneration) {
      setPieces(generated);
      return null;
    }
    const fitted = fitLayoutToContent(generated, zones, MIN_BOARD_SIZE, { width:MAX_BOARD_WIDTH, height:MAX_BOARD_HEIGHT });
    if (!fitted) {
      setPieces(generated);
      return null;
    }
    setPieces(fitted.pieces);
    setZones(fitted.zones);
    setCustomBoardSize(fitted.size);
    setBoardPreset("custom");
    return fitted.size;
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
    const fittedSize = commitGeneratedLayout(finalized);
    selectOnly(null);
    const joined = paletteCatalogues.length > 1 ? " · compatible cross-kit wall joins enabled" : "";
    const fit = lastReportRef.current?.note ? ` · ${lastReportRef.current.note}` : "";
    const boardFit = fittedSize ? ` · board fit ${fittedSize.width.toFixed(1)} × ${fittedSize.height.toFixed(1)}″` : "";
    setMessage(`${paletteLabel} generated · ${finalized.length} pieces${zones.length ? ` · ${zones.length} zone${zones.length === 1 ? "" : "s"} respected` : ""}${joined}${boardFit}${fit}`);
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
      const fittedSize = commitGeneratedLayout(finalized);
      selectOnly(null);
      const held = pieces.length - finalized.length;
      const boardFit = fittedSize ? ` · board fit ${fittedSize.width.toFixed(1)} × ${fittedSize.height.toFixed(1)}″` : "";
      setMessage(`Layout regenerated · ${finalized.length} pieces${held > 0 ? ` · ${held} held back` : ""}${boardFit}${lastReportRef.current?.note ? ` · ${lastReportRef.current.note}` : ""}`);
    } finally {
      generationInventoryRef.current = null;
    }
  };

  const downloadLayoutPng = () => exportLayoutPng({
    pieces,
    zones,
    boardWidth,
    boardHeight,
    theme,
    coverage,
    onStatus:setMessage,
  });


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

  const finishMenuDrag = () => {
    paletteDragRef.current = null;
    setPaletteDrag(null);
    setDropPreview(null);
  };

  const beginMenuPointerDrag = (event:React.PointerEvent<HTMLElement>, defId:string, source:PaletteDragState["source"], amount?:number) => {
    if (event.button !== 0) return;
    const payload:PaletteDragState = { defId, source, amount, x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in embedded browsers. */ }
    paletteDragRef.current = payload;
    setPaletteDrag(payload);
  };

  const updateDropPreviewAt = (clientX:number, clientY:number) => {
    const current = paletteDragRef.current;
    const board = boardRef.current;
    if (!current || !board) return;
    const rect = board.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) { setDropPreview(null); return; }
    const def = getDef(current.defId);
    const point = boardPoint(clientX, clientY);
    const x = quantize(clamp(point.x - def.width / 2, 0, boardWidth - def.width));
    const y = quantize(clamp(point.y - def.depth / 2, 0, boardHeight - def.depth));
    setDropPreview({ defId:current.defId, x, y, width:def.width, height:def.depth });
  };

  const moveMenuPointerDrag = (event:React.PointerEvent<HTMLElement>) => {
    const current = paletteDragRef.current;
    if (!current) return;
    const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 4;
    const next = { ...current, x:event.clientX, y:event.clientY, moved };
    paletteDragRef.current = next;
    setPaletteDrag(next);
    if (moved) { event.preventDefault(); updateDropPreviewAt(event.clientX, event.clientY); }
  };

  const finishMenuPointerDrag = (event:React.PointerEvent<HTMLElement>) => {
    const current = paletteDragRef.current;
    if (!current) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Capture may already be released. */ }
    if (current.moved && boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        const point = boardPoint(event.clientX, event.clientY);
        if (current.source === "catalogue") addFromCatalogue(current.defId, current.amount ?? 1, point.x, point.y);
        else addPiece(current.defId, point.x, point.y);
      }
      suppressMenuClickRef.current = true;
      window.setTimeout(() => { suppressMenuClickRef.current = false; }, 0);
    }
    finishMenuDrag();
  };

  const updateMenuDropPreview = (event:React.DragEvent<HTMLDivElement>) => { event.preventDefault(); updateDropPreviewAt(event.clientX, event.clientY); };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const encoded = event.dataTransfer.getData("application/x-mortalis-terrain");
    const fallback = paletteDragRef.current;
    let payload = fallback;
    if (encoded) {
      try { payload = { ...JSON.parse(encoded), x:event.clientX, y:event.clientY, startX:event.clientX, startY:event.clientY, moved:true } as PaletteDragState; } catch { /* The in-memory payload remains the fallback. */ }
    }
    const defId = payload?.defId || event.dataTransfer.getData("terrain/def-id");
    if (!defId || !boardRef.current) return;
    const point = boardPoint(event.clientX, event.clientY);
    if (payload?.source === "catalogue") addFromCatalogue(defId, payload.amount ?? 1, point.x, point.y);
    else addPiece(defId, point.x, point.y);
    finishMenuDrag();
  };

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
      <Topbar appearance={appearance} boardPreset={boardPreset} boardWidth={boardWidth} boardHeight={boardHeight} activeBoardName={activeCatalogueMeta.name} canExport={pieces.length > 0} canRemix={pieces.length > 0} onAppearanceChange={setAppearance} onBoardSizeChange={changeBoardSize} onExport={downloadLayoutPng} onRemix={generateLayout} />

      <section className={`workspace ${libraryOpen ? "" : "library-closed"}`}>
        <nav className="workspace-rail" aria-label="Workspace shortcuts">
          <div><button className={libraryOpen ? "active" : ""} aria-label="Toggle terrain library" aria-pressed={libraryOpen} title={libraryOpen ? "Close terrain library" : "Open terrain library"} onClick={() => setLibraryOpen((current) => !current)}><UiIcon name="brand" /><span>Library</span></button><button className={inspectorTab === "palette" ? "active" : ""} aria-label="Generator palette" aria-pressed={inspectorTab === "palette"} title="Generator palette" onClick={() => setInspectorTab("palette")}><UiIcon name="palette" /><span>Palette</span><em>{catalogueTotal}</em></button><button className={inspectorTab === "analysis" ? "active" : ""} aria-label="Board analysis" aria-pressed={inspectorTab === "analysis"} title="Board analysis" onClick={() => setInspectorTab("analysis")}><UiIcon name="wand" /><span>Analysis</span></button></div>
        </nav>
        <TerrainLibrary
          activeCatalogue={activeCatalogue}
          activeKitId={activeKitId}
          activeKit={activeCatalogueMeta}
          manufacturerKits={manufacturerKits}
          pieces={kitTerrain}
          kitTotal={activeKitTotal}
          addAmounts={kitAddAmounts}
          onClose={() => setLibraryOpen(false)}
          onManufacturerChange={selectManufacturer}
          onKitChange={selectKit}
          onAddKit={addKitToPalette}
          onAmountChange={(key, amount) => setKitAddAmounts((current) => ({ ...current, [key]:clamp(amount, 1, 999) }))}
          onAddStock={addToPalette}
          onPlaceOne={addFromCatalogue}
          onPiecePointerDown={(event, defId, amount) => beginMenuPointerDrag(event, defId, "catalogue", amount)}
          onPiecePointerMove={moveMenuPointerDrag}
          onPiecePointerUp={finishMenuPointerDrag}
        />

        <div className="board-column">
          <div className="stage-heading">
            <div className="stage-title"><p className="eyebrow">Editing board</p><h2>{boardWidth.toFixed(0)} × {boardHeight.toFixed(0)} in · {theme}</h2></div>
            <BoardSelectionSummary selectedPiece={selectedPiece} selectedCount={selectedIds.length} placedCount={pieces.length} paletteUsed={paletteUsed} catalogueTotal={catalogueTotal} zoneCount={zones.length} onSelectedHeightChange={setSelectedHeightMm} />
          </div>
          <BoardToolbar
            zoneMode={zoneMode} showGrid={showGrid} hasSelection={selectedIds.length > 0}
            canPaste={copyBuffer !== null} hasTerrain={pieces.length > 0} hasZones={zones.length > 0}
            boardZoom={boardZoom} snap={snap} smartFit={smartFit} gridSize={gridSize} theme={theme}
            onSelectMode={() => { setZoneMode(false); setZoneDraft(null); }}
            onZoneMode={() => { setZoneMode(true); selectOnly(null); setFocusedZone(null); setZoneResize(null); setMarquee(null); setMessage("Name the zone, then drag it on the board"); }}
            onCopy={copySelected} onPaste={pasteCopied} onDuplicate={duplicateSelected}
            onRotate={rotateSelected} onDelete={deleteSelected} onToggleGrid={() => { setShowGrid((current) => !current); setMessage(showGrid ? "Grid lines hidden" : "Grid lines shown"); }}
            onFitBoard={shrinkBoardToTerrain} onClearBoard={clearTerrain}
            onClearZones={() => { setZones([]); setFocusedZone(null); setZoneDraft(null); setZoneResize(null); setMessage("Reserved zones cleared · terrain preserved"); }}
            onZoom={changeBoardZoom} onResetZoom={() => { setBoardZoom(100); setMessage("Board zoom 100%"); }}
            onSmartFitChange={(value) => { setSmartFit(value); setMessage(value ? "Smart fit enabled" : "Smart fit disabled"); }}
            onSnapChange={setSnap} onGridSizeChange={setGridSize} onThemeChange={setTheme}
          />
          {zoneMode && <div className="zone-designator panel"><label><span>Zone name</span><input aria-label="Zone name" value={zoneName} maxLength={32} onChange={(event) => setZoneName(event.target.value)} /></label><p>Drag on the grid to reserve a clear area. Hold <kbd>Shift</kbd> while dragging for a perfect square.</p><strong>{zones.length} saved</strong></div>}

          <div ref={boardAreaRef} className={`board-area ${boardPanning ? "panning" : ""}`} title="Scroll to zoom · hold the mouse wheel and drag to pan" onWheel={zoomBoardAtPointer} onPointerDownCapture={beginBoardPan} onPointerMoveCapture={moveBoardPan} onPointerUpCapture={finishBoardPan} onPointerCancelCapture={finishBoardPan} onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}><div className="board-pan-stage" style={{ "--board-stage-width":`${boardZoom + Math.max(0, boardZoom - 100) * .9}cqw`, "--board-stage-height":`${boardZoom + Math.max(0, boardZoom - 100) * .9}cqh` } as CSSProperties}><div className="board-frame" style={{ "--board-ratio":boardWidth / boardHeight, "--board-zoom":boardZoom / 100 } as CSSProperties}>
            <div className="ruler ruler-top">{Array.from({ length:boardWidth / 12 + 1 }, (_, index) => index * 12).map((inch) => <span key={inch}>{inch}{inch === boardWidth ? "″" : ""}</span>)}</div>
            <div className="ruler ruler-left">{Array.from({ length:boardHeight / 12 + 1 }, (_, index) => index * 12).map((inch) => <span key={inch}>{inch}{inch === boardHeight ? "″" : ""}</span>)}</div>
            <div id="layout-board" ref={boardRef} style={{ "--minor-x":`${100 / boardWidth}%`, "--minor-y":`${100 / boardHeight}%`, "--major-x":`${1200 / boardWidth}%`, "--major-y":`${1200 / boardHeight}%` } as CSSProperties} className={`board ${theme}-board ${showGrid ? "grid-visible" : "grid-hidden"} ${drag ? "dragging" : ""} ${paletteDrag ? "menu-dragging" : ""} ${marquee ? "selecting" : ""} ${zoneMode ? "zone-mode" : ""} ${zoneResize ? "resizing-zone" : ""} ${zoneDrag ? "dragging-zone" : ""}`} aria-label={`${boardWidth.toFixed(1)} by ${boardHeight.toFixed(1)} inch layout board`} aria-describedby="board-help" onDragOver={updateMenuDropPreview} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreview(null); }} onDrop={onDrop} onPointerMove={onBoardPointerMove} onPointerUp={() => { if (zoneDraft) finishZone(); if (marquee) finishMarquee(); if (zoneResize) { const zone = zones.find((item) => item.uid === zoneResize.uid); if (zone) setMessage(`${zone.name} resized · ${zone.width.toFixed(1)} × ${zone.height.toFixed(1)} in`); setZoneResize(null); } if (zoneDrag) { const zone = zones.find((item) => item.uid === zoneDrag.uid); if (zone) setMessage(`${zone.name} moved · ${zone.x.toFixed(1)}, ${zone.y.toFixed(1)} in`); setZoneDrag(null); } setDrag(null); }} onPointerCancel={() => { setZoneDraft(null); setZoneResize(null); setZoneDrag(null); setMarquee(null); setDrag(null); }} onPointerDown={beginZone}>
              {pieces.length === 0 && <div className="board-mark"><strong>{boardPreset === "custom" ? `${boardWidth.toFixed(1)}″ × ${boardHeight.toFixed(1)}″` : BOARD_SIZES[boardPreset].label}</strong><span>{zoneMode ? "DRAG TO RESERVE A CLEAR ZONE" : "DROP TERRAIN TO PLACE"}</span></div>}
              {zones.map((zone) => <div key={zone.uid} role="group" tabIndex={zoneMode ? -1 : 0} aria-label={`${zone.name}, reserved zone ${zone.width.toFixed(1)} by ${zone.height.toFixed(1)} inches`} className={`reserved-zone ${focusedZone === zone.uid ? "focused" : ""} ${zoneResize?.uid === zone.uid ? "resizing" : ""} ${zoneDrag?.uid === zone.uid ? "moving" : ""}`} style={{ left:`${zone.x / boardWidth * 100}%`, top:`${zone.y / boardHeight * 100}%`, width:`${zone.width / boardWidth * 100}%`, height:`${zone.height / boardHeight * 100}%` }} onPointerDown={(event) => beginZoneDrag(event, zone)} onFocus={() => setFocusedZone(zone.uid)}><strong>{zone.name}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span>{!zoneMode && (["nw","ne","sw","se"] as ZoneCorner[]).map((corner) => <button key={corner} className={`zone-handle ${corner}`} aria-label={`Resize ${zone.name} from ${corner} corner`} title="Drag to resize" onPointerDown={(event) => beginZoneResize(event, zone, corner)} />)}</div>)}
              {zoneDraft && (() => { const zone = normaliseZoneDraft(zoneDraft); return <div className="reserved-zone draft" style={{ left:`${zone.x / boardWidth * 100}%`, top:`${zone.y / boardHeight * 100}%`, width:`${zone.width / boardWidth * 100}%`, height:`${zone.height / boardHeight * 100}%` }}><strong>{zoneName.trim() || "Hangar"}</strong><span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span></div>; })()}
              {marquee && (() => { const left = Math.min(marquee.startX, marquee.currentX); const top = Math.min(marquee.startY, marquee.currentY); return <div className="selection-marquee" aria-hidden="true" style={{ left:`${left / boardWidth * 100}%`, top:`${top / boardHeight * 100}%`, width:`${Math.abs(marquee.currentX - marquee.startX) / boardWidth * 100}%`, height:`${Math.abs(marquee.currentY - marquee.startY) / boardHeight * 100}%` }} />; })()}
              {dropPreview && <div className="menu-drop-preview" aria-hidden="true" style={{ left:`${dropPreview.x / boardWidth * 100}%`, top:`${dropPreview.y / boardHeight * 100}%`, width:`${dropPreview.width / boardWidth * 100}%`, height:`${dropPreview.height / boardHeight * 100}%` }} />}
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

        <aside id="generator-panel" className="inspector panel">
          {inspectorTab === "analysis" && <div className="inspector-heading"><p className="eyebrow">Board intelligence</p><h2>Review the layout</h2></div>}
          {inspectorTab === "palette" ? <PalettePanel
            paletteUsed={paletteUsed} catalogueTotal={catalogueTotal}
            shrinkAfterGeneration={shrinkAfterGeneration} anchor={anchor}
            doorTotal={paletteDoorTotal} doorMin={effectiveDoorMin} doorMax={effectiveDoorMax}
            paletteMaker={paletteMaker} paletteLabel={paletteLabel} terrain={catalogueTerrain}
            used={used} limits={limits} heightDefaults={heightDefaults}
            onClear={clearPalette}
            onShrinkAfterGenerationChange={setShrinkAfterGeneration} onAnchorChange={setAnchor}
            onDoorMinChange={(min) => setDoorRange((current) => ({ min, max:Math.max(min, current.max) }))}
            onDoorMaxChange={(max) => setDoorRange((current) => ({ min:Math.min(current.min, max), max }))}
            onGenerate={generateFromPalette} onPlace={(defId) => {
              if (suppressMenuClickRef.current) { suppressMenuClickRef.current = false; return; }
              addPiece(defId);
            }} onQuantityChange={setPaletteQuantity}
            onPiecePointerDown={(event, defId) => beginMenuPointerDrag(event, defId, "palette")}
            onPiecePointerMove={moveMenuPointerDrag}
            onPiecePointerUp={finishMenuPointerDrag}
          /> : <AnalysisPanel
            pieces={pieces} selectedPiece={selectedPiece} selectedCount={selectedIds.length}
            paletteUsed={paletteUsed} catalogueTotal={catalogueTotal}
            paletteMaker={paletteMaker} paletteLabel={paletteLabel} paletteCatalogues={paletteCatalogues}
            generationJoint={generationJoint} generationRange={generationRange}
            coverage={coverage} zones={zones} reservedCoverage={reservedCoverage}
            wallCount={wallPieces.length} doorCount={doors} loops={loops} chambers={chambers}
            usedInventory={usedInventory} boardWidth={boardWidth} boardHeight={boardHeight}
            focusedZone={focusedZone} onSelectedHeightChange={setSelectedHeightMm}
            familyIsAvailable={familyIsAvailable} familyHeightMm={familyHeightMm}
            onFamilyHeightChange={setFamilyHeightMm}
            onZonesChange={setZones} onFocusedZoneChange={setFocusedZone}
            onZoneResizeCancel={(uid) => {
              if (!uid) {
                setZoneDraft(null);
                setZoneResize(null);
                setMessage("Reserved zones cleared");
              } else if (zoneResize?.uid === uid) {
                setZoneResize(null);
              }
            }}
          />}
        </aside>
      </section>
    </main>
  );
}
