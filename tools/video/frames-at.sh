#!/usr/bin/env bash
# Grab frames from the built demo at given seconds and tile them, e.g.: frames-at.sh 14 16 18 20
set -euo pipefail
cd "$(dirname "$0")/../../video"
rm -f fa_*.jpg
i=0
for t in "$@"; do
  ffmpeg -loglevel error -y -ss "$t" -i hindsight-demo.mp4 -frames:v 1 -vf scale=480:-2 "fa_$(printf %02d $i).jpg"; i=$((i+1))
done
ffmpeg -loglevel error -y -pattern_type glob -i 'fa_*.jpg' -vf "tile=${#}x1" frames-at.jpg
rm -f fa_*.jpg
echo video/frames-at.jpg
