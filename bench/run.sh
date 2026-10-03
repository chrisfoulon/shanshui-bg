#!/usr/bin/env bash
# Run bench/raster.html headless and print its JSON lines.
# Usage: bench/run.sh chromium|firefox [extra query string, e.g. "tiles=4&margin=1600"]
set -u
browser=${1:-chromium}; extra=${2:-}
cd "$(dirname "$0")/.."
out=$(mktemp)
node bench/serve.mjs >"$out" 2>/dev/null & srv=$!
sleep 0.5
url="http://127.0.0.1:8765/bench/raster.html?post=1&$extra"
case $browser in
  # snap browsers can only write under ~/snap/<name>/
  chromium) prof=$HOME/snap/chromium/common/shanshui-bench
    timeout 300 chromium --headless=new --user-data-dir="$prof" --window-size=1920,1080 "$url" >/dev/null 2>&1 & ;;
  firefox) prof=$HOME/snap/firefox/common/shanshui-bench; mkdir -p "$prof"
    timeout 300 firefox --headless --new-instance --profile "$prof" --window-size=1920,1080 "$url" >/dev/null 2>&1 & ;;
  *) echo "unknown browser $browser" >&2; kill $srv; exit 1 ;;
esac
for _ in $(seq 150); do grep -q '"done"' "$out" && break; sleep 2; done
pkill -f -- "$prof"   # safe here: this script's own command line does not contain the path
kill $srv 2>/dev/null
cat "$out"; rm -f "$out"
