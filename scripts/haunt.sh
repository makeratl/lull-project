#!/usr/bin/env bash
# Rebuilds Haunt's one-shots in public/sounds/haunt/ from the raw generated takes.
#
#   npm run haunt                     # uses the default MCP output folders below
#   ACE=... TTS=... npm run haunt     # or point at other folders
#
# Sources (not in the repo):
#   voices  – Chatterbox previews (exaggeration 0.9–1.4, cfg 0.3), listed in VOICES below
#   screams – ACE-Step a cappella takes: prompt "a cappella, solo female|male vocal only, no instruments,
#             no drums, no music, dry recording, … horror movie scream", 12 s, lyrics "Aaaah!" / "Nooo!"
#   knock   – synthesized here
#
# To add a clip: add a row below, run this, and add its name to HAUNT_CLIPS in src/core/constants.ts.
set -euo pipefail

ACE=${ACE:-$HOME/AppWork/mcps/ace-step-mcp/productions/lull-halloween}
TTS=${TTS:-$HOME/AppWork/mcps/chatterbox-mcp/productions}
OUT=$(cd "$(dirname "$0")/.." && pwd)/public/sounds/haunt
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

ff() { ffmpeg -nostdin -hide_banner -loglevel error -y "$@"; }

# Trim trailing silence, soften the very end, encode mono 80 kbps MP3.
encode() { ff -i "$1" -af "areverse,silenceremove=start_periods=1:start_threshold=-55dB,afade=t=in:d=0.3,areverse" -ac 1 -ar 44100 -c:a libmp3lame -b:a 80k "$OUT/$2.mp3"; }

# Ghost voice: trim, reversed-echo swell into each word, pitch down ~12%, band-limit, cavernous echo.
# Chatterbox renders at 24 kHz, hence asetrate=24000*0.88.
VOICES=(
  "dont-fall-asleep preview_belle_1790732269902"
  "under-the-bed    preview_diane_1790732282679"
  "still-awake      preview_sam_1790732283941"
  "behind-you       preview_david_1790732284867"
  "let-me-in        preview_kevin_1790732285829"
  "listening        preview_belle_1790732287521"
  "so-cold          preview_paul_1790732288732"
  "i-see-you        preview_diane_1790732290509"
  "come-play        preview_sam_1790732291573"
  "the-light        preview_belle_1790732292958"
)
for row in "${VOICES[@]}"; do
  read -r name src <<<"$row"
  ff -i "$TTS/$src.wav" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,apad=pad_dur=1.2,aecho=0.8:0.7:90|170|260:0.5|0.35|0.2,areverse,asetrate=24000*0.88,aresample=44100,highpass=f=180,lowpass=f=5000,apad=pad_dur=1.5,aecho=0.8:0.6:400|780:0.35|0.18,loudnorm=I=-20:TP=-3,aresample=44100" -ac 1 "$TMP/$name.wav"
  encode "$TMP/$name.wav" "$name"
done

# Screams: a clean stretch of each take (name, take, start s, length s), with room echo.
SCREAMS=(
  "shriek f_2 0   5.5"
  "wail   f_4 0   7"
  "howl   m_3 0.5 3.5"
  "moan   m_4 0   6"
  "no     m_1 0   5"
  "groan  m_2 0   4.5"
)
for row in "${SCREAMS[@]}"; do
  read -r name take ss t <<<"$row"
  src=$(ls "$ACE"/lull_scream_"$take"_*.wav | head -1)
  ff -ss "$ss" -t "$t" -i "$src" -af "silenceremove=start_periods=1:start_threshold=-40dB,afade=t=in:d=0.04,afade=t=out:st=$(echo "$t - 0.6" | bc):d=0.6,highpass=f=150,apad=pad_dur=2,aecho=0.8:0.55:120|260|430|700:0.45|0.3|0.2|0.12,loudnorm=I=-19:TP=-2,aresample=44100" -ac 1 "$TMP/$name.wav"
  encode "$TMP/$name.wav" "$name"
done

# Knock: three low thuds (decaying 95 Hz sine plus a noise transient), half a second apart.
ff -f lavfi -i "aevalsrc='(sin(2*PI*95*t)*0.9+(random(0)-0.5)*0.6*exp(-60*t))*exp(-18*t)':s=44100:d=0.35" "$TMP/thud.wav"
ff -i "$TMP/thud.wav" -i "$TMP/thud.wav" -i "$TMP/thud.wav" -filter_complex "[1]adelay=520[b];[2]adelay=1040[c];[0][b][c]amix=inputs=3:normalize=0,apad=pad_dur=1.5,lowpass=f=900,aecho=0.8:0.4:60|140:0.4|0.2,loudnorm=I=-21:TP=-3" -ac 1 "$TMP/knock.wav"
encode "$TMP/knock.wav" knock

ls "$OUT" | wc -l | xargs echo "clips:"
du -sh "$OUT"
