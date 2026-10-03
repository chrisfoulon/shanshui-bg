#!/usr/bin/env bash
# Steady-state CPU of the demo per motion mode, in a real (visible, GPU-composited) browser window.
# Usage: bench/cpu.sh chromium|firefox [speed=12] [warmup s=20] [measure s=60]
#        VARIANTS="smooth step smooth step" bench/cpu.sh ...   to repeat or reorder variants
# Opens a fresh full-screen window per variant on the current display: keep it visible and don't
# touch the machine while it runs (a hidden page pauses; other activity pollutes the numbers).
# Prints: variant, CPU % of one core summed over the whole browser process tree, and its RSS.
set -u
browser=${1:-chromium}; speed=${2:-12}; warm=${3:-20}; dur=${4:-60}
cd "$(dirname "$0")/.."
log=$(mktemp)
node bench/serve.mjs >"$log" 2>/dev/null & srv=$!
trap 'kill $srv 2>/dev/null; rm -f "$log"' EXIT
sleep 0.5
hz=$(getconf CLK_TCK)

tree() { # pid and all its descendants
  local all; all=$(ps -eo pid=,ppid=)
  local list=$1 frontier=$1 next
  while [ -n "$frontier" ]; do
    next=$(echo "$all" | awk -v f=" $frontier " 'index(f, " " $2 " ") {print $1}' | tr '\n' ' ')
    list="$list $next"; frontier=$(echo $next)
  done
  echo $list
}
ticks() { local s=0 t; for p in $(tree $1); do t=$(awk '{print $14+$15}' /proc/$p/stat 2>/dev/null) && s=$((s + t)); done; echo $s; }
rss() { local s=0 r; for p in $(tree $1); do r=$(awk '/VmRSS/{print $2}' /proc/$p/status 2>/dev/null) && s=$((s + r)); done; echo $((s / 1024)); }

for v in ${VARIANTS:-still smooth step timer}; do
  q="seed=cpu&speed=$speed&report=1"; [ $v = still ] && q="$q&still=1" || q="$q&motion=$v"
  url="http://127.0.0.1:8765/demo/?$q"
  case $browser in
    chromium) prof=$HOME/snap/chromium/common/shanshui-cpu
      chromium --user-data-dir="$prof" --no-first-run --kiosk "$url" >/dev/null 2>&1 & ;;
    firefox) prof=$HOME/snap/firefox/common/shanshui-cpu; mkdir -p "$prof"
      firefox --new-instance --profile "$prof" --kiosk "$url" >/dev/null 2>&1 & ;;
  esac
  pid=$!
  sleep "$warm"
  : >"$log"
  a=$(ticks $pid); sleep "$dur"; b=$(ticks $pid)
  # page's own reports during the measured window: visibility states seen, mean rAF fps
  rep=$(grep -ao '{.*}' "$log" | awk -F'[:,}"]+' '{for(i=1;i<NF;i++){if($i=="vis")v[$(i+1)]=1; if($i=="fps"){s+=$(i+1);n++}}} END{for(k in v)printf "%s ",k; if(n)printf "fps %.0f", s/n}')
  echo "$v $(( (b - a) * 100 / hz / dur ))% $(rss $pid)MB  [$rep]"
  kill $pid 2>/dev/null; sleep 1; pkill -f -- "$prof"; sleep 2
done
