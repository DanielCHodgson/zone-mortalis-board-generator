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
