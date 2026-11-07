#!/usr/bin/env bash
# First / middle / last frame of a loop clip side by side, to check the loop is seamless.
set -euo pipefail
cd "$(dirname "$0")/../../video/clips"
n=${1:-hero-loop}
ffmpeg -loglevel error -y -i "$n.mp4" -vf "select='eq(n\,0)+eq(n\,60)+eq(n\,120)',scale=640:-2,tile=3x1" -frames:v 1 "$n-check.jpg"
echo "video/clips/$n-check.jpg"
