// Runs the unmodified upstream generator (upstream/index.html, scripts up to and including the
// chunk loader) inside a Node vm sandbox, as the reference for diff tests. Only the DOM is stubbed.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../upstream/index.html", import.meta.url), "utf8");
// Script blocks in document order; the generator ends with the block defining chunkrender.
const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const last = blocks.findIndex((b) => b.includes("function chunkrender"));
export const generatorSource = blocks.slice(0, last + 1).join("\n;\n");

export function createUpstream(seed) {
  const noop = () => {};
  const sandbox = {
    btoa,
    console: { log: noop },
    document: { addEventListener: noop, getElementById: () => ({ setAttribute: noop }) },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.location = { href: "http://x/?seed=" + seed };
  const ctx = vm.createContext(sandbox);
  const before = new Set(Object.getOwnPropertyNames(ctx));
  // Wrapped in one function, with `Math` aliased to the sandbox's own Math object (same object,
  // so upstream's Math.random override behaves identically): vm global lookups are ~10x slower
  // than closure lookups. The code itself is unchanged; implicit globals (MEM, vtxlist, ...)
  // still land on the sandbox.
  vm.runInContext(
    "(function(){var Math = this.Math;\n" + generatorSource + "\n;this.__api = {chunkloader: chunkloader, chunkrender: chunkrender, random: function(){return Math.random();}};}).call(this);",
    ctx,
  );
  const api = ctx.__api;
  return {
    ctx,
    before,
    load: (a, b) => api.chunkloader(a, b),
    upstreamRender: (a, b) => (api.chunkrender(a, b), ctx.MEM.canv),
    random: () => api.random(),
    get mem() {
      return ctx.MEM;
    },
  };
}
