import type { PlacedPiece, ReservedZone } from "../board/model.ts";
import { MANUFACTURERS, MM_PER_IN, TERRAIN, getDef, type CatalogueId, type TerrainDef } from "../terrain.ts";
import { pieceIconClass } from "./piece-icon.ts";

export type InventoryGroup = {
  catalogue:CatalogueId;
  maker:string;
  range:string;
  items:Array<{ def:TerrainDef; count:number }>;
};

type HeightFamily = "wall" | "support" | "end";

type AnalysisPanelProps = {
  pieces:PlacedPiece[];
  selectedPiece:PlacedPiece | null;
  selectedCount:number;
  paletteUsed:number;
  catalogueTotal:number;
  paletteMaker:string | null;
  paletteLabel:string;
  paletteCatalogues:CatalogueId[];
  generationJoint:(typeof MANUFACTURERS)[CatalogueId]["joint"];
  generationRange:string;
  coverage:number;
  zones:ReservedZone[];
  reservedCoverage:number;
  wallCount:number;
  doorCount:number;
  loops:number;
  chambers:number;
  usedInventory:InventoryGroup[];
  boardWidth:number;
  boardHeight:number;
  focusedZone:string | null;
  onSelectedHeightChange:(millimetres:number) => void;
  familyIsAvailable:(family:HeightFamily) => boolean;
  familyHeightMm:(family:HeightFamily) => number;
  onFamilyHeightChange:(family:HeightFamily, millimetres:number) => void;
  onZonesChange:(zones:ReservedZone[]) => void;
  onFocusedZoneChange:(uid:string | null) => void;
  onZoneResizeCancel:(uid?:string) => void;
};

const EBERLEG_LEGEND = TERRAIN.filter((def) => def.catalogue === "eberleg");

export function AnalysisPanel(props:AnalysisPanelProps) {
  const isEberleg = props.paletteCatalogues.length === 1 && props.paletteCatalogues[0] === "eberleg";
  const usedTotal = props.pieces.length;
  return <>
    <p className="eyebrow">Layout analysis</p><h2>{props.pieces.length ? "Playable sector" : "Ready to build"}</h2>
    {props.selectedPiece && <div className="selected-piece-editor">
      <div><span>{props.selectedCount > 1 ? "Selected group" : "Selected piece"}</span><strong>{props.selectedCount > 1 ? `${props.selectedCount} pieces` : getDef(props.selectedPiece.defId).shortName}</strong></div>
      <label><span>Height · Z</span><span className="dimension-input"><input aria-label="Selected piece height" type="number" min="10" max="300" step="1" value={Math.round(props.selectedPiece.height * MM_PER_IN)} onChange={(event) => props.onSelectedHeightChange(Number(event.target.value))} /> mm</span></label>
      <small>{props.selectedCount > 1 ? "Height changes apply to the whole selection" : `${getDef(props.selectedPiece.defId).note} footprint`}</small>
    </div>}
    <div className="metric"><span>Current layout</span><strong>{props.pieces.length} pcs</strong></div>
    <div className="metric"><span>Palette used</span><strong>{props.paletteUsed} / {props.catalogueTotal}</strong></div>
    <div className="metric"><span>Generator palette</span><strong>{props.paletteMaker || "None"}</strong></div>
    <div className="metric"><span>Footprint coverage</span><strong>{props.coverage.toFixed(1)}%</strong></div><div className="meter"><i style={{ width:`${Math.min(props.coverage * 5, 100)}%` }} /></div>
    <div className="metric"><span>Reserved clear space</span><strong>{props.zones.length} · {props.reservedCoverage.toFixed(1)}%</strong></div>
    <div className="metric"><span>{props.paletteCatalogues.length > 1 ? "Walls + hatchways" : props.generationJoint === "straddle" ? "Operable doorways" : "Wall modules"}</span><strong>{props.paletteCatalogues.length > 1 ? props.wallCount : props.generationJoint === "straddle" ? props.doorCount : props.wallCount}</strong></div>
    <div className="metric"><span>Corridor loops</span><strong>{props.loops}</strong></div>
    <div className="metric"><span>Open chambers</span><strong>{props.chambers}</strong></div>
    <div className="divider" />
    <p className="inspector-copy">{isEberleg ? "An unofficial, print-at-home proxy for Games Workshop’s Zone Mortalis terrain. Not affiliated with or endorsed by Games Workshop." : props.paletteCatalogues.length > 1 ? "Each terrain system keeps its own physical assembly rules while compatible ordinary wall faces align across kits." : props.generationJoint === "straddle" ? `Walls and doors slot into the ${props.generationRange} support grid.` : `${props.generationRange} pieces retain their own connector system.`}</p>
    {isEberleg ? <div className="eberleg-legend" aria-label="Eberleg terrain legend">{EBERLEG_LEGEND.map((def) => <span key={def.id}><span className={pieceIconClass(def)}><i /></span><small>{def.shortName.replace("Eb ", "")}</small></span>)}</div> : <div className="layout-key">{props.paletteCatalogues.length > 1 ? <><span><i className="key-wall" /> Compatible wall</span><span><i className="key-door" /> Door / hatch</span><span><i className="key-pillar" /> System support</span></> : props.generationJoint === "straddle" ? <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Doorway</span><span><i className="key-pillar" /> Column</span><span><i className="key-open" /> Open face</span></> : <><span><i className="key-wall" /> Wall</span><span><i className="key-door" /> Wall end</span><span><i className="key-pillar" /> Connector</span></>}</div>}

    {props.usedInventory.length > 0 && <div className="bom">
      <div className="bom-heading"><strong>What to pull off the sprue</strong><span>{usedTotal} pcs total</span></div>
      <p className="bom-intro">Exact pieces used on this board.</p>
      {props.usedInventory.map((group) => <div className="bom-group" key={group.catalogue}>
        {props.usedInventory.length > 1 && <div className="bom-group-heading">{group.maker} · {group.range}</div>}
        {group.items.map(({ def, count }) => <div className="bom-row" key={def.id}><span className={pieceIconClass(def)}><i /></span><span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note}</small></span><strong className="bom-count">× {count}</strong></div>)}
      </div>)}
    </div>}

    {props.catalogueTotal > 0 && <details className="height-settings inspector-height">
      <summary><span><strong>Advanced dimensions</strong><small>3D and export height defaults</small></span><em>Z axis · mm</em></summary>
      <p className="height-explainer">Export heights only; footprints stay fixed.</p>
      <div className="height-grid">
        {props.familyIsAvailable("wall") && <label><span>Structures</span><input aria-label={`${props.paletteLabel} structure default height`} type="number" min="10" max="300" step="1" value={props.familyHeightMm("wall")} onChange={(event) => props.onFamilyHeightChange("wall", Number(event.target.value))} /></label>}
        {props.familyIsAvailable("support") && <label><span>{props.paletteCatalogues.length > 1 ? "Supports" : props.generationJoint === "straddle" ? "Columns" : "Connectors"}</span><input aria-label={`${props.paletteLabel} support default height`} type="number" min="10" max="300" step="1" value={props.familyHeightMm("support")} onChange={(event) => props.onFamilyHeightChange("support", Number(event.target.value))} /></label>}
        {props.familyIsAvailable("end") && <label><span>Wall ends</span><input aria-label={`${props.paletteLabel} end default height`} type="number" min="10" max="300" step="1" value={props.familyHeightMm("end")} onChange={(event) => props.onFamilyHeightChange("end", Number(event.target.value))} /></label>}
      </div>
    </details>}

    {props.zones.length > 0 && <div className="zone-list">
      <div className="zone-list-heading"><span>Reserved zones</span><button onClick={() => { props.onZonesChange([]); props.onFocusedZoneChange(null); props.onZoneResizeCancel(); }}>Clear all</button></div>
      <small className="zone-list-hint">Hover a zone for handles; click to keep them open.</small>
      {props.zones.map((zone) => <div className={`zone-list-row ${props.focusedZone === zone.uid ? "active" : ""}`} key={zone.uid} onPointerDown={() => props.onFocusedZoneChange(zone.uid)}>
        <input aria-label={`Rename ${zone.name}`} value={zone.name} maxLength={32} onFocus={() => props.onFocusedZoneChange(zone.uid)} onChange={(event) => props.onZonesChange(props.zones.map((item) => item.uid === zone.uid ? { ...item, name:event.target.value } : item))} />
        <span>{zone.width.toFixed(1)} × {zone.height.toFixed(1)}″</span>
        <button aria-label={`Remove ${zone.name}`} onClick={() => { props.onZonesChange(props.zones.filter((item) => item.uid !== zone.uid)); if (props.focusedZone === zone.uid) props.onFocusedZoneChange(null); props.onZoneResizeCancel(zone.uid); }}>×</button>
      </div>)}
    </div>}
    <p className="accuracy-note">Scale: {props.boardWidth} × {props.boardHeight}″ · 25.4 mm/in. Published dimensions where available; otherwise measured approximations.</p>
  </>;
}
