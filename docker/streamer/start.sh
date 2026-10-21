#!/usr/bin/env bash
# Renders the avatar page in Chromium on a virtual screen (Xvfb), plays its sound
# into a virtual speaker (PulseAudio), and streams both to TikTok with ffmpeg.
# Chromium and ffmpeg are restarted when they stop; anything worse exits the
# container and Docker's restart policy brings it back.
set -euo pipefail

W=${STREAM_WIDTH:-720}
H=${STREAM_HEIGHT:-1280}
FPS=${STREAM_FPS:-30}
# The avatar's 3D runs on the CPU and costs roughly the same per frame regardless of size,
# so it is drawn at 15 fps (cartoon-like) while the stream itself stays at 30 fps.
RENDER_FPS=${STREAM_RENDER_FPS:-15}
VIDEO_KBPS=${STREAM_VIDEO_KBPS:-2500}
# x264 speed/quality trade-off: superfast leaves CPU for rendering; try veryfast on a strong server.
PRESET=${STREAM_PRESET:-superfast}
PAGE_URL=${PAGE_URL:-http://backend:${SERVER_PORT:-8787}/?fps=${RENDER_FPS}&lite}

export DISPLAY=:99
export XDG_RUNTIME_DIR=/tmp/runtime-streamer
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

log() { echo "[streamer] $*"; }

# Never print the stream key: it gives access to the account's LIVE.
redact() {
  local line
  while IFS= read -r line; do
    if [ -n "${STREAM_KEY:-}" ]; then line=${line//"$STREAM_KEY"/***}; fi
    echo "$line"
  done
}

# Virtual speaker: Chromium plays into "live", ffmpeg records "live.monitor".
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --log-target=stderr
until pactl info >/dev/null 2>&1; do sleep 0.5; done
pactl load-module module-null-sink sink_name=live sink_properties=device.description=live >/dev/null
pactl set-default-sink live

Xvfb "$DISPLAY" -screen 0 "${W}x${H}x24" -nolisten tcp &
until xdpyinfo >/dev/null 2>&1; do sleep 0.5; done

until curl -fsS -o /dev/null "$PAGE_URL"; do
  log "menunggu aplikasi di $PAGE_URL ..."
  sleep 2
done

keep_browser() {
  while true; do
    rm -rf /tmp/chromium-profile
    # SwiftShader renders WebGL on the CPU, since a VPS has no GPU.
    chromium \
      --no-sandbox --no-first-run --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
      --disable-translate --disable-features=Translate,HttpsUpgrades --hide-scrollbars --disable-dev-shm-usage \
      --autoplay-policy=no-user-gesture-required \
      --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --disable-gpu-compositing \
      --user-data-dir=/tmp/chromium-profile \
      --window-position=0,0 --window-size="${W},${H}" --kiosk "--app=${PAGE_URL}" \
      >/dev/null 2>&1 || true
    log "Chromium berhenti, menyalakan ulang dalam 3 detik"
    sleep 3
  done
}
keep_browser &
log "halaman avatar dibuka di layar virtual ${W}x${H} (avatar ${RENDER_FPS} fps, siaran ${FPS} fps)"

while true; do
  if [ -z "${STREAM_URL:-}" ] || [ -z "${STREAM_KEY:-}" ]; then
    log "STREAM_URL atau STREAM_KEY belum diisi di .env. Avatar sudah jalan, tapi belum disiarkan. Cek lagi dalam 30 detik."
    sleep 30
    continue
  fi
  log "mulai siaran ke ${STREAM_URL}"
  ffmpeg -nostdin -hide_banner -loglevel warning -nostats \
    -thread_queue_size 1024 -f x11grab -draw_mouse 0 -video_size "${W}x${H}" -framerate "$FPS" -i "$DISPLAY" \
    -thread_queue_size 1024 -f pulse -i live.monitor \
    -c:v libx264 -preset "$PRESET" -pix_fmt yuv420p \
    -b:v "${VIDEO_KBPS}k" -maxrate "${VIDEO_KBPS}k" -bufsize "$((VIDEO_KBPS * 2))k" \
    -g "$((FPS * 2))" -keyint_min "$((FPS * 2))" -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 44100 -ac 2 \
    -f flv "${STREAM_URL%/}/${STREAM_KEY}" 2>&1 | redact || true
  log "siaran terputus, menyambung ulang dalam 5 detik"
  sleep 5
done
