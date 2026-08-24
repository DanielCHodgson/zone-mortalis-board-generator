import assert from "node:assert/strict";
import test from "node:test";
import { boundsOf, clamp, connectionCandidates, fitLayoutToContent, pieceRect, piecesOverlap, type PlacedPiece } from "../app/board/model.ts";

const piece = (overrides:Partial<PlacedPiece> = {}):PlacedPiece => ({
  uid:"piece", defId:"short-wall", x:0, y:0, rotation:0, height:2.36, ...overrides,
});

test("board bounds and rectangles share one rotation-aware implementation", () => {
  const horizontal = piece();
  const vertical = piece({ uid:"vertical", x:4, y:3, rotation:90 });
  const first = pieceRect(horizontal);
  const second = pieceRect(vertical);
  assert.equal(first.width, second.height);
  assert.equal(first.height, second.width);
  assert.deepEqual(boundsOf([first, second]), {
    x:0,
    y:0,
    width:second.x + second.width,
    height:second.y + second.height,
  });
});

test("invalid numeric input is clamped before it can poison board state", () => {
  assert.equal(clamp(Number.NaN, 10, 300), 10);
  assert.equal(clamp(Number.POSITIVE_INFINITY, 10, 300), 10);
  assert.equal(clamp(120, 10, 300), 120);
});

test("fitting uses real piece footprints and translates the layout as one unit", () => {
  const pieces = [piece({ x:2, y:3 }), piece({ uid:"second", x:8, y:7, rotation:90 })];
  const fitted = fitLayoutToContent(pieces, [], 1, { width:60, height:48 });
  assert.ok(fitted);
  const bounds = boundsOf(fitted.pieces.map(pieceRect));
  assert.ok(bounds);
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= fitted.size.width);
  assert.ok(bounds.y + bounds.height <= fitted.size.height);
  assert.equal(fitted.pieces[1].x - fitted.pieces[0].x, pieces[1].x - pieces[0].x);
  assert.equal(fitted.pieces[1].y - fitted.pieces[0].y, pieces[1].y - pieces[0].y);
});

test("snap candidates respect kit joint models and collision rectangles", () => {
  const wall = piece();
  const pillar = piece({ uid:"pillar", defId:"pillar", x:4, y:0 });
  assert.ok(connectionCandidates(wall, pillar).length > 0);
  assert.equal(piecesOverlap(wall, piece({ uid:"far", x:20 })), false);
});
