#!/usr/bin/env bash
set -euo pipefail

export NODE_URL=
export POSTAGE_BATCH_ID=
export METADATA_FEED_OWNER=

cd "$(dirname "$0")/.."
exec npx tsx scripts/create-metadata-feed.ts "$@"
