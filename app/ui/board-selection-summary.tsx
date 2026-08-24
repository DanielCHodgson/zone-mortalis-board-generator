import type { PlacedPiece } from "../board/model.ts";
import { getDef, MM_PER_IN } from "../terrain.ts";
import { pieceIconClass } from "./piece-icon.ts";

type BoardSelectionSummaryProps = {
  selectedPiece:PlacedPiece | null;
  selectedCount:number;
  placedCount:number;
  paletteUsed:number;
  catalogueTotal:number;
  zoneCount:number;
  onSelectedHeightChange:(millimetres:number) => void;
};

export function BoardSelectionSummary(props:BoardSelectionSummaryProps) {
  const selectedDef = props.selectedPiece ? getDef(props.selectedPiece.defId) : null;
  const detail = props.selectedPiece && selectedDef
    ? props.selectedCount > 1
      ? "Edit height for the full selection"
      : `${Math.round((props.selectedPiece.rotation === 90 ? selectedDef.depth : selectedDef.width) * MM_PER_IN)} × ${Math.round((props.selectedPiece.rotation === 90 ? selectedDef.width : selectedDef.depth) * MM_PER_IN)} mm · ${props.selectedPiece.rotation}°`
    : "Click a piece to inspect";

  return <div className="board-selection-summary" aria-label="Current board selection">
    {selectedDef && <span className={pieceIconClass(selectedDef)} aria-hidden="true"><i /></span>}
    <div className="board-selection-copy">
      <span>{props.selectedCount > 1 ? "Selected group" : "Board selection"}</span>
      <strong>{props.selectedCount > 1 ? `${props.selectedCount} pieces` : selectedDef?.shortName || "No terrain selected"}</strong>
      <small>{detail}</small>
    </div>
    {props.selectedPiece && <label className="board-selection-height">
      <span>Z height</span>
      <span className="dimension-input"><input aria-label="Selected piece height in board header" type="number" min="10" max="300" step="1" value={Math.round(props.selectedPiece.height * MM_PER_IN)} onChange={(event) => props.onSelectedHeightChange(Number(event.target.value))} /> mm</span>
    </label>}
    <div className="board-selection-stats">
      <span><strong>{props.placedCount}</strong> placed</span>
      <span><strong>{props.paletteUsed}</strong> / {props.catalogueTotal} used</span>
      <span><strong>{props.zoneCount}</strong> zones</span>
    </div>
  </div>;
}
