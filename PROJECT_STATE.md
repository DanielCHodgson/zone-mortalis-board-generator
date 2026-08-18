# Mortalis Architect — project state

Last updated: 2026-08-18

## Product intent

Generate visually credible, playable Zone Mortalis-style boards from the exact
physical terrain inventory the user owns. A good output is not a collection of
random barricades or a single snake. It should use negative space to produce
long corridors, chambers, turns, junctions, dead ends, tactical doors, and
multiple routes. The board edge is a valid corridor wall.

Attached reference boards from prior design sessions showed dense but readable
industrial labyrinths made from several U-, L-, T-, cross-, and partial-room
structures. Those proportions, not arbitrary geometric coverage, are the visual
benchmark.

## Active architecture

- `app/page.tsx`: catalogue data, UI state, board editing, candidate scoring,
  persistence, analysis, and export.
- `app/spatial-generator.ts`: active procedural generator.
- `app/globals.css`: fixed desktop workspace and dimension-aware board styles.
- `tests/spatial-generator.test.ts`: physical/topological generator invariants.
- `tests/rendered-html.test.mjs`: rendered application checks.

Older motif and run generators remain in `app/page.tsx` for now, but the
palette and placed-piece generation paths call `generateSpatialLayout`.
Avoid accidentally reconnecting the legacy generators.

## Terrain and board scale

Board presets:

- 24 × 24 inches: one terrain kit is the primary visual test.
- 48 × 24 inches: test with approximately two kits.
- 48 × 48 inches: test with approximately four kits.

Iron Labyrinth measurements use TTCombat-published dimensions. The principal
module sizes are 50 × 50 mm connectors and 64 × 33 mm standard walls. Boarding
Actions footprints are physical-kit approximations based on the 97 mm assembly
grid and approximately 170/80 mm wall lengths.

The Boarding Actions Terrain Set entry represents one complete palette entry,
not a UI kit labelled “×2”.

## Generator rules that must not regress

1. Iron walls are always physically bracketed by a connector at each end.
2. A shared connector is allowed only at a real join between wall edges.
3. Do not emit floating pillars, connectors, isolated straight wall rows, or
   arbitrary Iron wall ends.
4. Prefer several shaped wall networks over one continuous snake.
5. Preserve long walkable lanes between networks.
6. Use doors/hatches sparingly at meaningful edges; empty gaps can act as
   pseudo-doors and should not consume strategic door inventory.
7. The generator places terrain only. It does not create zones.
8. Manual reserved zones are hard exclusions.
9. Board edges may complete corridors without spending terrain along the entire
   border.
10. Kit compatibility and physical piece assembly logic were already correct;
    future work should focus on topology and layout quality.

## Current procedural approach

`PATTERNS` defines small graph shapes: hooked chamber, bent T, cross, offset L,
partial U, and three-edge corner. Structural pieces become graph edges and
pillars/connectors become graph nodes.

For Iron Labyrinth, edge length is derived from the connector width plus the
wall width. This makes connector → wall → connector true by construction.
Components are placed near distributed board anchors and rejected if they:

- leave the board,
- intersect a reserved zone,
- violate inter-component corridor clearance, or
- cannot be built from the available supports.

Boarding components are capped at four edges because its 6–7 inch wall pieces
make five-edge clusters monopolise a 24-inch board. Iron components may use five
edges. The UI evaluates 24 seeded candidates and strongly rewards structural
piece count before span, quadrants, junctions, and doors.

## Verified results

Visual browser tests:

- Iron Ultima, one kit, 24 × 24 at 60%: 11 walls, 14 connectors, three shaped
  networks, broad movement lanes.
- Boarding Actions, one kit, 24 × 24 at 60%: typically 12 structural pieces and
  15 pillars in three partial chambers/junctions.
- Iron Ultima ×2, 48 × 24 at 60%: 22 walls and 27 connectors across five
  networks.
- Boarding Actions ×2, 48 × 24 at 60%: 54 total placed pieces across roughly
  six networks.
- Boarding Actions ×4, 48 × 48 at 60%: 97 total placed pieces across roughly
  nine networks.

Automated assertions verify:

- both physical endpoints of every generated Iron wall touch connectors,
- an 11-wall Iron target is not silently truncated,
- Iron networks retain at least 3.8 inches of clearance,
- Boarding generation produces at least three shaped networks, and
- no Boarding component is merely a straight floating barricade.

At this checkpoint, `npm run lint` and all six `npm test` checks pass.

## Known limitations and next improvements

- The “Footprint” slider currently scales the structural inventory target. It is
  not yet a literal target for occupied board area.
- Candidate scoring infers loops and chambers from structural counts rather
  than analysing a walkable-space navigation graph.
- Door placement is periodic/limited, not yet based on route centrality or game
  objectives.
- Pattern components are trees and partial shells. More controlled cycles,
  asymmetrical chambers, and safe cross-component links would add variety.
- The generator should eventually evaluate actual walkable-space connectivity,
  lane width distribution, deployment access, and unreachable pockets.
- Iron wall ends remain deliberately unused until their exact physical role can
  be modelled without violating the connector-at-both-ends rule.
- Large Iron floors and stairs use open-space collision placement but are not
  yet integrated into the corridor topology.
- Legacy generator code in `app/page.tsx` should be removed once the spatial
  generator has survived further iteration.

## Interaction details

- Palette “Generate from palette” uses the current inventory and footprint
  target.
- Header “Generate layout” regenerates from every piece currently placed. If a
  procedural candidate cannot consume the full placed inventory, the current
  lossless fallback mirrors the existing layout while preserving all pieces.
- Multi-select rotation rotates the selected group around a shared bounding-box
  centre rather than rotating pieces individually in place.
- Palette and board-size choices persist in local storage.

## Before changing generation

Run a one-kit 24 × 24 visual test for both catalogues. Reject the change if the
output reads as parallel barricades, a single snake, disconnected supports, or
cramped/unusable movement space. Then run the two-kit 48 × 24 case and
`npm test`.
