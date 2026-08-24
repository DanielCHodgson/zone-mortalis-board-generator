import { UiIcon } from "./icon.tsx";

export type BoardTheme = "industrial" | "gothic" | "desert";

type BoardToolbarProps = {
  zoneMode:boolean; showGrid:boolean; hasSelection:boolean; canPaste:boolean;
  hasTerrain:boolean; hasZones:boolean; boardZoom:number; snap:boolean;
  smartFit:boolean; gridSize:number; theme:BoardTheme;
  onSelectMode:() => void; onZoneMode:() => void; onCopy:() => void;
  onPaste:() => void; onDuplicate:() => void; onRotate:() => void;
  onDelete:() => void; onToggleGrid:() => void; onFitBoard:() => void;
  onClearBoard:() => void; onClearZones:() => void;
  onZoom:(direction:-1 | 1) => void; onResetZoom:() => void;
  onSmartFitChange:(enabled:boolean) => void; onSnapChange:(enabled:boolean) => void;
  onGridSizeChange:(size:number) => void; onThemeChange:(theme:BoardTheme) => void;
};

export function BoardToolbar(props:BoardToolbarProps) {
  const {
    zoneMode, showGrid, hasSelection, canPaste, hasTerrain, hasZones, boardZoom,
    snap, smartFit, gridSize, theme,
  } = props;
  return <div className="board-toolbar panel" role="toolbar" aria-label="Layout tools">
    <div className="tool-group primary-tools">
      <button className={`tool ${!zoneMode ? "active" : ""}`} aria-label="Select terrain" title="Select terrain" aria-pressed={!zoneMode} onClick={props.onSelectMode}><UiIcon name="pointer" /><span className="tool-label">Select</span></button>
      <button className={`tool ${zoneMode ? "active zone-tool" : ""}`} aria-label="Reserve a clear zone" title="Reserve a clear zone" aria-pressed={zoneMode} onClick={props.onZoneMode}><UiIcon name="zone" /><span className="tool-label">Reserve zone</span></button>
      <span className="tool-divider" aria-hidden="true" />
      <button className="tool icon-tool" title="Copy selected terrain · Ctrl C" aria-label="Copy selected terrain" onClick={props.onCopy} disabled={!hasSelection || zoneMode}><UiIcon name="copy" /></button>
      <button className="tool icon-tool" title="Paste copied terrain · Ctrl V" aria-label="Paste copied terrain" onClick={props.onPaste} disabled={!canPaste || zoneMode}><UiIcon name="paste" /></button>
      <button className="tool icon-tool" title="Duplicate selected terrain · Ctrl D" aria-label="Duplicate selected terrain" onClick={props.onDuplicate} disabled={!hasSelection || zoneMode}><UiIcon name="duplicate" /></button>
      <button className="tool icon-tool" title="Rotate selected terrain · R" aria-label="Rotate selected terrain" onClick={props.onRotate} disabled={!hasSelection || zoneMode}><UiIcon name="rotate" /></button>
      <button className="tool icon-tool danger" title="Delete selected terrain" aria-label="Delete selected terrain" onClick={props.onDelete} disabled={!hasSelection || zoneMode}><UiIcon name="trash" /></button>
      <span className="tool-divider" aria-hidden="true" />
      <button className="tool" aria-label={showGrid ? "Hide board grid lines" : "Show board grid lines"} aria-pressed={showGrid} title="Show or hide board grid lines" onClick={props.onToggleGrid}><UiIcon name="grid" /><span className="tool-label">Grid</span></button>
      <button className="tool" aria-label="Shrink board to fit terrain" onClick={props.onFitBoard} disabled={!hasTerrain && !hasZones} title="Crop the board to the terrain bounds"><UiIcon name="shrink" /><span className="tool-label">Fit board</span></button>
      <button className="tool danger destructive-tool" aria-label="Clear terrain" title="Remove terrain; keep reserved zones" onClick={props.onClearBoard} disabled={!hasTerrain}><UiIcon name="trash" /><span className="tool-label">Clear board</span></button>
      <button className="tool danger destructive-tool" aria-label="Clear reserved zones" title="Remove reserved zones; keep terrain" onClick={props.onClearZones} disabled={!hasZones}><UiIcon name="zone" /><span className="tool-label">Clear zones</span></button>
    </div>
    <div className="tool-group settings">
      <div className="zoom-control" role="group" aria-label="Board zoom"><button aria-label="Zoom board out" title="Zoom out" onClick={() => props.onZoom(-1)} disabled={boardZoom === 50}>−</button><button className="zoom-value" aria-label={`Reset board zoom, currently ${boardZoom}%`} title="Reset to 100%" onClick={props.onResetZoom}>{boardZoom}%</button><button aria-label="Zoom board in" title="Zoom in" onClick={() => props.onZoom(1)} disabled={boardZoom === 200}>+</button></div>
      <label className="switch-label" title="Snap compatible terrain faces"><input type="checkbox" checked={smartFit} onChange={(event) => props.onSmartFitChange(event.target.checked)} /><span className="toggle" /> Smart fit</label>
      <label className="switch-label"><input type="checkbox" checked={snap} onChange={(event) => props.onSnapChange(event.target.checked)} /><span className="toggle" /> Snap</label>
      {snap && <select aria-label="Snap grid size" value={gridSize} onChange={(event) => props.onGridSizeChange(Number(event.target.value))}><option value="1">1″ grid</option><option value="0.5">½″ grid</option><option value="0.25">¼″ grid</option></select>}
      <div className="theme-switch" aria-label="Board style">{(["industrial", "gothic", "desert"] as const).map((item) => <button key={item} className={theme === item ? "active" : ""} aria-pressed={theme === item} onClick={() => props.onThemeChange(item)}>{item}</button>)}</div>
    </div>
  </div>;
}
