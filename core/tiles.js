// Cuts tiles out of one forward-only world, so neighbouring tiles join without seams.
// Measured (STATUS.md): drawings reach up to ~1510 units right of their anchor, so the anchor
// window needs MARGIN; generation must run to ~x1 + LEAD before a tile ending at x1 is complete.
import { createWorld } from "./shanshui.js";

export const MARGIN = 1600;
export const LEAD = 1300;
const PAD = 10; // stroke widths reach a little past the polyline points
// Upstream's only text: a "Pizza Hut" sign on 1 in 3 one-storey pagoda roofs (an Easter egg).
// Removed from the output only, so the generator and its random stream stay identical to upstream.
const SIGN = /<text[^>]*>[^<]*<\/text>/g;

// x extent of an object's markup, from every "x,y" pair (points, paths, translate()).
function extent(canv) {
  var lo = Infinity, hi = -Infinity, m;
  var re = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;
  while ((m = re.exec(canv))) {
    var x = +m[1];
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return [lo, hi];
}

export function createTiler(seed) {
  var world = createWorld(seed);
  var genTo = 0;
  var pruned = -Infinity;

  // Markup of every object drawn inside [x0, x1], in painter's order (world units).
  // Calls must come with non-decreasing x0: ground left of x0 - MARGIN is freed.
  function tile(x0, x1) {
    if (x0 < pruned) throw new Error("tiles must move forward: " + x0 + " < " + pruned);
    while (genTo < x1 + LEAD) {
      world.load(genTo, genTo + 512);
      genTo += 512;
    }
    var out = "";
    var chunks = world.mem.chunks;
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      if (c.x <= x0 - MARGIN || c.x >= x1 + MARGIN) continue;
      if (!c.ext) {
        c.ext = extent(c.canv);
        c.out = c.canv.replace(SIGN, "");
      }
      if (c.ext[1] + PAD >= x0 && c.ext[0] - PAD <= x1) out += c.out;
    }
    world.prune(x0, MARGIN);
    pruned = x0;
    return out;
  }

  return { tile: tile, world: world };
}
