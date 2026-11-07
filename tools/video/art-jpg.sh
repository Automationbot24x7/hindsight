#!/usr/bin/env bash
# JPEG copies of the key art, used as Kling image-to-video inputs.
set -euo pipefail
cd "$(dirname "$0")/../../video/art"
for n in hero voices rebuild; do
  ffmpeg -loglevel error -y -i "$n.png" -vf scale=1920:-2 -q:v 3 "$n.jpg"
done
ls -la ./*.jpg
