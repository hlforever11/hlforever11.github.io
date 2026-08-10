#!/bin/sh
set -eu

node /opt/pot-server/build/main.js --port 4416 &
provider_pid=$!

cleanup() {
  kill "$provider_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
exec /opt/venv/bin/python -m uvicorn app:app +  --host 0.0.0.0 +  --port "${PORT:-10000}" +  --proxy-headers +  --forwarded-allow-ips="*"

