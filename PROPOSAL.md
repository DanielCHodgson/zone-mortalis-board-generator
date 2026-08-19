> **IMPLEMENTED.** This is the analysis and proposal the rebuild came from, kept as
> the reasoning behind the design. One detail was refined during implementation: the
> pitch invariant's upper bound is inclusive, because Iron Labyrinth's butt joint
> sits exactly on it. See [HANDOFF.md](HANDOFF.md) for what shipped.

# Once-over and generator proposal

Written after reading the code, running the current generator headless across
twelve seeds, dumping its output as ASCII, and verifying the kit contents and
grid pitch against published sources. Everything below is measured, derived or
cited.

---

## Part 1 — What the current generator actually produces

Twelve seeds, Boarding Actions inventory as coded, 30" x 22" board, one call each
(no best-of-N):

```
seed  0: total  7   wall 6   door 0   pillar 1   end 0
seed  1: total  6   wall 6   door 0   pillar 0   end 0
seed  2: total 10   wall 6   door 1   pillar 3   end 0
seed  3: total  8   wall 6   door 0   pillar 1   end 1
seed  4: total  9   wall 6   door 1   pillar 2   end 0
seed  5: total  8   wall 6   door 0   pillar 2   end 0
seed  6: total  8   wall 7   door 0   pillar 0   end 1
seed  7: total  8   wall 6   door 0   pillar 2   end 0
seed  8: total  7   wall 6   door 0   pillar 1   end 0
seed  9: total  9   wall 7   door 0   pillar 2   end 0
seed 10: total  6   wall 5   door 0   pillar 1   end 0
seed 11: total  7   wall 6   door 0   pillar 1   end 0
```

The set holds 32 panels and 32 pillars. It is spending about a fifth of the
panels, almost none of the hatchways, and **essentially none of the pillars** — so
the walls are floating free with nothing bracketing them. Rendered, that is a
handful of disconnected L-shapes adrift on an empty deck.

---

## Part 2 — Ground truth, verified

Two things were guesses in the code. Both are now settled from sources, and the
answers reframe the design.

### The pitch is 97 mm. Confirmed twice, independently.

- The Gallowdark terrain is designed around a **97 mm x 97 mm tile**, and a board
  is **42 tiles in a 6 x 7 grid**.
- The card board is **704 mm x 607 mm**. Check it: `7 x 97 = 679` and
  `6 x 97 = 582`, leaving `704 - 679 = 25` and `607 - 582 = 25` — a 12.5 mm
  border on every side. Exact, on both axes.

That is your model, confirmed: the square is one wall length, the pitch is the
square, and the columns straddle the corners.

So the **previous 97 mm value was right, and the change to 125 mm was the
error.** It is also worth recording that my own `long - short` derivation in the
first draft of this document was wrong — it gave 90 mm because the *long panel
length* in `TERRAIN` is the bad datum, not the pitch. At a 97 mm pitch a long
panel spanning two squares should measure about **176 mm**, not the coded 170 mm.

Related corrections from the same source:

- The columns are **28 x 25 mm**, not the coded 32 x 32 mm. They are *not square*,
  which means column orientation is a real degree of freedom the model currently
  ignores.
- The clear span between columns is **~72 mm**, and the panels are **5.5 mm**
  thick — much thinner than the coded 28 mm depth.

Reconciling: pitch 97, column 28 wide centred on the node, so 69 mm of open
opening; a short panel of ~80 mm bridges it and sits ~5.5 mm into each column.
Every number is consistent. The invariant to assert, rather than hard-code:

```
panel_length  <=  pitch  <=  panel_length + column_width
```

At 125 mm that fails, which is exactly the bug in Part 1: the panel end falls
**0.256" short of the column it is supposed to slot into**, so the orphan sweep
deletes every column, `openSealedPockets` then sees sealed regions and starts
deleting *walls*, and the cascade lands on a 6-piece board.

**Iron Labyrinth is a different joint model, and the code already has it right.**
Gallowdark: the panel slots *into* a column centred on the node, so pitch = panel
length. Iron Labyrinth: the wall sits *between* two connector columns, so
pitch = wall + connector = 64 + 50 = 114 mm. `nodeLength(def, support) =
def.span ?? support + def.width` encodes exactly these two models. Keep it. Only
the Gallowdark `span` value was ever wrong.

### The inventory was already correct — and it inverts the hatchway rule

The handoff flagged `limit: 4` on everything as fabricated. It is not. Verified
contents of the Boarding Actions Terrain Set, 68 pieces:

| piece | qty | cells | own columns? |
|---|---|---|---|
| Short wall with hatchway + pillars (2 designs) | 8 | 1 | yes |
| Short wall with hatchway | 4 | 1 | no |
| Long wall with hatchway + pillars | 4 | 2 | yes |
| Long wall with hatchway | 4 | 2 | no |
| Long wall + pillars | 4 | 2 | yes |
| Long wall | 4 | 2 | no |
| Short wall | 4 | 1 | no |
| Pillar | 32 | — | — |
| Wall end | 4 | — | — |

The coded quantities match exactly. So does the 68-piece total. **The one thing
the handoff was most confident was wrong turns out to be right**, and the real
conclusion is the opposite of the one drawn from it:

- **20 of 32 panels carry a hatchway — 62%.** `DOOR_SHARE = .13` is not a
  slightly-off tuning value, it is off by a factor of five.
- The two "door striping" episodes were the tiler being dragged toward the kit's
  actual composition and then forced back out of it. A Gallowdark board is
  *mostly* hatchway panels. Your own photos show this — the tall arched openings
  everywhere are hatchway panels, not plain walls.
- This kills the density-ceiling problem outright. A hatchway blocks sight but
  passes models, so a board can be walled almost solid and still be fully
  connected. Connectivity was never the thing limiting wall count.

### Capacity: one set is one card board

- Panels per set: 16 short (1 cell) + 16 long (2 cells) = **48 wall-cells.**
- A 7 x 6 lattice has `6x6 + 5x7 = 71` internal edges.
- 48 / 71 = **68% of internal edges walled.** Genuinely dense.

So **one set fills exactly one card board at reference density**, which is a much
cleaner statement than the "you need two or more sets" I put in the first draft —
retract that. GW ships two card boards, so the full published play area is two
sets' worth. Your photos look like two-plus, which now makes sense.

### Columns, not walls, are the binding constraint

48 wall-cells means up to 96 panel ends. There are 32 loose columns, plus 16
panels that carry their own. A node can serve up to four incident panels, so the
plan has to *share* nodes aggressively to fit.

This is the most useful thing in this document, because the pressure points the
right way:

- **long panels are cheaper** — one long panel spanning two cells skips the
  column a pair of shorts would need between them
- **junctions are cheaper** — a T or X junction serves three or four panel ends
  off one column
- **scattered short runs are expensive** — every isolated run pays for two end
  columns and buys nothing

Economising columns therefore *produces* long unbroken runs meeting at T and
cross junctions. That is the top item on your own list of what good looks like,
and it falls out of a physical budget rather than a scoring weight. Column count
should be a first-class budget in the generator, not an afterthought.

---

## Part 3 — Remaining issues in the code

### 1. All 11 tests pass on the broken output

The test helper generates **24 candidates and keeps the best**, so it never sees
what a single call returns. The assertions are lower bounds a 6-piece scatter
clears (`structures >= 5`, `supports >= 4`, `blockers >= 4`). Nothing asserts the
kit gets spent, and the bracketing test filters to `spanned` walls first, so
orphaned walls are excluded from the one check that would have caught this.

### 2. Three repair sweeps destroy the board rather than fixing it

`openSealedPockets` removes a sealing wall when no matching hatchway is left. The
door-inline sweep removes hatchways. The orphan sweep removes columns. Together
they take a 12-wall plan down to 6 walls with no columns. Repair-after-the-fact is
the wrong shape: a board is either buildable or it is not, and another candidate
is cheap. All three should be deleted in favour of **reject and retry**.

### 3. The run tiler leaves holes in the middle of a wall run

```ts
// Nothing in the tray fits this cell. Skip it and carry on down the run
if (!def) { index++; continue; }
```

A bulkhead with a random hole in it. A run that cannot be tiled from stock must
fail the whole run and force the plan to be revised.

### 4. Two scoring layers fight each other

`spatial-generator.ts` scores `-sight*12 + structural*2 + chambers*6`, penalising
long sight lines. `page.tsx` then re-scores 24 of those winners as
`structures*50 + span*45 + quadrants*12 + junctions*22 + doors*10`, rewarding raw
piece count and table spread with no sight-line term at all. The outer layer
systematically overrules the inner one and `structures*50` dominates everything.
This is the mechanism behind "optimised metrics instead of looking at output".
There should be exactly one scorer.

### 5. Wall-cell budget counts only plain walls

`cellsOf(walls)` gives 20 where the true panel capacity is 48, because hatchway
panels are excluded from the budget and then used as filler. Backwards: they are
62% of the kit and should size the lattice.

### 6. "+ pillars" variants double-count columns

16 of 32 panels carry their own columns; nothing in the model knows, so two of
them meeting at a node stack two columns. Needs `ownColumns: 0 | 1 | 2` on the
definition, suppressing the node occupant. **Worth one look at a real panel** to
confirm whether an integrated column is one end or both.

### 7. Piece dimensions need correcting

Panel depth 28 mm should be ~5.5 mm; column 32 x 32 mm should be 28 x 25 mm; long
panel 170 mm should be ~176 mm. The 5.5 mm panel thickness in particular changes
corridor clear width substantially and will change how the board reads.

### 8. Board presets have no defined relationship to the lattice

Add the real ones: one card board (704 x 607 mm, 7 x 6 squares) and two card
boards. Keep 30 x 22 and 4' x 4' but derive their lattice with one explicit,
documented margin policy instead of the improvised `cellCap` / `axisWidths` /
`place` logic.

### Minor

- `.gitignore` is clean; no build output tracked.
- Pre-existing `tsc --noEmit` errors in `worker/`, `db/`, `page.tsx:1107` and the
  test inventory literals. Unrelated; worth clearing separately.

---

## Part 4 — Proposal

### The one-line summary

Stop generating walls. **Generate the compartment partition, then cut the
doorways** — where "doorway" mostly means "a hatchway panel", because that is what
62% of the kit is. Wall count is bounded by columns and panels, never by
connectivity.

### Why a partition and not a maze

A Gallowdark board is not a labyrinth. It is a ship deck: through corridors, with
compartments either side, connected by hatchways. That is what your photos show
and what the multi-room example layout shows. A maze gives dead ends and one-cell
threads; a partition gives long straight bulkheads meeting at T-junctions.

### The lattice, stated once and enforced everywhere

```
nodes    (C+1) x (R+1) points at 97 mm spacing. A node may hold a column.
edges    unit segments between adjacent nodes. State: OPEN | WALL | HATCH.
cells    the C x R squares. The clear floor. What models stand on.
```

- A short panel occupies **one** edge. A long panel occupies **two collinear**
  edges and suppresses the node between them unless something else meets there.
- A column goes on **every node with at least one incident panel end**, and
  nowhere else. Panels with `ownColumns` suppress their own.
- The board border is the hull: a wall for free, costing no pieces.
- Movement crosses OPEN and HATCH. Sight crosses only OPEN — hatches default
  closed for layout scoring.

Every piece is an edge occupant or a node occupant, so overlap, alignment and
"panel centred in its span" are true by construction. An unbuildable layout stops
being representable.

### The pipeline

**Phase 0 — Lattice and footprint.** Pitch from the palette; assert
`panel <= pitch < panel + column`. Size the footprint from capacity (Part 5
below), then fit and anchor it on the board.

**Phase 1 — Corridor spine.** One or two corridors running the full extent of the
footprint on grid lines, optionally with a single dog-leg. Their flanks are the
long unbroken runs, and every compartment boundary meeting one is a T-junction
for free.

**Phase 2 — Compartments.** Recursively split remaining regions with straight
bulkheads on lattice lines. Split while a region is at least two cells on the
split axis; stop at roughly 1x1 to 3x3 rooms. Size variety comes from where the
splits land, not from a shape catalogue.

**Phase 3 — Doorways.** Region adjacency graph, spanning tree, plus extra links to
about 1.3x the tree so there are alternate routes. Each chosen adjacency gets one
boundary edge set to HATCH; every other boundary edge is WALL. With 20 hatchways
per set this is cheap, and hatchways get used as the kit intends.

**Phase 4 — Fit to budget, columns first.** Count required wall-cells *and*
required columns. Over either budget, undo the least valuable splits — deepest
and smallest regions first — and prefer revisions that merge runs or share nodes,
since those are what buy columns back. Piece count becomes a converged result
instead of an accident.

**Phase 5 — Tile the runs.** Maximal straight WALL runs, tiled greedily, long
panels first, against real per-SKU stock, mixing plain and hatchway panels toward
the kit's own 62% ratio. **A run that cannot be fully tiled fails and Phase 4
revises the plan.** No holes, ever.

**Phase 6 — Nodes.** Column on every node with an incident panel end; wall-end cap
at degree-1 nodes; `ownColumns` panels suppress theirs. A panel end with no node
occupant is a hard failure.

**Phase 7 — Validate, reject, retry.** All of these fail the candidate outright:

1. every panel end on a node occupant, or on the hull
2. every cell reachable from every other across OPEN/HATCH
3. no region enclosed by WALL alone
4. per-SKU inventory and column count never exceeded
5. no two pieces overlap
6. longest open sight line under threshold
7. every hatchway inline in a run, with structure or hull past both ends

**Phase 8 — Score the survivors, once.** One scorer, one place. Run-length
distribution, T and X junction counts, room-size spread, mean and max sight line,
dead-end count. Utilisation is a **tiebreak only** — never allowed to drive the
choice. That is the specific trap from last time.

### The thing that stops the swinging: a golden fixture

Transcribe one real board — a published Gallowdark layout, or one of your photos —
as `C`, `R` and the state of every edge. Then:

1. Render it and compare against the photo until it matches. That validates pitch,
   piece dimensions and renderer in one go, with no generation involved.
2. Compute its metric vector.
3. Score candidates by **distance to the fixture's metrics**, not by hand-tuned
   weights.

The generator then has a definition of "right" that does not move every time
output is rejected, and a regression test with real content replaces the
lower-bound assertions that are currently green on a broken board.

---

## Part 5 — Sets, footprint and spatial greed

Answering your second point directly.

### Capacity model

```
setCapacity   = 48 wall-cells, 32 loose columns, 4 wall ends   (per set)
capacity      = setCapacity x sets
targetDensity = walled internal edges / internal edges         (from the fixture; ~0.68)
```

`sets` is a UI control, default 1. Everything else is derived.

### Footprint sizing

Choose the largest `C x R` lattice, at the board's aspect ratio and capped by the
board, whose internal-edge count satisfies
`internalEdges(C,R) x targetDensity <= capacity`. Density stays calibrated to real
boards; the footprint absorbs the surplus. So:

- **1 set** → roughly 7 x 6, one card board's worth, about 27" x 23"
- **2 sets** → the full published two-board play area
- **4+ sets** → fills a 4' x 4'

Once the footprint hits the board on both axes, extra capacity has nowhere to go
horizontally, so it raises density above the reference instead — more subdivision,
smaller compartments, tighter sight lines. Footprint grows first, density second.

### Anchoring, when the footprint is smaller than the board

This is the "bias into a board edge or the centre" you asked for, and the two
options are not merely cosmetic — they cost different amounts of terrain:

| bias | behaviour | cost |
|---|---|---|
| `corner` | anchored to a corner; **two** hull sides are free walls | cheapest |
| `edge` | flush to one edge, centred on the other; **one** free hull side | middling |
| `centre` | island with open deck all round; hull used on **no** side | dearest — the complex must build its own perimeter |

Corner and edge anchoring spend more of the kit on interior structure, which is
what makes a small complex read as dense rather than as a hollow box. Centre is
the right choice when you want a free-standing structure with deck around it — a
hangar, or somewhere for a vehicle — and the generator should say plainly that it
buys that look with roughly a perimeter's worth of panels.

Default: `corner` at 1 set, `edge` as the footprint grows, `none` once it fills
the board and every hull side is free. `centre` stays an explicit user choice.

### Spatial greed

One derived dial, `greed = capacity / (internalEdges(board) x targetDensity)`:

- `greed < 1` — cannot fill the board. Shrink the footprint and anchor it. Report
  the shortfall in the UI as "fills about 60% of this board; 2 sets fills it".
- `greed ~ 1` — fills the board at reference density. No anchor, all four hull
  sides free.
- `greed > 1` — surplus. Subdivide further, add a second corridor, allow 1x1
  closets. Only here does raising density above the reference make sense.

That gives one number driving footprint, anchoring and subdivision depth together,
so the three cannot disagree — which is how the previous versions ended up with a
thin scatter across a big table.

---

## Part 6 — Files and sequencing

| file | role |
|---|---|
| `app/lattice.ts` | **new.** Pitch derivation, node/edge/cell types, world coordinates, run extraction. Pure, no randomness. |
| `app/deckplan.ts` | **new.** Phases 1-4 plus Part 5 sizing. Seeded, pure, no SKU knowledge. |
| `app/build.ts` | **new.** Phases 5-6. Deck plan + inventory to placed pieces. |
| `app/validate.ts` | **new.** Phase 7 invariants and Phase 8 metrics. |
| `app/generate.ts` | **new.** Candidate loop, fixture-calibrated scoring. The single scorer. |
| `tests/fixtures/*.ts` | **new.** Transcribed real boards. |
| `app/floorplan.ts` | retire. `edgeRuns` and `meanSightLine` move to `lattice.ts` / `validate.ts`. |
| `app/spatial-generator.ts` | retire. Keep `randomFactory`, `pieceRect`, `rectsOverlap`, the accessory scatter. Delete all three repair sweeps. |
| `app/page.tsx` | remove the outer scorer; call `generate.ts`. `GALLOWDARK_GRID` back to 97 mm and derived. Correct piece dimensions. Add `ownColumns`. Add sets and bias controls. Add card-board presets. |
| `tests/spatial-generator.test.ts` | rewrite. Drop the best-of-24 helper — single-shot assertions only. |

### Sequencing

1. Correct the data: 97 mm pitch, 28 x 25 mm columns, 5.5 mm panel depth, ~176 mm
   long panel, `ownColumns` flags. Inventory needs no change.
2. `lattice.ts` + the golden fixture + render it against the photo. **No
   generation until this matches.**
3. `deckplan.ts`, judged by rendering plans as ASCII edge maps — fast to eyeball,
   no UI needed.
4. `build.ts`, `validate.ts`, `generate.ts`.
5. Part 5: sets, greed, anchoring. Test at 1, 2 and 4 sets across all presets.
6. Rewire `page.tsx`, delete the old path, rewrite the tests.

### Two measurements still worth taking

Neither blocks step 1, and both are a 30-second look at the kit:

- **Count the printed squares on a card board and measure one.** The prediction is
  7 x 6 squares at 97 mm with a 12.5 mm border. If that holds, the pitch is closed
  for good.
- **Look at one "+ pillars" panel.** Is the integrated column at one end or both?
  That sets `ownColumns` to 1 or 2.

## Sources

- [Kill Team: Into the Dark terrain review — Tale of Painters](https://taleofpainters.com/2022/09/review-kill-team-into-the-dark-part-1-terrain-rules/)
- [Gallowdark terrain measurements — The Bolter and Chainsword](https://bolterandchainsword.com/topic/377098-gallowdark-terrain-measurements/)
- [Boarding Actions Terrain Set contents — Miniature Market](https://www.miniaturemarket.com/warhammer-40k-boarding-actions-terrain-set-gw-40-62.html)
- [Warhammer 40,000 Boarding Actions Terrain Set — Games Workshop](https://www.warhammer.com/en-WW/shop/40k-boarding-actions-terrain-set-2022)
