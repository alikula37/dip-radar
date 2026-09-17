#!/usr/bin/env bash
# Pull the latest source and rebuild the stack. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo "Pulling the latest source..."
  git pull --ff-only
else
  echo "This is not a git checkout. Download the latest release archive, replace the files and re-run this script." >&2
fi

echo "Rebuilding and restarting the stack..."
docker compose up -d --build

echo -n "Running version: "
docker compose exec -T backend python -c "from main import local_version; print(local_version())"
