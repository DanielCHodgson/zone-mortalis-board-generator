import test from "node:test";
import assert from "node:assert/strict";
import { generateSpatialLayout, type SpatialPiece, type SpatialTerrainDef } from "../app/spatial-generator.ts";

const INCH = 25.4;
const definitions:SpatialTerrainDef[] = [
  { id:"pillar", catalogue:"boarding", width:.98, depth:.98, height:2.36, kind:"pillar" },
  { id:"long-wall", catalogue:"boarding", width:6.69, depth:1.1, height:2.36, kind:"wall" },
  { id:"short-wall", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"wall" },
  { id:"short-door", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"door" },
  { id:"tt-connector", catalogue:"ttcombat", width:50/INCH, depth:50/INCH, height:60/INCH, kind:"connector" },
  { id:"tt-solid-wall", catalogue:"ttcombat", width:64/INCH, depth:33/INCH, height:60/INCH, kind:"wall" },
];

const rect = (piece:SpatialPiece) => {
  const def = definitions.find((candidate) => candidate.id === piece.defId)!;
  return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
};

const distance = (first:ReturnType<typeof rect>, second:ReturnType<typeof rect>) => Math.hypot(
  Math.max(0, first.x - second.x - second.width, second.x - first.x - first.width),
  Math.max(0, first.y - second.y - second.height, second.y - first.y - first.height),
);

const makeLayout = (catalogue:"boarding" | "ttcombat", inventory:Record<string, number>, usage:number, seed = 41) => {
  let uid = 0;
  return generateSpatialLayout({
    boardWidth:24, boardHeight:24, catalogue, definitions, inventory,
    heights:{}, zones:[], usage, seed, nextUid:() => `test-${uid++}`,
  });
};

const bestLayout = (catalogue:"boarding" | "ttcombat", inventory:Record<string, number>, usage:number, seed:number) =>
  Array.from({ length:24 }, (_, index) => makeLayout(catalogue, inventory, usage, seed + index * 7919))
    .sort((first, second) => second.filter((piece) => !["pillar", "connector"].includes(definitions.find((def) => def.id === piece.defId)!.kind)).length -
      first.filter((piece) => !["pillar", "connector"].includes(definitions.find((def) => def.id === piece.defId)!.kind)).length)[0];

test("Iron walls are bracketed by a connector at both physical ends", () => {
  const layout = bestLayout("ttcombat", { "tt-connector":24, "tt-solid-wall":18 }, .6, 41);
  const walls = layout.filter((piece) => piece.defId === "tt-solid-wall");
  const connectors = layout.filter((piece) => piece.defId === "tt-connector").map(rect);
  assert.equal(walls.length, 11);
  assert.ok(new Set(walls.map((piece) => piece.runId)).size >= 3);

  walls.forEach((wall) => {
    const wallRect = rect(wall);
    const endpoints = wall.rotation === 0
      ? [{ x:wallRect.x, y:wallRect.y + wallRect.height / 2 }, { x:wallRect.x + wallRect.width, y:wallRect.y + wallRect.height / 2 }]
      : [{ x:wallRect.x + wallRect.width / 2, y:wallRect.y }, { x:wallRect.x + wallRect.width / 2, y:wallRect.y + wallRect.height }];
    endpoints.forEach((point) => assert.ok(connectors.some((connector) =>
      point.x >= connector.x - .01 && point.x <= connector.x + connector.width + .01 &&
      point.y >= connector.y - .01 && point.y <= connector.y + connector.height + .01
    ), `missing connector at wall endpoint ${point.x}, ${point.y}`));
  });
});

test("Iron components leave model-scale corridors between wall networks", () => {
  const layout = makeLayout("ttcombat", { "tt-connector":24, "tt-solid-wall":18 }, .6, 73);
  const structures = layout.filter((piece) => piece.defId !== "tt-connector");
  assert.equal(structures.length, 11);
  const runs = [...new Set(structures.map((piece) => piece.runId!))];
  assert.ok(runs.length >= 3);
  for (let first = 0; first < runs.length; first++) for (let second = first + 1; second < runs.length; second++) {
    const firstPieces = layout.filter((piece) => piece.runId === runs[first]);
    const secondPieces = layout.filter((piece) => piece.runId === runs[second]);
    const clearance = Math.min(...firstPieces.flatMap((a) => secondPieces.map((b) => distance(rect(a), rect(b)))));
    assert.ok(clearance >= 3.79, `corridor narrowed to ${clearance.toFixed(2)} inches`);
  }
});

test("Boarding Actions uses several shaped networks rather than floating rows", () => {
  const layout = bestLayout("boarding", { pillar:32, "long-wall":8, "short-wall":4, "short-door":8 }, .6, 97);
  const structures = layout.filter((piece) => piece.defId !== "pillar");
  assert.ok(structures.length >= 10);
  const runs = [...new Set(structures.map((piece) => piece.runId!))];
  assert.ok(runs.length >= 3);
  runs.forEach((runId) => {
    const rotations = new Set(structures.filter((piece) => piece.runId === runId).map((piece) => piece.rotation));
    assert.equal(rotations.size, 2, `${runId} is only a straight floating barricade`);
  });
});
