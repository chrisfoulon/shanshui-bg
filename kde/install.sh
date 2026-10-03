#!/bin/sh
# Builds the wallpaper page and installs (or updates) the Plasma wallpaper package for this user.
set -e
cd "$(dirname "$0")"
node build.mjs
cp ../CREDITS.md ../upstream/LICENSE package/
kpackagetool5 -t Plasma/Wallpaper -u package 2>/dev/null || kpackagetool5 -t Plasma/Wallpaper -i package
