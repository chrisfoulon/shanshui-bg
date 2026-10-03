// Endless scroller: tiles are generated in a worker, rasterised onto canvases ahead of need, and
// moved by compositor animations (WAAPI transforms), so main-thread stalls while a tile is decoded
// (0.2–0.5 s measured, STATUS.md) don't stutter the movement.
//
// Every tile follows one linear clock: tile left edge (CSS px) = its layout position - offset(t),
// offset(t) = speed * (t - t0). Each tile gets its own short animation with an explicit startTime
// on the document timeline, so all tiles move in lockstep and the numbers stay small.
// opts.motion picks how the clock is shown (smooth / step / timer); see the comment at its default.
import { createWorld } from "./shanshui.js";

const OVERLAP = 2; // CSS px each tile extends under the next, hides subpixel hairlines at joins

// Chris's chosen look and motion (2026-10-03). Every option falls back to these; the demo panel
// reads them too. UPSTREAM_STYLE gives the original {Shan, Shui}* ink and paper back.
export const DEFAULTS = {
  speed: 20, // CSS px/s; below ~20 thin lines visibly pulse (see STATUS.md)
  zoom: 1.5,
  drift: 20, // vertical CSS px/s
  turn: 20, // mean s between vertical direction changes
  motion: "smooth",
  soften: 0,
  supersample: 1,
  ink: "#110349",
  inkStrength: 2,
  paper: "#f7deb8",
  grain: 3,
  night: false,
};
export const UPSTREAM_STYLE = { ink: null, inkStrength: 1, paper: null, grain: 1, night: false };

export function startScroller(container, opts = {}) {
  const seed = opts.seed ?? String(Math.floor(Math.random() * 1e9));
  const speed = opts.speed ?? DEFAULTS.speed;
  const ahead = opts.ahead ?? 2; // screens rendered beyond the right edge
  const onStat = opts.onStat || (() => {});
  const still =
    opts.still ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // smooth: linear compositor animation (redraws every display frame, subpixel positions);
  // step: compositor animation that only updates fps times a second (default: once per device
  // pixel, which looks stuttery at slow speeds); timer: the same steps moved from the main thread.
  const motion = opts.motion ?? DEFAULTS.motion;
  const fps = opts.fps ?? null;
  // subpixel: browsers may snap a translate-only layer to whole pixels, so a slow scroll jumps one
  // pixel at a time whatever the frame rate. An invisible rotation (0.02 px over the screen height)
  // makes the transform non-axis-aligned, which forces filtered, sub-pixel compositing instead.
  const tail = opts.subpixel ? " rotate(0.001deg)" : "";
  const tx = (x) => `translateX(${x}px)${tail}`;
  // soften: a thin line moving by fractions of a pixel alternates between sharp (on the pixel grid)
  // and smeared over two pixels, a once-per-pixel pulse that reads as stepping at slow speeds
  // (measured: sharpness swings ~34% per pixel travelled). Filtering each tile horizontally once,
  // when drawn, removes the pulse; scrolling cost is unchanged.
  // Value = number of filter passes (true = 1); more passes, less pulsing, softer lines.
  // supersample: raster tiles at N× the device resolution; the compositor scales them down, so each
  // screen pixel averages N×N tile pixels and that average moves with the content (as font
  // renderers do with sub-pixel glyph positions). Memory and raster cost grow by N².
  const supersample = opts.supersample ?? DEFAULTS.supersample;
  const soften = opts.soften === true ? 1 : Math.max(0, Math.round(+(opts.soften ?? DEFAULTS.soften) || 0));
  if (!["smooth", "step", "timer"].includes(motion)) throw new Error("unknown motion " + motion);

  if (getComputedStyle(container).position == "static") container.style.position = "relative";
  container.style.overflow = "hidden";
  // zoom: tiles are drawn zoom× the screen height, so a given screen speed passes zoom× less
  // landscape (the pulse rate follows screen px/s, so zoom in and speed up), and strokes are thicker.
  // drift: vertical movement over the extra height, in CSS px/s; 0 = off. turn: see startDrift.
  const zoom = opts.zoom ?? DEFAULTS.zoom;
  const drift = opts.drift ?? DEFAULTS.drift;
  const turn = opts.turn ?? DEFAULTS.turn;
  const strip = document.createElement("div"); // holds the tiles; drifts vertically when zoomed
  Object.assign(strip.style, { position: "absolute", left: "0", top: "0", width: "100%", willChange: "transform" });
  container.appendChild(strip);
  let driftAnim = null;

  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.postMessage({ seed });
  // Style, applied once per tile when it is drawn (no scrolling cost). UPSTREAM_STYLE reproduces upstream.
  //   ink: CSS colour the black of the drawing turns into (null = upstream grey ink, untouched)
  //   inkStrength: 1 = upstream; <1 lighter, >1 darker (up to 2)
  //   paper: CSS hex colour of the paper's mean tone (null = upstream #f0e4cc); grain: texture amount
  //   night: invert the finished tile (dark paper, light ink)
  const ink = opts.ink === undefined ? DEFAULTS.ink : opts.ink; // null = upstream ink
  const inkStrength = opts.inkStrength ?? DEFAULTS.inkStrength;
  const night = !!(opts.night ?? DEFAULTS.night);
  const paper = makePaper(seed, opts.paper === undefined ? DEFAULTS.paper : opts.paper, opts.grain ?? DEFAULTS.grain);

  let tiles = []; // {canvas, anim}
  let W, H, HT, dpr, scale, stepPx, stepMs; // screen size, tile height, world units -> CSS px, step
  let nextWX = 0; // world x where the next tile starts (only grows: the world is forward-only)
  let nextPX = 0; // layout x (CSS px) of the next tile
  let t0 = null; // clock origin; null until the first screen is ready
  let pausedAt = null;
  let busy = false;
  let generation = 0; // bumps on resize, drops tiles built for the old size
  let stopped = false;
  let pending = new Map();
  let reqId = 0;

  worker.onmessage = (e) => {
    const cb = pending.get(e.data.id);
    pending.delete(e.data.id);
    cb && cb(e.data);
  };
  const askWorker = (msg) =>
    new Promise((res) => {
      msg.id = ++reqId;
      pending.set(msg.id, res);
      worker.postMessage(msg);
    });

  const now = () => document.timeline.currentTime;
  const offset = () => (t0 == null ? 0 : speed * (((pausedAt ?? now()) - t0) / 1000));

  function layout() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = window.devicePixelRatio || 1;
    HT = Math.round(H * zoom);
    scale = HT / 800; // world height is 800 units
    stepPx = fps ? speed / fps : 1 / dpr; // CSS px per step: fixed rate, or one device pixel
    stepMs = (stepPx / speed) * 1000;
  }

  async function buildTile() {
    const gen = generation;
    const px = nextPX, wx = nextWX;
    const tw = W / scale; // world units per tile (without overlap)
    nextPX += W;
    nextWX += tw;
    const rd = dpr * supersample; // raster pixels per CSS px
    const cw = Math.round((W + OVERLAP) * rd), ch = Math.round(HT * rd);
    // With soften, the tile is composed with a margin of mD device px on every side and blurred
    // into the final canvas, so its edges blur against real neighbouring content, not transparency.
    const mD = 2 * soften, m = mD / rd; // each pass spreads one device px
    const t = performance.now();
    const res = await askWorker({
      x0: wx - m / scale, x1: wx + (W + OVERLAP + m) / scale, w: cw + 2 * mD, h: ch,
    });
    const url = URL.createObjectURL(new Blob([res.bytes], { type: "image/svg+xml" }));
    const img = new Image();
    img.src = url;
    await img.decode();
    const t1 = performance.now();
    const compose = (c) => {
      const ctx = c.getContext("2d");
      ctx.save();
      ctx.scale(rd, rd);
      ctx.translate(-(px - m), 0); // paper pattern is anchored to layout x, so it runs on across tiles
      ctx.fillStyle = paper;
      ctx.fillRect(px - m, 0, W + OVERLAP + 2 * m, HT + 2 * m);
      ctx.restore();
      ctx.globalCompositeOperation = "multiply";
      if (ink == null && inkStrength == 1) {
        ctx.drawImage(img, 0, mD); // upstream look: the drawing multiplied straight onto the paper
      } else {
        // Ink layer: the drawing on white (multiplying that is the same as multiplying the drawing),
        // recoloured with "screen" (black -> ink colour, white stays white), lightened with white.
        const L = document.createElement("canvas");
        L.width = c.width;
        L.height = c.height;
        const l = L.getContext("2d");
        l.fillStyle = "#fff";
        l.fillRect(0, 0, L.width, L.height);
        l.drawImage(img, 0, mD);
        if (ink != null) {
          l.globalCompositeOperation = "screen";
          l.fillStyle = ink;
          l.fillRect(0, 0, L.width, L.height);
        }
        if (inkStrength < 1) {
          l.globalCompositeOperation = "source-over";
          l.globalAlpha = 1 - inkStrength;
          l.fillStyle = "#fff";
          l.fillRect(0, 0, L.width, L.height);
        }
        ctx.drawImage(L, 0, 0);
        if (inkStrength > 1) { // multiply again, partly: darker ink
          ctx.globalAlpha = Math.min(1, inkStrength - 1);
          ctx.drawImage(L, 0, 0);
          ctx.globalAlpha = 1;
        }
        L.width = L.height = 0;
      }
      if (night) {
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.globalCompositeOperation = "source-over";
    };
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    if (!soften) {
      compose(canvas);
    } else {
      const big = document.createElement("canvas");
      big.width = cw + 2 * mD;
      big.height = ch + 2 * mD;
      compose(big);
      // Horizontal [1/4, 1/2, 1/4] filter: a half-pixel shift is a bilinear [1/2, 1/2] average, and
      // two opposite half shifts mixed 50/50 give [1/4, 1/2, 1/4]. Vertical detail is untouched
      // (the movement, and so the pulsing, is horizontal only). CSS blur() was tried: Chrome
      // ignored 0.5 px and smeared 0.8 px into mush.
      // Each further pass convolves again: 2 passes = [1, 4, 6, 4, 1] / 16, and so on.
      const pass = (src, dst, d) => { // d: offset of src in dst, both axes
        const ctx = dst.getContext("2d");
        ctx.drawImage(src, d - 0.5, d);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(src, d + 0.5, d);
      };
      let src = big;
      for (let i = 1; i < soften; i++) {
        const next = document.createElement("canvas");
        next.width = cw + 2 * mD;
        next.height = ch + 2 * mD;
        pass(src, next, 0);
        src.width = src.height = 0;
        src = next;
      }
      pass(src, canvas, -mD);
      src.width = src.height = 0;
    }
    URL.revokeObjectURL(url);
    onStat({
      tile: Math.round(px / W), workerMs: Math.round(res.ms), mb: +(res.bytes.length / 1e6).toFixed(1),
      decodeMs: Math.round(t1 - t - res.ms), drawMs: Math.round(performance.now() - t1),
    });
    if (gen != generation || stopped) return;
    mount(canvas, px);
  }

  function mount(canvas, px) {
    Object.assign(canvas.style, {
      position: "absolute", left: "0", top: "0", width: W + OVERLAP + "px", height: HT + "px",
      willChange: "transform",
    });
    // whole device pixels scrolled so far; timer mode uses the step its tiles were last moved to,
    // which lags the clock while the main thread is busy (e.g. decoding this very tile)
    const k = motion == "timer" && lastK >= 0 ? lastK : Math.floor(offset() / stepPx);
    const x = motion == "smooth" ? px - offset() : px - k * stepPx;
    if (x < W && t0 != null) onStat({ late: Math.round(px / W), visibleBy: Math.round(W - x) });
    canvas.style.transform = tx(x);
    strip.appendChild(canvas);
    const tile = { canvas, px, anim: null };
    tiles.push(tile);
    if (still || motion == "timer") return;
    const end = -(W + OVERLAP);
    if (motion == "smooth") {
      tile.anim = canvas.animate(
        [{ transform: tx(x) }, { transform: tx(end) }],
        { duration: ((x - end) / speed) * 1000, fill: "forwards", easing: "linear" },
      );
      if (pausedAt != null) {
        tile.anim.pause();
        tile.anim.currentTime = 0;
      } else if (t0 != null) {
        tile.anim.startTime = now();
      } else {
        tile.anim.pause(); // first screen: held until the clock starts
      }
    } else {
      // step: n jumps of stepPx, one every stepMs. The animation starts at the clock time
      // of step k, so every tile jumps at the same instants (t0 + j * stepMs) and joins stay aligned.
      const n = Math.ceil((x - end) / stepPx);
      tile.anim = canvas.animate(
        [{ transform: tx(x) }, { transform: tx(x - n * stepPx) }],
        { duration: n * stepMs, fill: "forwards", easing: `steps(${n}, end)` },
      );
      if (t0 == null) {
        tile.anim.pause(); // first screen: held until the clock starts (k = 0 then)
      } else if (pausedAt != null) {
        tile.anim.pause();
        tile.anim.currentTime = pausedAt - (t0 + k * stepMs);
      } else {
        tile.anim.startTime = t0 + k * stepMs;
      }
    }
    tile.anim.onfinish = () => drop(tile);
  }

  // timer: move every tile on the main thread, only when the whole-pixel offset changes.
  let lastK = -1;
  function tick() {
    if (t0 == null || pausedAt != null) return;
    const k = Math.floor(offset() / stepPx);
    if (k == lastK) return;
    lastK = k;
    for (const t of [...tiles]) {
      const x = t.px - k * stepPx;
      if (x < -(W + OVERLAP)) drop(t);
      else t.canvas.style.transform = tx(x);
    }
  }

  function drop(tile) {
    tile.anim && tile.anim.cancel();
    tile.canvas.remove();
    tile.canvas.width = tile.canvas.height = 0; // release the bitmap now, not at GC
    tiles = tiles.filter((t) => t != tile);
  }

  // Drift: move vertically at a steady `drift` px/s, reversing after a random 0.5–1.5 × `turn`
  // seconds, or earlier at the top or bottom. Each run is one compositor animation whose easing has
  // short ramps at both ends (~15% of the run), so reversals are gentle without a long crawl.
  // The next run is chained from onfinish (main thread); being late there is harmless, since the
  // strip is at rest at the end of a run.
  let driftY = 0;
  let driftDir = 1; // +1 moves the view down the painting (strip goes up)
  function startDrift() {
    driftAnim && driftAnim.cancel();
    driftAnim = null;
    const extra = HT - H;
    strip.style.height = HT + "px";
    driftY = -extra / 2; // begin mid-height
    driftDir = Math.random() < 0.5 ? 1 : -1;
    strip.style.transform = `translateY(${driftY}px)`;
    if (extra <= 0 || still || !drift) return;
    const glide = () => {
      let secs = turn * (0.5 + Math.random());
      let to = driftY - driftDir * drift * secs;
      if (to < -extra || to > 0) { // would pass an edge: stop there instead
        to = Math.min(0, Math.max(-extra, to));
        secs = Math.abs(to - driftY) / drift;
      }
      if (secs < 1) { // already at an edge: turn round and go again
        driftDir = -driftDir;
        return glide();
      }
      const ms = secs * 1000 * 1.15; // the ramps slow the mean a little; keep peak speed ≈ drift
      driftAnim = strip.animate(
        [{ transform: `translateY(${driftY}px)` }, { transform: `translateY(${to}px)` }],
        { duration: ms, fill: "forwards", easing: "cubic-bezier(0.15, 0, 0.85, 1)" },
      );
      if (pausedAt != null) driftAnim.pause();
      const mine = driftAnim;
      driftAnim.onfinish = () => {
        if (driftAnim != mine) return; // cancelled by a resize or stop
        driftY = to;
        strip.style.transform = `translateY(${to}px)`;
        driftDir = -driftDir;
        glide();
      };
    };
    glide();
  }

  function startClock() {
    t0 = now();
    for (const t of tiles) if (t.anim) t.anim.startTime = t0;
  }

  async function pump() {
    if (busy || stopped || pausedAt != null) return;
    busy = true;
    const gen = generation; // a resize starts a fresh loop; this one must then bow out
    const live = () => gen == generation && !stopped;
    try {
      if (t0 == null) {
        // first screen (plus one tile) before anything moves
        while (live() && nextPX < W * 2) await buildTile();
        if (!live()) return;
        if (!still) startClock();
      }
      if (still) return;
      while (live() && pausedAt == null && nextPX - offset() < W * (1 + ahead)) await buildTile();
    } finally {
      if (gen == generation) busy = false;
    }
  }

  function pause() {
    if (pausedAt != null || t0 == null) return;
    pausedAt = now();
    for (const t of tiles) t.anim && t.anim.pause();
    driftAnim && driftAnim.pause();
  }
  function play() {
    if (pausedAt == null) return;
    t0 += now() - pausedAt;
    pausedAt = null;
    for (const t of tiles) t.anim && t.anim.play();
    driftAnim && driftAnim.play();
  }

  const onVisibility = () => (document.hidden ? pause() : play());
  document.addEventListener("visibilitychange", onVisibility);

  // Resize: the world can't go back, so drop the tiles and carry on from the next unrendered ground.
  let resizeTimer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const r = container.getBoundingClientRect();
      if (Math.round(r.width) == W && Math.round(r.height) == H) return;
      generation++;
      for (const t of [...tiles]) drop(t);
      layout();
      startDrift();
      nextPX = 0;
      t0 = null;
      lastK = -1;
      clearInterval(stepTimer);
      stepTimer = motion == "timer" && !still ? setInterval(tick, stepMs) : null;
      busy = false;
      pump();
    }, 300);
  });

  layout();
  startDrift();
  ro.observe(container);
  const timer = setInterval(pump, 250);
  let stepTimer = motion == "timer" && !still ? setInterval(tick, stepMs) : null;
  pump();

  return {
    seed,
    pause,
    play,
    // current on-screen x of each tile (CSS px), as composited; for checks and debugging
    positions: () => tiles.map((t) => new DOMMatrix(getComputedStyle(t.canvas).transform).m41),
    tileWidth: () => W,
    stop() {
      stopped = true;
      clearInterval(timer);
      clearInterval(stepTimer);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      worker.terminate();
      for (const t of [...tiles]) drop(t);
      driftAnim && driftAnim.cancel();
      strip.remove();
    },
  };
}

// Upstream's paper: 512² mirrored noise, warm tint (upstream/index.html, bgcanv script).
// paperHex: the mean tone (upstream's is about #f0e4cc); grain scales the texture around that mean.
// With the defaults (null, 1) the pixels are upstream's exactly.
function makePaper(seed, paperHex, grain) {
  const n = paperHex && parseInt(paperHex.replace("#", ""), 16);
  const f = paperHex ? [(n >> 16) / 240, ((n >> 8) & 255) / 240, (n & 255) / 240] : [1, 0.95, 0.85];
  const w = createWorld("paper:" + seed); // its own PRNG/noise, independent of the landscape
  const reso = 512;
  const c = document.createElement("canvas");
  c.width = c.height = reso;
  const ctx = c.getContext("2d");
  for (let i = 0; i < reso / 2 + 1; i++) {
    for (let j = 0; j < reso / 2 + 1; j++) {
      let v = 245 + w.noise.noise(i * 0.1, j * 0.1) * 10;
      v -= w.random() * 20;
      if (grain != 1) v = 240 + grain * (v - 240); // 240 ≈ the mean of upstream's v
      ctx.fillStyle = `rgb(${(v * f[0]).toFixed(0)},${(v * f[1]).toFixed(0)},${(v * f[2]).toFixed(0)})`;
      ctx.fillRect(i, j, 1, 1);
      ctx.fillRect(reso - i, j, 1, 1);
      ctx.fillRect(i, reso - j, 1, 1);
      ctx.fillRect(reso - i, reso - j, 1, 1);
    }
  }
  return ctx.createPattern(c, "repeat");
}
