import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Mortalis Architect workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Mortalis Architect<\/title>/i);
  assert.match(html, /Wargaming layout utility/);
  assert.match(html, /Workspace shortcuts/);
  assert.match(html, /Browse pieces/);
  assert.match(html, /Shape the board/);
  assert.match(html, /Close terrain library/);
  assert.doesNotMatch(html, /aria-label="Right panel view"/);
  assert.match(html, /Boarding Actions Terrain Set/);
  assert.match(html, /Current generator palette/);
  assert.match(html, /Available pieces|Selected kit/);
  assert.match(html, /Generate from palette/);
  assert.ok(html.indexOf("Available pieces · selected kit") < html.indexOf("Current generator palette"), "kit pieces should appear before layout inventory");
  assert.doesNotMatch(html, /Generate uses only this persistent list/);
  // The default board is one Boarding Actions card board, 704 x 607 mm, which is
  // the board the kit is cut for and the one a single set fills.
  assert.match(html, /27.7 by 23.9 inch layout board/);
  assert.match(html, /role="toolbar" aria-label="Layout tools"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Skip to layout board/);
});

test("ships the complete first-pass catalogues and planner tools", async () => {
  // The catalogue lives in terrain.ts so the generator tests read the same numbers
  // the app draws, rather than keeping their own copy of the inventory.
  const page = await readFile(new URL("../app/terrain.ts", import.meta.url), "utf8")
    + await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const kit of [
    "Iron Labyrinth Alpha",
    "Iron Labyrinth Beta",
    "Iron Labyrinth Gamma",
    "Iron Labyrinth Doors",
    "Iron Labyrinth Floors",
    "Iron Labyrinth High Walls",
    "Iron Labyrinth Stairs",
    "Iron Labyrinth – Death Quadrant Complex",
    "Iron Labyrinth Ultima Complex",
  ]) {
    assert.ok(page.includes(kit), `missing ${kit}`);
  }

  assert.match(page, /Smart fit enabled/);
  assert.match(page, /selection-marquee/);
  assert.match(page, /copySelected/);
  assert.match(page, /pasteCopied/);
  assert.match(page, /ArrowLeft/);
  assert.match(page, /Export layout and piece manifest as PNG/);
  assert.match(page, /reserved-zone/);
  assert.match(page, /PALETTE_STORAGE_KEY/);
  assert.match(page, /mergeGeneratedSystems/);
  assert.match(page, /compatible cross-kit wall joins enabled/);
  assert.match(page, /palette-selection-summary/);
  assert.match(page, /Eberleg terrain legend/);
  assert.match(page, /print-at-home proxy for Games Workshop’s Zone Mortalis terrain/);
  assert.doesNotMatch(page, /The planner scores 24 connector-node layouts/);
});

test("keeps the desktop workspace fixed while panels scroll independently", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /body\s*\{[^}]*overflow:hidden/s);
  assert.match(css, /\.app-shell\s*\{[^}]*height:100vh[^}]*overflow:hidden/s);
  assert.match(css, /\.palette-list,\.kit-piece-list\s*\{[^}]*overflow:auto/s);
  assert.match(css, /\.inspector\s*\{[^}]*overflow:auto/s);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.workspace-rail/);
  assert.match(css, /\.stage-heading/);
  assert.match(css, /\.workspace\.library-closed/);
});

test("ships three persistent interface colour palettes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /\["taupe", "dark", "light"\]/);
  assert.match(page, /APPEARANCE_STORAGE_KEY/);
  assert.doesNotMatch(page, /scrollIntoView/);
  assert.match(css, /data-appearance="taupe"/);
  assert.match(css, /data-appearance="dark"/);
  assert.match(css, /--paper:#f5f6f4/);
});
