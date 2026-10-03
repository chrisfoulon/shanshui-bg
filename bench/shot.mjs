// Drive headless Chromium over the DevTools protocol, in real time (no virtual time: workers and
// image decoding must actually run). Prints console messages and page errors, saves screenshots.
// Usage: node bench/shot.mjs <url> <out-prefix|-> <seconds,seconds,...> [js expression to print each time]
//   e.g. node bench/shot.mjs "http://127.0.0.1:8765/demo/?seed=demo&speed=60" ~/snap/chromium/common/demo 5,15
// Screenshots must be written under ~/snap/chromium/... only because the browser is a snap; this
// script writes them itself, so any path works.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";

const [url, prefix, times = "5", expr] = process.argv.slice(2);
const port = 9333;
const browser = spawn("chromium", [
  "--headless=new", `--remote-debugging-port=${port}`, "--window-size=1920,1080",
  `--user-data-dir=${homedir()}/snap/chromium/common/shanshui-bench`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type == "page");
  } catch {}
}
if (!target) { console.error("no browser"); browser.kill(); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const waiting = new Map();
const send = (method, params = {}) => new Promise((res) => {
  waiting.set(++id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result ?? m); waiting.delete(m.id); }
  if (m.method == "Runtime.consoleAPICalled")
    console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method == "Runtime.exceptionThrown")
    console.log("[exception]", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method == "Log.entryAdded") console.log(`[log ${m.params.entry.level}]`, m.params.entry.text, m.params.entry.url ?? "");
});
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
const t0 = Date.now();
await send("Page.navigate", { url });
for (const s of times.split(",").map(Number)) {
  await sleep(Math.max(0, s * 1000 - (Date.now() - t0)));
  if (expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    console.log(`[eval ${s}s]`, JSON.stringify(r.result?.value ?? r.exceptionDetails?.text ?? r));
  }
  if (prefix != "-") {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const file = `${prefix}-${s}s.png`;
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log("saved", file);
  }
}
ws.close();
browser.kill();
