#!/usr/bin/env bash
# One-shot installer: finds free host ports, writes them to .env and starts the stack.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop (or Docker Engine + compose v2) and retry." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running. Start Docker Desktop (or 'sudo systemctl start docker') and retry." >&2
  exit 1
fi

port_busy() {
  curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1" 2>/dev/null
}

free_port() {
  local port=$1
  while port_busy "$port"; do
    echo "Port $port is busy, trying $((port + 1))..." >&2
    port=$((port + 1))
  done
  echo "$port"
}

FRONTEND_PORT="$(free_port "${FRONTEND_PORT:-3000}")"
BACKEND_PORT="$(free_port "${BACKEND_PORT:-8000}")"

if [ ! -f .env ]; then
  cp .env.example .env
fi
# Replace or append the port settings (idempotent).
for key in FRONTEND_PORT BACKEND_PORT; do
  value="${!key}"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
done

echo "Starting Dip Radar on http://localhost:${FRONTEND_PORT} (backend http://localhost:${BACKEND_PORT})"
docker compose up -d --build

echo
echo "Dashboard : http://localhost:${FRONTEND_PORT}"
echo "Strategy Lab: http://localhost:${FRONTEND_PORT}/backtest"
echo "Signals   : http://localhost:${FRONTEND_PORT}/signals"
echo
echo "The first sync runs in the background (20-60+ min). For instant demo data:"
echo "  docker compose exec -T backend python demo_seed.py"
echo "Progress: curl http://localhost:${BACKEND_PORT}/api/meta | grep sync_in_progress"
