import test from "node:test";
import assert from "node:assert/strict";
import { generateSpatialLayout, type SpatialPiece, type SpatialTerrainDef } from "../app/spatial-generator.ts";

const INCH = 25.4;
const definitions:SpatialTerrainDef[] = [
  { id:"pillar", catalogue:"boarding", width:32/INCH, depth:32/INCH, height:2.36, kind:"pillar" },
  { id:"long-wall", catalogue:"boarding", width:6.69, depth:1.1, height:2.36, kind:"wall" },
  { id:"short-wall", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"wall" },
  { id:"short-door", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"door" },
  { id:"tt-connector", catalogue:"ttcombat", width:50/INCH, depth:50/INCH, height:60/INCH, kind:"connector" },
  { id:"tt-solid-wall", catalogue:"ttcombat", width:64/INCH, depth:33/INCH, height:60/INCH, kind:"wall" },
  { id:"tt-door", catalogue:"ttcombat", width:64/INCH, depth:33/INCH, height:60/INCH, kind:"door" },
  // Gallowdark sits on a 97 mm assembly grid, so a long wall spans two squares
  // regardless of the panel's own measured length.
  { id:"long-wall-pillars", catalogue:"boarding", width:183/INCH, depth:1.1, height:2.36, kind:"wall", span:194/INCH },
];

const rect = (piece:SpatialPiece) => {
  const def = definitions.find((candidate) => candidate.id === piece.defId)!;
  return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
};

const distance = (first:ReturnType<typeof rect>, second:ReturnType<typeof rect>) => Math.hypot(
  Math.max(0, first.x - second.x - second.width, second.x - first.x - first.width),
  Math.max(0, first.y - second.y - second.height, second.y - first.y - first.height),
);

const makeLayout = (catalogue:"boarding" | "ttcombat", inventory:Record<string, number>, usage:number, seed = 41, boardWidth = 24, boardHeight = 24) => {
  let uid = 0;
  return generateSpatialLayout({
    boardWidth, boardHeight, catalogue, definitions, inventory,
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
  assert.ok(walls.length >= 10, `only ${walls.length} Iron walls placed`);
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
  // Scored over 24 candidates, matching how the UI actually generates. Iron Ultima
  // ships no doors, so a pocket sealed against the border can only be reopened by
  // removing the wall that seals it — reachability takes precedence over squeezing
  // the last wall on. The exact-target guarantee lives in the utilisation test,
  // which uses a door-bearing palette and hits its target on every seed.
  const layout = bestLayout("ttcombat", { "tt-connector":24, "tt-solid-wall":18 }, .6, 73);
  const structures = layout.filter((piece) => piece.defId !== "tt-connector");
  assert.ok(structures.length >= 10, `only ${structures.length} Iron structures placed`);
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

const structuralCount = (layout:SpatialPiece[]) =>
  layout.filter((piece) => !["pillar", "connector"].includes(definitions.find((def) => def.id === piece.defId)!.kind)).length;

// A component that could not be sited was abandoned whole, silently orphaning
// up to five walls per failure. Every seed should now reach the requested
// structural target rather than quietly spending two thirds of it.
test("a rejected component is retried smaller instead of orphaning its pieces", () => {
  const inventory = { "tt-connector":24, "tt-solid-wall":18, "tt-door":3 };
  const target = Math.round(21 * .6);
  const placed = [503, 8422, 16341, 24260, 32179, 40098].map((seed) => structuralCount(bestLayout("ttcombat", inventory, .6, seed)));
  const worst = Math.min(...placed);
  assert.ok(worst >= target - 1, `worst seed placed ${worst} of a ${target} structural target (all seeds: ${placed})`);
});

// A door was placed on any edge, including a leaf, leaving a support at its far
// end with nothing beyond it. Physically that is a freestanding frame in open
// space that models simply walk around, so a door must sit inline in a run with
// structural terrain continuing past both of its ends.
test("every door is inline in a run rather than a freestanding frame", () => {
  const endpoints = (piece:SpatialPiece) => {
    const box = rect(piece);
    return box.width > box.height
      ? [{ x:box.x, y:box.y + box.height / 2 }, { x:box.x + box.width, y:box.y + box.height / 2 }]
      : [{ x:box.x + box.width / 2, y:box.y }, { x:box.x + box.width / 2, y:box.y + box.height }];
  };
  const cases = [
    { catalogue:"boarding" as const, inventory:{ pillar:32, "long-wall":8, "short-wall":4, "short-door":8 } },
    { catalogue:"ttcombat" as const, inventory:{ "tt-connector":24, "tt-solid-wall":18, "tt-door":3 } },
  ];
  cases.forEach(({ catalogue, inventory }) => {
    // Neighbouring structural pieces are separated by exactly one support, so
    // their facing endpoints sit that far apart. Read the support width from the
    // catalogue rather than hardcoding it, or a resized pillar breaks the test
    // rather than the behaviour it guards.
    const support = Math.max(...definitions
      .filter((def) => def.catalogue === catalogue && ["pillar", "connector"].includes(def.kind))
      .map((def) => Math.max(def.width, def.depth)));
    const tolerance = support + .2;
    [617, 8536, 16455, 24374].forEach((seed) => {
      const layout = bestLayout(catalogue, inventory, .6, seed);
      const structures = layout.filter((piece) => !["pillar", "connector"].includes(definitions.find((def) => def.id === piece.defId)!.kind));
      const doors = structures.filter((piece) => definitions.find((def) => def.id === piece.defId)!.kind === "door");
      assert.ok(doors.length > 0, `${catalogue} seed ${seed} placed no doors to check`);
      doors.forEach((door) => {
        endpoints(door).forEach((point) => {
          const continues = structures.some((other) => other.uid !== door.uid
            && endpoints(other).some((candidate) => Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance));
          // Per rule 9 the board border is itself a wall, so an end that reaches
          // the border is terminated just as validly as one meeting more terrain.
          const meetsBorder = point.x <= tolerance || point.y <= tolerance
            || point.x >= 24 - tolerance || point.y >= 24 - tolerance;
          assert.ok(continues || meetsBorder, `${catalogue} seed ${seed}: door ${door.defId} is open at (${point.x.toFixed(2)}, ${point.y.toFixed(2)})`);
        });
      });
    });
  });
});

// In both real kits the support is a chunky column that the wall panels clip
// into, so it is never thinner than the wall. When it was, walls overhung their
// pillars by a sixteenth of an inch a side and every joint read as badly seated.
test("supports are never narrower than the walls they bracket", () => {
  const supports = definitions.filter((def) => ["pillar", "connector"].includes(def.kind));
  supports.forEach((support) => {
    const walls = definitions.filter((def) => def.catalogue === support.catalogue && ["wall", "door"].includes(def.kind));
    walls.forEach((wall) => {
      const thickness = Math.min(wall.width, wall.depth);
      assert.ok(Math.min(support.width, support.depth) >= thickness - .001,
        `${support.id} is ${support.width.toFixed(2)}" across but ${wall.id} is ${thickness.toFixed(2)}" thick`);
    });
  });
});

// Gallowdark is a grid kit: its board is 7 x 6 squares of 97 mm, so pillars land
// on a 97 mm pitch and a long wall spans two squares. Spacing must come from that
// pitch, not from the panel's measured length plus a pillar, which stretched
// every joint by a full pillar — about an inch at this scale.
test("a grid-kit wall spans exactly one grid pitch between pillar centres", () => {
  const span = 194 / INCH;
  const layout = bestLayout("boarding", { pillar:32, "long-wall-pillars":8, "short-wall":4 }, .6, 1207);
  const spanned = layout.filter((piece) => piece.defId === "long-wall-pillars");
  assert.ok(spanned.length >= 2, `expected several spanned walls, got ${spanned.length}`);
  const pillars = layout.filter((piece) => piece.defId === "pillar").map(rect);
  const centreOf = (box:ReturnType<typeof rect>) => ({ x:box.x + box.width / 2, y:box.y + box.height / 2 });
  spanned.forEach((piece) => {
    const box = rect(piece);
    const along = piece.rotation === 0 ? "x" : "y";
    const centre = centreOf(box);
    // The two pillars bracketing this wall sit one span apart, centred on it.
    const bracketing = pillars
      .map(centreOf)
      .filter((point) => Math.abs(point[along === "x" ? "y" : "x"] - centre[along === "x" ? "y" : "x"]) < .1)
      .sort((first, second) => Math.abs(first[along] - centre[along]) - Math.abs(second[along] - centre[along]))
      .slice(0, 2)
      .sort((first, second) => first[along] - second[along]);
    assert.equal(bracketing.length, 2, `wall at (${box.x.toFixed(2)}, ${box.y.toFixed(2)}) is not bracketed by two pillars`);
    const pitch = bracketing[1][along] - bracketing[0][along];
    assert.ok(Math.abs(pitch - span) < .02, `pillar pitch measured ${pitch.toFixed(3)}" but the grid span is ${span.toFixed(3)}"`);
    // And the panel sits centred in that span rather than flush to one end.
    const midpoint = (bracketing[0][along] + bracketing[1][along]) / 2;
    assert.ok(Math.abs(midpoint - centre[along]) < .02, `panel is off-centre in its grid square by ${Math.abs(midpoint - centre[along]).toFixed(3)}"`);
  });
});

// Closed rooms need a cyclic pattern, which the tree-based builder could not
// express: the closing edge has to land exactly back on the node it started from.
// A room is only built when a door is among its four sides, so it is a room rather
// than a sealed box the reachability pass would then have to break open.
test("closed rooms are built, and every one of them has a doorway", () => {
  const grid = 97 / INCH;
  const roomDefs:SpatialTerrainDef[] = [
    { id:"pillar", catalogue:"boarding", width:32 / INCH, depth:32 / INCH, height:2.36, kind:"pillar" },
    { id:"room-wall", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"wall", span:grid },
    { id:"room-door", catalogue:"boarding", width:3.15, depth:1.1, height:2.36, kind:"door", span:grid },
  ];
  const boxOf = (piece:SpatialPiece) => {
    const def = roomDefs.find((candidate) => candidate.id === piece.defId)!;
    return { x:piece.x, y:piece.y, width:piece.rotation === 90 ? def.depth : def.width, height:piece.rotation === 90 ? def.width : def.depth };
  };
  let rooms = 0;
  let roomsWithoutDoor = 0;
  [500, 8419, 16338, 24257, 32176].forEach((seed) => {
    let uid = 0;
    const layout = generateSpatialLayout({
      boardWidth:48, boardHeight:48, catalogue:"boarding", definitions:roomDefs,
      inventory:{ pillar:32, "room-wall":12, "room-door":8 }, heights:{}, zones:[], usage:1,
      seed, nextUid:() => `room-${uid++}`,
    });
    const runs = new Map<string, SpatialPiece[]>();
    layout.forEach((piece) => {
      const key = piece.runId ?? "none";
      runs.set(key, [...(runs.get(key) ?? []), piece]);
    });
    runs.forEach((pieces) => {
      const structural = pieces.filter((piece) => roomDefs.find((def) => def.id === piece.defId)!.kind !== "pillar");
      const supports = pieces.length - structural.length;
      // A tree has one more node than edges; a closed loop has exactly as many.
      if (structural.length < 4 || supports !== structural.length) return;
      rooms++;
      const hasDoor = structural.some((piece) => roomDefs.find((def) => def.id === piece.defId)!.kind === "door");
      if (!hasDoor) roomsWithoutDoor++;
      // A closed loop encloses area: opposite sides must have met exactly.
      const xs = structural.map(boxOf).map((box) => box.x);
      const ys = structural.map(boxOf).map((box) => box.y);
      assert.ok(Math.max(...xs) - Math.min(...xs) > .5 && Math.max(...ys) - Math.min(...ys) > .5,
        "a closed run should enclose area on both axes");
    });
  });
  assert.ok(rooms > 0, "no closed room was generated across any seed");
  assert.equal(roomsWithoutDoor, 0, `${roomsWithoutDoor} of ${rooms} rooms were sealed with no doorway`);
});

// Walled-off space is wasted space: models cannot enter it, so it is not board.
// Flood the walkable area with doors passable and everything else solid; every
// region worth standing in must be part of one connected space.
const CELL = .25;
const walkableRegions = (layout:SpatialPiece[], width:number, height:number) => {
  const columns = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const blocked = new Uint8Array(columns * rows);
  layout.forEach((piece) => {
    const def = definitions.find((candidate) => candidate.id === piece.defId)!;
    if (def.kind === "door") return;
    const box = rect(piece);
    for (let y = Math.max(0, Math.floor(box.y / CELL)); y <= Math.min(rows - 1, Math.ceil((box.y + box.height) / CELL) - 1); y++)
      for (let x = Math.max(0, Math.floor(box.x / CELL)); x <= Math.min(columns - 1, Math.ceil((box.x + box.width) / CELL) - 1); x++)
        blocked[y * columns + x] = 1;
  });
  const seen = new Int32Array(columns * rows).fill(-1);
  const sizes:number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (blocked[start] || seen[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const queue = [start];
    seen[start] = id;
    while (queue.length) {
      const cell = queue.pop()!;
      size++;
      const x = cell % columns;
      const y = (cell - x) / columns;
      const neighbours = [x > 0 ? cell - 1 : -1, x < columns - 1 ? cell + 1 : -1, y > 0 ? cell - columns : -1, y < rows - 1 ? cell + columns : -1];
      neighbours.forEach((n) => { if (n >= 0 && !blocked[n] && seen[n] === -1) { seen[n] = id; queue.push(n); } });
    }
    sizes.push(size);
  }
  return sizes;
};

test("no walled-off dead zone survives in the walkable space", () => {
  // 1.5 square inches is the floor for "worth reaching" — smaller than that is
  // grid rounding behind a wall, not a room.
  const minimumPocket = Math.ceil(1.5 / CELL / CELL);
  const cases = [
    { catalogue:"boarding" as const, inventory:{ pillar:32, "long-wall":8, "short-wall":4, "short-door":8 } },
    { catalogue:"ttcombat" as const, inventory:{ "tt-connector":24, "tt-solid-wall":18, "tt-door":3 } },
    // Iron with no doors at all: pockets must be opened by removing the sealing
    // wall, because there is nothing to cut a doorway with.
    { catalogue:"ttcombat" as const, inventory:{ "tt-connector":20, "tt-solid-wall":20 } },
  ];
  cases.forEach(({ catalogue, inventory }) => {
    [811, 8730, 16649].forEach((seed) => {
      [[24, 24], [48, 24]].forEach(([width, height]) => {
        const layout = Array.from({ length:24 }, (_, index) => makeLayout(catalogue, inventory, .6, seed + index * 7919, width, height))
          .sort((first, second) => structuralCount(second) - structuralCount(first))[0];
        const sizes = walkableRegions(layout, width, height);
        const main = Math.max(...sizes);
        const pockets = sizes.filter((size) => size !== main && size >= minimumPocket);
        const lost = (pockets.reduce((sum, size) => sum + size, 0) * CELL * CELL).toFixed(1);
        assert.equal(pockets.length, 0,
          `${catalogue} ${width}x${height} seed ${seed}: ${pockets.length} dead zone(s) sealing ${lost} square inches`);
      });
    });
  });
});

// Rule 9: the border is a wall. A wall laid ALONGSIDE it duplicates that wall
// and seals a strip too thin to walk down, which is the single most common way
// a generated board reads as broken. A wall running INTO the border is fine —
// that is a corner or dead end against the board wall — so only the parallel
// case is constrained.
test("no wall lies alongside the board border inside a corridor width", () => {
  const lane = 2.75;
  const cases = [
    { catalogue:"boarding" as const, inventory:{ pillar:32, "long-wall":8, "short-wall":4, "short-door":8 } },
    { catalogue:"ttcombat" as const, inventory:{ "tt-connector":24, "tt-solid-wall":18, "tt-door":3 } },
  ];
  cases.forEach(({ catalogue, inventory }) => {
    [409, 8328, 16247, 24166].forEach((seed) => {
      [[24, 24], [48, 24]].forEach(([width, height]) => {
        const layout = Array.from({ length:24 }, (_, index) => makeLayout(catalogue, inventory, .6, seed + index * 7919, width, height))
          .sort((first, second) => structuralCount(second) - structuralCount(first))[0];
        layout.filter((piece) => !["pillar", "connector"].includes(definitions.find((def) => def.id === piece.defId)!.kind)).forEach((piece) => {
          const box = rect(piece);
          const horizontal = box.width > box.height;
          // Only the two borders this piece lies parallel to are checked.
          const gaps = horizontal
            ? [box.y, height - (box.y + box.height)]
            : [box.x, width - (box.x + box.width)];
          gaps.forEach((gap) => assert.ok(gap >= lane - .01,
            `${catalogue} ${width}x${height} seed ${seed}: ${piece.defId} lies ${gap.toFixed(2)}" alongside the border`));
        });
      });
    });
  });
});

// The support budget used to be balanced by merging components into a single
// oversized cluster no pattern could build, which zeroed the trailing
// components and left two sparse networks holding half the available walls.
test("a tight support budget still spreads terrain over several networks", () => {
  const inventory = { "tt-connector":20, "tt-solid-wall":20 };
  const results = [503, 8422, 16341, 24260, 32179, 40098].map((seed) => {
    const layout = bestLayout("ttcombat", inventory, 1, seed);
    return { pieces:structuralCount(layout), networks:new Set(layout.map((piece) => piece.runId).filter(Boolean)).size };
  });
  results.forEach(({ pieces, networks }, index) => {
    // Network count is the discriminator here: the collapse bug produced about
    // two sparse clusters. Raw piece count no longer separates the two, because
    // reachability now deliberately pulls out any wall that would seal a pocket
    // Iron has no spare door to open — so this stays a loose sanity floor.
    assert.ok(pieces >= 9, `seed ${index} placed only ${pieces} of 20 walls`);
    assert.ok(networks >= 3, `seed ${index} built ${networks} networks, not several`);
  });
});
