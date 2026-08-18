# Mortalis Architect

An interactive, scale-aware Zone Mortalis and Boarding Actions terrain layout
planner. It provides physical terrain palettes, multiple board sizes, manual
editing, procedural layout generation, layout analysis, and PNG export.

## Current capabilities

- 2′ × 2′, 4′ × 2′, and 4′ × 4′ boards.
- Games Workshop Boarding Actions and TTCombat Iron Labyrinth catalogues.
- Persistent palette quantities and board size.
- Palette generation with an adjustable 0–60% footprint target.
- Regeneration from every terrain piece already placed on the board.
- Multi-selection, group rotation, duplication, smart connector fitting, and
  configurable grid snapping.
- Manual reserved zones; the generator respects them but never creates zones.
- Industrial, gothic, and desert board styles.
- PNG layout and piece-manifest export.

## Generator model

The active generator lives in
`app/spatial-generator.ts`. It builds a small number of connector-node graphs
using hooked chamber walls, T-junctions, crosses, partial U-shapes, turns, and
dead ends. Twenty-four candidates are generated and scored by the UI.

Important physical invariants:

- Every Iron Labyrinth wall is an edge between connectors: connector → wall →
  connector.
- Connectors may be shared only at a genuine corner, branch, or continuous join.
- Iron wall-end pieces are not automatically substituted for connectors.
- Separate Iron networks retain at least 3.8″ of clearance.
- Boarding Actions networks retain at least 2.75″ of clearance, with candidate
  placement normally producing wider lanes.
- Board edges may act as the opposite side of a corridor.
- Terrain is never placed inside a reserved zone.

See [PROJECT_STATE.md](PROJECT_STATE.md) for the detailed implementation
handoff, verified results, and known limitations.

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
- [Growing Tree maze generation](https://weblog.jamisbuck.org/2011/1/27/maze-generation-growing-tree-algorithm)
- [Breadth-first dungeon generation](https://www.redblobgames.com/x/2043-bfs-dungeons/)
