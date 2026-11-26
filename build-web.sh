#!/usr/bin/env bash
# Rebuilds the app UI bundle (only needed if you change files in web/).
# Needs Node.js:  npx esbuild ...
set -e
cd "$(dirname "$0")"
OUT=app/src/main/assets/app
mkdir -p "$OUT"
npx --yes esbuild@0.24 web/app.js --bundle --format=iife --target=chrome80 --charset=utf8 --outfile="$OUT/app.bundle.js"
cp web/index.html web/app.css web/icon.png "$OUT/"
echo "Built $OUT/app.bundle.js"
