# Handoff — Zone Mortalis board generator

The generator was rebuilt from scratch on the deck-partition model. This file
records what changed, what is settled, and what is still open. The analysis behind
it is in [PROPOSAL.md](PROPOSAL.md); the design summary is in the README.

## What was wrong, and what fixed it

**The 125 mm Gallowdark pitch was geometrically impossible, and it was the whole
bug.** At that pitch a short panel ends 0.256" clear of the pillar it clips into.
The old code then swept away every orphaned pillar, saw the sealed regions that
sweep created, and deleted *walls* to reopen them. Twelve seeds of Boarding Actions
output measured 6–7 panels and 0–3 pillars from a 68-piece box, while all 11 tests
passed — they took the best of 24 candidates and asserted lower bounds a scatter of
fragments satisfies.

The pitch is **97 mm**, confirmed twice: the terrain is documented as designed
around a 97 × 97 mm tile on a 6 × 7 grid, and the 704 × 607 mm card board is
exactly `7 × 97 + 25` by `6 × 97 + 25`. It is now checked by an invariant
(`panel ≤ pitch < panel + column`) rather than trusted as a constant, and an
unbuildable grid makes the generator refuse rather than produce something and patch
it.

Four structural changes followed:

1. **Partition, not maze.** Corridors and compartments, with doorways cut through
   the boundaries afterward. A maze must leave a spanning tree open, capping walls
   at `(cols-1)(rows-1)`; a partition has no such ceiling.
2. **Reject and retry, never repair.** The three repair sweeps are gone. Every
   invariant fails a candidate outright.
3. **One scorer.** The UI's outer `structures * 50 + span * 45 + …` re-ranking is
   gone. Candidates are scored once, by distance to a reference board, so no metric
   can run away with the result.
4. **Sizing from the kit.** One set fills one card board. Extra sets grow the
   footprint; surplus stays in the box.

## Settled facts

- **Pitch 97 mm.** Not the panel-plus-pillar figure. See above.
- **Iron Labyrinth is a different joint model, and the old code had it right.**
  Gallowdark's panel slots into a column straddling the corner (pitch = panel);
  Iron Labyrinth's wall butts between two connectors (pitch = wall + connector =
  114 mm). `def.span ?? support + def.width` encodes both. Iron Labyrinth sits
  *exactly* on the upper bound of the pitch invariant, with zero overlap — a butt
  joint is buildable, so the bound is inclusive.
- **The inventory was already correct.** The previous handoff was most confident
  this was fabricated, and it was not: 68 pieces, verified against two sources,
  matching the coded quantities exactly.
- **Hatchways are the primary building material.** 20 of the 32 panels carry one —
  62%. The old `DOOR_SHARE = .13` was off by a factor of five, and the two
  "door striping regressions" were the tiler being dragged toward the kit's real
  composition and forced back out. A hatchway blocks sight but passes models, so it
  is a strict superset of a wall panel: it may always substitute for one, never the
  reverse.
- **Columns are the binding constraint, not panels.** 48 wall-cells imply up to 96
  panel ends against 32 loose columns. This is useful pressure: long panels skip a
  mid node and junctions serve three or four ends from one column, so economising
  columns *produces* the long runs and T/X junctions that a good board is made of.
- **Capacity.** One set = 48 wall-cells. A 7 × 6 lattice has 71 internal edges, so
  reference density is ~0.62 and one set fills one card board. Two card boards want
  two sets, a 4' × 4' wants four.
- **Corrected dimensions.** Columns are 28 × 25 mm and *not square*, so they have
  an orientation. Panels are 5.5 mm thick, not 28 mm. The long panel is ~176 mm
  bare (194 mm with moulded pillars), not 170 mm.

## Open questions

Neither blocks anything. Both are one look at the kit.

1. **Is the moulded pillar on a "+ pillars" panel at one end or both?** Their
   stated width is exactly one grid square against the bare panel's 80 mm, which
   says half a pillar at each end with the neighbour supplying the other half — so
   a column occupant is still placed at every panel end regardless. Only the
   tiler's preference ordering in `build.ts` depends on the answer.
2. **Count the printed squares on a card board.** The prediction is 7 × 6 at 97 mm
   with a 12.5 mm border. It would close the pitch question for good.

## The one thing still worth doing

**Transcribe a real board into a fixture.** `PROVISIONAL_REFERENCE` in
`app/validate.ts` is derived from kit arithmetic and published board geometry, not
from a board known to be right. It is the honest weak point of the current design.

The mechanism is already in place: `generate` takes a `reference` profile, and
candidates are scored by distance to it. So the work is:

1. Transcribe one board — a published Gallowdark layout, or one of your own
   photos — as `cols`, `rows` and the state of every edge.
2. Render it and compare against the photo until it matches. That validates pitch,
   piece dimensions and renderer together, with no generation involved.
3. Run `measure()` on it and use the result as the reference profile.

That replaces a guess with a measurement and retunes the generator without touching
a line of generation code.

## Verification

- `npm test` — 23 tests, all passing. Includes a build, rendered-HTML checks, and
  the generator suite. One rendered-HTML assertion was already failing before this
  work (a stale `48 by 48` board default) and is now fixed.
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean for `app/` and `tests/`, except one pre-existing error
  at `app/page.tsx:1008` (a `rotation` property on a smart-fit candidate type).
  Pre-existing errors in `worker/` and `db/` are untouched.
- Verified live in the browser: both generation paths, no console errors, and all
  24 pillars confirmed sitting on one lattice grid in the rendered DOM.

The generator test suite is **single-shot** — one `generate` call per seed. The
previous suite's best-of-24 helper is what let a broken generator stay green, so
please do not reintroduce it.

## Second pass: catalogues added, and the bugs that surfaced

Zone Mortalis (50 mm) and Deadbolt's Derelict (50.8 mm) were added as straddling
catalogues alongside Gallowdark and Iron Labyrinth. Adding them found seven bugs, in
rough order of how much they mattered.

1. **`build` never placed the outside wall.** It filtered out every perimeter edge, so
   a centred 5 x 6 complex on a four-foot board planned 22 of its 44 wall-cells as
   exterior and placed none of them — an unenclosed patch of interior walls, with the
   interior starved by the hull budget it had been charged for and did not spend.
   `DeckPlan` now carries `exterior` and `build` honours it.
2. **The doorway invariant was toothless.** `doorPanels < 1 && hatchEdges.length` only
   fired on a board with no hatchway panels at all; one door against twenty planned
   doorways passed. Now counted against the doorways. This independently catches (1).
3. **The retry loop pulled the wrong lever.** Trimming the interior budget can only
   ever reduce interior density, so it was the wrong response to a shortage of columns
   or a big hull — a 4' board with one set sat at its full footprint with a 0.37
   interior. The budget now gives way down to the reference density and the FOOTPRINT
   gives way past that.
4. **The hull was built through reserved zones.** Reserved cells round outward and then
   clamp to the lattice, so a zone overhanging the complex left its boundary on the
   lattice perimeter — inside the drawn rectangle. Perimeter edges bordering a reserved
   cell are no longer walled. Decided on the CELL, not the panel midpoint: two one-cell
   edges either side of a thin zone both have midpoints outside it, and the long panel
   the tiler merges them into does not.
5. **`boxOf` could not measure scatter**, because it read `kit.buildDefs` (panels,
   columns and caps only). Every scatter piece fell back to a 0.5" stub, so the
   open-deck pass dropped a 120 mm container on top of a conduit. Now reads the
   catalogue.
6. **The accessory overlap test used the candidate's own dimensions for every existing
   piece** — a 194 mm floor tile tested itself against 194 mm boxes centred on every
   wall and pillar on the board.
7. **`interiorCap` was frozen at the pre-shrink lattice size**, so the density ceiling
   stopped applying once a lattice shrank.

Four UI call sites hard-coded `catalogue === "boarding"` or named the two catalogues
literally; the worst made "Generate from palette" silently ignore any later-added
range. The joint model now lives in `MANUFACTURERS[...].joint` and nothing branches on
a maker name. `randomFactory` and `shuffle` were four byte-identical copies across four
modules and are now `app/random.ts`; seven dead exports and five unread `BuildResult`
fields are gone.

## Third pass: doors were doing the walls' job

The complaint was that doors were used "like walls instead of ways to connect movement
channels", and that there were too many closed-off squares. Measured over eight boards at
four sets, before any change:

| | before | after | the photographs |
|---|---|---|---|
| doorways per board | 63 | 9.4 | a handful |
| doorways as a share of panels | 43% | 7% | a small minority |
| compartment faces fully open | 0% | 50% | most |
| compartments sealed | 100% | 5% | rare |
| compartments <= 2 cells | 55% | 20% | mostly 2x2 bays |
| largest see-across area | 7% of floor | 35% | one or two big open areas |

Four causes, and only the first was a policy choice:

1. **`hatchShare: .46` was a scoring TARGET.** Candidates are scored by distance to the
   reference, so a board with fewer doors scored worse — the spam was asked for. The
   number came from the kit's composition (20 of 32 panels carry a hatchway) transplanted
   into a target for the layout. Those are different things: a hatchway panel standing in
   a wall run with its door shut is a wall. Renamed `doorwayShare`, target .08.
2. **An opening was a door unless the kit ran out.** `order < hatchSupply ? "hatch" :
   "open"` — so open archways only appeared once hatchway stock was exhausted, and adding
   terrain could only ever add doors.
3. **Every boundary was walled by construction**, so connectivity had to be bought back
   one door at a time: 386 compartments meant at least 386 doors. The doors were the debt.
4. **The partition had no way to express an alcove.** A partition divides a rectangle
   exhaustively, so every region is closed. `mouth` (a whole open face) and `spur` (a wall
   inside a compartment) are the two primitives that were missing.

Consequences worth knowing about:

- **Mouths are whole faces, not single edges.** Opening one edge punched a hole in the
  middle of a wall line and fragmented every run on the board; mean run fell to 1.9 cells.
  Consolidating the openings is what buys back long runs while keeping the board open.
- **Spurs extend into runs.** Placed one edge at a time they read as scattered plus-signs.
- **Spurs cost columns.** A spur ends in open floor and that end needs a column, so spurs
  are the FIRST lever given up when columns run short — ahead of the footprint. Getting
  that order wrong shrank a one-set card board to 5 x 6 to pay for cover it did not need.
- **Junctions and openness are in tension.** A junction needs three or four faces of a node
  walled, and half the faces on this board are deliberately open. The old 0.4 target was a
  property of the walled-everything model, not of a good board.
- **A hatchway panel used as a wall now DRAWS as a wall.** Colouring by `kind === "door"`
  painted every substituted hatchway as an opening, so a board running 8% doorways looked
  like 58% doors. `BuiltPiece.servesDoorway` carries the distinction.

`npm run profile` is the instrument for this. It exists because every number in the old
profile was in range on those boards — and it reads its openness figures from `measure()`
rather than recomputing them, after counting open EDGES twice told me textbook alcoves were
wide-open floor.

### Wall ends are cosmetic

A wall end covers the exposed end of a panel that stops in open floor. It brackets
nothing, so it can never be the joint between two panels.

The node pass allowed one wherever a single panel END arrived at a node, which is not the
same test. A run terminating against the FLANK of a long panel has exactly one end
arriving there, while the long panel covers that same node with two more panel edges.
Measured over 18 boards: 51 of 168 caps — 30% — were sitting in that position, holding a
wall onto the side of another wall. The test is now on panel edges incident at the node,
which must be exactly one, and there is an invariant (`cap`) plus a test for it.

Two notes for whoever touches this next:

- **The first fix was wrong and is worth not repeating.** I read the problem as "the kit
  cannot build that joint at all" and stopped the tiler laying a long panel across an
  occupied node. That collapsed the boards: 16 of a set's 24 wall panels are two-cell
  pieces, so blocking them left the tiler short of stock, and boards fell to 4 x 4. A loose
  pillar standing against a panel's flank is something builders actually do — it is the
  CAP that is illegitimate there, because it brackets nothing.
- **`COLUMNS_PER_WALL_CELL` moves when panel choice changes.** That experiment took the
  measured ratio from 0.92 to 0.79, and a stale constant mis-sizes every board on the
  first attempt. Re-measure after any change to how panels are chosen.

## Fourth pass: the pitch was set by one piece

Reported as "Iron Labyrinth makes good layouts but it's not using enough of the palette
sometimes — it seems random how much it consumes". Three generations from the same
382-piece TTCombat palette gave 108, 21 and 55 pieces. Reported alongside it: "long
hatches going through connectors". Same cause.

`readKit` took the pitch as `min(spanOf)` — the SHORTEST panel dictated the grid for every
other panel — and `pitchIsBuildable` was then applied once, to that same shortest panel.
Nothing checked the rest.

TTCombat ships two modules that cannot share a lattice: a 46 mm Death Quadrant wall and a
64 mm Iron Labyrinth wall, both butting between 50 mm connectors, so they want a 96 mm and
a 114 mm pitch. Taking the minimum put the whole board on 96 mm, which leaves a 46 mm
opening — and six of the thirteen panel types were then placed into it 64 mm wide,
**overlapping their connectors by 9 mm at each end**. That is the hatches-through-connectors
bug. The erratic consumption is the same thing: the pitch flipped between 96 mm and 114 mm
depending on whether one 46 mm piece happened to be in the palette, and the whole board
changed with it. With the full palette, nothing built at all.

Three changes:

1. **The pitch is the one that makes the most of the palette usable**, chosen by trying
   every distinct span and measuring buildable wall-cells. Ties go to the smaller pitch.
2. **Every panel is fitted individually, against the joint it actually makes.** A
   straddling panel may be up to a column shorter than its span — that difference is the
   slot. A butting panel must match the clear opening, or it overlaps the connectors it is
   meant to sit between. `BuildDef.straddles` carries which.
3. **Pieces from the other module stay in the box and are named in the report**, so an
   under-spent palette explains itself instead of looking arbitrary.

Result: the full TTCombat palette went from building nothing to 150-160 pieces on a
consistent 10 x 10, every seed, no rejections.

A distinction that matters, and which cost a test failure to find: a panel fitting a
DIFFERENT pitch is a different module and is set aside; a panel fitting NO pitch has
incoherent geometry and the whole kit is refused. Without that split, the 125 mm regression
came back — the per-panel fit quietly built an eight-panel board out of the four panel
types that happened to fit, which is the exact symptom this generator was rewritten to
stop producing. `KitReading.unbuildable` is the second case.

### Two open data questions this exposed

Both are dimensions, not code, and the generator now handles either answer honestly.

- **Iron Labyrinth's own doors fit nothing.** The vertical door (94 mm) and sliding door
  (194 mm) match neither the 114 mm wall module nor any other, so an Iron Labyrinth board
  currently has no doorways at all — every opening is an open archway. Either the
  dimensions are wrong, or those pieces are meant to replace a connector-plus-wall unit and
  should carry an explicit `span` the way the Gallowdark "+ pillars" panels do.
- **Death Quadrant sets aside its own double wall and double door.** Its 46 mm "single" and
  64 mm "double" walls resolve to different pitches, so a DQ-only palette builds the 46 mm
  module and shelves the 64 mm one. If "single" and "double" mean one and two modules, one
  of those two figures is wrong — two 46 mm modules would be about 92 mm, not 64 mm.
