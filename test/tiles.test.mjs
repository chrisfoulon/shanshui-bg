// core/tiles.js: culling keeps every object that reaches into the tile, and tiles move forward only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTiler, MARGIN } from "../core/tiles.js";
import { createWorld } from "../core/shanshui.js";

const TW = 1422.2;

test("culled tile keeps every object with a point inside it, in painter's order", () => {
  const tiler = createTiler("tiles-test");
  // a twin world generated identically, never pruned: the full object list to compare against
  const twin = createWorld("tiles-test");
  let genTo = 0, droppedTotal = 0;
  for (let i = 0; i < 6; i++) {
    const x0 = i * TW, x1 = x0 + TW;
    const got = tiler.tile(x0, x1);
    while (genTo < x1 + 1300) { twin.load(genTo, genTo + 512); genTo += 512; }
    let expected = "", dropped = 0;
    for (const c of twin.mem.chunks) {
      if (c.x <= x0 - MARGIN || c.x >= x1 + MARGIN) continue;
      const xs = [...c.canv.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
      if (xs.some((x) => x >= x0 - 10 && x <= x1 + 10) || xs.some((x) => x < x0) && xs.some((x) => x > x1)) {
        expected += c.canv.replace(/<text[^>]*>[^<]*<\/text>/g, "");
      } else dropped++;
    }
    assert.ok(got.length == expected.length && got == expected, `tile ${i}: culled markup differs`);
    droppedTotal += dropped;
  }
  assert.ok(droppedTotal > 0, "culling dropped nothing (test would be vacuous)");
});

test("no sign text reaches the output, though the generator does draw signs", () => {
  const tiler = createTiler("tiles-test");
  const signed = new Set();
  for (let i = 0; i < 20; i++) {
    const out = tiler.tile(i * TW, (i + 1) * TW);
    assert.ok(!out.includes("<text"), `tile ${i}: a <text> element got through`);
    for (const c of tiler.world.mem.chunks) if (c.canv.includes("<text")) signed.add(c);
  }
  assert.ok(signed.size > 0, "no signs generated for this seed: the test would be vacuous");
});

test("tiles must not move backwards", () => {
  const tiler = createTiler("tiles-test");
  tiler.tile(3000, 4000);
  assert.throws(() => tiler.tile(1000, 2000), /forward/);
});
