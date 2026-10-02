# STATUS — shanshui-bg
_Last touched: 2026-10-02_

## Goal
A slowly scrolling {Shan, Shui}* landscape (Lingdong Huang, MIT) that can be used as
(a) a **moving KDE Plasma wallpaper** and (b) a **website background**, sharing one core.

## State of play
Folder created. The original is vendored unmodified in `upstream/` (pinned commit `9f754d2`). No code
written yet. Credit policy written in `CREDITS.md`.

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

## Open questions / next
- [ ] Read upstream `index.html`: how chunks are generated, whether a chunk is deterministic given
      seed + x (needed for seamless continuation), and which globals to untangle.
- [ ] Extract `renderChunk` and check that two adjacent chunks join without a seam.
- [ ] Scroller + a minimal test page.
- [ ] KDE: check whether a Plasma wallpaper plugin can host a web view running the core directly, or
      whether it should scroll tiles pre-rendered headless. Wayland vs X11 still unconfirmed.
- [ ] Web component + optional credit link.
- [ ] Alternative kept in reserve: a pre-rendered seamless video loop (hardware decode, very cheap).
