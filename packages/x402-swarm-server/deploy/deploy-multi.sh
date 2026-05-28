#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-dev}"
REMOTE_DIR="${REMOTE_DIR:-swarm-ai-data-exchange/x402-swarm-server}"
INSTANCES="${INSTANCES:-1 2 3}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

for i in $INSTANCES; do
  if [[ ! -f "$PKG_DIR/.env.dev$i" ]]; then
    echo "error: $PKG_DIR/.env.dev$i not found" >&2
    exit 1
  fi
done

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

for i in $INSTANCES; do
  echo "==> [instance $i] Stopping old container on $REMOTE_HOST (if running)"
  ssh "$REMOTE_HOST" "cd ~/$REMOTE_DIR/.deploy && INSTANCE_NUM=$i docker compose -f docker-compose.multi.yml down --remove-orphans"

  echo "==> [instance $i] Building and starting on $REMOTE_HOST"
  ssh "$REMOTE_HOST" "cd ~/$REMOTE_DIR/.deploy && INSTANCE_NUM=$i docker compose -f docker-compose.multi.yml up -d --build"
done

echo "==> Done."
echo "    Logs (instance N):   ssh $REMOTE_HOST 'cd ~/$REMOTE_DIR/.deploy && INSTANCE_NUM=N docker compose -f docker-compose.multi.yml logs -f'"
echo "    Status:              ssh $REMOTE_HOST 'docker ps --filter label=app=x402-swarm-server'"
