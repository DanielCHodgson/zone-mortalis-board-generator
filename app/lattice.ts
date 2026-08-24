/**
 * The lattice: the only geometry in the generator.
 *
 * Gallowdark and Iron Labyrinth are both assembly grids. A board is a grid of
 * square cells; a wall panel stands on the EDGE between two cells; a column
 * stands on the NODE where edges meet. Nothing else exists. Every piece is
 * therefore an edge occupant or a node occupant, which is what makes "panels are
 * aligned", "panels do not overlap" and "a panel is centred in its span" true by
 * construction rather than by a check that runs afterwards.
 *
 * The two kits differ only in how a panel meets a column, and that difference is
 * entirely captured by the pitch:
 *
 *   Gallowdark        the panel slots INTO a column straddling the corner, so the
 *                     column overlaps equally into both cells and
 *                     pitch = panel length (97 mm).
 *   Iron Labyrinth    the wall sits BETWEEN two connector blocks, so
 *                     pitch = wall + connector (64 + 50 = 114 mm).
 *
 * Both give `panel_length <= pitch <= panel_length + column_width`, which is the
 * invariant that says a panel can actually reach the columns it is supposed to
 * clip into. A pitch outside that range is unbuildable: too small and the panel
 * cannot fit between the columns, too large and its ends hang in mid-air. The
 * previous 125 mm Gallowdark pitch failed the upper bound by 8.5 mm, and every
 * downstream symptom — orphaned columns deleted, then walls deleted to open the
 * regions that deletion sealed — followed from that one number.
 *
 * Index conventions, fixed once here so nothing downstream has to guess:
 *
 *   cells   `cols` x `rows`, indexed (col, row) from the top left.
 *   nodes   (cols+1) x (rows+1), indexed (col, row). Node (0,0) is the top-left
 *           corner of cell (0,0).
 *   h-edge  (col, row) runs from node (col, row) to node (col+1, row) — a
 *           horizontal segment separating cell (col, row-1) from cell (col, row).
 *   v-edge  (col, row) runs from node (col, row) to node (col, row+1) — a
 *           vertical segment separating cell (col-1, row) from cell (col, row).
 *
 * So an h-edge with row 0 or row `rows` lies on the board border, as does a
 * v-edge with col 0 or col `cols`. Border edges are the hull: they block movement
 * and sight for free and never cost a piece.
 */

export type EdgeAxis = "h" | "v";

export type LatticeEdge = { axis:EdgeAxis; col:number; row:number };

export type LatticeNode = { col:number; row:number };

export type LatticeCell = { col:number; row:number };

/**
 * What stands on an edge.
 *
 * `hatch` is a wall panel with a hatchway in it: models pass through, sight does
 * not. It is the single most important state in the model, because it is what
 * lets a board be walled almost solid and still be fully connected — and because
 * 20 of the 32 panels in a Boarding Actions set are hatchway panels, it is also
 * the kit's primary building material rather than a garnish.
 */
export type EdgeState = "open" | "wall" | "hatch";

export type Lattice = {
  cols:number; rows:number;
  /** Node-to-node spacing in inches. Kept per-axis so a kit with two wall
   *  lengths can run a different pitch along each axis. */
  pitchX:number; pitchY:number;
  /** World position of node (0,0), in inches from the board's top-left corner. */
  originX:number; originY:number;
};

export const makeLattice = (
  cols:number, rows:number, pitchX:number, pitchY:number, originX:number, originY:number,
):Lattice => ({ cols, rows, pitchX, pitchY, originX, originY });

// ---------------------------------------------------------------------------
// Keys. String keys throughout: the plan is a map from edge to state, and it is
// read far more often than it is built.
// ---------------------------------------------------------------------------

export const edgeKey = (edge:LatticeEdge) => `${edge.axis}:${edge.col}:${edge.row}`;
export const cellKey = (cell:LatticeCell) => `${cell.col}:${cell.row}`;
export const nodeKey = (node:LatticeNode) => `${node.col}:${node.row}`;

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export const cellInside = (lattice:Lattice, cell:LatticeCell) =>
  cell.col >= 0 && cell.row >= 0 && cell.col < lattice.cols && cell.row < lattice.rows;

/** The two cells an edge separates. A cell off the board is returned as null,
 *  which is how a border edge identifies itself. */
export const cellsOfEdge = (lattice:Lattice, edge:LatticeEdge):[LatticeCell | null, LatticeCell | null] => {
  const pair:[LatticeCell, LatticeCell] = edge.axis === "h"
    ? [{ col:edge.col, row:edge.row - 1 }, { col:edge.col, row:edge.row }]
    : [{ col:edge.col - 1, row:edge.row }, { col:edge.col, row:edge.row }];
  return [
    cellInside(lattice, pair[0]) ? pair[0] : null,
    cellInside(lattice, pair[1]) ? pair[1] : null,
  ];
};

/** The two nodes an edge runs between. */
export const nodesOfEdge = (edge:LatticeEdge):[LatticeNode, LatticeNode] =>
  edge.axis === "h"
    ? [{ col:edge.col, row:edge.row }, { col:edge.col + 1, row:edge.row }]
    : [{ col:edge.col, row:edge.row }, { col:edge.col, row:edge.row + 1 }];

export const isBorderEdge = (lattice:Lattice, edge:LatticeEdge) =>
  edge.axis === "h"
    ? edge.row === 0 || edge.row === lattice.rows
    : edge.col === 0 || edge.col === lattice.cols;

/** Every edge on the lattice, border included. */
export const allEdges = (lattice:Lattice) => {
  const edges:LatticeEdge[] = [];
  for (let row = 0; row <= lattice.rows; row++) for (let col = 0; col < lattice.cols; col++) edges.push({ axis:"h", col, row });
  for (let col = 0; col <= lattice.cols; col++) for (let row = 0; row < lattice.rows; row++) edges.push({ axis:"v", col, row });
  return edges;
};

/** Every edge with a cell on both sides — the ones a panel can be spent on. */
export const internalEdges = (lattice:Lattice) => allEdges(lattice).filter((edge) => !isBorderEdge(lattice, edge));

/** How many internal edges a cols x rows lattice has. The denominator for
 *  density, and the number that decides how many sets a board wants. */
export const internalEdgeCount = (cols:number, rows:number) => (cols - 1) * rows + (rows - 1) * cols;

/** The four edges around a cell. */
export const edgesOfCell = (cell:LatticeCell):LatticeEdge[] => [
  { axis:"h", col:cell.col, row:cell.row },
  { axis:"h", col:cell.col, row:cell.row + 1 },
  { axis:"v", col:cell.col, row:cell.row },
  { axis:"v", col:cell.col + 1, row:cell.row },
];

/** The next edge along the same straight line, in the positive direction. */
export const nextEdgeAlong = (edge:LatticeEdge):LatticeEdge =>
  edge.axis === "h" ? { axis:"h", col:edge.col + 1, row:edge.row } : { axis:"v", col:edge.col, row:edge.row + 1 };

export const previousEdgeAlong = (edge:LatticeEdge):LatticeEdge =>
  edge.axis === "h" ? { axis:"h", col:edge.col - 1, row:edge.row } : { axis:"v", col:edge.col, row:edge.row - 1 };

// ---------------------------------------------------------------------------
// World geometry
// ---------------------------------------------------------------------------

export const nodeWorld = (lattice:Lattice, node:LatticeNode) => ({
  x:lattice.originX + node.col * lattice.pitchX,
  y:lattice.originY + node.row * lattice.pitchY,
});

export const cellCentreWorld = (lattice:Lattice, cell:LatticeCell) => ({
  x:lattice.originX + (cell.col + .5) * lattice.pitchX,
  y:lattice.originY + (cell.row + .5) * lattice.pitchY,
});

/**
 * Where a panel spanning `cells` edges starting at `edge` sits in the world.
 *
 * `centre` is the midpoint of the whole span, so a panel is placed centred in it
 * and its ends reach equally into the column at each end. `length` is the
 * node-to-node distance the span covers, which is what the panel's own length is
 * checked against.
 */
export const spanWorld = (lattice:Lattice, edge:LatticeEdge, cells = 1) => {
  const [from] = nodesOfEdge(edge);
  const to:LatticeNode = edge.axis === "h"
    ? { col:from.col + cells, row:from.row }
    : { col:from.col, row:from.row + cells };
  const a = nodeWorld(lattice, from);
  const b = nodeWorld(lattice, to);
  return {
    centre:{ x:(a.x + b.x) / 2, y:(a.y + b.y) / 2 },
    length:edge.axis === "h" ? cells * lattice.pitchX : cells * lattice.pitchY,
    horizontal:edge.axis === "h",
    from, to,
  };
};

// ---------------------------------------------------------------------------
// Runs
//
// A run is a maximal straight sequence of consecutive edges that all carry a
// panel. One run is one physical wall: it is what gets tiled from stock, and its
// length distribution is the single best description of whether a board looks
// like a real one. Hatchways count as part of the run — a hatchway panel is a
// wall with a door in it, not a gap.
// ---------------------------------------------------------------------------

export const edgeRuns = (edges:LatticeEdge[]):LatticeEdge[][] => {
  const present = new Set(edges.map(edgeKey));
  const used = new Set<string>();
  const runs:LatticeEdge[][] = [];
  edges.forEach((edge) => {
    if (used.has(edgeKey(edge))) return;
    let start = edge;
    for (;;) {
      const back = previousEdgeAlong(start);
      if (!present.has(edgeKey(back))) break;
      start = back;
    }
    const run:LatticeEdge[] = [];
    for (let current = start; present.has(edgeKey(current)); current = nextEdgeAlong(current)) {
      run.push(current);
      used.add(edgeKey(current));
    }
    runs.push(run);
  });
  return runs;
};

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

const stateOf = (plan:Map<string, EdgeState>, edge:LatticeEdge):EdgeState => plan.get(edgeKey(edge)) ?? "open";

/** Movement crosses `open` and `hatch`; only a solid `wall` stops a model. */
export const passable = (lattice:Lattice, plan:Map<string, EdgeState>, edge:LatticeEdge) =>
  !isBorderEdge(lattice, edge) && stateOf(plan, edge) !== "wall";

/** Sight crosses `open` alone. A hatchway panel is mostly solid and its door is
 *  closed until someone opens it, so for layout purposes it blocks. */
export const transparent = (lattice:Lattice, plan:Map<string, EdgeState>, edge:LatticeEdge) =>
  !isBorderEdge(lattice, edge) && stateOf(plan, edge) === "open";

/**
 * Connected groups of cells under a given edge predicate.
 *
 * Called with `passable` it answers "can a model get everywhere", which is the
 * invariant that matters most: a board with an unreachable compartment is not a
 * board. Called with `transparent` it gives the visually open rooms.
 */
export const cellRegions = (
  lattice:Lattice, plan:Map<string, EdgeState>,
  crossable:(lattice:Lattice, plan:Map<string, EdgeState>, edge:LatticeEdge) => boolean,
) => {
  const total = lattice.cols * lattice.rows;
  const label = new Int32Array(total).fill(-1);
  const sizes:number[] = [];
  const index = (cell:LatticeCell) => cell.row * lattice.cols + cell.col;
  for (let start = 0; start < total; start++) {
    if (label[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const queue:LatticeCell[] = [{ col:start % lattice.cols, row:Math.floor(start / lattice.cols) }];
    label[start] = id;
    while (queue.length) {
      const cell = queue.pop()!;
      size++;
      edgesOfCell(cell).forEach((edge) => {
        if (!crossable(lattice, plan, edge)) return;
        const other = cellsOfEdge(lattice, edge).find((candidate) => candidate && !(candidate.col === cell.col && candidate.row === cell.row));
        if (!other) return;
        if (label[index(other)] !== -1) return;
        label[index(other)] = id;
        queue.push(other);
      });
    }
    sizes.push(size);
  }
  return { label, sizes, index };
};

/** Every cell reachable from every other. The one non-negotiable invariant. */
export const fullyConnected = (lattice:Lattice, plan:Map<string, EdgeState>) =>
  cellRegions(lattice, plan, passable).sizes.length === 1;

// ---------------------------------------------------------------------------
// Sight lines
// ---------------------------------------------------------------------------

/**
 * How far a model in each cell can see along the two axes, in cells.
 *
 * A Zone Mortalis board is only doing its job if you cannot see across the
 * table, so this is the metric worth keeping down. Reported as both the mean and
 * the worst case: the mean describes the board's character, and the maximum
 * catches the one firing lane running the full length of it that a good mean can
 * otherwise hide.
 */
export const sightLines = (lattice:Lattice, plan:Map<string, EdgeState>) => {
  let total = 0;
  let longest = 0;
  for (let row = 0; row < lattice.rows; row++) for (let col = 0; col < lattice.cols; col++) {
    let seen = 0;
    let east = 0, west = 0, south = 0, north = 0;
    for (let step = col + 1; step <= lattice.cols && transparent(lattice, plan, { axis:"v", col:step, row }); step++) east++;
    for (let step = col; step >= 0 && transparent(lattice, plan, { axis:"v", col:step, row }); step--) west++;
    for (let step = row + 1; step <= lattice.rows && transparent(lattice, plan, { axis:"h", col, row:step }); step++) south++;
    for (let step = row; step >= 0 && transparent(lattice, plan, { axis:"h", col, row:step }); step--) north++;
    seen = east + west + south + north;
    total += seen;
    longest = Math.max(longest, east + west + 1, south + north + 1);
  }
  const cells = lattice.cols * lattice.rows;
  return { mean:cells ? total / cells : 0, longest };
};

// ---------------------------------------------------------------------------
// Pitch
// ---------------------------------------------------------------------------

/**
 * Whether a pitch can actually be assembled from a panel and a column.
 *
 * Two conditions, and they bracket the pitch from both sides:
 *
 *   pitch >= panel                   the panel has to fit in the square at all
 *   pitch <= panel + column          the panel has to REACH the columns
 *
 * The upper bound is where the two kits differ, and it is why it is an inequality
 * rather than an equation. Gallowdark sits strictly inside it: the panel slots into
 * a column straddling the corner, so it overlaps the column at each end. Iron
 * Labyrinth sits exactly on it: the wall butts up between two connector blocks, so
 * a 64 mm wall on a 114 mm pitch with 50 mm connectors leaves precisely zero
 * overlap. Both are real joints, so contact counts as buildable and only a genuine
 * gap does not.
 *
 * The 125 mm Gallowdark pitch failed this by 0.67" — a 3.15" panel and a 1.10"
 * column cannot span 4.92" between them, whatever order you assemble them in.
 */
export const pitchIsBuildable = (panelLength:number, pitch:number, columnWidth:number, jointSlack=0) =>
  pitch >= panelLength - 1e-6 && pitch <= panelLength + columnWidth + jointSlack + 1e-6;

/**
 * How far a panel end reaches into the column at each end of its span.
 *
 * Positive is a slotted joint, zero is a butt joint, and negative is a panel with
 * its end hanging in mid-air — which is unbuildable, and was the state of every
 * board the previous generator produced.
 */
export const columnBite = (panelLength:number, pitch:number, columnWidth:number) =>
  columnWidth / 2 - (pitch - panelLength) / 2;
