# STATUS — shanshui-bg
_Last touched: 2026-10-04_

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
- **Scroller works (2026-10-03, headless screenshots; not yet judged live by eye):**
  - `core/tiles.js`: `createTiler(seed).tile(x0, x1)` (forward-only, margin 1600, lead 1300,
    culls objects by real x-extent).
  - `core/worker.js`: module worker, returns SVG as transferred UTF-8 bytes.
  - `core/scroller.js`: `startScroller(el, {seed, speed, ahead, still, onStat})`. Paper texture is
    upstream's, painted per tile and anchored to layout x. Each canvas tile has its own WAAPI animation
    with an explicit startTime on one linear clock, overlapping the next by 2 px. It pauses when the
    tab is hidden, shows a still image under prefers-reduced-motion, and on resize drops the tiles and
    continues forward.
  - `opts.motion`: `smooth` (60 fps subpixel), `step` (compositor, whole device pixels, all tiles
    jump on the same clock instants) or `timer` (main thread). `positions()` returns the composited x
    of each tile; headless checks show `step`/`timer` on exact whole pixels with 0 gaps.
  - `demo/index.html`: full-screen demo (`?seed=&speed=&motion=&debug=1&still=1&report=1`).
  - `test/tiles.test.mjs`: culled output equals what an unpruned twin world gives.
- `bench/shot.mjs <url> <prefix> <s,s,…>`: real-time headless Chromium over DevTools: console,
  errors, screenshots. **`--virtual-time-budget` screenshots show blank paper (the worker doesn't
  progress), so don't use them.**
- `bench/`: `run.sh chromium|firefox [query]` runs `raster.html` headless (static server `serve.mjs`)
  and prints per-tile JSON. Profiles live under `~/snap/<browser>/common/shanshui-bench`.
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
- **A 3000-px view is ~22 MB of SVG text.**
- **Measured object extents** (5 seeds × 30k px): distMount reaches 1510 px right of its anchor,
  others ≤ ~500 px either side. Upstream's 512-px render margin can drop visible distMounts. Tiles
  need margin ≈ 1600, and generation must have run to ≈ x1 + 1300 before rasterising a tile ending
  at x1 (later strips can place flatMounts up to ~1200 px left of their start).
- **Verification hook:** same seed + same generation order → our module should emit the same SVG
  string as upstream. Diff test for the extraction.
- Machine: Plasma 5.27.12, X11, `qml-module-qtwebengine` 5.15 installed, so a wallpaper plugin
  can host a WebEngineView running the web front end (one code path; costs a Chromium process).

## Raster cost (measured 2026-10-03, headless, 1920×1080 tile = 1422 world units, margin 1600)
- SVG per tile: 14–20 MB. Blob → `Image.decode()` → `drawImage` onto a canvas:
  - Chromium 154: decode 300–650 ms, **main thread stalled 250–490 ms**; draw 160–300 ms, all on main.
  - Firefox 156: decode 600–760 ms, but mostly off-main (stall 125–185 ms); draw 180–300 ms on main.
  - `createImageBitmap(img)` after drawing re-rasterises (≈ draw cost again): no caching, don't use.
- So **each new screen costs ~0.5–1 s of CPU and a 0.2–0.5 s main-thread stall**. At a slow scroll
  (one screen per tens of seconds) the average load is small; the stall is the problem.
- Culling objects by real x-extent (regex over "x,y" pairs, ~20 ms per 1000 units, done once per
  object) removes 20–40% of each tile's bytes. Even culled, a screen is 10–14 MB: density, not margin.
- Headless timings are a proxy: no GPU, and QtWebEngine 5.15 is an older Chromium. Not yet measured there.

## Open questions / next
- [x] Extract generator into a module with its own PRNG; diff-test against upstream for fixed seeds.
- [x] Measure SVG-string → bitmap time per screen-wide tile (above).
- [x] Scroller + test page (design: worker generation, compositor-driven movement, extent culling).
- [x] **Steady CPU per motion mode** (2026-10-03, `bench/cpu.sh`, real full-screen windows at
      1920×1080, speed 12 px/s, 60 s windows; the page reported itself visible at 60 fps the whole time,
      even with the screen locked). CPU % of one core, summed over the browser's process tree:

      | | still | smooth | step | timer |
      |---|---|---|---|---|
      | Firefox 156 (runs) | 0, 0 | 8, 8, 6, 8 | 3, 3, 3, (15) | 4, 3 |
      | Chromium 154 (one run) | 4 | 10 | 6 | 6 |

      - **Whole-pixel `step` cuts the animation's cost by about two thirds** (Firefox ~8 → ~3;
        Chromium +6 → +2 over still). The (15) is an outlier from a run where the process-tree memory
        figure was also off; the first Firefox run, with a fresh profile, is discarded.
      - `timer` costs about the same as `step`, but freezes ~0.3 s and then jumps during every tile
        build (main thread), so `step` is preferred.
      - The `report=1` frame counter keeps a 60 fps rAF loop running in every variant, so the true cost
        of `step` may be a bit lower. A 60 s window may include one tile build (~1–2.5 CPU-s).
      - Step cost scales with speed: one update per device pixel.
- [x] By eye (Chris, 2026-10-03): `step` at 12 px/s is stuttery, and even `smooth` at 12 px/s shows
      visible steps. 20 px/s looks much better, but is too fast.
- **Slow-scroll pulsing, diagnosed:** a thin line moving by fractions of a pixel alternates between
  sharp and smeared over two pixels, once per pixel travelled, so the pulse runs at speed Hz (12 Hz is
  very visible; ~20 Hz blends). It is NOT pixel snapping: burst screenshots change every frame, and the
  `subpixel` rotation trick changes nothing in Chromium. Measured as the swing in per-frame horizontal
  sharpness (2 px/s, 16 shots 0.2 s apart; `bench/shot.mjs` + PIL):
  plain 34% · soften 1: 12.6% · **soften 2: 3.4% (soft)** · soften 3: 6.1% · ss 2: 12.6% ·
  **ss 2 + soften 1: 3.9%, much sharper** · ss 3: 23%. CSS `blur()` is useless (0.5 px ignored, 0.8 px
  mush). Film-credit practice (Endcrawl) is integer px/frame and no hairlines, i.e. ≥ 60 px/s at
  60 Hz, which is too fast here.
- New scroller options: `fps` (step rate), `subpixel`, `soften` (N horizontal [¼ ½ ¼] passes),
  `supersample`, `zoom` (tiles zoom× screen height, so screen speed can rise at the same landscape
  pace and strokes are thicker), and `drift` (compositor vertical pan over the extra height; see
  below).
- Demo has a **settings panel** (P / ⚙) with presets; all settings are URL params. serve.mjs now
  sends `cache-control: no-store`.
- [x] By eye (Chris): **zoom 1.5 @ 20 px/s is much smoother**, so these are now the scroller and demo
      defaults. Supersampling makes no visible difference (kept as an option, off).
- Drift (as Chris asked): a steady `drift` px/s (default 20), reversing after a random
  0.5–1.5 × `turn` s (default 20), or at the top or bottom. Short ramps (cubic-bezier 0.15/0.85) at
  each reversal. The old alternating ease-in-out sweep looked like it stopped near the ends; the random
  "glide to a random height" version was not what Chris meant.
- "Pizza Hut" signs (an upstream Easter egg on 1 in 3 one-storey pagoda roofs; the generator's only
  `<text>`) are stripped in `core/tiles.js`. The generator stays verbatim; tested.
- [x] Remeasured at the new defaults, in the wallpaper itself (see wallpaper memory below).
- Style options (applied per tile at draw time):
  - `ink`: "screen" recolours black to the ink colour.
  - `inkStrength`: white wash below 1, a second partial multiply above 1.
  - `paper`: the mean tone; `grain`: texture amount around the mean.
  - `night`: "difference" with white, i.e. invert.
  - Demo panel has Motion / Style tabs, with palettes (Default, Original (upstream), Sepia, Indigo,
    Celadon, Vermilion, Faded, Bold, Smooth paper, Night, Night indigo). A palette resets only the
    style keys it doesn't set to the defaults, so e.g. Sepia now gets strength 2 and grain 3.
- [x] Chris's settings are the defaults, in one place: `DEFAULTS` in `core/scroller.js` (speed 20,
      zoom 1.5, drift 20, turn 20, smooth, ink #110349, strength 2, paper #f7deb8, grain 3). The demo
      reads its field defaults from it. `UPSTREAM_STYLE` / `ink: null, paper: null` give the original
      look. Seed stays random. The bare demo URL renders pixel-identical to Chris's settings link.
- [ ] Object-level changes (no boats, etc.) and composition edits (needs generator changes behind
      switches) are still possible next steps.
- [x] **KDE wallpaper works and is in use (2026-10-03, Chris: "seems to work great").**
  - `kde/package` (id `org.shanshui.wallpaper`): QML `WebEngineView` (QtWebEngine 1.10) loads
    `shanshui.html`; `enabled: false` so clicks reach the desktop. Settings = one text field: paste a
    demo link (its query is passed to the page); empty = DEFAULTS.
  - `kde/build.mjs` bundles the core into one classic-script page (file:// refuses ES modules and
    module workers); the worker runs from a Blob of its source via the new `opts.workerUrl`. The bundle
    renders pixel-identical to the demo. `kde/install.sh` builds + installs (kpackagetool5, per user).
  - Undo: pick "Image" as wallpaper type. Lock screen could use the same plugin (Screen Locking →
    Appearance); untested, the greeter's sandbox may block the web view.
- **Wallpaper memory, `bench/wallpaper-mem.sh [min] [label]`** (reinstalls, reloads the wallpaper,
  samples the renderer's PSS + CPU every 5 s). Two changes, 15-min runs back to back (2026-10-04):
  renderer mean **486 MB (392–722) → 261 MB (229–303)**; CPU unchanged (renderer 2%, plasmashell 7%).
  - `ahead` 2 → 1 screen (a build takes < 1 s; one screen = 96 s at 20 px/s).
  - Each build's leftovers released at once (`img.removeAttribute("src")`, SVG bytes dropped), and the
    ink layer built in the tile itself (paper multiplied last; multiply commutes) instead of a second
    canvas. Pixels: upstream look identical, other styles ≤ 2/255 (rounding).
  - **6-min runs are useless for this:** memory steps at every tile build (±50–100 MB) and the old
    version climbed over time; only the 15-min comparison separated the two.
  - Chromium windows used ~1.1–1.7 GB each in the side-by-side test, but that is a whole browser;
    the wallpaper itself is the renderer above (+ ~30 MB of helpers, + its GPU textures in plasmashell).
- **Prior art (searched 2026-10-03):** ~a dozen ports appeared 27 Sep – 2 Oct 2026. Closest:
  theonthai45/endless-shan-shui (browser; same design: compositor scroll + tiles ahead; more terrain
  options). Measured side by side at 45 px/s: theirs 15–20% CPU steady, ours 10–12% + spikes at tile
  builds. EldinBegano/shan-shui-wallpaper (Rust, Wayland layer-shell, not X11). No native Plasma
  wallpaper plugin found. Chris's verdict on smoothness vs theirs: not given yet.
- [ ] Decide what to publish: own repo (not a fork/PR; upstream dormant since 2018), README for
      outsiders with the recording (`~/2026-10-03 22-38-08-10s.mp4`, 1.2 MB), positioned mainly as a
      KDE Plasma wallpaper. Commit `kde/`, the memory changes and `bench/wallpaper-mem.sh` first.
- [ ] Plasma 6 port (Qt 6 imports) if publishing for current KDE users.
- [ ] Optional: pause when a maximised window covers the desktop (TasksModel + WebEngineView
      lifecycleState Frozen). Half-screen tiles would halve per-build peaks further.
- [ ] Web component + optional credit link.
