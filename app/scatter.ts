/**
 * Scatter: the crates, barrels, consoles and machinery that dress the deck.
 *
 * Scatter is not structure. It never carries a wall, never blocks a route, and is
 * placed after the complex is finished and validated — so nothing here can break an
 * invariant. What it does is fill the floor, which is what makes a board read as a
 * working ship rather than a diagram of one, and it is what a reserved hangar or
 * generator hall is FOR.
 *
 * Placement is governed by one physical fact. A Gallowdark square is 97 mm between
 * pillar centres and 69 mm of clear opening, so a piece much over 50 mm across turns
 * a corridor into a squeeze that models cannot be moved through without knocking
 * things over. Hence three tiers and three destinations:
 *
 *   small   (<= ~40 mm)   anywhere, corridors included
 *   medium  (<= ~90 mm)   rooms and reserved halls
 *   large   (> ~90 mm)    reserved halls only
 *
 * Two rules beyond that, both learned from what a real table looks like:
 *
 * 1. Nothing stands in a doorway. A crate in a hatchway is the single most annoying
 *    thing to find on a board, so a cell keeps its scatter clear of any edge the
 *    plan made a doorway.
 * 2. A cell takes one piece, occasionally two if they are both small. Piling scatter
 *    into one square and leaving the next bare looks like a spill, not a deck.
 */

import { cellCentreWorld, edgeKey, edgesOfCell, type LatticeCell } from "./lattice.ts";
import type { DeckPlan, RegionKind } from "./deckplan.ts";

export type ScatterTier = "small" | "medium" | "large";

export type ScatterDef = {
  id:string;
  width:number; depth:number; height:number;
  tier:ScatterTier;
};

export type ScatterPiece = {
  uid:string; defId:string; x:number; y:number; rotation:0 | 90; height:number;
};

export type ScatterInput = {
  plan:DeckPlan;
  defs:ScatterDef[];
  /** Copies owned, by id. */
  stock:Record<string, number>;
  heights:Record<string, number>;
  /** Footprints already on the board, so scatter never lands on a wall. */
  occupied:{ x:number; y:number; width:number; height:number }[];
  nextUid:() => string;
  random:() => number;
};

/** Where each tier is allowed to stand. */
const ALLOWED:Record<ScatterTier, RegionKind[]> = {
  small:["corridor", "room", "reserved"],
  medium:["room", "reserved"],
  large:["reserved"],
};

const overlaps = (
  first:{ x:number;y:number;width:number;height:number },
  second:{ x:number;y:number;width:number;height:number },
  gap:number,
) => first.x < second.x + second.width + gap && first.x + first.width > second.x - gap
  && first.y < second.y + second.height + gap && first.y + first.height > second.y - gap;

const shuffle = <T,>(values:T[], random:() => number) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

export const placeScatter = ({ plan, defs, stock, heights, occupied, nextUid, random }:ScatterInput):ScatterPiece[] => {
  const { lattice } = plan;
  const placed:ScatterPiece[] = [];
  const footprints = [...occupied];
  const perCell = new Map<string, number>();

  // Cells a doorway opens onto. Scatter keeps out of these entirely rather than just
  // off the threshold — a model has to be able to come through and stand somewhere.
  const doorwayCells = new Set<string>();
  for (let row = 0; row < lattice.rows; row++) for (let col = 0; col < lattice.cols; col++) {
    const cell = { col, row };
    if (edgesOfCell(cell).some((edge) => plan.state.get(edgeKey(edge)) === "hatch")) {
      doorwayCells.add(`${col}:${row}`);
    }
  }

  const candidates = (tier:ScatterTier) => {
    const allowed = new Set(ALLOWED[tier]);
    const cells:LatticeCell[] = [];
    for (let row = 0; row < lattice.rows; row++) for (let col = 0; col < lattice.cols; col++) {
      const region = plan.regions[plan.cellRegion[row * lattice.cols + col]];
      if (!region || !allowed.has(region.kind)) continue;
      // A doorway cell is still fair game for small scatter — a crate tucked in a
      // corner of a room you walk through is fine — but nothing bigger.
      if (tier !== "small" && doorwayCells.has(`${col}:${row}`)) continue;
      cells.push({ col, row });
    }
    return cells;
  };

  // Largest first. The big pieces have the fewest places they can legally go, so
  // letting the small ones pick first leaves a storage tank with nowhere to stand.
  const order:ScatterTier[] = ["large", "medium", "small"];
  order.forEach((tier) => {
    const pool = shuffle(
      defs.filter((def) => def.tier === tier)
        .flatMap((def) => Array.from({ length:stock[def.id] ?? 0 }, () => def)),
      random,
    );
    if (!pool.length) return;
    let cells = shuffle(candidates(tier), random);
    pool.forEach((def) => {
      for (const cell of cells) {
        const key = `${cell.col}:${cell.row}`;
        const already = perCell.get(key) ?? 0;
        // One piece per square, or two if both are small.
        if (already >= (tier === "small" ? 2 : 1)) continue;
        const centre = cellCentreWorld(lattice, cell);
        for (let attempt = 0; attempt < 6; attempt++) {
          const rotation:(0 | 90) = random() < .5 ? 0 : 90;
          const width = rotation === 90 ? def.depth : def.width;
          const height = rotation === 90 ? def.width : def.depth;
          // Jittered off centre so a room of scatter does not look stamped, but kept
          // inside the square so it never fouls the wall line.
          const room = {
            x:Math.max(0, (lattice.pitchX - width) / 2 - .1),
            y:Math.max(0, (lattice.pitchY - height) / 2 - .1),
          };
          const rect = {
            x:centre.x - width / 2 + (random() * 2 - 1) * room.x,
            y:centre.y - height / 2 + (random() * 2 - 1) * room.y,
            width, height,
          };
          if (width > lattice.pitchX - .2 || height > lattice.pitchY - .2) {
            // Too big for one square. Legal only in a reserved hall, where it may
            // straddle the boundary between two of its cells.
            if (plan.regions[plan.cellRegion[cell.row * lattice.cols + cell.col]]?.kind !== "reserved") break;
          }
          if (footprints.some((other) => overlaps(rect, other, .08))) continue;
          placed.push({
            uid:nextUid(), defId:def.id, x:rect.x, y:rect.y, rotation,
            height:heights[def.id] ?? def.height,
          });
          footprints.push(rect);
          perCell.set(key, already + 1);
          cells = cells.filter((candidate) => candidate !== cell || (already + 1) < 2);
          return;
        }
      }
    });
  });

  return placed;
};
