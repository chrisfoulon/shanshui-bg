# STATUS — shanshui-bg
_Last touched: 2026-10-03_

## Goal
A slowly scrolling {Shan, Shui}* landscape (Lingdong Huang, MIT) that can be used as
(a) a **moving KDE Plasma wallpaper** and (b) a **website background**, sharing one core.

## State of play
Original vendored unmodified in `upstream/` (pinned `9f754d2`); credit policy in `CREDITS.md`.
- `core/shanshui.js`: generator extracted as `createWorld(seed)` → `{load, render, prune,
  upstreamRender, mem}`. Verbatim upstream code; edits listed in its header (local Math shadow,
  world-scoped implicit globals `vtxlist0/vtxlist1/vtxlist/reso/MEM`, btoa, console.log removed).
  Runs in strict mode over 60k px for 5 seeds; generation ≈ 100 ms per 1000 px.
- `test/upstream-ref.mjs`: unmodified upstream scripts run in a Node vm sandbox (DOM stubbed) as the
  reference. `test/diff-upstream.test.mjs`: byte-identical objects/views for 5 seeds × 3 scroll
  sequences, PRNG still in lockstep. **All 15 pass (2026-10-03, ~75 s)**; negative control (seed 42 vs
  43) is caught.
- Run tests with `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=0 npm test`
  (an OOM-killed child takes the whole Claude session down on this machine; happened twice; cause was
  a cross-realm `assert.deepEqual`, which always fails and then diffs MBs of SVG).

## Decided strategy
- **Render once, slide the bitmap.** Generating SVG live is the costly part. Scrolling an already-rendered
  tile is nearly free. So generate tiles ahead of time and translate them.
- **Shared core, two thin front ends:**
  1. `renderChunk(seed, x0, x1)`: pull the generator out of upstream's single global-scope
     `index.html` into a clean module. **This is the bulk of the work.**
  2. Scroller: keep 2–3 tiles in memory, request the next before it's needed, free the old ones.
     Speed and seed are parameters. The same logic serves both front ends.
  3. Front ends: a web `<shan-shui-bg>` element, which renders in the visitor's browser into a canvas,
     respects `prefers-reduced-motion` (shows a still image) and pauses when the tab is hidden; and a
     KDE Plasma wallpaper plugin.
- **Memory, not file size, is the constraint.** A 20000×1440 strip is about 115 MB decoded, so use
  tiles about one screen wide, never one giant image.
- **Seams:** first try true continuation (upstream already generates consecutive x-chunks). Fallback:
  fade through mist or blank paper.
- **Credit generously** beyond MIT's requirement (see `CREDITS.md`).
- Working mode: **accept-edits**. "Is the seam seamless, is it smooth" can only be judged by eye.

## Upstream findings (read 2026-10-02)
- Generator is pure string-building. The only DOM/global ties: `window.btoa` in `Prng.hash`,
  `Math.random` overridden globally by `Prng`, the global `MEM`, and the paper texture (`#bgcanv`,
  512² noise, tiled; the SVG sits on top with `mix-blend-mode:multiply`).
- **Not deterministic per x.** One global PRNG stream (the Perlin table is seeded from it too), so
  chunk N depends on every chunk generated before it. Generating forward-only from a seed IS
  deterministic. Consequence: no jumping to arbitrary x. Restart = replay or new seed.
- Upstream "chunks" are objects (mountain/boat/…) with an anchor (x,y), planned in 512-px strips by
  `mountplanner`. Drawings spill well past the anchor (distMount len up to 1500). A view = all objects
  near the window concatenated, sorted by y. **So seams don't arise if tiles are cut from one shared
  object list** with a margin ≥ widest object. `renderChunk(seed,x0,x1)` → stateful
  `ensure(x1)` / `svg(x0,x1)` / `prune(x0)`.
- Upstream never frees `MEM.chunks` / `MEM.planmtx`; we must prune.
- World height fixed at 800 units (viewBox zoom 1.142).
- **A 3000-px view is ~22 MB of SVG text.** Rasterisation cost per tile is the open performance risk.
- **Measured object extents** (5 seeds × 30k px): distMount reaches 1510 px right of its anchor,
  others ≤ ~500 px either side. Upstream's 512-px render margin can drop visible distMounts. Tiles
  need margin ≈ 1600, and generation must have run to ≈ x1 + 1300 before rasterising a tile ending
  at x1 (later strips can place flatMounts up to ~1200 px left of their start).
- **Verification hook:** same seed + same generation order → our module should emit the same SVG
  string as upstream. Diff test for the extraction.
- Machine: Plasma 5.27.12, X11, `qml-module-qtwebengine` 5.15 installed, so a wallpaper plugin
  can host a WebEngineView running the web front end (one code path; costs a Chromium process).

## Open questions / next
- [x] Extract generator into a module with its own PRNG; diff-test against upstream for fixed seeds.
- [ ] Measure SVG-string → bitmap time per screen-wide tile (decides worker/pre-render strategy).
- [ ] Scroller + a minimal test page.
- [ ] KDE: check whether a Plasma wallpaper plugin can host a web view running the core directly, or
      whether it should scroll tiles pre-rendered headless. Wayland vs X11 still unconfirmed.
- [ ] Web component + optional credit link.
- [ ] Alternative kept in reserve: a pre-rendered seamless video loop (hardware decode, very cheap).
