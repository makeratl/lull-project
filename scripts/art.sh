#!/usr/bin/env bash
# Builds the sound library's paintings in public/art/ from ComfyUI renders.
#
#   npm run art                 # uses the default ComfyUI output folder below
#   COMFY_OUT=... npm run art
#
# Renders: Qwen Lightning 8-step, 3:2, "Quiet nocturne painting of <scene> ... very dark deep navy blue night
# (#11141b), muted desaturated palette of navy, slate and pale moon-silver, soft painterly brushwork, minimal
# composition with lots of dark negative space, calm and sleepy, subtle film grain", negative "text, watermark,
# people, birds, bright colors, saturated, orange, daylight, busy, cartoon, 3d render". The files and seeds
# are listed below (the model likes to add gulls; check the sky).
#
# Each is cropped (optional), graded toward the app's greyer navy, and saved as a 480x320 WebP (~20 KB).
set -euo pipefail

IN=${COMFY_OUT:-"/media/makeratl/Crucial X10/AIscratch/ComfyUI/output"}
OUT=$(cd "$(dirname "$0")/.." && pwd)/public/art
mkdir -p "$OUT"

# id  source  crop (ffmpeg crop=w:h:x:y, or -)
ART=(
  "ocean  lull-tile-ocean-v2_00001_.png     -"
  "shore  lull-tile-shore-v2_00001_.png     iw*0.9:ih*0.9:iw*0.1:0"
  "rain   lull-tile-rain-probe_00001_.png   -"
  "fan    lull-tile-fan_00001_.png          -"
  "stream lull-tile-stream_00001_.png       -"
  "brook  lull-tile-brook-probe_00001_.png  -"
  "brown  lull-tile-brown_00001_.png        -"
  "pink   lull-tile-pink_00001_.png         -"
  "white  lull-tile-white_00001_.png        -"
  "haunt  lull-tile-haunt_00001_.png        -"
  "yours  lull-tile-yours_00001_.png        -"
)

for row in "${ART[@]}"; do
  read -r id src crop <<<"$row"
  f=""
  [ "$crop" != "-" ] && f="crop=$crop,"
  # Grade: less saturation, a touch darker and cooler, so the paintings sit in the sheet (#161a23) rather than glow.
  f+="eq=saturation=0.72:brightness=-0.03:gamma=0.95,colorbalance=bs=0.03:bm=0.02,scale=480:320:force_original_aspect_ratio=increase,crop=480:320"
  ffmpeg -nostdin -hide_banner -loglevel error -y -i "$IN/$src" -vf "$f" -c:v libwebp -quality 70 -compression_level 6 "$OUT/$id.webp"
done
ls -la "$OUT" | awk 'NR>3 {printf "%-12s %6d\n", $9, $5}'
du -sh "$OUT"
