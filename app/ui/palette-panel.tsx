import type { Anchor } from "../generate.ts";
import type { PlacedPiece } from "../board/model.ts";
import { MM_PER_IN, getDef, type TerrainDef } from "../terrain.ts";
import { UiIcon } from "./icon.tsx";
import { pieceIconClass } from "./piece-icon.ts";

type PalettePanelProps = {
  selectedPiece:PlacedPiece | null;
  selectedCount:number;
  placedCount:number;
  paletteUsed:number;
  catalogueTotal:number;
  zoneCount:number;
  generationPercent:number;
  anchor:Anchor;
  doorTotal:number;
  doorMin:number;
  doorMax:number;
  paletteMaker:string | null;
  paletteLabel:string;
  terrain:TerrainDef[];
  used:Record<string, number>;
  limits:Record<string, number>;
  heightDefaults:Record<string, number>;
  onSelectedHeightChange:(millimetres:number) => void;
  onClear:() => void;
  onGenerationPercentChange:(percent:number) => void;
  onAnchorChange:(anchor:Anchor) => void;
  onDoorMinChange:(minimum:number) => void;
  onDoorMaxChange:(maximum:number) => void;
  onGenerate:() => void;
  onPlace:(defId:string) => void;
  onQuantityChange:(defId:string, quantity:number) => void;
  onPiecePointerDown:(event:React.PointerEvent<HTMLDivElement>, defId:string) => void;
};

export function PalettePanel(props:PalettePanelProps) {
  const selectedDef = props.selectedPiece ? getDef(props.selectedPiece.defId) : null;
  return <section className="palette-builder" aria-labelledby="generator-palette-heading">
    <div className="palette-selection-summary" aria-label="Current board selection">
      {props.selectedPiece && selectedDef ? <>
        <span className={pieceIconClass(selectedDef)}><i /></span>
        <div className="palette-selection-copy">
          <span>{props.selectedCount > 1 ? "Selected group" : "Selected piece"}</span>
          <strong>{props.selectedCount > 1 ? `${props.selectedCount} pieces` : selectedDef.shortName}</strong>
          <small>{props.selectedCount > 1 ? "Edit height for the full selection" : `${Math.round((props.selectedPiece.rotation === 90 ? selectedDef.depth : selectedDef.width) * MM_PER_IN)} × ${Math.round((props.selectedPiece.rotation === 90 ? selectedDef.width : selectedDef.depth) * MM_PER_IN)} mm · ${props.selectedPiece.rotation}°`}</small>
        </div>
        <label className="palette-selection-height"><span>Z height</span><span className="dimension-input"><input aria-label="Selected piece height in palette view" type="number" min="10" max="300" step="1" value={Math.round(props.selectedPiece.height * MM_PER_IN)} onChange={(event) => props.onSelectedHeightChange(Number(event.target.value))} /> mm</span></label>
      </> : <div className="palette-selection-copy empty"><span>Board selection</span><strong>No terrain selected</strong><small>Click a piece to inspect it here</small></div>}
      <div className="palette-selection-stats"><span><strong>{props.placedCount}</strong> placed</span><span><strong>{props.paletteUsed}</strong> / {props.catalogueTotal} used</span><span><strong>{props.zoneCount}</strong> zones</span></div>
    </div>

    <div className="section-heading">
      <div><p className="eyebrow">Layout inventory</p><h2 id="generator-palette-heading">Generator palette</h2></div>
      <div className="section-actions"><span className="count">{props.catalogueTotal} pcs</span><button className="text-action danger clear-action" onClick={props.onClear} disabled={!props.catalogueTotal} title="Remove every item from the palette"><UiIcon name="trash" />Clear all</button></div>
    </div>

    {props.catalogueTotal > 0 && <div className="palette-generation-controls">
      <label className="generation-target palette-generation-target" title="Maximum share of the palette to use."><span>Use up to <strong>{props.generationPercent}%</strong></span><input type="range" min="20" max="100" step="5" value={props.generationPercent} onChange={(event) => props.onGenerationPercentChange(Number(event.target.value))} aria-label="Maximum palette use" /></label>
      <label className="generation-target palette-generation-target" title="Choose where the generated layout sits."><span>Placement</span><select value={props.anchor} onChange={(event) => props.onAnchorChange(event.target.value as Anchor)} aria-label="Generated layout placement"><option value="fill">Fill the table</option><option value="corner">Into a corner</option><option value="edge">Against an edge</option><option value="centre">Centred island</option></select></label>
      {props.doorTotal > 0 && <div className="door-range-control"><span>Doors used</span><label><small>Min</small><select aria-label="Minimum doors used" value={props.doorMin} onChange={(event) => props.onDoorMinChange(Number(event.target.value))}>{Array.from({ length:props.doorTotal + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label><span aria-hidden="true">–</span><label><small>Max</small><select aria-label="Maximum doors used" value={props.doorMax} onChange={(event) => props.onDoorMaxChange(Number(event.target.value))}>{Array.from({ length:props.doorTotal + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label></div>}
      <button className="primary palette-generate" onClick={props.onGenerate} aria-label="Generate layout from current terrain palette">Generate from palette</button>
    </div>}

    {props.catalogueTotal > 0 && <div className="palette-range"><span>{props.paletteMaker}</span><strong>{props.paletteLabel}</strong><em>{Math.max(0, props.catalogueTotal - props.paletteUsed)} unplaced</em></div>}
    <div className="palette-list" aria-label="Current generator terrain palette">
      {!props.catalogueTotal && <div className="palette-empty"><strong>Palette empty</strong><span>Add a kit or individual pieces from the library.</span></div>}
      {props.terrain.map((def) => {
        const remaining = Math.max(0, props.limits[def.id] - (props.used[def.id] || 0));
        return <div className="palette-row" key={def.id} onPointerDown={(event) => {
          if (remaining === 0 || (event.target as HTMLElement).closest("input, .remove-palette")) return;
          props.onPiecePointerDown(event, def.id);
        }}>
          <button className="piece-add" onClick={() => props.onPlace(def.id)} disabled={remaining === 0} aria-label={`Place ${def.name}`}>
            <span className={pieceIconClass(def)}><i /></span>
            <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · Z {Math.round(props.heightDefaults[def.id] * MM_PER_IN)} mm</small></span>
          </button>
          <label className="palette-quantity"><span>Available</span><input aria-label={`${def.name} palette quantity`} type="number" min="0" max="999" value={props.limits[def.id]} onChange={(event) => props.onQuantityChange(def.id, Number(event.target.value))} /><em>{remaining} left</em></label>
          <button className="remove-palette" aria-label={`Remove ${def.name} from palette`} title="Remove from palette" onClick={() => props.onQuantityChange(def.id, 0)}>×</button>
        </div>;
      })}
    </div>
  </section>;
}
