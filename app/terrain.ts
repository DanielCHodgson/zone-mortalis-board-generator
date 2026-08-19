/**
 * The physical terrain catalogue: what the kits actually contain, and how big it is.
 *
 * Extracted from the UI so the generator tests import the same numbers the app
 * draws. The previous suite hard-coded its own inventory literals, which meant a
 * data error and a test could never disagree.
 */

export type TerrainDef = {
  id: string;
  catalogue: "boarding" | "ttcombat";
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
   * Size tier, which decides where a scatter piece may stand.
   *
   * A Gallowdark corridor gives 69 mm of clear opening between pillars, so a piece
   * much over 50 mm across makes it awkward to move a model through. Small goes
   * anywhere, medium in rooms and reserved halls, large only in halls — which is
   * what the reserved-zone tool is for.
   */
  scatter?: "small" | "medium" | "large";
  visual?: "solid" | "grid" | "pipe" | "vertical-pipe" | "reinforced" | "fan" | "floor" | "stair" | "door"
    | "crate" | "barrel" | "barricade" | "console" | "machinery" | "container" | "tank" | "pipes";
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
} as const;
export type BoardPreset = keyof typeof BOARD_SIZES;
export const PALETTE_STORAGE_KEY = "mortalis-architect-terrain-palette-v4";
export const BOARD_STORAGE_KEY = "mortalis-architect-board-size-v1";
export const APPEARANCE_STORAGE_KEY = "mortalis-architect-appearance-v1";

/** Light or dark for the interface as a whole. Separate from the board STYLE,
 *  which describes what the terrain is made of, not how the app is lit. */
export type Appearance = "light" | "dark";

export const MANUFACTURERS: Record<CatalogueId, { name:string; range:string }> = {
  boarding: { name:"Games Workshop", range:"Boarding Actions" },
  ttcombat: { name:"TTCombat", range:"Iron Labyrinth" },
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

  { id:"tt-connector", catalogue:"ttcombat", name:"Iron Labyrinth connector block", shortName:"Connector", width:50/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:24, kind:"connector", note:"50 × 50 mm" },
  { id:"tt-wall-end", catalogue:"ttcombat", name:"Iron Labyrinth wall end", shortName:"Wall end", width:46/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:21, kind:"end", note:"46 × 33 mm" },
  { id:"tt-solid-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid wall", shortName:"Solid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:8, kind:"wall", visual:"solid", note:"64 × 33 mm" },
  { id:"tt-grid-wall", catalogue:"ttcombat", name:"Iron Labyrinth grid wall", shortName:"Grid wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"grid", note:"64 × 33 mm" },
  { id:"tt-solid-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth solid pipe wall", shortName:"Solid pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"pipe", note:"64 × 33 mm" },
  { id:"tt-vertical-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth vertical pipe wall", shortName:"Vertical pipe", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"vertical-pipe", note:"64 × 33 mm" },
  { id:"tt-reinforced-pipe-wall", catalogue:"ttcombat", name:"Iron Labyrinth reinforced pipe wall", shortName:"Reinforced", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"reinforced", note:"64 × 33 mm" },
  { id:"tt-fan-wall", catalogue:"ttcombat", name:"Iron Labyrinth fan wall", shortName:"Fan wall", width:64/MM_PER_IN, depth:33/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"wall", visual:"fan", note:"64 × 33 mm" },
  { id:"tt-vertical-door", catalogue:"ttcombat", name:"Iron Labyrinth vertical door", shortName:"Vertical door", width:94/MM_PER_IN, depth:33/MM_PER_IN, height:120/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"94 × 33 mm" },
  { id:"tt-sliding-door", catalogue:"ttcombat", name:"Iron Labyrinth sliding door", shortName:"Sliding door", width:194/MM_PER_IN, depth:50/MM_PER_IN, height:60/MM_PER_IN, limit:2, kind:"door", visual:"door", note:"194 × 50 mm" },
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
  { id:"iron-alpha", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Alpha", description:"Lattice and solid-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-alpha", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-grid-wall":2, "tt-solid-pipe-wall":2 } },
  { id:"iron-beta", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Beta", description:"Solid and reinforced wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-beta", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-solid-wall":2, "tt-reinforced-pipe-wall":2 } },
  { id:"iron-gamma", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Gamma", description:"Fan and vertical-pipe wall sector", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-gamma", inventory:{ "tt-connector":5, "tt-wall-end":3, "tt-vertical-pipe-wall":2, "tt-fan-wall":2 } },
  { id:"iron-doors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Doors", description:"Two sliding and two removable vertical doors", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-doors", inventory:{ "tt-sliding-door":2, "tt-vertical-door":2 } },
  { id:"iron-floors", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Floors", description:"One large and one small elevated floor", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-floors", inventory:{ "tt-large-floor":1, "tt-small-floor":1 } },
  { id:"iron-high-walls", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth High Walls", description:"Double-height walls and columns", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-high-walls", inventory:{ "tt-high-connector":3, "tt-high-wall":5 } },
  { id:"iron-stairs", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Stairs", description:"Two connector-compatible stair sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-stairs", inventory:{ "tt-stair":2 } },
  { id:"iron-death-quadrant", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth – Death Quadrant Complex", description:"Dimensioned columns, walls, and door modules", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-death-quadrant-complex", inventory:{ "tt-dq-column":11, "tt-dq-double-wall":4, "tt-dq-single-wall":4, "tt-dq-double-door":1, "tt-dq-single-door":2 }, caveat:"Platforms, tiles, ladders, and stairs are listed by TTCombat but omitted from the scaled palette because their footprints are not published." },
  { id:"iron-ultima", catalogue:"ttcombat", maker:"TTCombat", name:"Iron Labyrinth Ultima Complex", description:"24 connectors, 21 ends, and 18 wall sections", source:"TTCombat published dimensions", sourceUrl:"https://ttcombat.com/products/iron-labyrinth-bundle", inventory:{ "tt-connector":24, "tt-wall-end":21, "tt-solid-wall":8, "tt-grid-wall":2, "tt-solid-pipe-wall":2, "tt-vertical-pipe-wall":2, "tt-reinforced-pipe-wall":2, "tt-fan-wall":2 } },
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
