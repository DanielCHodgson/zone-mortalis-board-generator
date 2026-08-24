import type { Anchor } from "../generate.ts";
import { MM_PER_IN, type TerrainDef } from "../terrain.ts";
import { UiIcon } from "./icon.tsx";
import { pieceIconClass } from "./piece-icon.ts";

type PalettePanelProps = {
  paletteUsed:number;
  catalogueTotal:number;
  shrinkAfterGeneration:boolean;
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
  onClear:() => void;
  onShrinkAfterGenerationChange:(enabled:boolean) => void;
  onAnchorChange:(anchor:Anchor) => void;
  onDoorMinChange:(minimum:number) => void;
  onDoorMaxChange:(maximum:number) => void;
  onGenerate:() => void;
  onPlace:(defId:string) => void;
  onQuantityChange:(defId:string, quantity:number) => void;
  onPiecePointerDown:(event:React.PointerEvent<HTMLDivElement>, defId:string) => void;
  onPiecePointerMove:(event:React.PointerEvent<HTMLDivElement>) => void;
  onPiecePointerUp:(event:React.PointerEvent<HTMLDivElement>) => void;
};

export function PalettePanel(props:PalettePanelProps) {
  return <section className="palette-builder" aria-labelledby="generator-palette-heading">
    <div className="section-heading">
      <div><p className="eyebrow">Layout inventory</p><h2 id="generator-palette-heading">Generator palette</h2></div>
      <div className="section-actions"><span className="count">{props.catalogueTotal} pcs</span><button className="text-action danger clear-action" onClick={props.onClear} disabled={!props.catalogueTotal} title="Remove every item from the palette"><UiIcon name="trash" />Clear all</button></div>
    </div>

    {props.catalogueTotal > 0 && <div className="palette-generation-controls">
      <button className="primary palette-generate" onClick={props.onGenerate} aria-label="Generate layout from current terrain palette">Generate from palette</button>
      <label className="generation-target palette-generation-target" title="Choose where the generated layout sits."><span>Placement</span><select value={props.anchor} onChange={(event) => props.onAnchorChange(event.target.value as Anchor)} aria-label="Generated layout placement"><option value="fill">Fill the table</option><option value="corner">Into a corner</option><option value="edge">Against an edge</option><option value="centre">Centred island</option></select></label>
      <label className="switch-label palette-auto-fit" title="Trim unused board margin after each generated layout.">
        <input type="checkbox" checked={props.shrinkAfterGeneration} onChange={(event) => props.onShrinkAfterGenerationChange(event.target.checked)} />
        <span className="toggle" aria-hidden="true" />
        <span>Shrink board after generation</span>
      </label>
      {props.doorTotal > 0 && <div className="door-range-control"><span>Doors used</span><label><small>Min</small><select aria-label="Minimum doors used" value={props.doorMin} onChange={(event) => props.onDoorMinChange(Number(event.target.value))}>{Array.from({ length:props.doorTotal + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label><span aria-hidden="true">–</span><label><small>Max</small><select aria-label="Maximum doors used" value={props.doorMax} onChange={(event) => props.onDoorMaxChange(Number(event.target.value))}>{Array.from({ length:props.doorTotal + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label></div>}
    </div>}

    {props.catalogueTotal > 0 && <div className="palette-range"><span>{props.paletteMaker}</span><strong>{props.paletteLabel}</strong><em>{Math.max(0, props.catalogueTotal - props.paletteUsed)} unplaced</em></div>}
    <div className="palette-list" aria-label="Current generator terrain palette">
      {!props.catalogueTotal && <div className="palette-empty"><strong>Palette empty</strong><span>Add a kit or individual pieces from the library.</span></div>}
      {props.terrain.map((def) => {
        const remaining = Math.max(0, props.limits[def.id] - (props.used[def.id] || 0));
        return <div className="palette-row" key={def.id}>
          <div className="piece-add" role="button" tabIndex={remaining > 0 ? 0 : -1} aria-disabled={remaining === 0} onPointerDown={(event) => { if (remaining > 0) props.onPiecePointerDown(event, def.id); }} onPointerMove={props.onPiecePointerMove} onPointerUp={props.onPiecePointerUp} onPointerCancel={props.onPiecePointerUp} onClick={() => { if (remaining > 0) props.onPlace(def.id); }} onKeyDown={(event) => { if (remaining > 0 && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); props.onPlace(def.id); } }} aria-label={`Place ${def.name}`}>
            <span className={pieceIconClass(def)}><i /></span>
            <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · Z {Math.round(props.heightDefaults[def.id] * MM_PER_IN)} mm</small></span>
          </div>
          <label className="palette-quantity"><span>Available</span><input aria-label={`${def.name} palette quantity`} type="number" min="0" max="999" value={props.limits[def.id]} onChange={(event) => props.onQuantityChange(def.id, Number(event.target.value))} /><em>{remaining} left</em></label>
          <button className="remove-palette" aria-label={`Remove ${def.name} from palette`} title="Remove from palette" onClick={() => props.onQuantityChange(def.id, 0)}>×</button>
        </div>;
      })}
    </div>
  </section>;
}
