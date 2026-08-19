> **HISTORICAL.** This describes generator versions that were replaced when the
> engine was rebuilt on the deck-partition model. It is kept for the physical
> measurements and the record of what was tried. For current state see
> [HANDOFF.md](HANDOFF.md), [PROPOSAL.md](PROPOSAL.md) and the README.

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

The superseded motif and run generators have been deleted from `app/page.tsx`
along with `finalizeGeneratedLayout`, `chooseDefinition`, `RUN_LAYOUTS` and the
`generationLimit`/`generationEnabled` helpers that only they used. All
generation now goes through `generateSpatialLayout`.

## Terrain and board scale

Board presets:

- 24 × 24 inches: one terrain kit is the primary visual test.
- 48 × 24 inches: test with approximately two kits.
- 48 × 48 inches: test with approximately four kits.

Iron Labyrinth measurements use TTCombat-published dimensions. The principal
module sizes are 50 × 50 mm connectors and 64 × 33 mm standard walls.

**Gallowdark is a grid kit, and the grid is the authority.** The boxed board is
70.3 × 60.7 cm laid out as 7 × 6 squares of 9.7 × 9.7 cm, and each element is
6 cm tall ([Tale of Painters review, September
2022](https://taleofpainters.com/2022/09/review-kill-team-into-the-dark-part-1-terrain-rules/)).
So a short wall occupies one 97 mm square and a long wall two, and every
Boarding structural piece carries an explicit `span` of `GALLOWDARK_GRID` or
`GALLOWDARK_GRID * 2`. That span — not the measured panel length — decides where
pillars land; the panel is drawn centred inside it and the pillars cover the
joints. Generated boards measure 3.82″ and 7.64″ between pillar centres, which is
97 mm and 194 mm exactly.

The panel widths themselves (80/170 mm bare, 97/183 mm with pillars) and the
32 mm pillar remain approximations. They only affect how a piece is *drawn*
inside its square, not the topology, so they are cosmetic until measured.

The Boarding Actions Terrain Set entry represents one complete palette entry,
not a UI kit labelled “×2”.

## Generator rules that must not regress

1. Iron walls are always physically bracketed by a connector at each end.
2. A shared connector is allowed only at a real join between wall edges.
3. Do not emit floating pillars, connectors, isolated straight wall rows, or
   arbitrary Iron wall ends.
4. Prefer several shaped wall networks over one continuous snake.
5. Preserve long walkable lanes between networks.
6. A door must sit inline in a wall run, with structural terrain continuing
   past both of its ends. A door on a leaf edge is a freestanding frame that
   models walk around. Use doors sparingly at meaningful edges; empty gaps can
   act as pseudo-doors and should not consume strategic door inventory.
7. The generator places terrain only. It does not create zones.
8. Manual reserved zones are hard exclusions.
9. The board border IS a solid wall. Terrain must not ride alongside it:
   placement is held back so the perimeter strip becomes a corridor or chamber
   in its own right, and the terrain saved that way is spent on corners, dead
   ends and enclosed space instead of duplicating the border.
10. A support is never thinner than the walls it brackets. In both real kits the
    support is a chunky column the panels clip into; when the pillar was 25 mm
    against 28 mm walls, every wall overhung its pillar and the joints read as
    recessed and badly seated.
11. Every part of the walkable space must be reachable. A wall that seals a
    pocket wastes whatever it encloses, so either a door is cut through it or the
    wall comes out. Doors are passable, walls and supports are not.
12. Kit compatibility and physical piece assembly logic were largely correct, but
    not entirely — see rule 10 and the Boarding dimensions notes. Treat the
    Boarding footprints as approximations, not as settled fact.

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

Properties of the placement loop that matter and are easy to regress:

- A door is only placed on an *inline* edge, meaning both of its nodes carry
  another structural edge. On a leaf edge the far support has nothing beyond it,
  so the door is a freestanding frame in open space that models simply walk
  around. If a component has fewer inline edges than doors, it is rejected and
  another pattern is tried.
- Every component must contain both rotations. A component shrunk to a single
  edge is by definition a straight row, which is the isolated barricade rule 3
  forbids, so the shrink floor is two edges and single-orientation components
  are rejected outright.
- Rule 9 is enforced by `edgeFault`, and **orientation is the whole point**. A
  structural piece lying PARALLEL to a border must keep a full 2.75-inch lane
  from it: laying terrain alongside the border duplicates a wall the board
  already provides and seals a strip too thin to walk down. A piece running
  PERPENDICULAR to a border may butt straight into it, because that is a
  legitimate corner or dead end against the board wall. Supports are exempt
  entirely — they are precisely the pieces that terminate a run at the border.
- Constraining supports and perpendicular pieces as well was tried and rejected:
  Iron walls are only 2.5 inches long, so no Iron arm can reach a border from
  2.75 inches inboard and the catalogue collapsed to six walls. Only the
  parallel case is a real defect, and only it is constrained.
- Freed terrain is steered into shape rather than volume: the score rewards
  corners (nodes carrying both a horizontal and a vertical edge) and dead ends.
- T-junctions are legal and desirable in both catalogues — a support may carry
  three structural ends. Nothing should ever restrict node degree to two.
- A run that stops just short of the border is snapped the rest of the way, so an
  end piece meets the edge instead of leaving a gap with no play value. The snap
  moves the whole component, so relative geometry is preserved. It only fires
  across a gap under `deadGap` (1.5 in — narrower than a 32 mm base can enter).
  Snapping across the full lane instead was measured and rejected: it dragged
  U-shaped components flush against the border, sealing pockets that then cost a
  wall each to reopen, and pinned door-less Iron to exactly 10 walls on every
  seed. Widening the threshold again will quietly cost Iron walls.
- `PATTERNS` holds one cyclic shape, a rectangular room. `buildComponent` accepts
  a closing edge only when it lands back on its origin node within 0.02 in, and
  `pairForClosure` arranges the pieces so opposite sides span equally — including
  taking two pairs from a single span length, which is what makes a square room
  possible at all. A room is built only when a door is among its sides, so it is
  born enterable rather than as a sealed box the flood pass must break open.
- Patterns a component cannot build are filtered out *before* the attempt loop.
  Leaving the room pattern in for a door-less palette burned a seventh of the
  attempt budget on a shape that could never succeed.
- `openSealedPockets` floods the walkable space after placement — doors passable,
  walls and supports solid — and finds every region that is not the main one.
  For each pocket it converts the sealing wall into a same-footprint door, or,
  when no door of that size remains (Iron owns very few, sometimes none), removes
  the sealing wall outright. One unplaced wall is a far smaller loss than a
  sealed chunk of board. Any support left touching nothing is then dropped, since
  rule 3 forbids stranded supports.
- Reachability is the reason for the edge snap's existence *and* its danger:
  snapping a U-shaped component against the border is exactly what seals a
  pocket. Measured before the flood pass was added, Iron produced 3.68 dead zones
  a board, losing 67 square inches. Never ship the snap without the flood pass.

- Each graph node owns its own support, assigned before any geometry, so a wall
  span is derived from the two supports that actually bracket it. Deriving it
  from one support only holds while every support is square and identical.
- A component that cannot be sited is retried at successively smaller edge
  counts, and any pieces still left over are offered to extra small networks.
  Abandoning a failed component whole used to orphan up to five walls silently.
- The support budget is balanced by trimming the edge count, never by merging
  components. Merging demanded a single cluster larger than any pattern could
  build, which zeroed the trailing components.

Cost of the border rule, per board, averaged over 25 best-of-24 generations:

| Case | Walls alongside border | Structural placed |
| --- | --- | --- |
| Boarding 24 × 24 | 5.7 → **0** | 12.8 → 10.8 |
| Boarding 48 × 24 | 4.7 → **0** | 15.0 → 15.0 (free) |
| Boarding ×4, 48 × 48 | 8.0 → **0** | 40.8 → 39.4 |
| Iron 24 × 24 | 1.9 → **0** | 9.3 → 12.2 |

Only the 2′ × 2′ Boarding case pays for it, and it pays about two pieces: its
7.2-inch walls plus a 2.75-inch lane on all four sides genuinely do not leave
room. `borderStandoff` on `SpatialGeneratorInput` overrides the lane width if
that trade ever needs retuning.

Anchor pull is deliberately weighted below the separation reward and the anchor
table is rotated and jittered per seed. At the original weight the anchor term
dominated every other term, pinning components to six fixed spots and banding
the board into regularly spaced horizontal stripes.

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
- Boarding generation produces at least three shaped networks,
- no Boarding component is merely a straight floating barricade,
- every seed reaches its structural target rather than orphaning rejected
  components,
- every door has structural terrain continuing past both of its ends,
- no wall lies alongside the board border inside a corridor width,
- no walled-off dead zone survives anywhere in the walkable space,
- a support is never narrower than the walls it brackets,
- a grid-kit wall spans exactly one grid pitch between pillar centres,
- closed rooms are built and every one of them has a doorway, and
- a tight support budget still yields several networks, not one sparse cluster.

The last three fail against the pre-fix generator with `placed 9 of a 13
structural target`, `door short-door is open at (5.38, 19.03)` and `placed only
10 of 20 walls`, so they are real guards rather than restatements of current
behaviour. When checking a door assertion by hand, remember that neighbouring
structural pieces are separated by exactly one support, so a proximity
tolerance below the support width makes every door look isolated.

At this checkpoint, `npm run lint` and all fourteen `npm test` checks pass.

Measured effect of the placement fixes, best of 24 candidates, averaged over
seeds. Structural pieces placed:

| Case | Structural placed | Networks | Corners | Doors open at an end | Pieces inside border lane |
| --- | --- | --- | --- | --- | --- |
| Boarding full kit, 24 × 24 @ 60% | 12.8 → 12.5 | 3.3 → 3.7 | 6.8 → 7.4 | 56% → **0%** | 55% → 41% |
| Boarding full kit, 48 × 24 @ 60% | 15.0 → 15.0 | 4.0 → 4.0 | 8.5 → 8.7 | 77% → **0%** | 44% → **18%** |
| Iron, 24 conn + 18 walls + 3 doors, 24 × 24 @ 60% | 9.3 → **12.6** | 2.1 → 3.5 | 6.6 → 8.2 | 20% → **0%** | 32% → 40% |

Structural orientation moved from 57–63% horizontal to 48–53%, horizontal wall
bands are no longer regularly spaced, and no board in the sample contained a
single-orientation floating network. Boarding 24 × 24 gives up 0.3 pieces to buy
the border lane and the corner count; Iron 24 × 24 gains a third more terrain,
which is why more of it ends up in the lane despite the penalty.

Confirmed in a real browser at 24 × 24, both catalogues, by extracting the
rendered piece geometry:

- Boarding, full kit: 30 pieces, 13 structural, 17 pillars, 3 doors all inline,
  0 unbracketed ends, 0 off-board, 1 piece near the border.
- Iron Ultima, full kit: 25 pieces, 11 walls, 14 connectors, 0 unbracketed
  ends, 0 off-board, six distinct wall types used. This matches the previously
  recorded 11-wall/14-connector benchmark exactly. Closest piece to the border
  sat 1.26 inches away — a full 32 mm base — with nothing inside one inch and a
  3.65 inch average, so the perimeter read as a continuous corridor.

The Iron corridor-clearance test now scores 24 candidates instead of using one
unscored layout, because that is how the UI generates. A single unscored layout
packs less predictably now that placement trades border clearance against
density; the 11-wall target is still asserted, at the level the app runs at.

## Known limitations and next improvements

- The “Footprint” slider scales the structural inventory target, not occupied
  board area. Above roughly 60% it now has little effect on a 24 × 24 board:
  the binding constraint is geometric, because separate networks must each keep
  their clearance lane, so the target is no longer what limits the result. A
  literal area target would need the generator to trade lane width against
  coverage rather than simply request more pieces.
- **The Boarding footprints are wrong in a way that matters, and there is now a
  source.** A Bolter & Chainsword thread on Boarding Actions dimensions
  (https://bolterandchainsword.com/topic/377288-boarding-action-terrain-dimensions/)
  reports two things. First, a wall measures **97 mm pillar-centreline to
  pillar-centreline**. Second, *“none of the pillars on the walls are full
  pillars. They’re all halves, and the 32 pillar pieces can make up the other
  half.”* The thread's box contents also match this catalogue exactly: 16 short
  walls, 16 long walls, 32 pillars, 4 wall ends, 68 total.

  If 97 mm is centre-to-centre, then the catalogue's 97 mm and 183 mm
  “+ pillars” entries are *already* node-to-node spans, and
  `distance = halfSupport + wall + halfSupport` adds a further pillar width on
  top — over-spacing every joint in those runs by about 25 mm (1 inch). The
  half-pillar fact also means two “+ pillars” pieces meeting end to end complete
  a full pillar between them from their own halves, consuming no inventory
  pillar at all, which is very likely the real cause of Boarding's low kit use.

  Suspicious supporting detail: the plain panels are 80/170 mm and the
  “+ pillars” versions 97/183 mm, differences of 17 mm and 13 mm. Those should
  be identical if both are “panel plus two half-pillars”, so at least one figure
  is approximate. A 97 mm assembly grid would also imply a long wall of 194 mm
  (two grid units), not the 183/170 mm recorded here.

  **Acted on, partially.** The four “+ pillars” entries now carry
  `bringsPillars:true`, and the generator treats such a width as a node-to-node
  span instead of adding a further pillar to it. That removed a genuine 25 mm
  (one inch) over-spacing at every joint in those runs. The bare 80/170 mm panels
  keep the old model — panel plus half a support each end — which was already
  right for them. Inventory consumption is unchanged: the loose pillar still
  completes the piece's two halves.

  The pillar footprint also moved from 25 mm to **32 mm approx.**, because at
  25 mm it was thinner than the 28 mm walls and every joint rendered recessed.

  **Still unresolved, and needs calipers.** Under this reading a short bare panel
  spans 80 + 32 = 112 mm while a short “+ pillars” piece spans 97 mm, yet the two
  are physically interchangeable in a run — so at least one of 80 mm, 97 mm or
  32 mm is wrong. A 97 mm grid also implies a long wall of 194 mm, not 183/170 mm.
  Measure a long wall, a short wall and a pillar and these all collapse into one
  consistent set. Until then the Boarding geometry is close, not exact.
- Under-fill is reported as success. The palette message states how many pieces
  were placed but not that the rest went unplaced, so a genuinely constrained
  board is indistinguishable from a bug. The stated intent of biasing a smaller
  interesting area when terrain is short is not implemented.
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
- Reserved-zone exclusion, PNG export, and the unimplemented scatter-terrain
  regions have not been re-verified since the placement rewrite.

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
