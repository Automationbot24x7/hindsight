#!/usr/bin/env bash
# Web-ready background loops for the site (H.264, no audio, fast start).
# Hero: the two "live" variants chained (both start and end on the key-art frame, so the chain loops seamlessly).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/media
C=video/clips
ENC=(-an -c:v libx264 -preset slow -crf 25 -profile:v high -pix_fmt yuv420p -movflags +faststart)

if [ -f "$C/hero-live-a.mp4" ] && [ -f "$C/hero-live-b.mp4" ]; then
  ffmpeg -loglevel error -y -i "$C/hero-live-a.mp4" -i "$C/hero-live-b.mp4" \
    -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,scale=1920:-2:flags=lanczos,crop=1920:trunc(ih/2)*2[v]" -map "[v]" "${ENC[@]}" public/media/hero-loop.mp4
else
  ffmpeg -loglevel error -y -i "$C/hero-loop.mp4" -vf "scale=1920:-2:flags=lanczos,crop=1920:trunc(ih/2)*2" "${ENC[@]}" public/media/hero-loop.mp4
fi
echo "hero: $(du -h public/media/hero-loop.mp4 | cut -f1)"
for n in voices rebuild; do
  ffmpeg -loglevel error -y -i "$C/$n-loop.mp4" -vf "scale=1280:-2:flags=lanczos,crop=1280:trunc(ih/2)*2" "${ENC[@]}" "public/media/$n-loop.mp4"
  echo "$n: $(du -h "public/media/$n-loop.mp4" | cut -f1)"
done
# The opening of the demo video uses the same chained hero loop.
cp public/media/hero-loop.mp4 video/clips/hero-live.mp4
