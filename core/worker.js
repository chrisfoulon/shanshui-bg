// Module worker: owns one world, answers tile requests with UTF-8 SVG bytes (transferred, not copied).
// in:  {seed} once, then {id, x0, x1, w, h}   (world units; w × h output pixels)
// out: {id, bytes, ms}
import { createTiler } from "./tiles.js";

var tiler = null;
var enc = new TextEncoder();

self.onmessage = function(e) {
  var m = e.data;
  if (m.seed !== undefined) {
    tiler = createTiler(m.seed);
    return;
  }
  var t = performance.now();
  var svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='" + m.w + "' height='" + m.h +
    "' viewBox='" + m.x0 + " 0 " + (m.x1 - m.x0) + " 800' preserveAspectRatio='none'>" +
    tiler.tile(m.x0, m.x1) + "</svg>";
  var bytes = enc.encode(svg);
  self.postMessage({ id: m.id, bytes: bytes, ms: performance.now() - t }, [bytes.buffer]);
};
