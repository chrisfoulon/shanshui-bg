// Static server for the repo root + a POST /result sink. Used by bench/run.sh.
// Prints each posted result as one JSON line; exits after the page posts {done: true}.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = normalize(join(import.meta.dirname, ".."));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
const port = +(process.env.PORT || 8765);

createServer(async (req, res) => {
  if (req.method == "POST" && req.url == "/result") {
    let body = "";
    for await (const c of req) body += c;
    console.log(body);
    res.end("ok");
    if (JSON.parse(body).done) setTimeout(() => process.exit(0), 100);
    return;
  }
  let path = normalize(join(root, decodeURIComponent(req.url.split("?")[0])));
  if (path.endsWith("/")) path += "index.html";
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const data = await readFile(path);
    res.writeHead(200, {
      "content-type": types[extname(path)] || "application/octet-stream",
      "cache-control": "no-store", // always serve the code as it is on disk
    });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () => console.error(`serving ${root} on http://127.0.0.1:${port}/`));
