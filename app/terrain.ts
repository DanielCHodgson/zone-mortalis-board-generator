/**
 * The physical terrain catalogue: what the kits actually contain, and how big it is.
 *
 * Extracted from the UI so the generator tests import the same numbers the app
 * draws. The previous suite hard-coded its own inventory literals, which meant a
 * data error and a test could never disagree.
 */

export type TerrainDef = {
  id: string;
  catalogue: "boarding" | "mortalis" | "deathray" | "ttcombat" | "eberleg";
  name: string;
  shortName: string;
  width: number;
  depth: number;
  height: number;
  limit: number;
  kind: "wall" | "door" | "pillar" | "connector" | "end" | "floor" | "stair" | "scatter";
  /** Node-to-node span for kits on a fixed assembly grid. Authoritative for
   *  spacing; the piece is drawn centred inside it. */
  span?: number;
  /** Pillars moulded into the piece, at 0, 1 or 2 of its ends. */
  ownColumns?: 0 | 1 | 2;
  /**
   * For a HUB kit only (see EBERLEG_GRID): which node this piece is the casting
   * for, as the arrangement of wall arms moulded onto its hub.
   *
   *   column    no arms — a bare node
   *   stub      one arm — a run stops here
   *   straight  two arms, opposite — a run passes through
   *   corner    two arms, adjacent — a run turns
   *   t         three arms
   *   cross     four arms
   *
   * Undefined on every piece in every other catalogue, where a column is
   * direction-agnostic and stands at any node.
   */
  shape?: "column" | "stub" | "straight" | "corner" | "t" | "cross";
  /**
   * A hub kit's filler panel, covering HALF an edge — the span between one hub's
   * face and the midpoint of the gap, where the facing hub's arm would otherwise
   * reach. Two of them, or one plus an arm, make a whole edge.
   */
  halfEdge?: boolean;
  /**
   * Size tier, which decides where a scatter piece may stand.
   *
   * A Gallowdark corridor gives 69 mm of clear opening between pillars, so a piece
   * much over 50 mm across makes it awkward to move a model through. Small goes
   * anywhere, medium in rooms and reserved halls, large only in halls — which is
   * what the reserved-zone tool is for.
   */
  scatter?: "small" | "medium" | "large";
  visual?: "solid" | "grid" | "pipe" | "vertical-pipe" | "reinforced" | "fan" | "floor" | "stair" | "door"
    | "crate" | "barrel" | "barricade" | "console" | "machinery" | "container" | "tank" | "pipes"
    | "corner" | "t-junction";
  note: string;
};

export type CatalogueId = TerrainDef["catalogue"];

export type TerrainKit = {
  id: string;
  catalogue: CatalogueId;
  maker: string;
  name: string;
  description: string;
  source: string;
  sourceUrl: string;
  inventory: Record<string, number>;
  caveat?: string;
};


export const MM_PER_IN = 25.4;
// Gallowdark lays out as a grid of squares — the killzone board is 6 x 7 of them
// — with each square one wall panel on a side and a pillar straddling every
// corner, overlapping equally into both squares.
//
// THE PITCH IS THE PANEL LENGTH. The pillar straddles the corner rather than
// sitting inside the square, so a bare 80 mm panel bridges the 69 mm opening
// between two pillars and slots ~5.5 mm into each. Confirmed two ways: the terrain
// is documented as designed around a 97 x 97 mm tile on a 6 x 7 grid, and the
// 704 x 607 mm card board is exactly 7 x 97 + 25 by 6 x 97 + 25 — a 12.5 mm border,
// on both axes.
//
// A previous version set this to 125 mm on the theory that the pitch was panel plus
// pillar. It is not, and the consequences were structural rather than cosmetic:
// panel ends landed 0.256" short of the pillars they clip into, so every pillar was
// orphaned and swept away, and the cleanup pass then deleted walls to reopen the
// regions that sweep had sealed. Boards came out as six panels and no pillars. The
// invariant that catches it now lives in lattice.ts:
//
//     panel_length <= pitch <= panel_length + pillar_width
export const GALLOWDARK_GRID = 97/25.4;

// Zone Mortalis — the Necromunda range the project is named after — is a DIFFERENT
// system from Gallowdark, on half the pitch. Its column straddles the intersection
// exactly as Gallowdark's pillar does, so the same `span` semantics apply; only the
// number changes.
//
// THE PITCH IS 50 MM, and three independent readings agree on it:
//
//   - The floor tile is 289 mm square over a 6 x 6 grid. The printed square measures
//     43 mm with a ~7 mm spacer between squares, and 43 + 7 = 50: the columns sit on
//     the spacer lines, not inside the squares.
//   - The kit pairs each piece type in a 1:2 ratio — a 50 mm standard wall and a
//     95 mm wide wall, a 50 mm standard door and a 95 mm wide door. A 1:2 ratio is
//     only meaningful against a module, and 95 <= 2 x 50 with 5 mm of slot to spare.
//   - Death Ray Designs, an independent range built for the same GW tiles, lands on
//     a flat 2 inch column and 2 inch single wall.
//
// Note that 289/6 = 48.16 mm, so the walls do NOT register to the tile edge — five
// and a bit modules cross a tile. That is correct for the real terrain: the columns
// are placed by eye on the printed grid, they do not clip to it.
export const MORTALIS_GRID = 50/25.4;
// Death Ray Designs' Deadbolt's Derelict works the same joint on a flat 2 inch
// module: a 2 x 2 in column straddling the node, a 2 in single wall spanning one
// module, and a 3.7 in double wall spanning two (94 mm into a 101.6 mm span, so it
// bites 3.8 mm into the column at each end). Kept as its own catalogue rather than
// folded into `mortalis` because 50.8 vs 50 mm drifts a full 8 mm over ten bays —
// close enough to mix by hand on a real table, not close enough to put on one
// lattice.
export const DEATHRAY_GRID = 50.8/25.4;
// Eberleg's "Zone Mortalis Terrain Pieces" is a free, print-your-own STL kit
// (Thingiverse thing:2609090/2609112) — a third, unrelated range that happens to
// share this project's name. It is designed around a 6" x 6" printed floor tile
// (measured 152.40 mm square on the model, exactly 6.000 in).
//
// THE PITCH IS 152.4 MM — the full tile edge, and the full "Straight" wall's own
// measured length with ZERO slack — because that is where the kit's real columns
// stand: at the CORNERS of a floor tile, six inches apart, not at some
// in-between point invented to give the tiler more panels to choose from.
//
// Two earlier attempts got this wrong in the same direction, and it is worth
// recording why so it does not happen a third time. The first pass took the
// pitch from the door bulkhead (52.8 mm) because it was the tightest-fitting
// piece; the second took it from half a floor tile (76.2 mm) after noticing the
// door and short wall both happened to fit there too. Both pitches pass every
// piece's own straddle test — `cellsThatFit` does not know what a corridor is
// for — but neither is where the kit's columns actually go, and the consequence
// was not cosmetic: a Zone Mortalis corridor needs room for a 32 mm base to
// walk through and more besides, and clear width is `pitch - support`. At
// 76.2 mm that was 24.3 mm — not even one model wide. At the correct 152.4 mm
// pitch it is 152.4 - 51.91 = 100.5 mm, 3.96 in, which is what a playable
// corridor with headroom for wider machinery bays actually requires.
//
// THIS KIT DOES NOT PUT PANELS ON EDGES. Every piece in it is a NODE piece: a
// column hub with between zero and three arms of wall moulded onto its faces.
// Three earlier passes missed this and tried to read the pieces as edge panels,
// which is why each of them produced a different wrong pitch and, in the last
// one, corner and T castings that visibly collided with the panels either side.
//
// The proof is in the STL coordinates, which all share ONE origin across the
// files — so the pieces can be laid on top of each other and read directly.
// Every piece's hub is the same box, and every arm is the same length:
//
//   piece                bbox              reach W / E / N / S      arms
//   ZM_Collumn           51.91 x 51.91     26 / 26 / 26 / 26        none
//   ZM_..._Short_A       102.16 x 51.91    26 / 76 / 26 / 26        one   (stub)
//   ZM_..._Straight_A    152.40 x 51.91    76 / 76 / 26 / 26        two, opposite
//   ZM_Wall_Corner_A     102.16 x 102.16   76 / 26 / 26 / 76        two, adjacent (L)
//   ZM_Wall_T-Inter._A   152.40 x 102.16   76 / 76 / 26 / 76        three (T)
//
// Hub half-width is 25.955 mm — half of the 51.91 mm column — and an arm reaches
// 76.2 mm, which is exactly HALF the 152.4 mm pitch. That is the whole system,
// and it closes exactly: two hubs a pitch apart leave 152.4 - 51.91 = 100.49 mm
// of clear gap between their faces, and the two arms facing each other across it
// are 50.245 mm each, so they meet in the middle with nothing left over.
//
// So an edge on this lattice is walled when BOTH of its end hubs point an arm at
// it, and a node's piece is chosen by which of its four directions are walled —
// nothing else. `build.ts` has a dedicated `buildHub` pass for exactly this, and
// `MANUFACTURERS.eberleg.joint` is "hub" to select it.
//
// The three remaining pieces are the fillers for the case a hub cannot serve a
// direction (it ran out, or four runs meet and the kit has no cross casting).
// Their sizes are the same arithmetic from the other side:
//
//   ZM_Wall_Single_008     50.80 mm   one arm's worth — half an edge
//   ZM_Door_Single_Bulk.   52.80 mm   half an edge, with a door in it
//   ZM_Door_Double_Bulk.  103.60 mm   a whole edge's 100.49 mm gap, with a door
//
// A doorway is always a filler, never an arm, because an arm is solid wall: the
// hubs either side of a hatchway deliberately do NOT extend arms into it, and
// the bulkhead stands in the gap they leave. That is how the real kit is built.
export const EBERLEG_GRID = 152.4/25.4;
/** Hub half-width and arm reach, in inches — see the note above. */
export const EBERLEG_HUB = 51.91/25.4;
export const EBERLEG_ARM = 76.2/25.4;
export const BOARD_SIZES = {
  // The card board that ships in the box: 704 x 607 mm. It is a 7 x 6 grid of
  // 97 mm squares with a 12.5 mm border, which checks exactly — 7 x 97 = 679 and
  // 6 x 97 = 582, leaving 25 mm on each axis. Listed first because it is the board
  // the kit is cut for, and one set fills it at real density.
  "card": { width:704/25.4, height:607/25.4, label:"27.7″ × 23.9″ · one card board" },
  // Two card boards, which is the published Boarding Actions play area and wants
  // two sets.
  "cardx2": { width:1408/25.4, height:607/25.4, label:"55.4″ × 23.9″ · two card boards" },
  "30x22": { width:30, height:22, label:"30″ × 22″" },
  "24x24": { width:24, height:24, label:"2′ × 2′" },
  "48x24": { width:48, height:24, label:"4′ × 2′" },
  "48x48": { width:48, height:48, label:"4′ × 4′" },
  "60x48": { width:60, height:48, label:"5′ × 4′" },
} as const;
export type BoardPreset = keyof typeof BOARD_SIZES;
export const PALETTE_STORAGE_KEY = "mortalis-architect-terrain-palette-v4";
export const BOARD_STORAGE_KEY = "mortalis-architect-board-size-v1";
export const APPEARANCE_STORAGE_KEY = "mortalis-architect-appearance-v1";

/** The interface colour palette. Separate from the board STYLE, which describes
 *  what the terrain is made of, not how the app is lit. */
export type Appearance = "dark" | "light";

/**
 * `joint` is the assembly model, and it is the only structural difference between
 * the catalogues that the app's snapping has to care about:
 *
 *   straddle — the column sits ON the node, overlapping both squares, and the panel
 *              slots into it. Pitch = panel length. Gallowdark, Zone Mortalis and
 *              Deadbolt's Derelict all work this way.
 *   butt     — the panel butts BETWEEN two connectors. Pitch = panel + connector.
 *              Iron Labyrinth works this way.
 *   hub      — there are no edge panels at all. Every piece stands on a NODE and
 *              carries its own half-length arms of wall; an edge is walled when
 *              the hubs at both its ends point an arm along it. Pitch = arm x 2 +
 *              column. Eberleg works this way — see EBERLEG_GRID above.
 *
 * Two entries share the maker name "Games Workshop", so anything listing
 * manufacturers must show the range too or the two are indistinguishable.
 */
export const MANUFACTURERS: Record<CatalogueId, { name:string; range:string; joint:"straddle" | "butt" | "hub" }> = {
  boarding: { name:"Games Workshop", range:"Boarding Actions", joint:"straddle" },
  mortalis: { name:"Games Workshop", range:"Zone Mortalis", joint:"straddle" },
  deathray: { name:"Death Ray Designs", range:"Deadbolt's Derelict", joint:"straddle" },
  ttcombat: { name:"TTCombat", range:"Iron Labyrinth", joint:"butt" },
  eberleg: { name:"Eberleg", range:"Zone Mortalis Terrain Pieces (print-it-yourself)", joint:"hub" },
} as const;

// Quantities are the verified contents of the Boarding Actions Terrain Set: 68
// pieces, 32 of them panels, of which 20 carry a hatchway. That last ratio matters
// more than it looks — hatchways are the kit's PRIMARY building material, not a
// garnish, and a generator that treats them as a rare exception is fighting the box
// by a factor of five.
//
// The "+ pillars" variants are exactly one grid square wide against the bare
// panel's 80 mm, which says their moulded pillars sit inside the span: half a pillar
// at each end, with the neighbouring piece supplying the other half. Whether the
// moulding is at one end or both is one look at a real panel; only the tiler's
// preference order depends on the answer.
export const TERRAIN: TerrainDef[] = [
  { id:"short-door-pillars-a", catalogue:"boarding", name:"Short hatchway + pillars A", shortName:"Hatch A", width:97/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"door", span:GALLOWDARK_GRID, ownColumns:2, note:"97 × 5.5 mm · one square" },
  { id:"short-door-pillars-b", catalogue:"boarding", name:"Short hatchway + pillars B", shortName:"Hatch B", width:97/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"door", span:GALLOWDARK_GRID, ownColumns:2, note:"97 × 5.5 mm · one square" },
  { id:"short-door", catalogue:"boarding", name:"Short wall with hatchway", shortName:"Short hatch", width:80/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"door", span:GALLOWDARK_GRID, note:"80 × 5.5 mm" },
  { id:"long-door-pillars", catalogue:"boarding", name:"Long hatchway + pillars", shortName:"Long hatch +", width:194/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"door", span:GALLOWDARK_GRID*2, ownColumns:2, note:"194 × 5.5 mm · two squares" },
  { id:"long-door", catalogue:"boarding", name:"Long wall with hatchway", shortName:"Long hatch", width:176/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"door", span:GALLOWDARK_GRID*2, note:"176 × 5.5 mm" },
  { id:"long-wall-pillars", catalogue:"boarding", name:"Long wall + pillars", shortName:"Long wall +", width:194/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", span:GALLOWDARK_GRID*2, ownColumns:2, note:"194 × 5.5 mm · two squares" },
  { id:"long-wall", catalogue:"boarding", name:"Long wall", shortName:"Long wall", width:176/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", span:GALLOWDARK_GRID*2, note:"176 × 5.5 mm" },
  { id:"short-wall", catalogue:"boarding", name:"Short wall", shortName:"Short wall", width:80/MM_PER_IN, depth:5.5/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", span:GALLOWDARK_GRID, note:"80 × 5.5 mm" },
  // The Gallowdark pillar is 28 x 25 mm and NOT square, so it has an orientation:
  // the builder turns its long side along whichever axis carries more of the panels
  // meeting at that corner.
  { id:"pillar", catalogue:"boarding", name:"Pillar", shortName:"Pillar", width:28/MM_PER_IN, depth:25/MM_PER_IN, height:60/MM_PER_IN, limit:32, kind:"pillar", note:"28 × 25 mm" },
  { id:"wall-end", catalogue:"boarding", name:"Wall end", shortName:"Wall end", width:25/MM_PER_IN, depth:14/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"end", note:"25 × 14 mm approx." },

  // ---------------------------------------------------------------------------
  // Scatter
  //
  // Games Workshop publishes no dimensions for any of this, so these are DESIGN
  // APPROXIMATIONS from a sizing reference rather than measurements — treat them as
  // ranges, and correct any piece you own with a caliper.
  //
  // The tiers are what matter, because they decide where a piece may be placed. A
  // Gallowdark corridor is 97 mm between pillar centres and 69 mm of clear opening,
  // so anything much over 50 mm across turns a corridor into a squeeze. Hence:
  // small scatter anywhere, medium in rooms, and the large line-of-sight blockers
  // only in a reserved hall — which is exactly what the zone tool is for.
  { id:"scatter-ammo-crate", catalogue:"boarding", name:"Ammo crate", shortName:"Ammo crate", width:25/MM_PER_IN, depth:25/MM_PER_IN, height:20/MM_PER_IN, limit:0, kind:"scatter", scatter:"small", visual:"crate", note:"25 × 25 mm · fits anywhere" },
  { id:"scatter-barrel", catalogue:"boarding", name:"Promethium barrel", shortName:"Barrel", width:25/MM_PER_IN, depth:25/MM_PER_IN, height:38/MM_PER_IN, limit:0, kind:"scatter", scatter:"small", visual:"barrel", note:"Ø25 × 38 mm · fits anywhere" },
  { id:"scatter-crate", catalogue:"boarding", name:"Cargo crate", shortName:"Cargo crate", width:40/MM_PER_IN, depth:40/MM_PER_IN, height:35/MM_PER_IN, limit:0, kind:"scatter", scatter:"small", visual:"crate", note:"40 × 40 mm · fits anywhere" },
  { id:"scatter-console", catalogue:"boarding", name:"Control console", shortName:"Console", width:50/MM_PER_IN, depth:30/MM_PER_IN, height:35/MM_PER_IN, limit:0, kind:"scatter", scatter:"medium", visual:"console", note:"50 × 30 mm · rooms and halls" },
  { id:"scatter-generator", catalogue:"boarding", name:"Generator", shortName:"Generator", width:60/MM_PER_IN, depth:50/MM_PER_IN, height:55/MM_PER_IN, limit:0, kind:"scatter", scatter:"medium", visual:"machinery", note:"60 × 50 mm · rooms and halls" },
  { id:"scatter-barricade", catalogue:"boarding", name:"Barricade", shortName:"Barricade", width:90/MM_PER_IN, depth:30/MM_PER_IN, height:40/MM_PER_IN, limit:0, kind:"scatter", scatter:"medium", visual:"barricade", note:"90 × 30 mm · rooms and halls" },
  { id:"scatter-pipes", catalogue:"boarding", name:"Plasma conduit", shortName:"Conduit", width:90/MM_PER_IN, depth:35/MM_PER_IN, height:45/MM_PER_IN, limit:0, kind:"scatter", scatter:"medium", visual:"pipes", note:"90 × 35 mm · rooms and halls" },
  { id:"scatter-machinery", catalogue:"boarding", name:"Heavy machinery", shortName:"Machinery", width:90/MM_PER_IN, depth:75/MM_PER_IN, height:85/MM_PER_IN, limit:0, kind:"scatter", scatter:"large", visual:"machinery", note:"90 × 75 mm · halls only" },
  { id:"scatter-container", catalogue:"boarding", name:"Munitorum container", shortName:"Container", width:120/MM_PER_IN, depth:60/MM_PER_IN, height:60/MM_PER_IN, limit:0, kind:"scatter", scatter:"large", visual:"container", note:"120 × 60 mm · halls only" },
  { id:"scatter-tank", catalogue:"boarding", name:"Storage tank", shortName:"Storage tank", width:90/MM_PER_IN, depth:110/MM_PER_IN, height:120/MM_PER_IN, limit:0, kind:"scatter", scatter:"large", visual:"tank", note:"90 × 110 mm · halls only" },

  // ---------------------------------------------------------------------------
  // Zone Mortalis (Games Workshop, Necromunda)
  //
  // Pitch 50 mm — see MORTALIS_GRID above. The set is 6 columns, 4 standard walls,
  // 1 wide wall, 2 standard doors and 2 wide doors, which is 3 column sprues, a
  // small-wall sprue, a long-wall sprue and a door sprue. The sprue naming is what
  // settles which of the two wall lengths is "standard": the four come off the SMALL
  // wall sprue, so standard is the one-module 50 mm piece and wide is the two-module
  // 95 mm one. Doors come one of each width, two apiece.
  //
  // Panel thickness is not published for this range. 10 mm is taken from the visible
  // proportion of the wall against its 50 mm column and is the one figure here that
  // is an estimate rather than a reading — it affects only how thick the wall draws,
  // never where it sits.
  { id:"zm-column", catalogue:"mortalis", name:"Zone Mortalis column", shortName:"ZM column", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:6, kind:"pillar", note:"50 × 50 mm · chamfered corners" },
  { id:"zm-wall", catalogue:"mortalis", name:"Zone Mortalis standard wall", shortName:"ZM wall", width:50/MM_PER_IN, depth:10/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", span:MORTALIS_GRID, visual:"solid", note:"50 × 60 mm · one square" },
  { id:"zm-wide-wall", catalogue:"mortalis", name:"Zone Mortalis wide wall", shortName:"ZM wide wall", width:95/MM_PER_IN, depth:10/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"wall", span:MORTALIS_GRID*2, visual:"reinforced", note:"95 × 60 mm · two squares" },
  { id:"zm-door", catalogue:"mortalis", name:"Zone Mortalis standard door", shortName:"ZM door", width:50/MM_PER_IN, depth:10/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", span:MORTALIS_GRID, visual:"door", note:"50 × 60 mm · one square" },
  { id:"zm-wide-door", catalogue:"mortalis", name:"Zone Mortalis wide door", shortName:"ZM wide door", width:95/MM_PER_IN, depth:10/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", span:MORTALIS_GRID*2, visual:"door", note:"95 × 60 mm · two squares" },

  // ---------------------------------------------------------------------------
  // Deadbolt's Derelict (Death Ray Designs, MDF)
  //
  // The one range here whose dimensions the maker publishes outright, in inches:
  // 2 x 2 x 2.75 in columns, 1.3 x 2 x 2.75 in single walls, 1.3 x 3.7 x 2.75 in
  // doubles. Taller than the GW ranges at 70 mm, and much thicker at 33 mm, because
  // MDF walls are built as a laminated box rather than moulded as a panel.
  { id:"drd-column", catalogue:"deathray", name:"Corridor column", shortName:"DRD column", width:50.8/MM_PER_IN, depth:50.8/MM_PER_IN, height:70/MM_PER_IN, limit:24, kind:"pillar", note:"2″ × 2″ × 2.75″" },
  { id:"drd-single-wall", catalogue:"deathray", name:"Corridor single wall", shortName:"DRD single", width:50.8/MM_PER_IN, depth:33/MM_PER_IN, height:70/MM_PER_IN, limit:20, kind:"wall", span:DEATHRAY_GRID, visual:"solid", note:"2″ long · one module" },
  { id:"drd-double-wall", catalogue:"deathray", name:"Corridor double wall", shortName:"DRD double", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:70/MM_PER_IN, limit:18, kind:"wall", span:DEATHRAY_GRID*2, visual:"reinforced", note:"3.7″ long · two modules" },
  // The door set is the weakest data in this file. Death Ray Designs lists the narrow
  // door with the same 1.3 x 3.7 x 2.75 in figures as the double wall, which cannot be
  // right for a piece described as narrow, and gives nothing for the wide door. What
  // is certain is the count — five wide, two narrow — and that they are "fully
  // compatible with the main set", which on a 2 in module can only mean they occupy
  // the same one- and two-module widths as the walls. Encoded that way: narrow = one
  // module, wide = two. Correct with a ruler if you buy the set.
  { id:"drd-narrow-door", catalogue:"deathray", name:"Corridor narrow door", shortName:"DRD narrow door", width:50.8/MM_PER_IN, depth:33/MM_PER_IN, height:70/MM_PER_IN, limit:2, kind:"door", span:DEATHRAY_GRID, visual:"door", note:"one module · width inferred" },
  { id:"drd-wide-door", catalogue:"deathray", name:"Corridor wide door", shortName:"DRD wide door", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:70/MM_PER_IN, limit:5, kind:"door", span:DEATHRAY_GRID*2, visual:"door", note:"two modules · width inferred" },

  // ---------------------------------------------------------------------------
  // Eberleg's Zone Mortalis Terrain Pieces (print-your-own STL, Thingiverse)
  //
  // A HUB kit — read the note on EBERLEG_GRID above before changing anything
  // here, because none of these are edge panels and three earlier passes came
  // unstuck assuming they were. Every `pillar` below stands on a NODE and brings
  // its own arms of wall; `shape` says which arms, and that is what decides the
  // node it belongs at. Every figure is a bounding-box measurement taken off the
  // STL mesh. Height is 63.50 mm (2.5 in exactly) throughout.
  { id:"eb-column", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) column", shortName:"Eb column", width:51.91/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:24, kind:"pillar", shape:"column", note:"51.9 x 51.9 mm - bare hub, no arms" },
  { id:"eb-stub", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) short wall", shortName:"Eb stub", width:102.16/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:8, kind:"pillar", shape:"stub", visual:"solid", note:"102.16 x 51.9 mm - hub + one arm, where a run stops" },
  { id:"eb-wall", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) straight wall", shortName:"Eb wall", width:152.40/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:16, kind:"pillar", shape:"straight", visual:"solid", note:"152.4 x 51.9 mm - hub + two opposite arms, a run passing through" },
  { id:"eb-corner", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) corner", shortName:"Eb corner", width:102.16/MM_PER_IN, depth:102.16/MM_PER_IN, height:63.5/MM_PER_IN, limit:6, kind:"pillar", shape:"corner", visual:"corner", note:"102.16 x 102.16 mm - hub + two arms at 90 degrees, an L" },
  { id:"eb-t-intersection", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) T-intersection", shortName:"Eb T-piece", width:152.40/MM_PER_IN, depth:102.16/MM_PER_IN, height:63.5/MM_PER_IN, limit:4, kind:"pillar", shape:"t", visual:"t-junction", note:"152.4 x 102.16 mm - hub + three arms, a T" },

  // The fillers. These DO sit on an edge, and they exist for the two cases a hub
  // cannot serve: a direction whose hub casting has run out, and a doorway --
  // which is never an arm, because an arm is solid wall, so the hubs either side
  // leave the gap open and a bulkhead stands in it.
  //
  // The bulkhead prints as a FRAME plus a separate sliding door LEAF; only the
  // frame is catalogued, since the leaf rides inside a frame already on the
  // board rather than being placed itself. Depth is carried as the wall's own
  // 51.91 mm rather than the frame's measured 43.97 mm opening, so a door draws
  // flush with the runs either side instead of reading as a step in the wall.
  { id:"eb-single-wall", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) single wall", shortName:"Eb single wall", width:50.8/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:4, kind:"wall", halfEdge:true, visual:"solid", note:"50.8 x 51.9 mm - one arm's worth, fills half an edge" },
  { id:"eb-single-door", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) single bulkhead", shortName:"Eb single door", width:52.80/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:2, kind:"door", halfEdge:true, visual:"door", note:"52.8 x 51.9 mm - half an edge, with a door in it" },
  { id:"eb-wide-door", catalogue:"eberleg", name:"Zone Mortalis (Eberleg) double bulkhead", shortName:"Eb door", width:103.60/MM_PER_IN, depth:51.91/MM_PER_IN, height:63.5/MM_PER_IN, limit:2, kind:"door", span:EBERLEG_GRID, visual:"door", note:"103.6 x 51.9 mm - a whole edge's 100.49 mm gap, with a door in it" },

  { id:"tt-connector", catalogue:"ttcombat", name:"Iron Labyrinth connector block", shortName:"Connector", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:24, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-wall-end", catalogue:"ttcombat", name:"Iron Labyrinth wall end", shortName:"Wall end", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:21, kind:"end", note:"46 × 33 mm" },
  { id:"tt-solid-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid wall", shortName:"Solid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:8, kind:"wall", visual:"solid", note:"64 × 33 mm" },
  { id:"tt-grid-wall", catalogue:"ttcombat", name:"Iron Labyrinth grid wall", shortName:"Grid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"grid", note:"64 × 33 mm" },
  { id:"tt-solid-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid pipe wall", shortName:"Solid pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"pipe", note:"64 × 33 mm" },
  { id:"tt-vertical-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth vertical pipe wall", shortName:"Vertical pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"vertical-pipe", note:"64 × 33 mm" },
  { id:"tt-reinforced-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth reinforced pipe wall", shortName:"Reinforced", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"reinforced", note:"64 × 33 mm" },
  { id:"tt-fan-wall", catalogue:"ttcombat", name:"Iron Labyrinth fan wall", shortName:"Fan wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"fan", note:"64 × 33 mm" },
  // Unlike the 64 mm wall panels, these door frames overlap the 50 mm connector
  // blocks rather than butting between them. Their published 94/194 mm widths fit
  // one/two cells on the range's 114 mm connector-centre grid respectively.
  // Without an explicit span the kit reader treated them as 144/244 mm modules and
  // excluded both before the builder ever saw the palette.
  { id:"tt-vertical-door", catalogue:"ttcombat", name:"Iron Labyrinth vertical door", shortName:"Vertical door", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:120/MM_PER_IN, limit:2, kind:"door", span:114/MM_PER_IN, visual:"door", note:"94 × 33 mm · one 114 mm module" },
  { id:"tt-sliding-door", catalogue:"ttcombat", name:"Iron Labyrinth sliding door", shortName:"Sliding door", width:194/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", span:228/MM_PER_IN, visual:"door", note:"194 × 50 mm · two 114 mm modules" },
  { id:"tt-large-floor", catalogue:"ttcombat", name:"Iron Labyrinth large floor", shortName:"Large floor", width:194/MM_PER_IN, depth:194/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"floor", visual:"floor", note:"194 × 194 mm" },
  { id:"tt-small-floor", catalogue:"ttcombat", name:"Iron Labyrinth small floor", shortName:"Small floor", width:94/MM_PER_IN, depth:94/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"floor", visual:"floor", note:"94 × 94 mm" },
  { id:"tt-high-connector", catalogue:"ttcombat", name:"Iron Labyrinth high column", shortName:"High column", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:120/MM_PER_IN, limit:3, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-high-wall", catalogue:"ttcombat", name:"Iron Labyrinth high wall", shortName:"High wall", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:120/MM_PER_IN, limit:5, kind:"wall", visual:"reinforced", note:"94 × 33 mm" },
  { id:"tt-stair", catalogue:"ttcombat", name:"Iron Labyrinth stair section", shortName:"Stair section", width:94/MM_PER_IN, depth:160/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"stair", visual:"stair", note:"94 × 160 mm" },
  { id:"tt-dq-column", catalogue:"ttcombat", name:"Death Quadrant column", shortName:"DQ column", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:11, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-dq-single-wall", catalogue:"ttcombat", name:"Death Quadrant single wall", shortName:"Single wall", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", visual:"grid", note:"46 × 33 mm" },
  { id:"tt-dq-double-wall", catalogue:"ttcombat", name:"Death Quadrant double wall", shortName:"Double wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:4, kind:"wall", visual:"reinforced", note:"64 × 33 mm" },
  { id:"tt-dq-single-door", catalogue:"ttcombat", name:"Death Quadrant single door", shortName:"Single door", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"46 × 33 mm · module width" },
  { id:"tt-dq-double-door", catalogue:"ttcombat", name:"Death Quadrant double door", shortName:"Double door", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:1, kind:"door", visual:"door", note:"64 × 33 mm · module width" },
];

export const BOARDING_INVENTORY = Object.fromEntries(TERRAIN.filter((item) => item.catalogue === "boarding").map((item) => [item.id, item.limit]));

export const TERRAIN_KITS: TerrainKit[] = [
  { id:"boarding-actions", catalogue:"boarding", maker:"Games Workshop", name:"Boarding Actions Terrain Set", description:"Complete Gallowdark wall and hatchway set", source:"Physical-kit measurements and assembly instructions", sourceUrl:"https://buildinstructions.com/pdf-downloads/Boarding-Actions-Terrain-Set.pdf", inventory:BOARDING_INVENTORY },
  { id:"zm-columns-and-walls", catalogue:"mortalis", maker:"Games Workshop", name:"Zone Mortalis: Columns & Walls", description:"Six columns, five walls and four doors on a 50 mm module", source:"GW published contents; wall and column sizes from community measurement of the range", sourceUrl:"https://www.warhammer.com/en-US/shop/Zone-Mortalis-Columns-And-Walls-2020", inventory:{ "zm-column":6, "zm-wall":4, "zm-wide-wall":1, "zm-door":2, "zm-wide-door":2 }, caveat:"Games Workshop publishes the contents but no dimensions. The 50 mm column, 50 mm standard and 95 mm wide panels are community measurements that three sources agree on; the 10 mm panel thickness is an estimate. The sprues also carry terminals, tanks and pipe connectors that GW does not itemise and nobody has measured — omitted rather than guessed." },
  { id:"drd-corridors", catalogue:"deathray", maker:"Death Ray Designs", name:"Deadbolt's Derelict: Corridors Bundle", description:"24 columns, 20 single and 18 double walls, sized for the GW Underhive tiles", source:"Maker-published dimensions", sourceUrl:"https://deathraydesigns.com/product/deadbolts-derelict-corridors-bundle/", inventory:{ "drd-column":24, "drd-single-wall":20, "drd-double-wall":18 } },
  { id:"drd-doors", catalogue:"deathray", maker:"Death Ray Designs", name:"Deadbolt's Derelict: Door Set", description:"Five wide and two narrow doors, each a door in a wall section", source:"Maker-published contents; widths inferred from the module", sourceUrl:"https://deathraydesigns.com/product/deadbolts-derelict-door-set/", inventory:{ "drd-wide-door":5, "drd-narrow-door":2 }, caveat:"Death Ray Designs lists the narrow door with the double wall's dimensions, which cannot be right, and gives none for the wide door. Widths here are inferred from the range's own 2″ module — see terrain.ts." },
  { id:"iron-alpha", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Alpha", description:"Lattice and solid-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-alpha", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-grid-wall":2, "tt-solid-pipe-wall":2 } },
  { id:"iron-beta", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Beta", description:"Solid and reinforced wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-beta", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-solid-wall":2, "tt-reinforced-pipe-wall":2 } },
  { id:"iron-gamma", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Gamma", description:"Fan and vertical-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-gamma", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-vertical-pipe-wall":2, "tt-fan-wall":2 } },
  { id:"iron-doors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Doors", description:"Two sliding and two removable vertical doors", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-doors", inventory:{ "tt-sliding-door":2, "tt-vertical-door":2 } },
  { id:"iron-floors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Floors", description:"One large and one small elevated floor", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-floors", inventory:{ "tt-large-floor":1, "tt-small-floor":1 } },
  { id:"iron-high-walls", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth High Walls", description:"Double-height walls and columns", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-high-walls", inventory:{ "tt-high-connector":3, "tt-high-wall":5 } },
  { id:"iron-stairs", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Stairs", description:"Two connector-compatible stair sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-stairs", inventory:{ "tt-stair":2 } },
  { id:"iron-death-quadrant", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth – Death Quadrant Complex", description:"Dimensioned columns, walls, and door modules", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-death-quadrant-complex", inventory:{ "tt-dq-column":11, "tt-dq-double-wall":4, "tt-dq-single-wall":4, "tt-dq-double-door":1, "tt-dq-single-door":2 }, caveat:"Platforms, tiles, ladders, and stairs are listed by TTCombat but omitted from the scaled palette because their footprints are not published." },
  { id:"iron-ultima", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Ultima Complex", description:"24 connectors, 21 ends, and 18 wall sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-bundle", inventory:{ "tt-connector":24, "tt-wall-end":21, "tt-solid-wall":8, "tt-grid-wall":2, "tt-solid-pipe-wall":2, "tt-vertical-pipe-wall":2, "tt-reinforced-pipe-wall":2, "tt-fan-wall":2 } },
  { id:"eberleg-all", catalogue:"eberleg", maker:"Eberleg", name:"Zone Mortalis Terrain Pieces (print files)", description:"Columns, corners, T-intersections, both wall lengths and both bulkheads — everything the print-your-own range holds", source:"Bounding-box measurement of the published STL meshes, across the range's three separate Thingiverse downloads (thing:2609090 walls/columns, thing:2609112 doors)", sourceUrl:"https://www.thingiverse.com/thing:2609090", inventory:{ "eb-column":16, "eb-stub":32, "eb-wall":24, "eb-corner":20, "eb-t-intersection":14, "eb-single-wall":16, "eb-single-door":6, "eb-wide-door":8 }, caveat:"Print-your-own kit, no fixed box count — quantities are a starting palette, sized here for a four-foot board. Unlike every other range here, these are NODE pieces: each column, stub, straight, corner and T casting carries its own half-length arms of wall. The starter palette favours proper short/stub castings at run ends; it does not manufacture them from a bare column plus a loose single wall. Loose singles are for the one node shape the range does not publish — a four-way crossing, built as a T plus one single — while bulkheads replace compatible wall spans." },
  // Not a real GW product — the scatter pieces above have no published kit to
  // belong to, and the "Available pieces" browser only ever shows what a selected
  // kit lists. Without an entry here the pieces exist in the catalogue but are
  // permanently unreachable from the UI. One of each small/medium type by default,
  // so a generated board has something to dress a room with immediately; the large
  // line-of-sight blockers are 0 by default since they need a reserved hall to
  // legally stand in.
  { id:"scatter-set", catalogue:"boarding", maker:"Design approximation", name:"Deck Scatter (unofficial)", description:"Crates, barrels, consoles and machinery sized from a community scale reference, not a published GW set", source:"Sized from Munitorum container and general 28-35mm scatter references — see terrain.ts", sourceUrl:"https://www.warhammer.com/en-GB/shop/Battlezone-Manufactorum-Munitorum-Armoured-Containers-2020", inventory:{ "scatter-ammo-crate":3, "scatter-barrel":3, "scatter-crate":2, "scatter-console":2, "scatter-generator":1, "scatter-barricade":2, "scatter-pipes":2, "scatter-machinery":0, "scatter-container":0, "scatter-tank":0 }, caveat:"Games Workshop has not published dimensions for Boarding Actions scatter terrain. These footprints are design approximations sized off the ~120 x 60 mm Munitorum container and general 28-35mm scale references — correct any piece you own with a caliper." },
];

export const getDef = (id: string) => TERRAIN.find((item) => item.id === id)!;
