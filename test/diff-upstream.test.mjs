// The extracted core must reproduce upstream byte for byte: same seed + same load() sequence
// -> same objects (tag, x, y, SVG) and the same rendered view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../core/shanshui.js";
import { createUpstream } from "./upstream-ref.mjs";

const SEEDS = ["1", "42", "abc", "1700000000000", "shanshui"];

// Upstream's own usage: initial view at 0, then the 〈 〉 buttons move by ±200.
const SEQUENCES = {
  scrollRight: Array.from({ length: 60 }, (_, i) => i * 200),
  backAndForth: [0, 200, 400, 200, 0, -200, -400, -200, 0, 600, 1200, 5000, 4800],
  bigJumps: [0, 10000, -6000, 25000],
};
const WINDX = 3000;

// Views are ~20 MB strings: assert.equal would build a diff of them on failure, which can eat
// gigabytes. Report a short excerpt around the first difference instead.
function sameString(a, b, label) {
  if (a === b) return;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const cut = (s) => JSON.stringify(s.slice(Math.max(0, i - 60), i + 60));
  assert.fail(`${label}: lengths ${a.length}/${b.length}, first difference at ${i}\n ours: ${cut(a)}\n  ref: ${cut(b)}`);
}

function sameObjects(ours, ref) {
  const a = ours.mem.chunks, b = ref.mem.chunks;
  assert.equal(a.length, b.length, "object count");
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual([a[i].tag, a[i].x, a[i].y], [b[i].tag, b[i].x, b[i].y], `object ${i}`);
    sameString(a[i].canv, b[i].canv, `object ${i} (${a[i].tag}) SVG`);
  }
}

for (const seed of SEEDS) {
  for (const [name, seq] of Object.entries(SEQUENCES)) {
    test(`seed ${seed}, ${name}`, () => {
      const ours = createWorld(seed);
      const ref = createUpstream(seed);
      for (const x of seq) {
        ours.load(x, x + WINDX);
        ref.load(x, x + WINDX);
        const view = ref.upstreamRender(x, x + WINDX);
        sameString(ours.upstreamRender(x, x + WINDX), view, `view at x=${x}`);
        sameString(ours.render(x, x + WINDX), view, `render() at x=${x}`);
      }
      sameObjects(ours, ref);
      assert.equal(ours.mem.xmin, ref.mem.xmin);
      assert.equal(ours.mem.xmax, ref.mem.xmax);
      // The PRNG streams must still be in lockstep afterwards.
      assert.equal(ours.random(), ref.random());
    });
  }
}
