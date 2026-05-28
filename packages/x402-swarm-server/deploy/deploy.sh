#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-dev}"
REMOTE_DIR="${REMOTE_DIR:-swarm-ai-data-exchange/x402-swarm-server}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

if [[ ! -f "$PKG_DIR/.env.dev" ]]; then
  echo "error: $PKG_DIR/.env.dev not found" >&2
  exit 1
fi

echo "==> Ensuring remote dir ~/$REMOTE_DIR on $REMOTE_HOST"
ssh "$REMOTE_HOST" "mkdir -p ~/$REMOTE_DIR"

echo "==> Syncing source to $REMOTE_HOST:~/$REMOTE_DIR"
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.env' \
  --exclude='.env.example' \
  --exclude='package-lock.json' \
  --exclude='.DS_Store' \
  "$PKG_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"

echo "==> Stopping old container on $REMOTE_HOST (if running)"
ssh "$REMOTE_HOST" "cd ~/$REMOTE_DIR/.deploy && docker compose --env-file ../.env.dev down --remove-orphans"

echo "==> Building and starting on $REMOTE_HOST"
ssh "$REMOTE_HOST" "cd ~/$REMOTE_DIR/.deploy && docker compose --env-file ../.env.dev up -d --build"

echo "==> Done."
echo "    Logs:   ssh $REMOTE_HOST 'cd ~/$REMOTE_DIR/.deploy && docker compose logs -f'"
echo "    Status: ssh $REMOTE_HOST 'cd ~/$REMOTE_DIR/.deploy && docker compose ps'"
