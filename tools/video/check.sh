#!/usr/bin/env bash
# Quick check of the built demo: stream info, loudness, and a contact sheet (one frame every 8 s).
set -euo pipefail
cd "$(dirname "$0")/../../video"
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,size -of compact hindsight-demo.mp4
ffmpeg -hide_banner -i hindsight-demo.mp4 -af volumedetect -vn -f null - 2>&1 | grep -E "mean_volume|max_volume"
ffmpeg -loglevel error -y -i hindsight-demo.mp4 -vf "fps=1/8,scale=480:-2,tile=4x5" -frames:v 1 check-sheet.jpg
