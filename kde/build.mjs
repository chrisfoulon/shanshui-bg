// Bundles the core into one self-contained HTML page for the Plasma wallpaper.
// The wallpaper loads it from file://, where Chromium refuses ES modules and module workers, so the
// modules are concatenated as classic scripts and the worker is started from a Blob of its source.
// Usage: node kde/build.mjs   → kde/package/contents/ui/shanshui.html
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dirname;
const core = (f) => readFileSync(join(dir, "..", "core", f), "utf8");
// drop import lines and "export " keywords; nothing else in the core depends on modules
const classic = (src) => src.replace(/^import .*$/gm, "").replace(/^export /gm, "");
const replaceOnce = (s, from, to) => {
  if (s.split(from).length != 2) throw new Error("expected exactly one " + JSON.stringify(from));
  return s.replace(from, () => to);
};

// The worker script is not run by the page (its type makes the browser skip it); the page hands
// its text to a Blob worker, which has its own global scope. The main part is wrapped in a function
// so its top-level names stay private.
const worker = classic(core("shanshui.js")) + classic(core("tiles.js")) + classic(core("worker.js"));
let scroller = classic(core("scroller.js"));
// import.meta is a syntax error in a classic script even where it never runs
scroller = replaceOnce(scroller, `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`, "null");
const main =
  "var ShanShui = (function () {\n" + classic(core("shanshui.js")) + scroller +
  "\nreturn { startScroller: startScroller, DEFAULTS: DEFAULTS, UPSTREAM_STYLE: UPSTREAM_STYLE };\n})();";
for (const [name, src] of [["worker", worker], ["main", main]])
  if (/<\/script/i.test(src)) throw new Error(name + " contains </script");

let page = readFileSync(join(dir, "page.html"), "utf8");
page = replaceOnce(page, "<script>\n/*WORKER*/", '<script type="text/js-worker">\n' + worker);
page = replaceOnce(page, "/*MAIN*/", main);
const out = join(dir, "package", "contents", "ui", "shanshui.html");
writeFileSync(out, page);
console.log(out, (page.length / 1024).toFixed(0) + " KB");
