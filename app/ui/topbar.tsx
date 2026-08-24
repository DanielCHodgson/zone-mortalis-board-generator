import { BOARD_SIZES, type Appearance, type BoardPreset } from "../terrain.ts";
import { UiIcon } from "./icon.tsx";

type TopbarProps = {
  appearance:Appearance;
  boardPreset:BoardPreset | "custom";
  boardWidth:number;
  boardHeight:number;
  activeBoardName:string;
  canExport:boolean;
  canRemix:boolean;
  onAppearanceChange:(appearance:Appearance) => void;
  onBoardSizeChange:(preset:BoardPreset | "custom") => void;
  onExport:() => void;
  onRemix:() => void;
};

export function Topbar({
  appearance, boardPreset, boardWidth, boardHeight, activeBoardName,
  canExport, canRemix, onAppearanceChange, onBoardSizeChange, onExport, onRemix,
}:TopbarProps) {
  return <header className="topbar">
    <div className="app-brand">
      <span className="brand-mark"><UiIcon name="brand" /></span>
      <div><h1>Mortalis Architect</h1><p>Terrain layout studio</p></div>
    </div>
    <div className="project-summary">
      <span className="project-summary-icon"><UiIcon name="grid" /></span>
      <span><small>Current board</small><strong>{activeBoardName}</strong></span>
    </div>
    <div className="top-actions">
      <div className="appearance-switch" role="group" aria-label="Colour palette">
        {(["dark", "light"] as const).map((mode) => <button key={mode} className={appearance === mode ? "active" : ""} aria-label={`${mode} colour palette`} aria-pressed={appearance === mode} onClick={() => onAppearanceChange(mode)}><UiIcon name={mode === "light" ? "sun" : "moon"} /><span>{mode}</span></button>)}
      </div>
      <label className="board-size-control"><span>Board size</span><select aria-label="Board size" value={boardPreset} onChange={(event) => onBoardSizeChange(event.target.value as BoardPreset | "custom")}>
        {boardPreset === "custom" && <option value="custom">{boardWidth.toFixed(1)}″ × {boardHeight.toFixed(1)}″ · custom</option>}
        {(Object.entries(BOARD_SIZES) as Array<[BoardPreset, typeof BOARD_SIZES[BoardPreset]]>).map(([value, size]) => <option key={value} value={value}>{size.label}</option>)}
      </select></label>
      <span className="board-chip">{boardWidth.toFixed(1)} × {boardHeight.toFixed(1)} IN</span>
      <button className="export-action" onClick={onExport} disabled={!canExport} aria-label="Export layout and piece manifest as PNG"><UiIcon name="download" />Export</button>
      <button className="primary" onClick={onRemix} disabled={!canRemix} aria-label="Generate a new layout using every piece currently on the board"><UiIcon name="wand" />Remix board</button>
    </div>
  </header>;
}
