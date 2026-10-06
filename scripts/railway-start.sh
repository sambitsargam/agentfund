#!/usr/bin/env bash
# One repository, several Railway services. Each sets AGENTFUND_SERVICE; the workspace is
# installed once at the root, so @agentfund/* resolves the same way it does locally.
set -euo pipefail
case "${AGENTFUND_SERVICE:-}" in
  atlas)    exec npm run start -w @agentfund/atlas ;;
  coworker) exec npm run start -w @agentfund/coworker ;;
  keeper)   exec npm run loop  -w @agentfund/keeper ;;
  "")
    echo "AGENTFUND_SERVICE is not set. Expected one of: atlas, coworker, keeper." >&2
    exit 1 ;;
  *)
    echo "Unknown AGENTFUND_SERVICE '${AGENTFUND_SERVICE}'. Expected one of: atlas, coworker, keeper." >&2
    exit 1 ;;
esac
