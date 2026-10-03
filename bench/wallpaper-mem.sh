#!/usr/bin/env bash
# Memory and CPU of the installed Plasma wallpaper (QtWebEngine inside plasmashell), from a fresh start.
# Usage: bench/wallpaper-mem.sh [minutes=6] [label]
# Reinstalls kde/package, reloads the wallpaper (image, then back), then samples every 5 s:
# PSS of the page's renderer process and of plasmashell (PSS splits shared pages fairly), and CPU
# (% of one core) of each. Prints a summary line at the end; the desktop shows the wallpaper restart.
set -u
mins=${1:-6}; label=${2:-run}
cd "$(dirname "$0")/.."
kde/install.sh >/dev/null
qplug() {
  qdbus org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript \
    "desktops().forEach(function(d){ d.wallpaperPlugin = '$1'; })" >/dev/null
}
shell=$(pgrep -x plasmashell)
renderers() { # QtWebEngine renderer processes descended from plasmashell
  for p in $(pgrep -f "QtWebEngineProcess --type=renderer"); do
    q=$p; while [ "$q" -gt 1 ]; do q=$(awk '{print $4}' /proc/$q/stat 2>/dev/null) || break
      [ "$q" = "$shell" ] && { echo $p; break; }; done
  done
}
old=$(renderers | tr '\n' ' ')
qplug org.kde.image; sleep 3; qplug org.shanshui.wallpaper
r=""
for i in $(seq 40); do # wait for a renderer that wasn't there before
  sleep 0.5
  for p in $(renderers); do
    case " $old " in *" $p "*) ;; *) r=$p ;; esac
  done
  [ -n "$r" ] && break
done
[ -z "$r" ] && { echo "no new renderer appeared (old: $old)"; exit 1; }
hz=$(getconf CLK_TCK)
pss() { awk '/^Pss:/{print int($2/1024)}' /proc/$1/smaps_rollup 2>/dev/null; }
ticks() { awk '{print $14+$15}' /proc/$1/stat 2>/dev/null; }
echo "renderer $r, plasmashell $shell; sampling ${mins} min"
ra=$(ticks $r); sa=$(ticks $shell); n=$((mins * 12)); out=""
for i in $(seq $n); do
  sleep 5
  rb=$(ticks $r) || break; sb=$(ticks $shell)
  line="$(( (rb - ra) * 100 / hz / 5 )) $(pss $r) $(( (sb - sa) * 100 / hz / 5 )) $(pss $shell)"
  out="$out$line"$'\n'; ra=$rb; sa=$sb
  printf "%s  renderer %3d%% %4d MB   plasmashell %3d%% %4d MB\n" "$(date +%T)" $line
done
# summary over the last two thirds (skips the start-up builds): median / max of each column
echo "$out" | awk -v L="$label" 'NF{c[NR]=$1; m[NR]=$2; s[NR]=$3; p[NR]=$4; n=NR}
  function med(a, lo, hi,   i, k, t, b) { k = 0; for (i = lo; i <= hi; i++) b[++k] = a[i]
    for (i = 1; i <= k; i++) for (t = i + 1; t <= k; t++) if (b[t] < b[i]) { x = b[i]; b[i] = b[t]; b[t] = x }
    return b[int((k + 1) / 2)] }
  function mx(a, lo, hi,   i, v) { v = a[lo]; for (i = lo; i <= hi; i++) if (a[i] > v) v = a[i]; return v }
  END { lo = int(n / 3) + 1
    printf "%s: renderer PSS median %d max %d MB, CPU median %d%% | plasmashell PSS median %d MB, CPU median %d%%\n",
      L, med(m, lo, n), mx(m, lo, n), med(c, lo, n), med(p, lo, n), med(s, lo, n) }'
