#!/usr/bin/env bash
# Saves TikTok's RTMP Server URL and Stream Key to .env and restarts only the streamer.
# Usage: ./scripts/set-stream-key.sh "<Server URL>" "<Stream Key>"
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 2 ]; then
  echo "Pakai: $0 \"<Server URL>\" \"<Stream Key>\""
  echo "Ambil keduanya dari livecenter.tiktok.com/producer setelah klik \"Save & Go LIVE\"."
  exit 1
fi
[ -f .env ] || { echo ".env belum ada. Jalankan dulu: cp .env.example .env"; exit 1; }

# Single quotes keep characters like $ ? & in the key literal for docker compose.
set_var() {
  local key=$1 value=$2
  if grep -q "^${key}=" .env; then
    K="$key" V="$value" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
      index($0, k "=") == 1 { print k "='\''" v "'\''"; next } { print }' .env > .env.tmp
    mv .env.tmp .env
  else
    printf "%s='%s'\n" "$key" "$value" >> .env
  fi
}

set_var STREAM_URL "$1"
set_var STREAM_KEY "$2"
chmod 600 .env

docker compose up -d --force-recreate streamer
echo "Stream key tersimpan. Cek siarannya: docker compose logs -f streamer"
