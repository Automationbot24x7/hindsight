#!/usr/bin/env bash
# Web-sized copies of the generated art (originals in video/art are not committed).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/img
for n in priya moonboy otter me raj; do
  ffmpeg -loglevel error -y -i "video/art/$n.png" -vf scale=192:192 -c:v libwebp -quality 82 "public/img/$n.webp"
done
for n in hero voices rebuild; do
  ffmpeg -loglevel error -y -i "video/art/$n.png" -vf scale=1600:-1 -c:v libwebp -quality 80 "public/img/$n.webp"
done
ls -la public/img
