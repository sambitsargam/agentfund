#!/bin/sh
# Runs the CRE rating workflow every 15 minutes until it is deployed to a DON.
# Each run executes the real workflow and writes through the simulation forwarder.
set -u
cd "$(dirname "$0")/../workflows/rating" || exit 1
CRE="${CRE_BIN:-$HOME/.cre/bin/cre}"
INTERVAL="${RATING_INTERVAL_SECONDS:-900}"
while :; do
  "$CRE" workflow simulate rate-atlas --target staging-settings --non-interactive --trigger-index 0 --broadcast 2>&1 \
    | grep -E 'USER LOG|workflow execution failed' || echo "$(date -u +%FT%TZ) rating run produced no result"
  sleep "$INTERVAL"
done
