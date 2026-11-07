#!/usr/bin/env bash
# Five frames across each electric hero variant, stacked, to pick the better loop.
set -euo pipefail
cd "$(dirname "$0")/../../video/clips"
for n in hero-live-a hero-live-b; do
  ffmpeg -loglevel error -y -i "$n.mp4" -vf "select='eq(n\,0)+eq(n\,30)+eq(n\,60)+eq(n\,90)+eq(n\,120)',scale=400:-2,tile=5x1" -frames:v 1 "$n-strip.jpg"
done
ffmpeg -loglevel error -y -i hero-live-a-strip.jpg -i hero-live-b-strip.jpg -filter_complex vstack=2 live-compare.jpg
echo video/clips/live-compare.jpg
