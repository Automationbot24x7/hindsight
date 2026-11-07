#!/usr/bin/env bash
# Contact sheet (start / middle / end frame) of each Kling clip, for a quick visual check.
set -euo pipefail
cd "$(dirname "$0")/../../video/clips"
for n in intro voices rebuild; do
  ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration -of csv=p=0 "$n.mp4" | head -1
  ffmpeg -loglevel error -y -i "$n.mp4" -vf "select='eq(n\,0)+eq(n\,60)+eq(n\,119)',scale=480:-2,tile=3x1" -frames:v 1 "$n-sheet.jpg"
done
ffmpeg -loglevel error -y -i intro-sheet.jpg -i voices-sheet.jpg -i rebuild-sheet.jpg -filter_complex vstack=3 sheet.jpg
