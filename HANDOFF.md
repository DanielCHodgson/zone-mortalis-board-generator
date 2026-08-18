# Handoff — Zone Mortalis board generator

Written at the end of a long, largely unsuccessful session. Read the honest
assessment first; it is the most useful part.

## Honest assessment

**The current implementation is not good and should probably not be built on.**

The session started as a bug-review of the existing generator and turned into
three successive rewrites, each of which fixed the previous one's visible fault
and introduced a new one. The output was rejected at every stage. What went
wrong, so it is not repeated:

1. **Optimised metrics instead of looking at output.** Piece utilisation went
   from 15/32 to 31/32, shape variety tripled, tests went green — while the
   boards got *worse*. Every number tracked was the wrong number. Several rounds
   of work were reported as progress when the boards were plainly bad.

2. **Over-corrected, repeatedly.** Floating fragments → so build enclosed rooms →
   "squares of doom" → so build a strict maze → too sparse to look like a real
   board. Each swing was a reaction to the last complaint rather than to a model
   of what the board should be.

3. **Built elaborate abstractions instead of copying something known-good.**
   Tile archetypes, variable-pitch lattices, coverage scoring, spanning-tree
   mazes. All of it invented from first principles, none of it validated against
   an actual board until far too late.

4. **Asked the user to adjudicate geometry that reference photos would have
   settled.** The 97 mm-vs-125 mm pitch question cost a lot and was answerable
   from the box art the whole time.

## Where to start next time

**Replicate one real Boarding Actions / Kill Team Gallowdark board exactly, from
reference photos, before generating anything.**

Concretely:

- Pick a published board (the Warhammer Community Gallowdark shots are good —
  full-board overheads showing wall runs, rooms, hatchways and pillars).
- Hand-transcribe it into a fixture: a list of squares, and for each square edge
  whether it carries a wall, a hatchway, or nothing.
- Get the app to render that fixture and compare it against the photo until it
  matches. That validates the geometry, the piece dimensions and the renderer in
  one go, with no generation involved.
- Only then generalise: the fixture becomes the ground truth a generator is
  judged against — wall density, run lengths, room sizes, hatchway frequency,
  corridor topology all measured off a board that is known to be right.

This is the step that was skipped, and skipping it is why the session failed.

## Hard-won facts worth keeping

These cost real effort to establish and should not be rediscovered.

### Geometry

- **The square is the clear floor.** A Gallowdark wall panel sits on a square's
  edge with a pillar straddling each corner, overlapping equally into both
  squares. Node-to-node pitch is therefore *panel + pillar*, not the bare panel.
- `GALLOWDARK_GRID` was `97 mm`, which treated the bare panel as the pitch, put
  the pillar inside the square and left every corridor **2.72" clear** — visibly
  far too thin. It is now **125 mm**, giving **3.82" clear** corridors. Target is
  3.5–4".
- Long panels span exactly two squares. Keeping the `span` field is what holds
  the grid regular; removing it fragmented the lattice into irregular columns.
  The bug was the *value*, never the field's existence.
- Achievable clear corridor widths, if the pitch is ever revisited:

  | kit | spacing | pitch | clear |
  |---|---|---|---|
  | Gallowdark | one square | 4.92" | 3.82" |
  | Gallowdark | two squares | 9.84" | 8.74" |
  | Iron Labyrinth | 64 mm wall + connector | 4.49" | 3.19" |
  | Iron Labyrinth | 94 mm high wall + connector | 5.67" | 4.37" |

### The density ceiling (the unresolved problem)

A maze built as a pure spanning tree over a `c x r` grid has exactly
**`(c-1)(r-1)`** edges left for walls. A 30x22 board at the current pitch is a
6x4 grid → **15 wall-cells**, but the Gallowdark kit holds **20**. That is why
the generator currently produces ~8 panels and looks sparse.

Real boards are much denser than that limit because **hatchways are passable**:
GW's own board has genuinely enclosed rooms whose connectivity runs *through* a
hatchway, so its wall count is not bounded by a spanning tree at all.

The likely fix — unvalidated — is to allow walls beyond the tree and restore
connectivity through hatchways. Do not attempt this before the reference-board
fixture exists, or it will just be another swing.

### What "good" looks like (from user feedback on real output)

- Long unbroken wall runs meeting at T and cross junctions.
- Line-of-sight blockers everywhere; you should not see across the table.
- Corridors 3.5–4" clear.
- Dense — comparable to the reference photos, not a few pieces on open floor.
- Enclosed rooms are fine *as part of a dense board*; isolated rectangles on an
  empty table are not. The rejected outputs were called "squares of doom",
  "weird rooms of doom" and "a double square made of doors".
- **Hatchways are the exception, not a building material.** Roughly one panel in
  eight. Two separate regressions produced runs striped wall/door/wall/door.

### Data problems in `app/page.tsx`

- Every entry in `TERRAIN` has `limit: 4`, giving **20 hatchways to 12 walls**.
  This is very unlikely to be the real Boarding Actions contents and it distorts
  everything downstream — it is the direct cause of both door-striping
  regressions. **Verify the real kit contents; this is cheap and high value.**
- The "+ pillars" variants (`short-door-pillars-a/b`, `long-wall-pillars`) appear
  to include their own pillars in the stated width. Nothing in the model knows
  this, so two of them meeting at a corner double up on pillars. Rare, but a real
  physical-fit error.
- `wall-end` pieces: Gallowdark has 4, Iron Labyrinth Ultima has 21. The old
  generator never placed a single one; the current one does, at run termini.

### Environment

- **`npm run dev` binds port 3000**, not Vite's default 5173, despite no port in
  `vite.config.ts`. Pointing a preview at 5173 opens a blank tab with no error.
  `.claude/launch.json` is configured correctly.
- `npx tsc --noEmit` has pre-existing errors in `worker/`, `db/`, `page.tsx:1107`
  and the test file's inventory literals. None are from this session's work.

## Current state of the code

Everything below is committed but **should be treated as a starting point to
replace, not extend**.

| file | state |
|---|---|
| `app/floorplan.ts` | **New.** Spanning-tree maze generator. Clean and well-commented, but produces boards that are too sparse. |
| `app/spatial-generator.ts` | **Rewritten.** Lattice realisation: panels on edges, supports on vertices, variable cell widths, run tiling with long-panel preference, hatchway quota. The geometry layer here is the most likely part to be worth keeping. |
| `tests/spatial-generator.test.ts` | 11 tests, all passing. Several were rewritten this session — see below. |
| `app/page.tsx` | `GALLOWDARK_GRID` 97→125 mm; added `30x22` board preset, now the default. |
| `.claude/launch.json` | **New.** Dev server config on port 3000. |

### Tests

11/11 pass, lint clean. Four were rewritten because they asserted the old model:

- `closed rooms are built, and every one of them has a doorway` — **deleted.** It
  demanded exactly the sealed rooms the user was rejecting. Replaced with
  `no firing lane runs unbroken across the board`, which tests the actual game
  requirement.
- `a rejected component is retried smaller` — **deleted**, its premise (hit a
  structural piece target) is obsolete now that panel count is an output of board
  capacity. Replaced with `hatchways stay a small minority of the wall line`,
  which guards the door-striping regression that recurred twice.
- `Iron components leave model-scale corridors` and
  `Boarding Actions uses several shaped networks` — replaced with
  `every gap between terrain is either a joint or a walkable corridor` and
  `every wall runs along a line the supports define`.

Tests worth keeping regardless of what replaces the generator: the physical-fit
ones (`walls bracketed by a connector`, `supports never narrower than walls`,
`a grid-kit wall spans exactly one grid pitch`, `no wall lies alongside the board
border`, `no walled-off dead zone`).

## Tuning dials in the current code

If it is used at all before being replaced:

- `DOOR_SHARE` in `spatial-generator.ts` — hatchway frequency, currently `.13`.
- `-sight * 12` in the candidate score — how tight the maze is.
- `buildMaze(..., budgetCells, ...)` — wall count; currently capped by the
  spanning-tree ceiling described above.
