import { MANUFACTURERS, type CatalogueId, type TerrainDef, type TerrainKit } from "../terrain.ts";
import { pieceIconClass } from "./piece-icon.ts";

type TerrainLibraryProps = {
  activeCatalogue:CatalogueId;
  activeKitId:string;
  activeKit:TerrainKit;
  manufacturerKits:TerrainKit[];
  pieces:TerrainDef[];
  kitTotal:number;
  addAmounts:Record<string, number>;
  onClose:() => void;
  onManufacturerChange:(catalogue:CatalogueId) => void;
  onKitChange:(kitId:string) => void;
  onAddKit:() => void;
  onAmountChange:(key:string, amount:number) => void;
  onAddStock:(defId:string, amount:number) => void;
  onPlaceOne:(defId:string, amount:number) => void;
  onPiecePointerDown:(event:React.PointerEvent<HTMLDivElement>, defId:string, amount:number) => void;
  onPiecePointerMove:(event:React.PointerEvent<HTMLDivElement>) => void;
  onPiecePointerUp:(event:React.PointerEvent<HTMLDivElement>) => void;
};

export function TerrainLibrary({
  activeCatalogue, activeKitId, activeKit, manufacturerKits, pieces, kitTotal, addAmounts,
  onClose, onManufacturerChange, onKitChange, onAddKit, onAmountChange, onAddStock,
  onPlaceOne, onPiecePointerDown, onPiecePointerMove, onPiecePointerUp,
}:TerrainLibraryProps) {
  return <aside id="terrain-library" className="catalogue panel">
    <div className="catalogue-heading"><div><p className="eyebrow">Terrain library</p><h2>Browse pieces</h2></div><button aria-label="Close terrain library" title="Close terrain library" onClick={onClose}>×</button></div>
    <div className="catalogue-selectors" aria-label="Terrain source">
      <label><span>Manufacturer</span><select value={activeCatalogue} onChange={(event) => onManufacturerChange(event.target.value as CatalogueId)}>{(Object.keys(MANUFACTURERS) as CatalogueId[]).map((catalogueId) => <option key={catalogueId} value={catalogueId}>{MANUFACTURERS[catalogueId].name} · {MANUFACTURERS[catalogueId].range}</option>)}</select></label>
      <label><span>Kit</span><select value={activeKitId} onChange={(event) => onKitChange(event.target.value)}>{manufacturerKits.map((kit) => <option key={kit.id} value={kit.id}>{kit.name}</option>)}</select></label>
    </div>
    <section className="kit-browser" aria-labelledby="kit-browser-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Selected kit</p><h2 id="kit-browser-heading">{activeKit.name}</h2></div>
        <button className="add-kit" onClick={onAddKit}>Add kit <span>+{kitTotal}</span></button>
      </div>
      <p className="section-intro">{activeKit.description} <a href={activeKit.sourceUrl} target="_blank" rel="noreferrer">View source <span aria-hidden="true">↗</span></a></p>
      <div className="kit-piece-list" aria-label={`${activeKit.name} available pieces`}>
        {pieces.map((def) => {
          const amountKey = `${activeKitId}:${def.id}`;
          const amount = addAmounts[amountKey] ?? activeKit.inventory[def.id] ?? 1;
          return <div className="kit-piece-row" key={def.id} onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("input, button")) return;
            onPiecePointerDown(event, def.id, amount);
          }} onPointerMove={onPiecePointerMove} onPointerUp={onPiecePointerUp} onPointerCancel={onPiecePointerUp}>
            <span className={pieceIconClass(def)}><i /></span>
            <span className="piece-copy"><strong>{def.shortName}</strong><small>{def.note} · kit includes {activeKit.inventory[def.id]}</small></span>
            <div className="kit-piece-actions">
              <label className="add-amount"><span className="sr-only">Amount of {def.name} to add</span><input aria-label={`Amount of ${def.name} to add`} type="number" min="1" max="999" value={amount} onChange={(event) => onAmountChange(amountKey, Number(event.target.value))} /></label>
              <div className="kit-piece-buttons">
                <button className="add-piece-to-palette" onClick={() => onAddStock(def.id, amount)} aria-label={`Add ${amount} ${def.name} to the palette only`} title="Add this quantity to the palette">Add stock</button>
                <button className="add-piece-to-board" onClick={() => onPlaceOne(def.id, amount)} aria-label={`Add ${amount} ${def.name} to the palette and place one on the board`} title="Add this quantity and place one">Place 1</button>
              </div>
            </div>
          </div>;
        })}
      </div>
      {activeKit.caveat && <details className="kit-caveat"><summary>Measurement notes</summary><p>{activeKit.caveat}</p></details>}
    </section>
  </aside>;
}
