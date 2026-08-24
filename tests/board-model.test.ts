import assert from "node:assert/strict";
import test from "node:test";
import { boundsOf, clamp, connectionCandidates, pieceRect, piecesOverlap, type PlacedPiece } from "../app/board/model.ts";

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

test("snap candidates respect kit joint models and collision rectangles", () => {
  const wall = piece();
  const pillar = piece({ uid:"pillar", defId:"pillar", x:4, y:0 });
  assert.ok(connectionCandidates(wall, pillar).length > 0);
  assert.equal(piecesOverlap(wall, piece({ uid:"far", x:20 })), false);
});
