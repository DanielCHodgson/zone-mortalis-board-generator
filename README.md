# Mortalis Architect

An interactive, scale-aware Zone Mortalis and Boarding Actions terrain layout
planner. It provides physical terrain palettes, multiple board sizes, manual
editing, procedural layout generation, layout analysis, and PNG export.

## Current capabilities

- One and two Boarding Actions card boards (the real 704 x 607 mm grid), plus
  30″ × 22″, 2′ × 2′, 4′ × 2′ and 4′ × 4′.
- Four terrain catalogues, on three different pitches: Games Workshop Boarding
  Actions (97 mm), Games Workshop Zone Mortalis (50 mm), Death Ray Designs
  Deadbolt's Derelict (50.8 mm) and TTCombat Iron Labyrinth (114 mm).
- Persistent palette quantities and board size.
- Palette generation with a set multiplier, adjustable palette spend, and corner /
  edge / centred anchoring for a complex smaller than the board.
- Regeneration from every terrain piece already placed on the board.
- Multi-selection, group rotation, duplication, smart connector fitting, and
  configurable grid snapping.
- Manual reserved zones; the generator respects them but never creates zones.
- Industrial, gothic, and desert board styles.
- PNG layout and piece-manifest export.

## Generator model

The generator treats a board as a **ship deck**, not a maze: through corridors,
compartments either side of them, hatchways between. It generates the compartment
**partition** and then cuts the doorways, rather than generating walls directly —
which is what removes the density ceiling that made every earlier version sparse.

Everything sits on a node lattice and nothing else exists:

| | |
|---|---|
| **cells** | the clear floor, one grid square each — what models stand on |
| **edges** | between adjacent cells. `open`, `wall` or `hatch` |
| **nodes** | the corners. A column stands on any node a panel end reaches |

A panel is an edge occupant and a column is a node occupant, so alignment,
non-overlap and "a panel is centred in its span" hold by construction. A layout
that cannot be assembled from the kit is not representable.

| module | role |
|---|---|
| `app/lattice.ts` | geometry, pitch derivation, runs, reachability, sight lines |
| `app/deckplan.ts` | corridors, compartments, doorways, fit to budget |
| `app/build.ts` | tiling runs from real stock; columns |
| `app/validate.ts` | hard invariants, and the metrics |
| `app/generate.ts` | sizing, anchoring, candidate loop, **the only scorer** |
| `app/terrain.ts` | the kit catalogue, shared with the tests |
| `tests/profile.ts` | `npm run profile` — layout shape against the reference photos |

### Physical invariants

Every one of these fails a candidate outright. Nothing is repaired after the
fact — repairing a finished layout is what reduced earlier versions to a handful
of pieces.

- **The pitch must be buildable**: `panel ≤ pitch ≤ panel + column`. Gallowdark
  sits inside this (the panel slots into a column straddling the corner, so the
  pitch is the 97 mm panel); Iron Labyrinth sits exactly on the upper bound (the
  wall butts between two 50 mm connectors, so the pitch is 64 + 50 mm). Zone
  Mortalis and Deadbolt's Derelict are straddling ranges like Gallowdark, on a
  50 mm and 50.8 mm module.
- **The joint model, not the maker, decides how pieces meet.** A straddling column
  takes panel ends at its centre; a butting connector takes them at its faces.
  `MANUFACTURERS[catalogue].joint` is the single place that distinction lives —
  several call sites used to test `catalogue === "boarding"` instead, which gave
  every later straddling range the connector treatment.
- **Openness is the ground state, and walls are what is left over.** Every
  compartment gets a MOUTH — one whole face left open — and the mouth is what
  connects it to the board. A doorway is a deliberate exception: a bulkhead across a
  street, a store worth sealing, a way in through the hull. The model used to be the
  other way round, walling every boundary and buying connectivity back one hatchway
  at a time, which produced 63 doorways a board, 43% of every panel placed, and 100%
  of compartments sealed with not one open face anywhere. `classifyBoundary` is where
  this lives.
- **Surplus terrain becomes cover, not more rooms.** The partition can only spend a
  panel by making it a compartment boundary, and that bottoms out at `roomMin`. Past
  it, panels go into SPUR walls standing inside a bay — the stubs and Ls that make
  the nooks you can put a squad in. Which is what the reference boards do with a big
  collection; they do not have a finer mesh of rooms.
- **The outside wall gets built.** A perimeter edge facing open deck is the complex's
  own hull and receives a panel; one lying along the table border does not, because
  the board edge is the wall. `DeckPlan.exterior` is which is which, and `build`
  reads it — it used to drop every perimeter edge, so the hull was planned, budgeted
  and drawn in the ASCII map but never placed.
- Every panel end stands on a column, or on the board border.
- Every doorway the plan promised gets a hatchway panel — counted against the
  doorways, not against zero.
- A spur never seals anything. Connectivity is checked before each one is kept, and a
  spur that cuts a cell off is rejected rather than repaired.
- **The kit is sized by its COLUMNS, not by its panels.** A Boarding Actions set holds
  48 wall-cells of panel against 32 loose columns and 4 wall ends. At a measured 0.9
  columns per wall-cell those supports bracket about 40 wall-cells, so the last eight
  panels in the box have nothing to stand on. Sizing solves against the lesser of the
  two.
- Every square is reachable from every other, across `open` and `hatch` edges.
- No firing lane runs the length of the board.
- A wall run is tiled end to end or the plan is revised — never a hole mid-run.
- A planned doorway always receives a hatchway panel; a solid panel may stand in
  for a hatchway but never the reverse.
- Per-piece stock is never exceeded, and reserved zones are avoided by moving the
  complex, not by deleting pieces from it.

### Sizing

One Boarding Actions set is 48 wall-cells and a 7 × 6 card board has 71 internal
edges, so **one set fills one card board** at real density. Extra sets grow the
footprint rather than the density; once the complex fills the table, surplus
terrain stays in the box and the app says how much. A complex smaller than the
board is anchored into a corner or against an edge, which uses the border as free
wall and spends more of the kit on interior structure.

Candidates are scored by **distance to a reference board**, so overshooting is
penalised as much as undershooting and no single metric can run away with the
result. Piece utilisation is a tiebreak only — it is an output, never a target.

The reference profile in `app/validate.ts` is provisional, derived from the kit
arithmetic and the published board geometry. Replacing it with one measured from a
transcribed real board retunes the generator without touching generation code.

See [PROPOSAL.md](PROPOSAL.md) for the analysis this design came from, and
[PROJECT_STATE.md](PROJECT_STATE.md) for historical notes on the versions it
replaced.

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm run lint
npm test
```

`npm test` performs a production build, rendered-HTML checks, and procedural
generator invariant tests.

## Reference basis

- [Official Zone Mortalis additional rules](https://assets.warhammer-community.com/eng_06-11_additionalrules_thehorusheresy_zone-mortalis-05ydhlu5wp-vllnduuxzc.pdf)
- [TTCombat Iron Labyrinth dimensions](https://ttcombat.com/products/iron-labyrinth-death-quadrant-complex)
- [Zone Mortalis: Columns & Walls contents](https://www.warhammer.com/en-US/shop/Zone-Mortalis-Columns-And-Walls-2020)
  — contents only; the 50 mm pitch comes from community measurement, cross-checked
  against the 289 mm floor tile and against Death Ray Designs' independent 2″ module
- [Death Ray Designs: Deadbolt's Derelict Corridors](https://deathraydesigns.com/product/deadbolts-derelict-corridors-bundle/)
  — the only range here whose maker publishes dimensions outright
- [Growing Tree maze generation](https://weblog.jamisbuck.org/2011/1/27/maze-generation-growing-tree-algorithm)
- [Breadth-first dungeon generation](https://www.redblobgames.com/x/2043-bfs-dungeons/)
