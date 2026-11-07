#!/usr/bin/env bash
# One full-size frame from a clip: frame.sh <clip-name> <frame-number>
set -euo pipefail
cd "$(dirname "$0")/../../video/clips"
ffmpeg -loglevel error -y -i "$1.mp4" -vf "select='eq(n\,$2)',crop=iw*0.55:ih*0.75:iw*0.3:ih*0.05" -frames:v 1 "$1-f$2.jpg"
echo "video/clips/$1-f$2.jpg"
