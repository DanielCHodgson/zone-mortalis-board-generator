import type { PlacedPiece, ReservedZone } from "./board/model.ts";
import { MANUFACTURERS, MM_PER_IN, TERRAIN, getDef } from "./terrain.ts";

type LayoutPngOptions = {
  pieces:PlacedPiece[];
  zones:ReservedZone[];
  boardWidth:number;
  boardHeight:number;
  theme:"industrial" | "gothic" | "desert";
  coverage:number;
  onStatus:(message:string) => void;
};

export function exportLayoutPng({ pieces, zones, boardWidth, boardHeight, theme, coverage, onStatus }:LayoutPngOptions) {
  if (!pieces.length) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  canvas.height = 1320;
  const ctx = canvas.getContext("2d");
  if (!ctx) { onStatus("PNG export is unavailable in this browser"); return; }

  const boardX = 70;
  const boardY = 160;
  const boardScale = Math.min(1080 / boardWidth, 1080 / boardHeight);
  const boardPixelWidth = boardWidth * boardScale;
  const boardPixelHeight = boardHeight * boardScale;
  const exportPanelHeight = 1080;
  const manifestX = 1200;
  const manifestWidth = 530;
  const themeColours = {
    industrial: { board:"#858e89", minor:"rgba(238,243,239,.16)", major:"rgba(28,37,34,.30)" },
    gothic: { board:"#626967", minor:"rgba(235,237,230,.13)", major:"rgba(18,23,22,.36)" },
    desert: { board:"#b9aa8b", minor:"rgba(255,248,226,.25)", major:"rgba(77,65,45,.28)" },
  }[theme];
  const manifest = TERRAIN.map((def) => {
    const matches = pieces.filter((piece) => piece.defId === def.id);
    const heightCounts = matches.reduce<Record<string, number>>((counts, piece) => {
      const height = String(Math.round(piece.height * MM_PER_IN));
      return { ...counts, [height]:(counts[height] || 0) + 1 };
    }, {});
    return { def, count:matches.length, heightCounts };
  }).filter((item) => item.count > 0);
  const cataloguesUsed = [...new Set(manifest.map((item) => item.def.catalogue))];

  ctx.fillStyle = "#f2f3f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#17201e";
  ctx.font = "700 38px Arial, sans-serif";
  ctx.fillText("MORTALIS ARCHITECT", 70, 70);
  ctx.fillStyle = "#68736e";
  ctx.font = "700 15px Arial, sans-serif";
  ctx.fillText("HORUS HERESY LAYOUT SHEET", 72, 102);
  ctx.textAlign = "right";
  ctx.font = "700 17px Arial, sans-serif";
  ctx.fillText(`BOARD ${boardWidth} × ${boardHeight} IN  ·  SCALE 1:1 DATA`, 1730, 76);
  ctx.font = "15px Arial, sans-serif";
  const exportSource = cataloguesUsed.length === 1
    ? `${MANUFACTURERS[cataloguesUsed[0]].name} · ${MANUFACTURERS[cataloguesUsed[0]].range}`
    : "Mixed terrain layout";
  ctx.fillText(exportSource, 1730, 103);
  ctx.textAlign = "left";

  ctx.fillStyle = themeColours.board;
  ctx.fillRect(boardX, boardY, boardPixelWidth, boardPixelHeight);
  for (let inch = 0; inch <= boardWidth; inch++) {
    const position = boardX + inch * boardScale;
    ctx.beginPath();
    ctx.strokeStyle = inch % 12 === 0 ? themeColours.major : themeColours.minor;
    ctx.lineWidth = inch % 12 === 0 ? 3 : 1;
    ctx.moveTo(position, boardY);
    ctx.lineTo(position, boardY + boardPixelHeight);
    ctx.stroke();
  }
  for (let inch = 0; inch <= boardHeight; inch++) {
    ctx.beginPath();
    ctx.strokeStyle = inch % 12 === 0 ? themeColours.major : themeColours.minor;
    ctx.lineWidth = inch % 12 === 0 ? 3 : 1;
    ctx.moveTo(boardX, boardY + inch * boardScale);
    ctx.lineTo(boardX + boardPixelWidth, boardY + inch * boardScale);
    ctx.stroke();
  }
  ctx.strokeStyle = "#17201e";
  ctx.lineWidth = 5;
  ctx.strokeRect(boardX, boardY, boardPixelWidth, boardPixelHeight);
  ctx.fillStyle = "#5f6965";
  ctx.font = "13px Arial, sans-serif";
  ctx.textAlign = "center";
  Array.from({ length:boardWidth / 12 + 1 }, (_, index) => index * 12).forEach((inch) => ctx.fillText(`${inch}${inch === boardWidth ? "″" : ""}`, boardX + inch * boardScale, boardY - 17));
  ctx.textAlign = "right";
  Array.from({ length:boardHeight / 12 + 1 }, (_, index) => index * 12).forEach((inch) => ctx.fillText(`${inch}${inch === boardHeight ? "″" : ""}`, boardX - 17, boardY + inch * boardScale + 5));
  ctx.textAlign = "left";

  zones.forEach((zone) => {
    const x = boardX + zone.x * boardScale;
    const y = boardY + zone.y * boardScale;
    const width = zone.width * boardScale;
    const height = zone.height * boardScale;
    ctx.fillStyle = "rgba(226,214,164,.58)";
    ctx.fillRect(x, y, width, height);
    ctx.save();
    ctx.setLineDash([12, 8]);
    ctx.strokeStyle = "#815f29";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
    ctx.fillStyle = "#3c321f";
    ctx.font = "700 17px Arial, sans-serif";
    ctx.fillText(zone.name || "Reserved zone", x + 10, y + 26);
    ctx.font = "13px Arial, sans-serif";
    ctx.fillText(`${zone.width.toFixed(1)} × ${zone.height.toFixed(1)}″ CLEAR`, x + 10, y + 48);
  });

  pieces.forEach((piece) => {
    const def = getDef(piece.defId);
    const widthIn = piece.rotation === 90 ? def.depth : def.width;
    const depthIn = piece.rotation === 90 ? def.width : def.depth;
    const x = boardX + piece.x * boardScale;
    const y = boardY + piece.y * boardScale;
    const width = Math.max(4, widthIn * boardScale);
    const depth = Math.max(4, depthIn * boardScale);
    // The export always prints on paper, whichever appearance the app is set to.
    // A sheet you take to the table wants ink on white, not a screenshot of a dark
    // viewport, so these are deliberately the light palette's literals rather than
    // the live tokens.
    // A hatchway panel the plan uses as a WALL prints as wall — same piece, door shut.
    // Colouring every door-kind panel as an opening is what made a board running 8%
    // doorways read as 58% doors. The manifest below still lists it as a hatchway,
    // because that is the piece you reach into the box for.
    const asDoorway = def.kind === "door" && piece.servesDoorway !== false;
    const colour = asDoorway ? "#7d4b39"
      : def.kind === "wall" || def.kind === "door" ? "#3d4844"
        : def.kind === "end" ? "#56615c"
          : def.kind === "scatter" ? "#4c6f66"
            : "#2d3934";
    if (def.catalogue === "eberleg") {
      // The arm meets the straight face of the 18%-chamfered 51.91 mm node:
      // 64% × 51.91 = 33.22 mm. Door frames retain their measured 43.97 mm depth.
      const wallThickness = 51.91 * .64 / MM_PER_IN * boardScale;
      const doorFrameThickness = 43.97 / MM_PER_IN * boardScale;
      const hubSize = 51.91 / MM_PER_IN * boardScale;
      const armReach = 76.2 / MM_PER_IN * boardScale;
      const baseArms:Record<string, Array<"n" | "e" | "s" | "w">> = {
        column:[], stub:["e"], straight:["w","e"], corner:["w","s"], t:["w","e","s"], cross:["n","e","s","w"],
      };
      const clockwise = { n:"e", e:"s", s:"w", w:"n" } as const;
      let arms = [...(baseArms[def.shape || "column"] || [])];
      for (let turn = 0; turn < (piece.facing || 0) / 90; turn++) arms = arms.map((dir) => clockwise[dir]);

      if (def.shape) {
        const nodeX = x + (arms.includes("w") ? armReach : hubSize / 2);
        const nodeY = y + (arms.includes("n") ? armReach : hubSize / 2);
        ctx.fillStyle = "#3d4844";
        if (arms.includes("w")) ctx.fillRect(x, nodeY - wallThickness / 2, nodeX - x, wallThickness);
        if (arms.includes("e")) ctx.fillRect(nodeX, nodeY - wallThickness / 2, x + width - nodeX, wallThickness);
        if (arms.includes("n")) ctx.fillRect(nodeX - wallThickness / 2, y, wallThickness, nodeY - y);
        if (arms.includes("s")) ctx.fillRect(nodeX - wallThickness / 2, nodeY, wallThickness, y + depth - nodeY);
        const half = hubSize / 2;
        const bevel = hubSize * .18;
        ctx.beginPath();
        ctx.moveTo(nodeX - half + bevel, nodeY - half);
        ctx.lineTo(nodeX + half - bevel, nodeY - half);
        ctx.lineTo(nodeX + half, nodeY - half + bevel);
        ctx.lineTo(nodeX + half, nodeY + half - bevel);
        ctx.lineTo(nodeX + half - bevel, nodeY + half);
        ctx.lineTo(nodeX - half + bevel, nodeY + half);
        ctx.lineTo(nodeX - half, nodeY + half - bevel);
        ctx.lineTo(nodeX - half, nodeY - half + bevel);
        ctx.closePath();
        ctx.fillStyle = "#2d3934";
        ctx.fill();
        ctx.strokeStyle = "#18211e";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        const horizontal = piece.rotation !== 90;
        const thickness = def.kind === "door" ? doorFrameThickness : wallThickness;
        const bar = horizontal
          ? { x, y:y + (depth - thickness) / 2, width, height:thickness }
          : { x:x + (width - thickness) / 2, y, width:thickness, height:depth };
        ctx.fillStyle = asDoorway ? "#7d4b39" : "#3d4844";
        ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
        if (asDoorway) {
          ctx.fillStyle = "#252d2a";
          if (horizontal) ctx.fillRect(x + width * .32, bar.y + 2, width * .36, Math.max(2, bar.height - 4));
          else ctx.fillRect(bar.x + 2, y + depth * .32, Math.max(2, bar.width - 4), depth * .36);
        }
      }
      return;
    }
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, width, depth);
    ctx.strokeStyle = "#18211e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, depth);
    ctx.strokeStyle = "rgba(226,233,228,.48)";
    ctx.lineWidth = 2;
    if (asDoorway) {
      ctx.fillStyle = "#252d2a";
      if (width >= depth) ctx.fillRect(x + width * .35, y + 3, width * .3, Math.max(2, depth - 6));
      else ctx.fillRect(x + 3, y + depth * .35, Math.max(2, width - 6), depth * .3);
    } else if (def.kind === "door") {
      // Shut, but still outlined: the sheet is a build guide and you need to know
      // which panel goes here.
      ctx.strokeStyle = "rgba(189,113,82,.45)";
      if (width >= depth) ctx.strokeRect(x + width * .35, y + 3, width * .3, Math.max(2, depth - 6));
      else ctx.strokeRect(x + 3, y + depth * .35, Math.max(2, width - 6), depth * .3);
      ctx.strokeStyle = "rgba(226,233,228,.48)";
    } else if (["pillar", "connector"].includes(def.kind)) {
      ctx.strokeRect(x + 4, y + 4, Math.max(1, width - 8), Math.max(1, depth - 8));
    } else if (def.visual === "grid") {
      for (let offset = 5; offset < Math.max(width, depth); offset += 8) {
        ctx.beginPath(); ctx.moveTo(x + Math.min(offset, width), y); ctx.lineTo(x + Math.min(offset, width), y + depth); ctx.stroke();
      }
    } else if (["pipe", "vertical-pipe"].includes(def.visual || "")) {
      ctx.beginPath();
      if (width >= depth) { ctx.moveTo(x + 5, y + depth * .35); ctx.lineTo(x + width - 5, y + depth * .35); ctx.moveTo(x + 5, y + depth * .65); ctx.lineTo(x + width - 5, y + depth * .65); }
      else { ctx.moveTo(x + width * .35, y + 5); ctx.lineTo(x + width * .35, y + depth - 5); ctx.moveTo(x + width * .65, y + 5); ctx.lineTo(x + width * .65, y + depth - 5); }
      ctx.stroke();
    } else if (def.visual === "reinforced") {
      ctx.strokeRect(x + 4, y + 4, Math.max(1, width - 8), Math.max(1, depth - 8));
    } else if (def.visual === "fan") {
      ctx.beginPath(); ctx.arc(x + width / 2, y + depth / 2, Math.max(2, Math.min(width, depth) * .28), 0, Math.PI * 2); ctx.stroke();
    }
  });

  ctx.fillStyle = "#fafbf9";
  ctx.fillRect(manifestX, boardY, manifestWidth, exportPanelHeight);
  ctx.strokeStyle = "#d0d6d2";
  ctx.lineWidth = 2;
  ctx.strokeRect(manifestX, boardY, manifestWidth, exportPanelHeight);
  ctx.fillStyle = "#17201e";
  ctx.font = "700 25px Arial, sans-serif";
  ctx.fillText("PIECES USED", manifestX + 30, boardY + 48);
  ctx.fillStyle = "#68736e";
  ctx.font = "15px Arial, sans-serif";
  ctx.fillText(`${pieces.length} terrain pieces  ·  ${coverage.toFixed(1)}% footprint coverage`, manifestX + 30, boardY + 77);
  if (zones.length) {
    ctx.fillStyle = "#815f29";
    ctx.font = "700 13px Arial, sans-serif";
    const zoneNames = zones.map((zone) => zone.name || "Reserved zone").join(" · ");
    ctx.fillText(`${zones.length} RESERVED · ${zoneNames.length > 46 ? `${zoneNames.slice(0, 43)}…` : zoneNames}`, manifestX + 30, boardY + 104);
  }
  let rowY = boardY + (zones.length ? 142 : 118);
  cataloguesUsed.forEach((catalogueId) => {
    ctx.fillStyle = "#eef1ed";
    ctx.fillRect(manifestX + 20, rowY - 22, manifestWidth - 40, 34);
    ctx.fillStyle = "#4e5a55";
    ctx.font = "700 13px Arial, sans-serif";
    ctx.fillText(`${MANUFACTURERS[catalogueId].name.toUpperCase()} · ${MANUFACTURERS[catalogueId].range.toUpperCase()}`, manifestX + 30, rowY);
    rowY += 42;
    manifest.filter((item) => item.def.catalogue === catalogueId).forEach(({ def, count, heightCounts }) => {
      // The manifest lists piece TYPES, so a hatchway panel shows as a hatchway here
      // whatever the layout uses it for — this is the shopping list, not the board.
      ctx.fillStyle = def.kind === "door" ? "#7d4b39" : def.kind === "wall" ? "#3d4844" : def.kind === "end" ? "#56615c" : "#2d3934";
      ctx.fillRect(manifestX + 30, rowY - 16, 12, 12);
      ctx.fillStyle = "#17201e";
      ctx.font = "700 16px Arial, sans-serif";
      ctx.fillText(`${count} × ${def.shortName}`, manifestX + 55, rowY - 4);
      ctx.fillStyle = "#68736e";
      ctx.font = "13px Arial, sans-serif";
      const heightEntries = Object.entries(heightCounts).sort(([a], [b]) => Number(a) - Number(b));
      const zText = heightEntries.length === 1 ? `${heightEntries[0][0]} mm` : heightEntries.map(([height, quantity]) => `${quantity}×${height}`).join(" / ") + " mm";
      ctx.fillText(`${def.note}  ·  Z ${zText}`, manifestX + 55, rowY + 15);
      rowY += 42;
    });
    rowY += 10;
  });
  ctx.fillStyle = "#68736e";
  ctx.font = "13px Arial, sans-serif";
  ctx.fillText("Bird's-eye placement diagram · dimensions shown at real-world scale", manifestX + 30, boardY + exportPanelHeight - 35);
  ctx.fillText("Generated with Mortalis Architect", 70, 1286);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" }), 1730, 1286);
  ctx.textAlign = "left";

  onStatus("Preparing PNG layout sheet…");
  canvas.toBlob((blob) => {
    if (!blob) { onStatus("PNG export could not be created"); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const catalogueSlug = (cataloguesUsed.length === 1 ? MANUFACTURERS[cataloguesUsed[0]].range : "mixed-terrain").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    link.href = url;
    link.download = `mortalis-layout-${catalogueSlug}-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onStatus(`PNG exported · ${pieces.length} pieces listed`);
  }, "image/png");
};

