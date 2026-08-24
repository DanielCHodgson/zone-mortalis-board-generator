import { MANUFACTURERS, getDef, type TerrainDef } from "../terrain.ts";

export type Rotation = 0 | 90;
export type Facing = 0 | 90 | 180 | 270;

export type PlacedPiece = {
  uid:string; defId:string; x:number; y:number; rotation:Rotation; height:number;
  runId?:string; sequenceIndex?:number; servesDoorway?:boolean; facing?:Facing;
};

export type ReservedZone = {
  uid:string; name:string; x:number; y:number; width:number; height:number;
};

export type Rect = { x:number; y:number; width:number; height:number };
export type Point = { x:number; y:number };
export type ZoneDraft = { startX:number; startY:number; currentX:number; currentY:number };
export type ConnectionCandidate = { dx:number; dy:number; rotation?:Rotation };

export const clamp = (value:number, min:number, max:number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

export const pieceRect = (piece:PlacedPiece):Rect => {
  const def = getDef(piece.defId);
  return {
    x:piece.x,
    y:piece.y,
    width:piece.rotation === 90 ? def.depth : def.width,
    height:piece.rotation === 90 ? def.width : def.depth,
  };
};

export const boundsOf = (rects:Rect[]):Rect | null => {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x:left, y:top, width:right - left, height:bottom - top };
};

export const normaliseZoneDraft = (draft:ZoneDraft):Rect => ({
  x:Math.min(draft.startX, draft.currentX),
  y:Math.min(draft.startY, draft.currentY),
  width:Math.abs(draft.currentX - draft.startX),
  height:Math.abs(draft.currentY - draft.startY),
});

const pieceCentre = (piece:PlacedPiece):Point => {
  const rect = pieceRect(piece);
  return { x:rect.x + rect.width / 2, y:rect.y + rect.height / 2 };
};

export const structuralEndpoints = (piece:PlacedPiece):Point[] => {
  const def = getDef(piece.defId);
  const centre = def.depth / 2;
  return piece.rotation === 0
    ? [{ x:piece.x, y:piece.y + centre }, { x:piece.x + def.width, y:piece.y + centre }]
    : [{ x:piece.x + centre, y:piece.y }, { x:piece.x + centre, y:piece.y + def.width }];
};

const endAttachmentPoints = (piece:PlacedPiece):Point[] => {
  const rect = pieceRect(piece);
  return piece.rotation === 90
    ? [{ x:rect.x, y:rect.y + rect.height / 2 }, { x:rect.x + rect.width, y:rect.y + rect.height / 2 }]
    : [{ x:rect.x + rect.width / 2, y:rect.y }, { x:rect.x + rect.width / 2, y:rect.y + rect.height }];
};

const connectorFaces = (piece:PlacedPiece):Point[] => {
  const rect = pieceRect(piece);
  return [
    { x:rect.x, y:rect.y + rect.height / 2 },
    { x:rect.x + rect.width, y:rect.y + rect.height / 2 },
    { x:rect.x + rect.width / 2, y:rect.y },
    { x:rect.x + rect.width / 2, y:rect.y + rect.height },
  ];
};

const isStructural = (def:TerrainDef) => def.kind === "wall" || def.kind === "door";
const hasSpecialFace = (def:TerrainDef) => ["pipe", "vertical-pipe", "floor", "stair"].includes(def.visual ?? "");

export const connectionCandidates = (moving:PlacedPiece, fixed:PlacedPiece):ConnectionCandidate[] => {
  const movingDef = getDef(moving.defId);
  const fixedDef = getDef(fixed.defId);
  const movingStructural = isStructural(movingDef);
  const fixedStructural = isStructural(fixedDef);

  if (movingDef.catalogue !== fixedDef.catalogue) {
    if (!movingStructural || !fixedStructural || hasSpecialFace(movingDef) || hasSpecialFace(fixedDef)) return [];
    if (Math.abs(movingDef.depth - fixedDef.depth) > .55) return [];
    return structuralEndpoints(moving).flatMap((movingPoint) => structuralEndpoints(fixed).map((fixedPoint) => ({
      dx:fixedPoint.x - movingPoint.x,
      dy:fixedPoint.y - movingPoint.y,
    })));
  }

  let movingPoints:Point[] = [];
  let fixedPoints:Point[] = [];
  let rotation:Rotation | undefined;
  if (MANUFACTURERS[movingDef.catalogue].joint === "straddle") {
    if (movingStructural && fixedStructural) { movingPoints = structuralEndpoints(moving); fixedPoints = structuralEndpoints(fixed); }
    else if (movingStructural && fixedDef.kind === "pillar") { movingPoints = structuralEndpoints(moving); fixedPoints = [pieceCentre(fixed)]; }
    else if (movingDef.kind === "pillar" && fixedStructural) { movingPoints = [pieceCentre(moving)]; fixedPoints = structuralEndpoints(fixed); }
    else if (movingDef.kind === "end" && fixedStructural) {
      rotation = fixed.rotation === 0 ? 90 : 0;
      movingPoints = endAttachmentPoints({ ...moving, rotation });
      fixedPoints = structuralEndpoints(fixed);
    } else if (movingStructural && fixedDef.kind === "end") {
      movingPoints = structuralEndpoints(moving);
      fixedPoints = endAttachmentPoints(fixed);
    }
  } else {
    if (movingStructural && fixedDef.kind === "connector") { movingPoints = structuralEndpoints(moving); fixedPoints = connectorFaces(fixed); }
    else if (movingDef.kind === "connector" && fixedStructural) { movingPoints = connectorFaces(moving); fixedPoints = structuralEndpoints(fixed); }
    else if (movingDef.kind === "end" && fixedDef.kind === "connector") {
      return connectorFaces(fixed).flatMap((fixedPoint, faceIndex) => {
        const nextRotation:Rotation = faceIndex < 2 ? 0 : 90;
        return structuralEndpoints({ ...moving, rotation:nextRotation }).map((movingPoint) => ({
          dx:fixedPoint.x - movingPoint.x,
          dy:fixedPoint.y - movingPoint.y,
          rotation:nextRotation,
        }));
      });
    } else if (movingDef.kind === "connector" && fixedDef.kind === "end") {
      movingPoints = connectorFaces(moving);
      fixedPoints = structuralEndpoints(fixed);
    }
  }
  return movingPoints.flatMap((movingPoint) => fixedPoints.map((fixedPoint) => ({
    dx:fixedPoint.x - movingPoint.x,
    dy:fixedPoint.y - movingPoint.y,
    rotation,
  })));
};

export const piecesOverlap = (first:PlacedPiece, second:PlacedPiece, padding=.06) => {
  const a = pieceRect(first);
  const b = pieceRect(second);
  return a.x < b.x + b.width + padding && a.x + a.width > b.x - padding
    && a.y < b.y + b.height + padding && a.y + a.height > b.y - padding;
};
